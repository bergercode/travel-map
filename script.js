// State
let stops = [];
let routeLayers = []; // Store multiple route layers
let isReordering = false;
let sortable = null;
const mapContainer = document.getElementById('map');
const sidebar = document.querySelector('.sidebar');
const stopsListEl = document.getElementById('stops-list');
const totalStopsEl = document.getElementById('total-stops');
const totalDistanceEl = document.getElementById('total-distance');
const totalDaysEl = document.getElementById('total-days'); // New
const resetBtn = document.getElementById('reset-btn');
const reorderBtn = document.getElementById('reorder-btn'); // Floating (Desktop)
const reorderBtnMobile = document.getElementById('reorder-btn-mobile'); // Sidebar (Mobile)
const undoBtn = document.getElementById('undo-btn'); // Mobile
const playBtn = document.getElementById('play-btn'); // New
const sidebarToggle = document.getElementById('sidebar-toggle');

// Initialize Map
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([20, 0], 2);

// Map Tiles
const lightMode = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
});

const darkMode = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
});

let isDarkMode = true;
darkMode.addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.attribution({ position: 'bottomright' }).addTo(map);

// Format Distance Helper
const formatDistance = (meters) => {
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(1) + ' km';
};

// Travel Constants
const TRAVEL_SPEEDS = {
    car: 60, // km/h
    train: 80,
    bus: 40,
    walk: 5,
    plane: 800
};

const calculateTime = (distMeters, method) => {
    const km = distMeters / 1000;
    const speed = TRAVEL_SPEEDS[method] || 60;
    const hours = km / speed;
    const totalMinutes = Math.round(hours * 60);

    // Return both string and raw minutes for calculation
    let display = '';
    if (totalMinutes < 60) display = `${totalMinutes} min`;
    else {
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        display = `${h} h ${m} min`;
    }

    return { display, totalMinutes, hours };
};

const isJourneyEnded = () => {
    return false; // Map never locks now
};

// Utils
const debounce = (func, wait) => {
    let timeout;
    return function (...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

const searchPlaces = async (query) => {
    if (!query || query.length < 3) return [];
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
        return await response.json();
    } catch (e) {
        console.error('Search failed', e);
        return [];
    }
};

const reverseGeocode = async (lat, lng) => {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        const addr = data.address;
        if (!addr) return null;
        return addr.city || addr.town || addr.village || addr.hamlet || data.name || null;
        return addr.city || addr.town || addr.village || addr.hamlet || data.name || null;
    } catch (e) {
        console.error('Reverse geocode failed', e);
        return null;
    }
};

// Route Fetcher
const getRoute = async (start, end, method, options = {}) => {
    // OSRM profiles: driving, walking
    // For Plane: Calculate Arc Geometry

    // Coordinates for OSRM are lon,lat

    if (method === 'plane') {
        const getArcPoints = (p1, p2) => {
            const latlngs = [];
            const lat1 = p1.lat;
            const lng1 = p1.lng;
            const lat2 = p2.lat;
            const lng2 = p2.lng;

            const midLat = (lat1 + lat2) / 2;
            const midLng = (lng1 + lng2) / 2;
            const dist = Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lng2 - lng1, 2));
            const controlLat = midLat + (dist * 0.2);
            const controlLng = midLng;

            for (let t = 0; t <= 1; t += 0.05) {
                const l = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * controlLat + t * t * lat2;
                const n = (1 - t) * (1 - t) * lng1 + 2 * (1 - t) * t * controlLng + t * t * lng2;
                latlngs.push([l, n]);
            }
            return latlngs;
        };

        if (options.flightStopovers && options.flightStopovers.length > 0) {
            // Multi-segment arc: Start -> Stopover1 -> Stopover2 ... -> End
            const points = [start, ...options.flightStopovers.map(s => s.latlng), end];
            const allArcs = [];

            for (let i = 0; i < points.length - 1; i++) {
                if (points[i] && points[i + 1]) { // Ensure valid points
                    allArcs.push(...getArcPoints(points[i], points[i + 1]));
                }
            }
            return allArcs;
        } else if (options.flightStopLatLng) {
            // Deprecated single stop support or fallback? 
            // Better to migrate `flightStopLatLng` to `flightStopovers` array internally if possible, 
            // but for now keeping back-compat or just treating it as one.
            const arc1 = getArcPoints(start, options.flightStopLatLng);
            const arc2 = getArcPoints(options.flightStopLatLng, end);
            return [...arc1, ...arc2];
        } else {
            // Single arc
            return getArcPoints(start, end);
        }
    }

    let profile = 'driving';
    if (method === 'walk') profile = 'walking';
    // Train/Bus will default to 'driving' for road mapping if available.

    // Define OSRM Server Candidates
    // We prioritize routing.openstreetmap.de as it is often more reliable than the demo server
    const candidates = [];

    // Candidate 1: routing.openstreetmap.de
    // This server separates profiles into different URL paths
    if (profile === 'driving') {
        candidates.push(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
    } else if (profile === 'walking') {
        candidates.push(`https://routing.openstreetmap.de/routed-foot/route/v1/foot/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
    } else {
        // Fallback for other profiles if added in future, trying car instance
        candidates.push(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
    }

    // Candidate 2: project-osrm.org (Original, often overloaded)
    candidates.push(`https://router.project-osrm.org/route/v1/${profile}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);

    for (const url of candidates) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 2000); // 2 second timeout per candidate

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(id);

            if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
            const json = await res.json();
            if (json.routes && json.routes.length > 0) {
                const coords = json.routes[0].geometry.coordinates;
                // GeoJSON is [lng, lat], Leaflet wants [lat, lng]
                return coords.map(c => [c[1], c[0]]);
            }
        } catch (e) {
            console.warn(`Routing failed on ${url}:`, e);
            // Continue to next candidate
        }
    }

    console.error('All routing providers failed. Using straight line fallback.');
    // Fallback: Return straight line as array of points [lat, lng]
    // Inputs start/end are Leaflet LatLng objects
    return [[start.lat, start.lng], [end.lat, end.lng]];
};

