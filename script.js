// State
let stops = [];
let polyline = null;
let isReordering = false;
let sortable = null;

const mapContainer = document.getElementById('map');
const sidebar = document.querySelector('.sidebar');
const stopsListEl = document.getElementById('stops-list');
const totalStopsEl = document.getElementById('total-stops');
const totalDistanceEl = document.getElementById('total-distance');
const resetBtn = document.getElementById('reset-btn');
const reorderBtn = document.getElementById('reorder-btn');
const sidebarToggle = document.getElementById('sidebar-toggle');

// Initialize Map
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([20, 0], 2);

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.attribution({ position: 'bottomright' }).addTo(map);

// Format Distance Helper
const formatDistance = (meters) => {
    if (meters < 1000) return Math.round(meters) + ' m';
    return (meters / 1000).toFixed(1) + ' km';
};

// Check if flow is complete (has END stop)
const isJourneyEnded = () => {
    return stops.some(s => s.type === 'end');
};

// Update UI
const updateUI = () => {
    if (isReordering) return; // Don't redraw list while dragging

    stopsListEl.innerHTML = '';

    // Check if map should be locked
    if (isJourneyEnded()) {
        mapContainer.classList.add('map-locked');
    } else {
        mapContainer.classList.remove('map-locked');
    }

    if (stops.length === 0) {
        stopsListEl.innerHTML = `
            <li class="empty-state">
                <i class="fa-regular fa-map"></i>
                <p>Click on the map to add your start point</p>
            </li>`;

        totalStopsEl.innerText = '0';
        totalDistanceEl.innerText = '0 km';

        if (polyline) {
            map.removeLayer(polyline);
            polyline = null;
        }
        return;
    }

    // Refresh Map Lines
    const latlngs = stops.map(s => s.latlng);
    if (polyline) {
        polyline.setLatLngs(latlngs);
    } else {
        polyline = L.polyline(latlngs, {
            color: '#00f2fe',
            weight: 3,
            opacity: 0.7,
            dashArray: '10, 10',
            lineCap: 'round'
        }).addTo(map);
    }

    let totalDist = 0;

    stops.forEach((stop, index) => {
        let legDistance = 0;
        let legInfoHtml = '';

        if (index > 0) {
            const prev = stops[index - 1];
            const dist = prev.latlng.distanceTo(stop.latlng);
            legDistance = dist;
            totalDist += dist;
            legInfoHtml = `
                <div class="leg-info">
                    <i class="fa-solid fa-route"></i>
                    <span>+ ${formatDistance(dist)} from previous</span>
                </div>
            `;
        }

        const li = document.createElement('li');
        li.className = 'stop-item';
        li.dataset.id = stop.id;

        // Determine controls based on index/type
        let typeControl = '';
        if (index === 0) {
            typeControl = `<span class="stop-type-badge type-start">Start</span>`;
        } else {
            typeControl = `
                <select class="type-select" onchange="changeStopType(${stop.id}, this.value)">
                    <option value="transit" ${stop.type === 'transit' ? 'selected' : ''}>Transit</option>
                    <option value="stop" ${stop.type === 'stop' ? 'selected' : ''}>Stop</option>
                    <option value="end" ${stop.type === 'end' ? 'selected' : ''}>End</option>
                </select>
            `;
        }

        li.innerHTML = `
            <div class="stop-header">
                <i class="fa-solid fa-grip-lines drag-handle"></i>
                <span class="stop-name">Stop #${index + 1}</span>
                <div class="stop-controls">
                    ${typeControl}
                    <button class="delete-btn" onclick="removeStop(${stop.id})" title="Remove Stop">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="stop-coords">${stop.latlng.lat.toFixed(4)}, ${stop.latlng.lng.toFixed(4)}</div>
            ${legInfoHtml}
        `;
        stopsListEl.appendChild(li);
    });

    stopsListEl.scrollTop = stopsListEl.scrollHeight;
    totalStopsEl.innerText = stops.length;
    totalDistanceEl.innerText = formatDistance(totalDist);
};

