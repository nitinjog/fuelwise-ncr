# FuelWise NCR

FuelWise NCR is a static web app for Delhi NCR commuters who want to estimate fuel use before starting a journey.

## What it estimates

- Route distance and base travel time
- Mapped traffic signal count near the route
- Tentative stoppage time
- Time-of-day traffic condition
- Road condition category based on route speed and signal density
- Current fuel consumption and cost
- Better start time over the next 12 hours
- Fuel savings from switching to a 2 wheeler or public transport

## Free APIs used

- OpenStreetMap Nominatim for geocoding
- OSRM public route service for driving route distance and duration
- Overpass API for mapped `highway=traffic_signals` points
- Open-Meteo Air Quality API for route context
- OpenStreetMap tiles through Leaflet

No API keys or secrets are stored in this project.

## Important limitation

Free public APIs generally do not provide reliable live traffic or historical traffic feeds without keys. The app therefore combines public route/map data with a local Delhi NCR time-of-day traffic trend model. Results should be treated as planning estimates, not navigation-grade predictions.

## Run locally

```bash
python -m http.server 8000
```

Then open `http://127.0.0.1:8000/`.