const getMethodColor = (method) => {
    switch (method) {
        case 'car': return '#00f2fe'; // Blue
        case 'train': return '#ff9f43'; // Orange
        case 'walk': return '#2ecc71'; // Green
        case 'bus': return '#f1c40f'; // Yellow
        case 'plane': return '#9b59b6'; // Purple
        default: return '#00f2fe';
    }
};

window.updateStopLocationAndName = (id, lat, lng, name) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        const newLatLng = new L.LatLng(lat, lng);
        stop.latlng = newLatLng;

        if (!stop.marker) {
            stop.marker = L.marker(newLatLng, { draggable: true }).addTo(map);

            // Bind Tooltip
            stop.marker.bindTooltip('', {
                direction: 'top',
                offset: [0, -10],
                opacity: 0.95,
                className: 'custom-tooltip'
            });

            // Drag Event
            stop.marker.on('dragend', (e) => {
                const newPos = e.target.getLatLng();
                stop.latlng = newPos;

                // Reverse Geocode
                reverseGeocode(newPos.lat, newPos.lng).then(foundName => {
                    if (foundName) {
                        const input = document.querySelector(`.stop-name-input[data-id="${id}"]`);
                        if (input && document.activeElement === input) return;

                        stop.name = foundName;
                        updateMarkerInfo(stop, stops.indexOf(stop), stop.type);
                        if (input) input.value = foundName;
                    }
                    updateUI();
                });
                updateUI();
            });
        } else {
            stop.marker.setLatLng(newLatLng);
        }

        // Auto-select travel method if not already set by user (or if currently default 'car')
        // Logic: Compare with previous stop
        const index = stops.indexOf(stop);
        if (index > 0) {
            const prev = stops[index - 1];
            if (prev && prev.latlng) {
                const dist = prev.latlng.distanceTo(newLatLng);
                const { hours } = calculateTime(dist, 'car');

                // Only override if it seems to be default 'car' or we want to force update on location change?
                // Users might have manually set it, so maybe only update if it matches the *previous* default?
                // Or just update it always on location change because location change invalidates the method choice usually?
                // Let's update it.
                if (hours < 2) stop.travelMethod = 'car';
                else if (hours <= 6) stop.travelMethod = 'train';
                else stop.travelMethod = 'plane';
            }
        }

        stop.name = name;
        updateUI();
    }
};

// Update UI
let uiUpdateId = 0;