// Add Stop
const addStop = (latlng) => {
    if (isJourneyEnded()) {
        alert("Journey has ended. Remove the 'End' stop or change its type to add more.");
        return;
    }
    if (isReordering) return;

    const id = Date.now();
    let type = 'transit'; // default
    if (stops.length === 0) type = 'start'; // first is always start

    // Enable dragging
    const marker = L.marker(latlng, { draggable: true }).addTo(map);

    // Bind Tooltip for Hover
    marker.bindTooltip('', {
        direction: 'top',
        offset: [0, -10],
        opacity: 0.95,
        className: 'custom-tooltip' // We can add styles for this if needed
    });

    const newStop = { id, latlng, marker, type };
    stops.push(newStop);

    // Drag Event
    marker.on('dragend', (e) => {
        const newPos = e.target.getLatLng();
        newStop.latlng = newPos;
        updateUI(); // Recalculate distances and lines
        updateMarkerInfo(newStop, stops.indexOf(newStop));
    });

    // Initial info update
    updateMarkerInfo(newStop, stops.length - 1);

    // marker.openPopup(); // Removed popup open on create, tooltip handles info now? 
    // User asked for hover info. Let's keep popup on click if they want persistent info?
    // Actually, let's keep the popup logic but maybe update it too.
    // The previous code had `marker.openPopup()` which was nice for feedback.
    // Let's stick to tooltip for hover as requested.

    updateUI();
};

// Helper: Update Marker Tooltip
const updateMarkerInfo = (s, idx) => {
    const content = `
        <div style="text-align: center; font-family: 'Outfit', sans-serif;">
            <b>Stop #${idx + 1}</b>
            <div style="font-size: 0.85em; opacity: 0.8; margin-top: 2px;">${s.type.toUpperCase()}</div>
        </div>
    `;
    s.marker.setTooltipContent(content);
};

window.removeStop = (id) => {
    const index = stops.findIndex(s => s.id === id);
    if (index !== -1) {
        map.removeLayer(stops[index].marker);
        stops.splice(index, 1);

        // If we removed the start (index 0), make the new index 0 the start
        if (index === 0 && stops.length > 0) {
            stops[0].type = 'start';
        }

        // Refresh all markers info
        stops.forEach((s, i) => updateMarkerInfo(s, i));

        updateUI();
    }
};

window.changeStopType = (id, newType) => {
    const stop = stops.find(s => s.id === id);
    if (stop) {
        stop.type = newType;
        const idx = stops.indexOf(stop);
        updateMarkerInfo(stop, idx);
        updateUI();
    }
};

// Reorder Logic
reorderBtn.addEventListener('click', () => {
    isReordering = !isReordering;

    if (isReordering) {
        // Mode ON
        reorderBtn.innerHTML = `<i class="fa-solid fa-check"></i> Done`;
        reorderBtn.classList.remove('btn-secondary');
        reorderBtn.classList.add('btn-primary');
        stopsListEl.classList.add('reordering');

        // Initialize Sortable
        sortable = new Sortable(stopsListEl, {
            animation: 150,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost'
        });

    } else {
        // Mode OFF - SAVE CHANGES
        reorderBtn.innerHTML = `<i class="fa-solid fa-sort"></i> Reorder`;
        reorderBtn.classList.remove('btn-primary');
        reorderBtn.classList.add('btn-secondary');
        stopsListEl.classList.remove('reordering');

        if (sortable) {
            // Get new order
            const itemEls = stopsListEl.querySelectorAll('.stop-item');
            const newStops = [];

            itemEls.forEach((el, idx) => {
                const id = parseInt(el.dataset.id);
                const stop = stops.find(s => s.id === id);
                if (stop) {
                    // Update types based on new position
                    if (idx === 0) stop.type = 'start';
                    else if (stop.type === 'start') stop.type = 'transit'; // downgrade if moved

                    newStops.push(stop);
                }
            });

            stops = newStops;
            sortable.destroy();
            sortable = null;

            // Refresh all markers info with new indices
            stops.forEach((s, i) => updateMarkerInfo(s, i));

            updateUI();
        }
    }
});

// Map Events
map.on('click', (e) => {
    addStop(e.latlng);
});

resetBtn.addEventListener('click', () => {
    stops.forEach(s => map.removeLayer(s.marker));
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
