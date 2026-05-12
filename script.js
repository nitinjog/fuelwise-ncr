const DELHI_NCR_BOUNDS = {
  south: 28.18,
  west: 76.62,
  north: 29.02,
  east: 77.78,
};

const FUEL_PRICE = {
  petrol: 95,
  diesel: 88,
};

const DEFAULT_MILEAGE = {
  car: {
    petrol: 15,
    diesel: 18,
  },
  twoWheeler: {
    petrol: 45,
    diesel: 40,
  },
};

const TRAFFIC_BY_HOUR = [
  0.66, 0.58, 0.52, 0.5, 0.56, 0.72, 1.08, 1.42, 1.58, 1.34, 1.12, 1.02,
  0.98, 1.03, 1.12, 1.24, 1.42, 1.68, 1.78, 1.52, 1.18, 0.94, 0.82, 0.72,
];

const form = document.querySelector("#journey-form");
const planButton = document.querySelector("#plan-button");
const statusText = document.querySelector("#status");
const vehicleType = document.querySelector("#vehicle-type");
const fuelType = document.querySelector("#fuel-type");
const mileageInput = document.querySelector("#mileage");
const clock = document.querySelector("#system-clock");

const fields = {
  distance: document.querySelector("#distance"),
  duration: document.querySelector("#duration"),
  signals: document.querySelector("#signals"),
  fuelNow: document.querySelector("#fuel-now"),
  confidence: document.querySelector("#confidence"),
  trafficCondition: document.querySelector("#traffic-condition"),
  roadCondition: document.querySelector("#road-condition"),
  stoppageTime: document.querySelector("#stoppage-time"),
  airQuality: document.querySelector("#air-quality"),
  bestBadge: document.querySelector("#best-badge"),
  bestTime: document.querySelector("#best-time"),
  timeFuelSaving: document.querySelector("#time-fuel-saving"),
  timeCostSaving: document.querySelector("#time-cost-saving"),
  twoWheelerSaving: document.querySelector("#two-wheeler-saving"),
  publicSaving: document.querySelector("#public-saving"),
  timeline: document.querySelector("#timeline"),
};

const map = L.map("map", {
  zoomControl: true,
  scrollWheelZoom: true,
}).setView([28.6139, 77.209], 10);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

let routeLayer;
let markerLayer = L.layerGroup().addTo(map);

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.style.color = isError ? "#ba1a1a" : "";
}

function updateClock() {
  clock.textContent = new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(new Date());
}

function updateMileageDefault() {
  mileageInput.value = DEFAULT_MILEAGE[vehicleType.value][fuelType.value];
}

function formatKm(meters) {
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(minutes) {
  if (minutes < 60) {
    return `${Math.round(minutes)} min`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  return `${hours} hr ${mins} min`;
}

function formatLitres(value) {
  return `${value.toFixed(2)} L`;
}

function formatRupees(value) {
  return `Rs ${Math.max(0, Math.round(value)).toLocaleString("en-IN")}`;
}

function isInsideNcr(location) {
  return (
    location.lat >= DELHI_NCR_BOUNDS.south &&
    location.lat <= DELHI_NCR_BOUNDS.north &&
    location.lon >= DELHI_NCR_BOUNDS.west &&
    location.lon <= DELHI_NCR_BOUNDS.east
  );
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchJson(url, message, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(message);
  }
  return response.json();
}

async function geocode(place) {
  const params = new URLSearchParams({
    q: `${place}, Delhi NCR, India`,
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
    countrycodes: "in",
  });

  const data = await fetchJson(
    `https://nominatim.openstreetmap.org/search?${params}`,
    `Could not locate "${place}". Try a more specific Delhi NCR landmark.`
  );

  if (!data.length) {
    throw new Error(`Could not locate "${place}". Try a more specific Delhi NCR landmark.`);
  }

  const location = {
    label: data[0].display_name,
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
  };

  if (!isInsideNcr(location)) {
    throw new Error(`"${place}" appears outside Delhi NCR. Please enter a Delhi NCR route.`);
  }

  return location;
}

async function getRoute(start, end) {
  const coordinates = `${start.lon},${start.lat};${end.lon},${end.lat}`;
  const params = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "true",
    annotations: "true",
  });
  const data = await fetchJson(
    `https://router.project-osrm.org/route/v1/driving/${coordinates}?${params}`,
    "Could not calculate the driving route."
  );

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("No route found for these locations.");
  }

  return data.routes[0];
}

function getRouteBounds(points) {
  const lats = points.map((point) => point[1]);
  const lons = points.map((point) => point[0]);
  const padding = 0.012;
  return {
    south: Math.max(DELHI_NCR_BOUNDS.south, Math.min(...lats) - padding),
    west: Math.max(DELHI_NCR_BOUNDS.west, Math.min(...lons) - padding),
    north: Math.min(DELHI_NCR_BOUNDS.north, Math.max(...lats) + padding),
    east: Math.min(DELHI_NCR_BOUNDS.east, Math.max(...lons) + padding),
  };
}