// Update UI
const updateUI = () => {
    if (isReordering) return; // Don't redraw list while dragging

    uiUpdateId++;
    const currentId = uiUpdateId;

    stopsListEl.innerHTML = ''; // Clear list immediately

    // Clear old layers
    routeLayers.forEach(layer => map.removeLayer(layer));
    routeLayers = [];

    // Draw Routes
    if (stops.length > 1) {
        for (let i = 0; i < stops.length - 1; i++) {
            const start = stops[i];
            const end = stops[i + 1];
            // Transit method associated with the END stop (or logic: leg between i and i+1)
            // In the data model, 'method' is stored on the 'end' stop of the leg.
            // Wait, stop.travelMethod is defined on the stop. 
            // Logic check: "Transit to this stop".
            // Stop 0: Start (no method). stop 1: "travelMethod" (how I got here).
            // Yes.
            const method = end.travelMethod || 'car';

            if (start.latlng && end.latlng) {
                const activeFlightStopovers = (end.flightStopovers || []).slice(0, end.flightStops || 0);

                // Async drawing
                getRoute(start.latlng, end.latlng, method, { flightStopovers: activeFlightStopovers, flightStopLatLng: end.flightStopLatLng }).then(latlngs => {
                    if (currentId !== uiUpdateId) return; // Ignore outdated result

                    // Check for flight stopover
                    if (method === 'plane') {
                        const drawStopoverPing = (pos) => {
                            // Draw Ping
                            const ping = L.circleMarker(pos, {
                                radius: 4,
                                color: '#9b59b6', // Purple
                                fillColor: '#9b59b6',
                                fillOpacity: 1
                            }).addTo(map);

                            // Add ripple animation via CSS or just another circle
                            const ripple = L.circleMarker(pos, {
                                radius: 8,
                                color: '#9b59b6',
                                fill: false,
                                weight: 1,
                                opacity: 0.5
                            }).addTo(map);
                            routeLayers.push(ping);
                            routeLayers.push(ripple);
                        };

                        if (activeFlightStopovers && activeFlightStopovers.length > 0) {
                            activeFlightStopovers.forEach(s => {
                                if (s.latlng) drawStopoverPing(s.latlng);
                            });
                        } else if (end.flightStopLatLng) {
                            drawStopoverPing(end.flightStopLatLng);
                        }
                    }

                    // Custom Rendering per Method
                    if (method === 'train') {
                        // Railway Style: Dashed line over solid line
                        const bgPoly = L.polyline(latlngs, {
                            color: getMethodColor(method),
                            weight: 6,
                            opacity: 0.8,
                            lineCap: 'butt'
                        }).addTo(map);

                        const dashPoly = L.polyline(latlngs, {
                            color: '#fff', // White dashes
                            weight: 3,
                            opacity: 0.6,
                            dashArray: '10, 10',
                            lineCap: 'butt'
                        }).addTo(map);

                        routeLayers.push(bgPoly);
                        routeLayers.push(dashPoly);
                    } else {
                        // Standard Style
                        const color = getMethodColor(method);
                        const poly = L.polyline(latlngs, {
                            color: color,
                            weight: 4,
                            opacity: 0.8,
                            dashArray: method === 'plane' ? '10, 10' : null, // Dashed for planes
                            lineCap: 'round'
                        }).addTo(map);
                        routeLayers.push(poly);
                    }
                });
            }
        }
    }

    if (stops.length === 0) {
        stopsListEl.innerHTML = `
            <li class="empty-state">
                <i class="fa-regular fa-map"></i>
                <p>Click on the map to add your start point</p>
                <div style="margin-top: 10px; opacity: 0.7;">or</div>
                <button class="btn btn-primary" onclick="addStopFromButton()" style="margin-top: 10px;">
                    <i class="fa-solid fa-play"></i> Start
                </button>
            </li>`;

        totalStopsEl.innerText = '0';
        totalDistanceEl.innerText = '0 km';
        if (totalDaysEl) totalDaysEl.innerText = '0';

        if (routeLayers.length > 0) {
            routeLayers.forEach(l => map.removeLayer(l));
            routeLayers = [];
        }
        return;
    }

    let totalDist = 0;
    let totalTravelHours = 0;
    // Exclude start location (index 0) from total nights
    const totalNights = stops.reduce((acc, stop, index) => acc + (index === 0 ? 0 : (parseInt(stop.nights) || 0)), 0);

    stops.forEach((stop, index) => {
        // Determine implicit type
        let type = 'stop';
        if (index === 0) type = 'start';
        else if (index === stops.length - 1 && stops.length > 1) type = 'end';

        // Update the stop object type for marker consistency
        stop.type = type;

        // Render Transit (Leg) Component if not first
        if (index > 0) {
            const prev = stops[index - 1];

            // Only calc distance if both exist
            if (prev.latlng && stop.latlng) {
                // Default method is car if not set
                const method = stop.travelMethod || 'car';

                let dist = 0;

                // Calculate distance based on method and stopovers
                if (method === 'plane' && stop.flightStopovers && stop.flightStopovers.length > 0) {
                    // Multi-leg distance calculation
                    let previousPoint = prev.latlng;

                    // Slice to active stops only
                    const activeStops = stop.flightStopovers.slice(0, stop.flightStops || 0);

                    // 1. Start -> First Stopover
                    // 2. Stopover -> Next Stopover
                    activeStops.forEach(s => {
                        if (s.latlng) {
                            dist += previousPoint.distanceTo(s.latlng);
                            previousPoint = s.latlng;
                        }
                    });

                    // 3. Last Stopover -> Destination
                    if (stop.latlng) {
                        dist += previousPoint.distanceTo(stop.latlng);
                    } else {
                        dist += previousPoint.distanceTo(stop.latlng);
                    }
                } else {
                    // Standard direct distance
                    dist = prev.latlng.distanceTo(stop.latlng);
                }

                totalDist += dist;

                const timeData = calculateTime(dist, method);
                const timeStr = timeData.display;
                totalTravelHours += timeData.hours;

                // Create SEPARATE list item for transit
                const transitLi = document.createElement('li');
                transitLi.className = 'transit-item';
                transitLi.innerHTML = `
                    <div class="transit-container separate-transit">
                        <div class="transit-header">
                            <span>
                                <i class="fa-solid fa-${method === 'walk' ? 'person-walking' : method}" style="margin-right: 6px; color: var(--secondary-color);"></i>
                                ${method.charAt(0).toUpperCase() + method.slice(1)}
                                <span style="opacity: 0.5; margin-left: 8px; font-weight: 400;">${formatDistance(dist)}</span>
                            </span>
                            <span class="transit-time">${timeStr}</span>
                        </div>
                        <div class="transit-options">
                            <button class="transit-option-btn btn-car ${method === 'car' ? 'active' : ''}" 
                                    onclick="setTravelMethod(${stop.id}, 'car')" title="Car">
                                <i class="fa-solid fa-car"></i>
                            </button>
                            <button class="transit-option-btn btn-bus ${method === 'bus' ? 'active' : ''}" 
                                    onclick="setTravelMethod(${stop.id}, 'bus')" title="Bus">
                                <i class="fa-solid fa-bus"></i>
                            </button>
                            <button class="transit-option-btn btn-train ${method === 'train' ? 'active' : ''}" 
                                    onclick="setTravelMethod(${stop.id}, 'train')" title="Train">
                                <i class="fa-solid fa-train"></i>
                            </button>
                            <button class="transit-option-btn btn-walk ${method === 'walk' ? 'active' : ''}" 
                                    onclick="setTravelMethod(${stop.id}, 'walk')" title="Walk">
                                <i class="fa-solid fa-person-walking"></i>
                            </button>
                            <button class="transit-option-btn btn-plane ${method === 'plane' ? 'active' : ''}" 
                                    onclick="setTravelMethod(${stop.id}, 'plane')" title="Flight">
                                <i class="fa-solid fa-plane"></i>
                            </button>
                        </div>
                        ${method === 'plane' ? `
                        <div class="flight-details" style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                           <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                                <span style="font-size: 11px; color: var(--text-muted); text-transform: uppercase;">Stops</span>
                                <input type="number" min="0" value="${stop.flightStops !== undefined ? stop.flightStops : 0}" 
                                       style="width: 40px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px; padding: 2px 4px; text-align: center;"
                                       onchange="updateFlightStops(${stop.id}, this.value)">
                                <div class="night-adjust-btns" style="margin-left: 2px;">
                                   <button class="night-btn btn-plus" onclick="adjustFlightStops(${stop.id}, 1)">+</button>
                                   <button class="night-btn btn-minus" onclick="adjustFlightStops(${stop.id}, -1)">-</button>
                                </div>
                                ${(stop.flightStops !== undefined && stop.flightStops > 0) ? `
                                <button class="btn-toggle-stops" onclick="toggleFlightStops(${stop.id})" style="margin-left: auto; background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px;">
                                    <i class="fa-solid fa-chevron-${stop.isFlightStopsCollapsed ? 'down' : 'up'}"></i>
                                </button>
                                ` : ''}
                           </div>
                           ${(stop.flightStops === undefined || stop.flightStops > 0) && !stop.isFlightStopsCollapsed ? `
                           <div class="stopovers-list-container">
                               ${(function () {
                                const count = stop.flightStops !== undefined ? stop.flightStops : 0;
                                let html = '';
                                for (let i = 0; i < count; i++) {
                                    const val = (stop.flightStopovers && stop.flightStopovers[i]) ? stop.flightStopovers[i].name : (i === 0 && stop.flightStopName ? stop.flightStopName : '');
                                    html += `
                                       <div class="stopover-input-container" style="margin-bottom: 4px;">
                                           <input type="text" placeholder="Stopover ${i + 1} City"
                                                  class="stopover-name-input"
                                                  data-id="${stop.id}"
                                                  data-index="${i}"
                                                  value="${val || ''}"
                                                  style="width: 100%; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); color: white; border-radius: 4px; padding: 4px 8px; font-size: 12px; font-family: inherit;"
                                                  onchange="updateFlightStopover(${stop.id}, ${i}, this.value)"
                                                  autocomplete="off">
                                           <div class="suggestions-dropdown" id="dropdown-stopover-${stop.id}-${i}" style="top: 100%; left: 0; right: 0;"></div>
                                       </div>`;
                                }
                                return html;
                            })()}
                           </div>
                           ` : ''}
                       </div>
                        ` : ''}
                    </div>
                `;
                stopsListEl.appendChild(transitLi);
            }
        }

        const li = document.createElement('li');
        li.className = 'stop-item';
        li.dataset.id = stop.id;

        // Render Type Badge
        const typeBadge = `<span class="stop-type-badge type-${type}">${type.toUpperCase()}</span>`;

        const displayName = stop.name || `Stop #${index + 1}`;
        const nights = stop.nights || 0;

        // New Card Layout
        li.innerHTML = `
            <div class="stop-card-header">
                 <input type="text" 
                       class="stop-name-input" 
                       data-id="${stop.id}"
                       value="${displayName}" 
                       onchange="updateStopName(${stop.id}, this.value)" 
                       onclick="this.select()"
                       aria-label="Stop Name"
                       placeholder="Enter Stop Name"
                       autocomplete="off"
                />
                <div class="suggestions-dropdown" id="dropdown-${stop.id}"></div>
            </div>
            
            <div class="stop-controls-row">
                <div class="stop-main-controls">
                    <i class="fa-solid fa-grip-lines drag-handle"></i>
                    ${typeBadge}
                    
                    ${type !== 'start' ? `
                    <div class="nights-counter" title="Nights at this stop">
                        <i class="fa-solid fa-moon" style="font-size: 10px; color: #a0a0b0; margin-right: 4px;"></i>
                        <input type="number" 
                               class="nights-input" 
                               value="${nights}" 
                               min="0"
                               onchange="updateStopNights(${stop.id}, this.value)"
                        />
                        <span class="nights-label">Nights</span>
                        <div class="night-adjust-btns">
                           <button class="night-btn btn-plus" onclick="adjustNights(${stop.id}, 1)">+</button>
                           <button class="night-btn btn-minus" onclick="adjustNights(${stop.id}, -1)">-</button>
                        </div>
                    </div>` : ''}
                </div>
                
                <button class="delete-btn" onclick="removeStop(${stop.id})" title="Remove Stop">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
            

        `;
        stopsListEl.appendChild(li);

        // Update marker tooltip (ONLY if marker exists)
        if (stop.marker) {
            updateMarkerInfo(stop, index, type);
        }
    });

    // Add "Plus" Button if we have at least one stop (Start)
    // Only show if NOT reordering
    if (stops.length > 0 && !isReordering) {
        const addLi = document.createElement('li');
        addLi.className = 'add-stop-item';
        addLi.innerHTML = `
            <button class="btn-add-stop" onclick="addStopFromButton()" title="Add Stop">
                <i class="fa-solid fa-plus"></i>
            </button>
         `;
        stopsListEl.appendChild(addLi);
    }

    stopsListEl.scrollTop = stopsListEl.scrollHeight;
    totalStopsEl.innerText = stops.length;
    totalDistanceEl.innerText = formatDistance(totalDist);

    // Total Days Calculation: Nights + (Travel Hours / 24 rounded up)
    let travelDays = 0;
    if (totalTravelHours > 0) {
        // If we want to be strict: 
        // travelDays = Math.floor(totalTravelHours / 24);
        // But maybe user wants to see fractional days or "partial days"?
        // Simples: Total Days usually includes travel days.
        // If I travel 2 hours, does it add a day? Usually not if I stay 0 nights.
        // But if I stay 2 nights, it's 2 nights + travel. 
        // Let's assuming travel time adds to duration if it's significant, 
        // but "Nights" usually implies the duration of the trip excluding travel?
        // Let's just append (X days travel) if significant? 
        // Or just add to the total days number.
        travelDays = totalTravelHours / 24;
    }

    // Display as integer for simplicity, rounding up if travel is significant?
    // "Total Days" of a trip usually means "Duration".
    // 3 nights = 4 days trip usually.
    // Let's simple format to 1 decimal if needed, or just Math.round.
    const grandTotal = totalNights + travelDays;
    // Formatting: if travelDays is small, it might not show up if we just round.
    // Let's show decimal if non-integer.
    if (!Number.isInteger(grandTotal)) {
        totalDaysEl.innerText = grandTotal.toFixed(1);
    } else {
        totalDaysEl.innerText = grandTotal;
    }
};

