# TravelPlot.app - Interactive Travel Planner

Live App - [travelplot.app](https://travelplot.app/)

**TravelPlot.app** is an interactive travel planning application designed to help you visualize your journeys. It allows you to plot stops on a map, calculate travel times between them, and simulate the entire trip with an animated playback feature.

## What this app does
- **Interactive Map**: Click to add stops and drag them to adjust positions.
- **Route Calculation**: Automatically calculates routes and travel times for driving, flying, taking the train, or walking.
- **Trip Simulation**: Watch an animated token travel along your route to get a real sense of distance and duration.
- **Smart Adjustments**: Customize stop names, stay durations (nights), and specific transit methods.

![TravelPlotapp](https://github.com/user-attachments/assets/2f50c264-2789-4f31-87a6-4c942aa30257)

## How it's built
This project is built using standard web technologies:
- **HTML5 & CSS3**: For structure and styling, using a modern, glassmorphism aesthetic.
- **Vanilla JavaScript**: For all application logic, state management, and UI updates.
- **Open Source Libraries**:
  - **[Leaflet](https://leafletjs.com/)**: The core mapping library used to display the map and handle interactions, powered by **OpenStreetMap** data.
  - **[OSRM (Open Source Routing Machine)](http://project-osrm.org/)**: Used for calculating accurate driving and walking routes.
  - **SortableJS**: For the drag-and-drop reordering of stops.
  - **Font Awesome**: For icons.
  - **Google Fonts (Outfit)**: For typography.

## Why I built this
I love planning trips and wanted something that gave a good visual representation of the travel time vs total holiday time. Standard maps show the route, but I wanted to *feel* the journey—seeing how long legs take relative to each other and visualizing the flow of the entire trip.

## The Challenge
My challenge was to get familiar with **Google's Antigravity with Gemini 3 Pro** and see what I could build and get working for a MVP draft. I'm honestly impressed with how it turned out!

## Limitations
- Flight Transit: Some flight paths are being routed incorrectly around the globe e.g. BNE -> LAX -> IAD shows flight path going West instead of East.
- Train routs default to driving routes visually
  - Will address this with a new routing machine instead of OSRM
- Lots of User testing to be done and I'm sure there will be bugs discovered

## Hosting & Current state
This is currently using Github Pages. Why? because it's free - my favorite price point

## Roadmap
- I might rewrite this app and deploy it on some AWS infrastructure.