async function getTrafficSignals(points) {
  const bounds = getRouteBounds(points);
  const query = `
    [out:json][timeout:25];
    (
      node["highway"="traffic_signals"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
    );
    out body;
  `;

  const params = new URLSearchParams({ data: query });
  const data = await fetchJson(
    `https://overpass-api.de/api/interpreter?${params}`,
    "Could not load red-light data. Estimate will continue without signal detail."
  );

  return data.elements
    .map((item) => ({ lat: item.lat, lon: item.lon }))
    .filter((signal) => distanceToRoute(signal, points) <= 80);
}

async function getAirQuality(route) {
  const coords = route.geometry.coordinates;
  const midpoint = coords[Math.floor(coords.length / 2)];
  const params = new URLSearchParams({
    latitude: midpoint[1],
    longitude: midpoint[0],
    current: "european_aqi,pm2_5",
    timezone: "Asia/Kolkata",
  });

  try {
    const data = await fetchJson(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`,
      "Could not load air quality."
    );
    return data.current || null;
  } catch {
    return null;
  }
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineMeters(a, b) {
  const radius = 6371000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function distanceToSegmentMeters(point, a, b) {
  const x = point.lon;
  const y = point.lat;
  const x1 = a.lon;
  const y1 = a.lat;
  const x2 = b.lon;
  const y2 = b.lat;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return haversineMeters(point, a);
  }

  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  const projection = { lon: x1 + t * dx, lat: y1 + t * dy };
  return haversineMeters(point, projection);
}

function distanceToRoute(point, coordinates) {
  let min = Number.POSITIVE_INFINITY;

  for (let index = 1; index < coordinates.length; index += 1) {
    const a = { lon: coordinates[index - 1][0], lat: coordinates[index - 1][1] };
    const b = { lon: coordinates[index][0], lat: coordinates[index][1] };
    min = Math.min(min, distanceToSegmentMeters(point, a, b));
  }

  return min;
}

function trafficMultiplier(date) {
  const base = TRAFFIC_BY_HOUR[date.getHours()];
  const day = date.getDay();
  const weekendFactor = day === 0 ? 0.78 : day === 6 ? 0.88 : 1;
  return base * weekendFactor;
}

function trafficLabel(multiplier) {
  if (multiplier >= 1.55) return "Severe";
  if (multiplier >= 1.25) return "Heavy";
  if (multiplier >= 0.95) return "Moderate";
  return "Light";
}

function roadConditionLabel(avgSpeed, signalsPerKm) {
  if (avgSpeed < 18 || signalsPerKm > 1.4) return "Slow urban corridor";
  if (avgSpeed < 28 || signalsPerKm > 0.8) return "Mixed city roads";
  return "Mostly flowing arterials";
}

function estimateFuel({ distanceKm, baseMinutes, signalCount, vehicle, fuel, mileage, startTime }) {
  const multiplier = trafficMultiplier(startTime);
  const trafficMinutes = baseMinutes * multiplier;
  const signalDelay = signalCount * (vehicle === "car" ? 0.9 : 0.55) * Math.max(0.75, multiplier);
  const stoppageMinutes = signalDelay + Math.max(0, trafficMinutes - baseMinutes) * 0.38;
  const idleLitresPerHour = vehicle === "car" ? (fuel === "diesel" ? 0.75 : 0.9) : 0.18;
  const movingFuel = distanceKm / mileage;
  const trafficPenalty = movingFuel * Math.max(0, multiplier - 0.72) * (vehicle === "car" ? 0.18 : 0.1);
  const idleFuel = (stoppageMinutes / 60) * idleLitresPerHour;

  return {
    multiplier,
    minutes: trafficMinutes + signalDelay,
    stoppageMinutes,
    litres: movingFuel + trafficPenalty + idleFuel,
  };
}

function buildTimeline(route, signalCount, vehicle, fuel, mileage) {
  const distanceKm = route.distance / 1000;
  const baseMinutes = route.duration / 60;
  const now = new Date();

  return Array.from({ length: 12 }, (_, index) => {
    const startTime = new Date(now.getTime() + index * 60 * 60 * 1000);
    const estimate = estimateFuel({
      distanceKm,
      baseMinutes,
      signalCount,
      vehicle,
      fuel,
      mileage,
      startTime,
    });
    return {
      startTime,
      ...estimate,
    };
  });
}

function confidenceLabel(signalCount, airQuality) {
  if (signalCount > 0 && airQuality) return "Good estimate";
  if (signalCount > 0) return "Route estimate";
  return "Limited API data";
}

function renderMap(route, start, end, signals) {
  const coordinates = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  markerLayer.clearLayers();

  if (routeLayer) {
    map.removeLayer(routeLayer);
  }

  routeLayer = L.polyline(coordinates, {
    color: "#0f7a5a",
    weight: 6,
    opacity: 0.9,
  }).addTo(map);

  L.marker([start.lat, start.lon]).bindPopup("Start").addTo(markerLayer);
  L.marker([end.lat, end.lon]).bindPopup("Destination").addTo(markerLayer);

  signals.slice(0, 80).forEach((signal) => {
    L.marker([signal.lat, signal.lon], {
      icon: L.divIcon({
        className: "",
        html: '<span class="signal-marker">R</span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    }).addTo(markerLayer);
  });

  map.fitBounds(routeLayer.getBounds(), { padding: [28, 28] });
}

function renderTimeline(timeline, currentLitres, fuel) {
  const best = timeline.reduce((lowest, item) => (item.litres < lowest.litres ? item : lowest));

  fields.timeline.innerHTML = timeline
    .map((item) => {
      const isBest = item === best;
      const saving = Math.max(0, currentLitres - item.litres);
      return `
        <article class="time-card ${isBest ? "best" : ""}">
          <span>${item.startTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          <strong>${formatLitres(item.litres)}</strong>
          <span>${trafficLabel(item.multiplier)} traffic</span>
          <span>${saving > 0 ? `${formatLitres(saving)} saved` : "baseline"}</span>
        </article>
      `;
    })
    .join("");

  const fuelSaving = Math.max(0, currentLitres - best.litres);
  fields.bestBadge.textContent = trafficLabel(best.multiplier);
  fields.bestTime.textContent = `Start around ${best.startTime.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  })} for the lowest estimated fuel use in the next 12 hours.`;
  fields.timeFuelSaving.textContent = formatLitres(fuelSaving);
  fields.timeCostSaving.textContent = formatRupees(fuelSaving * FUEL_PRICE[fuel]);
}

function renderResults({ route, signals, airQuality, vehicle, fuel, mileage }) {
  const distanceKm = route.distance / 1000;
  const baseMinutes = route.duration / 60;
  const nowEstimate = estimateFuel({
    distanceKm,
    baseMinutes,
    signalCount: signals.length,
    vehicle,
    fuel,
    mileage,
    startTime: new Date(),
  });
  const avgSpeed = distanceKm / (nowEstimate.minutes / 60);
  const signalsPerKm = signals.length / Math.max(1, distanceKm);
  const timeline = buildTimeline(route, signals.length, vehicle, fuel, mileage);
  const twoWheelerEstimate = estimateFuel({
    distanceKm,
    baseMinutes,
    signalCount: signals.length,
    vehicle: "twoWheeler",
    fuel: "petrol",
    mileage: DEFAULT_MILEAGE.twoWheeler.petrol,
    startTime: new Date(),
  });
  const twoWheelerSaving = Math.max(0, nowEstimate.litres - twoWheelerEstimate.litres);

  fields.distance.textContent = formatKm(route.distance);
  fields.duration.textContent = formatDuration(nowEstimate.minutes);
  fields.signals.textContent = signals.length.toString();
  fields.fuelNow.textContent = formatLitres(nowEstimate.litres);
  fields.confidence.textContent = confidenceLabel(signals.length, airQuality);
  fields.trafficCondition.textContent = `${trafficLabel(nowEstimate.multiplier)} (${Math.round(avgSpeed)} km/h avg)`;
  fields.roadCondition.textContent = roadConditionLabel(avgSpeed, signalsPerKm);
  fields.stoppageTime.textContent = formatDuration(nowEstimate.stoppageMinutes);
  fields.airQuality.textContent = airQuality
    ? `AQI ${Math.round(airQuality.european_aqi)} / PM2.5 ${Math.round(airQuality.pm2_5)}`
    : "Unavailable";
  fields.twoWheelerSaving.textContent = `${formatLitres(twoWheelerSaving)} (${formatRupees(
    twoWheelerSaving * FUEL_PRICE.petrol
  )})`;
  fields.publicSaving.textContent = `${formatLitres(nowEstimate.litres)} (${formatRupees(
    nowEstimate.litres * FUEL_PRICE[fuel]
  )})`;

  renderTimeline(timeline, nowEstimate.litres, fuel);
}

async function planJourney(event) {
  event.preventDefault();
  planButton.disabled = true;

  const formData = new FormData(form);
  const startQuery = formData.get("start").trim();
  const endQuery = formData.get("end").trim();
  const vehicle = formData.get("vehicleType");
  const fuel = formData.get("fuelType");
  const mileage = Math.max(5, Number(formData.get("mileage")) || DEFAULT_MILEAGE[vehicle][fuel]);

  try {
    setStatus("Finding Delhi NCR coordinates...");
    const start = await geocode(startQuery);
    await delay(1100);
    const end = await geocode(endQuery);

    setStatus("Calculating route with OSRM...");
    const route = await getRoute(start, end);

    setStatus("Counting mapped red lights near the route...");
    let signals = [];
    try {
      signals = await getTrafficSignals(route.geometry.coordinates);
    } catch (error) {
      setStatus(error.message);
    }

    setStatus("Checking air quality context...");
    const airQuality = await getAirQuality(route);

    renderMap(route, start, end, signals);
    renderResults({ route, signals, airQuality, vehicle, fuel, mileage });
    setStatus("Estimate ready. Public APIs can vary by coverage and rate limits.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    planButton.disabled = false;
  }
}

vehicleType.addEventListener("change", updateMileageDefault);
fuelType.addEventListener("change", updateMileageDefault);
form.addEventListener("submit", planJourney);

updateClock();
setInterval(updateClock, 1000);
updateMileageDefault();