// Add Stop (Modified for Manual Entry support)
const addStop = (latlng = null) => {
    if (isReordering) return;

    const id = Date.now();
    let name = null;
    let travelMethod = 'car';
    const nights = 1;
    let marker = null;

    if (latlng) {
        // Normal Map Click Logic
        if (stops.length > 0) {
            const last = stops.filter(s => s.latlng)[stops.length - 1]; // Find last valid stop
            if (last && last.latlng) {
                const dist = last.latlng.distanceTo(latlng);
                const { hours } = calculateTime(dist, 'car');
                if (hours < 2) travelMethod = 'car';
                else if (hours <= 6) travelMethod = 'train';
                else travelMethod = 'plane';
            }
        }

        marker = L.marker(latlng, { draggable: true }).addTo(map);

        marker.bindTooltip('', {
            direction: 'top',
            offset: [0, -10],
            opacity: 0.95,
            className: 'custom-tooltip'
        });
    }

    // If manual entry (no latlng), we initialize minimal object.
    const newStop = { id, latlng, marker, name, travelMethod, nights, type: 'stop' };
    stops.push(newStop);

    if (latlng && marker) {
        // Drag Event for Marker
        marker.on('dragend', (e) => {
            const newPos = e.target.getLatLng();
            newStop.latlng = newPos;

            reverseGeocode(newPos.lat, newPos.lng).then(foundName => {
                if (foundName) {
                    const input = document.querySelector(`.stop-name-input[data-id="${id}"]`);
                    if (input && document.activeElement === input) return;

                    newStop.name = foundName;
                    updateMarkerInfo(newStop, stops.indexOf(newStop), newStop.type);
                    if (input) input.value = foundName;
                }
                updateUI();
            });
            updateUI();
        });

        // Reverse Geocode Initial
        reverseGeocode(latlng.lat, latlng.lng).then(foundName => {
            if (foundName) {
                const s = stops.find(x => x.id === id);
                if (s && !s.name) {
                    const input = document.querySelector(`.stop-name-input[data-id="${id}"]`);
                    if (input && document.activeElement === input) return;

                    s.name = foundName;
                    updateMarkerInfo(s, stops.indexOf(s), s.type);
                    if (input) input.value = foundName;
                }
            }
        });
    }

    updateUI();

    // Auto-focus the input if it was a button add
    if (!latlng) {
        setTimeout(() => {
            const input = document.querySelector(`.stop-name-input[data-id="${id}"]`);
            if (input) input.focus();
        }, 50);
    }
};

window.addStopFromButton = () => {
    addStop(null);
};

// Helper: Update Marker Tooltip
const updateMarkerInfo = (s, idx, type) => {
    const displayName = s.name || `Stop #${idx + 1}`;

    const content = `
        <div style="text-align: center; font-family: 'Outfit', sans-serif;">
            <b>${displayName}</b>
            <div style="font-size: 0.85em; opacity: 0.8; margin-top: 2px;">${type.toUpperCase()}</div>
        </div>
    `;
    s.marker.setTooltipContent(content);
};

window.removeStop = (id) => {
    const index = stops.findIndex(s => s.id === id);
    if (index !== -1) {
        if (stops[index].marker) {
            map.removeLayer(stops[index].marker);
        }
        stops.splice(index, 1);
        updateUI();
    }
};

window.setTravelMethod = (id, method) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        stop.travelMethod = method;
        updateUI();
    }
};

window.updateStopName = (id, newName) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        stop.name = newName;
        const idx = stops.indexOf(stop);
        let type = 'stop';
        if (idx === 0) type = 'start';
        else if (idx === stops.length - 1 && stops.length > 1) type = 'end';

        updateMarkerInfo(stop, idx, type);
    }
};

window.updateStopNights = (id, newNights) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        stop.nights = parseInt(newNights) || 0;
        updateUI(); // Need full redraw to recalc travel days potentially if we wanted to be super accurate, but here just updating text is safer.
        // Actually, updating nights doesn't change travel time, just the sum.
        // We can just trigger updateUI safely.
        // But to avoid focus loss, we might want to skip updateUI if it's just nights.
        // But the user requested "Take into account transit times". Transit times are constant unless location changes.
        // So updateUI is fine EXCEPT for focus loss.
        // I'll stick to full updateUI() for correctness on the Total calculation which now involves floats.
        // To fix focus loss, we can rely on 'onchange' which fires on blur/enter, not every keystroke.
    }
};

window.adjustNights = (id, delta) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        let n = (parseInt(stop.nights) || 0) + delta;
        if (n < 0) n = 0;
        stop.nights = n;
        updateUI();
    }
};

window.updateFlightStops = (id, val) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        let count = parseInt(val) || 0;
        if (count < 0) count = 0;
        stop.flightStops = count;

        // Ensure array exists and is sized correctly
        if (!stop.flightStopovers) stop.flightStopovers = [];

        // If we have single flightStopName/LatLng from before, migrate it to array if array is empty
        if (stop.flightStopovers.length === 0 && stop.flightStopName) {
            stop.flightStopovers.push({
                name: stop.flightStopName,
                latlng: stop.flightStopLatLng
            });
        }

        // Clip or Grow
        // Actually we don't need to explicitly grow with empty objects immediately, 
        // the UI loop handles rendering. But for state consistency it's nice.
        // Let's just keep the existing data if we reduce count, so if user accidentally reduces and increases, data is there?
        // No, typically we slice.
        // But for "Stop 1", "Stop 2" logic, maybe we slice.
        // Let's not delete data aggressively.
        // But updateUI renders loop based on count.

        updateUI();
    }
};

window.adjustFlightStops = (id, delta) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        let count = (stop.flightStops !== undefined ? stop.flightStops : 0) + delta;
        if (count < 0) count = 0;
        updateFlightStops(id, count);
    }
};



window.toggleFlightStops = (id) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        stop.isFlightStopsCollapsed = !stop.isFlightStopsCollapsed;
        updateUI();
    }
};

window.updateFlightStopover = (id, index, name) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        if (!stop.flightStopovers) stop.flightStopovers = [];

        // Ensure object at index
        if (!stop.flightStopovers[index]) stop.flightStopovers[index] = {};

        stop.flightStopovers[index].name = name;

        // Backward compat sync for first one
        if (index === 0) {
            stop.flightStopName = name;
        }

        if (name.length > 2) {
            searchPlaces(name).then(res => {
                if (res && res.length > 0) {
                    const latlng = new L.LatLng(res[0].lat, res[0].lon);
                    // Re-check existence
                    if (!stop.flightStopovers[index]) stop.flightStopovers[index] = {};
                    stop.flightStopovers[index].latlng = latlng;

                    if (index === 0) stop.flightStopLatLng = latlng;

                    updateUI();
                }
            });
        } else {
            if (stop.flightStopovers[index]) stop.flightStopovers[index].latlng = null;
            if (index === 0) stop.flightStopLatLng = null;
            updateUI();
        }
    }
};



// Reorder Logic
// Reorder Logic Shared
const toggleReorderMode = () => {
    isReordering = !isReordering;

    const setupButton = (btn, isReordering) => {
        if (!btn) return;
        if (isReordering) {
            btn.innerHTML = `<i class="fa-solid fa-check"></i> Done`;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
        } else {
            btn.innerHTML = `<i class="fa-solid fa-sort"></i> Reorder`;
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        }
    };

    // Update both buttons visually
    setupButton(reorderBtn, isReordering);
    setupButton(reorderBtnMobile, isReordering);

    if (isReordering) {
        // Mode ON
        stopsListEl.classList.add('reordering');
        mapContainer.classList.add('map-locked');

        // Disable map dragging
        map.dragging.disable();

        // Create Sortable
        sortable = Sortable.create(stopsListEl, {
            animation: 150,
            handle: '.stop-item', // Drag by whole item or handle?
            // Actually let's use the handle
            handle: '.stop-item',
            // The handle is .drag-handle but we can make whole item draggable if we want.
            // Let's use the whole item for now, or just the handle?
            // If I look at CSS: `.stops-list.reordering .stop-item` has `cursor: grab`.
            // Let's try whole item.
            onEnd: (evt) => {
                // Update array order
                const item = stops.splice(evt.oldIndex, 1)[0];
                stops.splice(evt.newIndex, 0, item);

                // Update Types (Start/End)
                // Actually updateUI handles types based on index, so just calling updateUI() is enough?
                // Yes, but we need to update the model first. 
                // Done above with splice.

                // Redraw
                updateUI();
            }
        });

    } else {
        // Mode OFF
        stopsListEl.classList.remove('reordering');
        mapContainer.classList.remove('map-locked');

        map.dragging.enable();

        if (sortable) {
            sortable.destroy();
            sortable = null;
        }

        updateUI();
    }
};

reorderBtn.addEventListener('click', toggleReorderMode);
reorderBtnMobile.addEventListener('click', toggleReorderMode);

// Undo Logic
if (undoBtn) {
    undoBtn.addEventListener('click', () => {
        if (isReordering) return;
        if (stops.length > 0) {
            const lastStop = stops.pop();
            if (lastStop.marker) {
                map.removeLayer(lastStop.marker);
            }
            updateUI();
        }
    });
}

// Map Events
map.on('click', (e) => {
    addStop(e.latlng);
});

resetBtn.addEventListener('click', () => {
    stops.forEach(s => {
        if (s.marker) map.removeLayer(s.marker);
    });
    stops = [];
    isReordering = false; // Reset mode
    if (sortable) sortable.destroy();

    // Reset button state just in case
    reorderBtn.innerHTML = `<i class="fa-solid fa-sort"></i> Reorder`;
    reorderBtn.classList.remove('btn-primary');
    reorderBtn.classList.add('btn-secondary');
    stopsListEl.classList.remove('reordering');

    updateUI();
});

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('active');
    const icon = sidebarToggle.querySelector('i');
    if (sidebar.classList.contains('active')) {
        icon.classList.remove('fa-bars');
        icon.classList.add('fa-xmark');
    } else {
        icon.classList.remove('fa-xmark');
        icon.classList.add('fa-bars');
    }
});

// Autocomplete Event Listeners
stopsListEl.addEventListener('input', debounce(async (e) => {
    if (e.target.classList.contains('stop-name-input') || e.target.classList.contains('stopover-name-input')) {
        const input = e.target;
        const stopId = input.dataset.id;
        const query = input.value;

        let dropdownId = `dropdown-${stopId}`;
        if (input.classList.contains('stopover-name-input')) {
            const index = input.dataset.index !== undefined ? input.dataset.index : 0;
            dropdownId = `dropdown-stopover-${stopId}-${index}`;
        }

        const dropdown = document.getElementById(dropdownId);

        if (!dropdown) return;

        if (query.length < 3) {
            dropdown.classList.remove('active');
            return;
        }

        const results = await searchPlaces(query);
        if (results.length > 0) {
            dropdown.innerHTML = results.map(r => `
                <div class="suggestion-item" 
                     data-lat="${r.lat}" 
                     data-lon="${r.lon}" 
                     data-name="${r.display_name}">
                     <div style="pointer-events: none;">
                        <strong>${r.display_name.split(',')[0]}</strong>
                        <small>${r.display_name}</small>
                     </div>
                </div>
            `).join('');
            dropdown.classList.add('active');
        } else {
            dropdown.classList.remove('active');
        }
    }
}, 300));

stopsListEl.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (item) {
        const dropdown = item.parentElement;
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lon);
        // Use the first part of the display name (e.g. "Cologne") as the main name
        const displayName = item.dataset.name.split(',')[0];

        if (dropdown.id.startsWith('dropdown-stopover-')) {
            // ID format: dropdown-stopover-{id}-{index}
            const parts = dropdown.id.replace('dropdown-stopover-', '').split('-');
            const stopId = parseInt(parts[0]);
            const index = parseInt(parts[1]);

            // For stopover, we update the stopover name and location
            const stop = stops.find(s => s.id === stopId);
            if (stop) {
                // Ensure array
                if (!stop.flightStopovers) stop.flightStopovers = [];
                if (!stop.flightStopovers[index]) stop.flightStopovers[index] = {};

                stop.flightStopovers[index].name = displayName;
                stop.flightStopovers[index].latlng = new L.LatLng(lat, lng);

                // Back compat
                if (index === 0) {
                    stop.flightStopName = displayName;
                    stop.flightStopLatLng = new L.LatLng(lat, lng);
                }

                updateUI();
            }
        } else {
            // Normal Stop
            const stopId = parseInt(dropdown.id.replace('dropdown-', ''));
            updateStopLocationAndName(stopId, lat, lng, displayName);
        }

        dropdown.classList.remove('active');
    }
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.stop-card-header')) {
        document.querySelectorAll('.suggestions-dropdown.active').forEach(el => el.classList.remove('active'));
    }
});
const playbackTimeDisplay = document.getElementById('playback-time');
const speedDisplay = document.getElementById('speed-val');
const speedUpBtn = document.getElementById('speed-up');
const speedDownBtn = document.getElementById('speed-down');
const centerBtn = document.getElementById('center-btn');

// Speed State
const speeds = [0.025, 0.1, 0.25, 0.5, 1, 2, 5];
let currentSpeedIdx = 2; // Default 1x

const updateSpeedUI = () => {
    speedDisplay.innerText = speeds[currentSpeedIdx] + 'x';
};

speedUpBtn.addEventListener('click', () => {
    if (currentSpeedIdx < speeds.length - 1) {
        currentSpeedIdx++;
        updateSpeedUI();
    }
});

speedDownBtn.addEventListener('click', () => {
    if (currentSpeedIdx > 0) {
        currentSpeedIdx--;
        updateSpeedUI();
    }
});

// Play Trip Logic
let playbackMarker = null;
let isPlaying = false;
let isCameraLocked = true;

const updateCenterBtnUI = () => {
    if (isCameraLocked) {
        centerBtn.classList.remove('btn-secondary');
        centerBtn.classList.add('btn-primary');
    } else {
        centerBtn.classList.remove('btn-primary');
        centerBtn.classList.add('btn-secondary');
    }
};

centerBtn.addEventListener('click', () => {
    isCameraLocked = !isCameraLocked;
    updateCenterBtnUI();
    if (isCameraLocked && playbackMarker) {
        map.panTo(playbackMarker.getLatLng(), { animate: true });
    }
});

map.on('dragstart', () => {
    if (isPlaying && isCameraLocked) {
        isCameraLocked = false;
        updateCenterBtnUI();
    }
});

playBtn.addEventListener('click', async () => {
    if (isPlaying) {
        // Stop logic if clicked while playing
        isPlaying = false;
        playBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
        return;
    }
    if (stops.length < 2) return;

    isPlaying = true;
    isCameraLocked = true;
    updateCenterBtnUI();

    playBtn.innerHTML = `<i class="fa-solid fa-stop"></i>`;
    playbackTimeDisplay.style.display = 'block';

    try {
        // 1. Gather all segments with detailed geometry
        const segments = [];

        for (let i = 0; i < stops.length - 1; i++) {
            const start = stops[i];
            const end = stops[i + 1];
            const method = end.travelMethod || 'car';

            // We re-fetch route to ensure we have the points for animation
            const latlngs = await getRoute(start.latlng, end.latlng, method, {
                flightStopovers: end.flightStopovers,
                flightStopLatLng: end.flightStopLatLng
            });

            // Calculate duration: 
            let dist = 0;
            for (let j = 0; j < latlngs.length - 1; j++) {
                dist += L.latLng(latlngs[j]).distanceTo(L.latLng(latlngs[j + 1]));
            }

            const speedKmph = TRAVEL_SPEEDS[method] || 60;
            const totalHours = (dist / 1000) / speedKmph;

            // Base: 1 hour real time = 1000ms animation time (1 sec)
            // This is the "1x" speed reference.
            const baseDurationMs = totalHours * 1000;

            segments.push({
                latlngs: latlngs,
                realDurationHours: totalHours,
                baseAnimDuration: Math.max(baseDurationMs, 500),
                method: method,
                nightsAfter: parseInt(end.nights) || 0 // Nights spent AT the destination
            });
        }

        // 2. Start Animation Sequence
        if (playbackMarker) map.removeLayer(playbackMarker);

        const icons = {
            car: 'fa-car',
            bus: 'fa-bus',
            train: 'fa-train',
            walk: 'fa-person-walking',
            plane: 'fa-plane'
        };

        const createMarker = (method) => {
            return L.divIcon({
                className: 'travel-token',
                html: `<div class="token-inner" style="background: ${getMethodColor(method)}"><i class="fa-solid ${icons[method]}"></i></div>`,
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            });
        };

        playbackMarker = L.marker(segments[0].latlngs[0], {
            icon: createMarker(segments[0].method),
            zIndexOffset: 1000
        }).addTo(map);

        // Time Tracking
        // Start Day 1, 08:00
        let currentDay = 1;
        let currentHour = 8.0;

        const updateTimeDisplay = () => {
            const d = Math.floor(currentDay);
            // Hour wrapping
            let h = Math.floor(currentHour % 24);
            let m = Math.floor((currentHour % 1) * 60);
            const hStr = h.toString().padStart(2, '0');
            const mStr = m.toString().padStart(2, '0');

            playbackTimeDisplay.innerHTML = `Day ${d} <span style="opacity: 0.7;">${hStr}:${mStr}</span>`;
        };

        updateTimeDisplay();

        // Animation Loop
        for (const segment of segments) {
            if (!isPlaying) break;

            playbackMarker.setIcon(createMarker(segment.method));

            const points = segment.latlngs;

            // Reset progress for this segment
            let progress = 0;
            let lastTimestamp = performance.now();

            await new Promise(resolve => {
                const animate = (timestamp) => {
                    if (!isPlaying) {
                        resolve();
                        return;
                    }

                    // Calculate Delta Time
                    const dt = timestamp - lastTimestamp;
                    lastTimestamp = timestamp;

                    // Speed Factor
                    const speedMult = speeds[currentSpeedIdx];

                    // Advance progress
                    // progress is 0..1
                    // dt is ms. baseAnimDuration is ms for 1x.
                    // At 1x speed: total time = baseAnimDuration
                    // At 2x speed: total time = baseAnimDuration / 2
                    // deltaProgress = dt / (currentDuration)
                    // currentDuration = baseAnimDuration / speedMult
                    // deltaProgress = (dt * speedMult) / baseAnimDuration

                    // Use a safe minimum duration to avoid division by zero or super fast jumps
                    const safeDuration = Math.max(segment.baseAnimDuration, 100);
                    const deltaProgress = (dt * speedMult) / safeDuration;

                    progress += deltaProgress;

                    if (progress > 1) progress = 1;

                    // Update Time
                    // Real hours passed = progress * segment.realDurationHours
                    // But we are accumulating. 
                    const deltaRealHours = (deltaProgress * safeDuration) / 1000; // 1000ms = 1hr animation logic
                    // Wait, if 1000ms animation = 1 hr real time
                    // Then deltaRealHours = (dt * speedMult) / 1000.
                    // Check: if dt=1000ms (1sec), speed=1, then deltaRealHours=1. Correct.
                    // Check: if dt=1000ms, speed=10, then deltaRealHours=10. Correct.

                    currentHour += (dt * speedMult) / 1000;

                    if (currentHour >= 24) {
                        const daysPassed = Math.floor(currentHour / 24);
                        currentDay += daysPassed;
                        currentHour = currentHour % 24;
                    }
                    updateTimeDisplay();

                    // Interpolate Position
                    let lat, lng;
                    if (points.length === 2) {
                        lat = points[0][0] + (points[1][0] - points[0][0]) * progress;
                        lng = points[0][1] + (points[1][1] - points[0][1]) * progress;
                    } else {
                        const totalIdx = points.length - 1;
                        const floatIdx = progress * totalIdx;
                        const idx = Math.floor(floatIdx);
                        const nextIdx = Math.min(idx + 1, totalIdx);
                        const subProgress = floatIdx - idx;

                        const p1 = points[idx];
                        const p2 = points[nextIdx];

                        if (p1 && p2) {
                            lat = p1[0] + (p2[0] - p1[0]) * subProgress;
                            lng = p1[1] + (p2[1] - p1[1]) * subProgress;
                        } else if (p1) {
                            lat = p1[0];
                            lng = p1[1];
                        }
                    }

                    if (lat && lng) {
                        const newPos = [lat, lng];
                        playbackMarker.setLatLng(newPos);
                        if (isCameraLocked) {
                            map.panTo(newPos, { animate: false });
                        }
                    }

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    } else {
                        resolve();
                    }
                };
                requestAnimationFrame(animate);
            });

            // End of Segment: Process Nights
            if (segment.nightsAfter > 0) {
                // Add nights to time
                currentDay += segment.nightsAfter;
                // Update time to morning (e.g., check out time 10:00 or stay same)
                // Just add full 24h days for simplicity
                updateTimeDisplay();

                // Brief pause to show we stopped?
                await new Promise(r => setTimeout(r, 500));
            }
        }

    } catch (err) {
        console.error("Playback error:", err);
    } finally {
        // Finish
        isPlaying = false;
        playBtn.innerHTML = `<i class="fa-solid fa-play"></i>`;
        playbackTimeDisplay.style.display = 'none';
        if (playbackMarker) {
            map.removeLayer(playbackMarker);
            playbackMarker = null;
        }
        const group = new L.featureGroup(stops.map(s => s.marker));
        map.fitBounds(group.getBounds().pad(0.2));
    }
});

// Map Theme Toggle Logic
window.toggleMapTheme = () => {
    isDarkMode = !isDarkMode;

    if (isDarkMode) {
        map.removeLayer(lightMode);
        darkMode.addTo(map);
    } else {
        map.removeLayer(darkMode);
        lightMode.addTo(map);
    }

    // Update Icons
    const iconClass = isDarkMode ? 'fa-moon' : 'fa-sun';
    const desktopIcon = document.querySelector('#theme-toggle-btn i');
    const mobileIcon = document.querySelector('#theme-toggle-mobile i');

    if (desktopIcon) {
        desktopIcon.className = `fa-solid ${iconClass}`;
    }
    if (mobileIcon) {
        mobileIcon.className = `fa-solid ${iconClass}`;
    }
};

const desktopToggleBtn = document.getElementById('theme-toggle-btn');
const mobileToggleBtn = document.getElementById('theme-toggle-mobile');

if (desktopToggleBtn) {
    desktopToggleBtn.addEventListener('click', toggleMapTheme);
}

if (mobileToggleBtn) {
    mobileToggleBtn.addEventListener('click', toggleMapTheme);
}
