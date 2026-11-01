'use strict';

const $ = id => document.getElementById(id);
const DEFAULT_FIX = { lat: 50.775, lon: -1.3 };
const SETTING_IDS = [
  'connectionMode', 'provider', 'zoom', 'autoCenterProvider', 'updateSeconds', 'wsUrl', 'serialBaud',
  'bathymetryEnabled', 'bathymetryShading', 'depthUnits',
  'weatherEnabled', 'weatherModel', 'windBarbEnabled', 'windFieldEnabled', 'waveFieldEnabled', 'tempUnits', 'waveUnits',
  'cacheEnabled', 'cacheMode', 'cacheMaxMB', 'cacheMaxAgeDays', 'prefetchLevels'
];
const CACHE_IDS = ['cacheEnabled', 'cacheMode', 'cacheMaxMB', 'cacheMaxAgeDays'];
const CHART_IDS = ['tileUrl', 'tileMinZoom', 'tileMaxZoom', 'attribution'];
const BASE_CHARTS = {
  esri: {
    // blankTile=false: Esri answers 404 instead of its "Map data not yet available" image.
    tileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}?blankTile=false',
    tileMinZoom: 0,
    tileMaxZoom: 10,
    attribution: 'Esri, Garmin, GEBCO, NOAA NGDC, and other contributors · Not for navigation',
    hint: 'Marine overview. In many areas outside North America it has detail up to zoom 10 and is enlarged beyond; depth colours draw the coast at harbour zoom. Cached for offline use as you view it.'
  },
  osm: {
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileMinZoom: 0,
    tileMaxZoom: 19,
    attribution: '© OpenStreetMap contributors · Not for navigation',
    hint: 'Detailed streets and coastline. Its policy does not allow offline storage: only the browser\'s own cache is used, and OpenStreetMap may refuse some tiles from this extension (they are hidden).'
  }
};
const GLYPHS_URL = 'https://tiles.openwaters.io/fonts/{fontstack}/{range}.pbf';
const SEAMARKS_URL = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
const LOCALE = 'en-GB';
let config = {};
let map = null;
let mapReady = false;
let boatMarker = null;
let track = [];
let lastFix = null;
let socket = null;
let serialPort = null;
let serialReader = null;
let serialReadTask = null;
let serialStopped = false;
let serialBusy = false;
let availablePorts = [];
let intentionallyDisconnected = false;
let prefetchAbort = null;
let geoWatchId = null;
let wakeLock = null;
let wakeLockWanted = false;
let lastSeriesAt = null;
let boatSeries = null;        // { fix, times:[], hours:[{...}], info }
let fieldSeries = null;       // { times:[], points:[{lat,lon,hours:[{...}]}] }
let selectedHour = 0;         // index into the forecast window (0 = now)
let playTimer = null;
let weatherRefreshTimer = null;
let weatherAbort = null;
let windMarker = null;
let fieldMarkers = [];
let fieldAbort = null;
let fieldTimer = null;
let wxStore = null;
const WEATHER_MIN_MOVE_M = 2000;
const WEATHER_MAX_AGE_MS = 10 * 60 * 1000;
const FORECAST_WINDOW_H = 72;   // hours of forecast the timeline scrubs through
const WEATHER_IDS = ['windReadout', 'gustReadout', 'airTempReadout', 'pressureReadout', 'waveReadout'];
// Persistent weather cache: fresh for an hour (reused without a request), then kept up to 72 hours as
// an offline fallback shown with its age. Stored per viewer in localStorage.
const WX_FRESH_MS = 60 * 60 * 1000;
const WX_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const WX_MAX_ENTRIES = 600;
const WX_CACHE_KEY = 'gps-charts-weather-cache';
const WX_FIELD_KEY = 'gps-charts-field-series';     // last field series, kept for offline reloads
const WEATHER_REFRESH_MS = 3 * 60 * 60 * 1000;      // background refresh when online (forecasts update a few times a day)

const parser = new GPSParser.Parser(receiveFix, (message, raw) => {
  log(`${message}: ${String(raw).slice(0, 90)}`);
});

function log(message) {
  $('eventLog').textContent = `${new Date().toLocaleTimeString(LOCALE)} · ${message}`;
}

function setConnectionState(state, text) {
  $('statusDot').className = `dot ${state === 'live' ? 'live' : state === 'error' ? 'error' : ''}`;
  $('statusText').textContent = text;
  $('connect').disabled = state === 'live' || state === 'connecting';
  $('disconnect').disabled = state !== 'live' && state !== 'connecting' && state !== 'error';
}

function formatNumber(value, digits, suffix = '') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function updateClock() {
  if (!lastFix) {
    $('clock').textContent = '';
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - new Date(lastFix.receivedAt).getTime()) / 1000));
  $('clock').textContent = age < 5 ? 'GPS updated just now' : `Last position ${age} s ago`;
}

function receiveFix(fix) {
  lastFix = fix;
  $('lat').textContent = formatNumber(fix.lat, 6, '°');
  $('lon').textContent = formatNumber(fix.lon, 6, '°');
  $('sog').textContent = formatNumber(fix.sog, 1, ' kn');
  $('cog').textContent = formatNumber(fix.cog ?? fix.heading, 0, '°');
  $('fixMeta').textContent = `${fix.quality || 'GPS'} · ${fix.source} · ${new Date(fix.receivedAt).toLocaleTimeString(LOCALE)}`;
  $('mapNotice').style.opacity = '0';
  setConnectionState('live', `GPS live · ${fix.source}`);
  updateMap(fix);
  updateClock();
  requestSeries(fix);
  if (boatSeries && currentHour()) updateWindBarb(fix, currentHour());
  GPSPlatform.send({ type: 'GPS_FIX', fix }).catch(error => log(`State not synchronised: ${error.message}`));
}

/* ---------- Conditions (Open-Meteo forecast) ---------- */

function clearConditions(note) {
  for (const id of WEATHER_IDS) $(id).textContent = '—';
  if (note !== undefined) $('condMeta').textContent = note;
}

function wxLoad() {
  try { return JSON.parse(localStorage.getItem(WX_CACHE_KEY) || '{}'); } catch (_) { return {}; }
}

function wxSave(store) {
  try { localStorage.setItem(WX_CACHE_KEY, JSON.stringify(store)); } catch (_) {}
}

// One shared in-memory store, so concurrent writes (boat conditions and the field) never clobber each
// other the way separate load/modify/save round-trips to localStorage would.
function wxStoreGet() {
  if (!wxStore) wxStore = wxLoad();
  return wxStore;
}

// The field series is large, so only the latest one is persisted (overwritten each fetch); it lets the
// field reappear after an offline reload.
function saveFieldSeries(series, model) {
  try { localStorage.setItem(WX_FIELD_KEY, JSON.stringify({ time: Date.now(), model: model || 'best_match', series })); } catch (_) {}
}

function loadFieldSeries(model) {
  try {
    const raw = JSON.parse(localStorage.getItem(WX_FIELD_KEY) || 'null');
    if (!raw || Date.now() - raw.time > WX_MAX_AGE_MS) return null;
    if (raw.model !== (model || 'best_match')) return null;
    if (!raw.series || !raw.series.points || !raw.series.points[0] || !raw.series.points[0].hours.length) return null;
    return raw.series;
  } catch (_) { return null; }
}

// The hour the timeline is pointing at (0 = now), used by the panel, the boat barb and the field.
function currentHour() {
  return boatSeries && boatSeries.hours[selectedHour] ? boatSeries.hours[selectedHour] : null;
}

// Fetches the 72 h hourly forecast for the boat (cached), then drives the timeline and the display.
async function requestSeries(fix, force = false) {
  if (!config.weatherEnabled) return;
  const now = Date.now();
  if (!force && !Weather.needsRefresh(lastSeriesAt, fix.lat, fix.lon, now, WEATHER_MIN_MOVE_M, WEATHER_MAX_AGE_MS)) {
    return;
  }
  lastSeriesAt = { lat: fix.lat, lon: fix.lon, time: now };
  const key = Weather.cacheKey('series', fix.lat, fix.lon, config.weatherModel);
  const store = wxStoreGet();
  const cached = Weather.cacheGet(store, key, now, WX_FRESH_MS, WX_MAX_AGE_MS);
  // A fresh cached series (under an hour old) is used as-is, without a request.
  if (cached && cached.fresh) {
    setBoatSeries(cached.data, fix, { fromCache: true, age: cached.age });
    return;
  }
  if (weatherAbort) weatherAbort.abort();
  weatherAbort = new AbortController();
  try {
    const series = await Weather.fetchSeries(fix.lat, fix.lon, { model: config.weatherModel, signal: weatherAbort.signal });
    Weather.cachePut(store, key, series, Date.now(), WX_MAX_ENTRIES, WX_MAX_AGE_MS);
    wxSave(store);
    setBoatSeries(series, fix, { fromCache: false, age: 0 });
  } catch (error) {
    if (error.name === 'AbortError') return;
    // Offline or the API failed: fall back to the most recent cached series (up to 72 h).
    if (cached) setBoatSeries(cached.data, fix, { fromCache: true, age: cached.age });
    else $('condMeta').textContent = `Forecast unavailable: ${error.message}`;
  }
}

// Windows the series to start at "now" and show the next 72 hours, then renders.
function setBoatSeries(series, fix, info) {
  const start = Weather.nowIndex(series.times, Date.now());
  boatSeries = {
    fix: { lat: fix.lat, lon: fix.lon },
    times: series.times.slice(start, start + FORECAST_WINDOW_H + 1),
    hours: series.hours.slice(start, start + FORECAST_WINDOW_H + 1),
    info
  };
  if (selectedHour > boatSeries.hours.length - 1) selectedHour = 0;
  renderTimeline();
  renderSelectedHour();
}

// Draws the boat panel, the boat barb and the field for the selected hour.
function renderSelectedHour() {
  if (boatSeries && boatSeries.hours[selectedHour]) {
    const info = selectedHour === 0 ? (boatSeries.info || {}) : {};
    updateConditions(boatSeries.hours[selectedHour], info);
  }
  renderFieldAtHour();
  updateTimeLabel();
}

function renderFieldAtHour() {
  if (!fieldSeries || (!config.windFieldEnabled && !config.waveFieldEnabled)) {
    clearField();
    return;
  }
  const last = fieldSeries.points[0] ? fieldSeries.points[0].hours.length - 1 : 0;
  const h = Math.min(selectedHour, last);
  renderField(fieldSeries.points.map(p => ({ lat: p.lat, lon: p.lon, ...(p.hours[h] || {}) })));
}

/* ---------- Forecast timeline ---------- */

function renderTimeline() {
  const show = config.weatherEnabled && boatSeries && boatSeries.hours.length > 1;
  const bar = $('timeline');
  if (!show) { bar.classList.add('hidden'); return; }
  const slider = $('timeSlider');
  slider.max = String(boatSeries.hours.length - 1);
  slider.value = String(selectedHour);
  bar.classList.remove('hidden');
  updateTimeLabel();
}

function updateTimeLabel() {
  if (!boatSeries || !boatSeries.times[selectedHour]) return;
  const when = new Date(boatSeries.times[selectedHour]);
  $('timeWhen').textContent = selectedHour === 0 ? 'Now' : `+${selectedHour} h`;
  $('timeClock').textContent = when.toLocaleString(LOCALE, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function setHour(hour) {
  if (!boatSeries) return;
  selectedHour = Math.max(0, Math.min(hour, boatSeries.hours.length - 1));
  $('timeSlider').value = String(selectedHour);
  renderSelectedHour();
}

function togglePlay() {
  if (playTimer) { stopPlay(); return; }
  if (!boatSeries || boatSeries.hours.length < 2) return;
  $('timePlay').textContent = '⏸';
  $('timePlay').classList.add('playing');
  playTimer = setInterval(() => {
    const max = boatSeries.hours.length - 1;
    setHour(selectedHour >= max ? 0 : selectedHour + 1);
  }, 650);
}

function stopPlay() {
  if (!playTimer) return;
  clearInterval(playTimer);
  playTimer = null;
  $('timePlay').textContent = '▶';
  $('timePlay').classList.remove('playing');
}

// Forces a fresh fetch of the boat series and the field (used on reconnect and on the background timer).
function refreshWeather() {
  if (!lastFix) return;
  requestSeries(lastFix, true);
  requestFieldSeries().catch(() => {});
}

function updateConditions(c, info = {}) {
  // Wind stays in knots (the maritime standard the barb is drawn in); air temperature and wave height
  // are fetched metric and converted here, so changing units never needs a new request.
  const tempUnit = config.tempUnits === 'F' ? 'F' : 'C';
  const waveUnit = config.waveUnits === 'ft' ? 'ft' : 'm';
  const direction = Weather.degToCompass(c.windDir);
  const airTemp = c.airTemp === null || c.airTemp === undefined ? null
    : (tempUnit === 'F' ? c.airTemp * 9 / 5 + 32 : c.airTemp);
  const waveHeight = c.waveHeight === null || c.waveHeight === undefined ? null
    : (waveUnit === 'ft' ? c.waveHeight * 3.28084 : c.waveHeight);
  $('windReadout').textContent = c.windSpeed === null || c.windSpeed === undefined
    ? '—'
    : `${formatNumber(c.windSpeed, 0, ' kn')}${direction ? ' ' + direction : ''}`;
  $('gustReadout').textContent = formatNumber(c.windGust, 0, ' kn');
  $('airTempReadout').textContent = formatNumber(airTemp, 1, ` °${tempUnit}`);
  $('pressureReadout').textContent = formatNumber(c.pressure, 0, ' hPa');
  $('waveReadout').textContent = waveHeight === null
    ? '—'
    : `${formatNumber(waveHeight, 1, ' ' + waveUnit)}${c.wavePeriod ? ' · ' + formatNumber(c.wavePeriod, 0, ' s') : ''}`;
  const modelName = $('weatherModel').selectedOptions[0] ? $('weatherModel').selectedOptions[0].textContent : '';
  const modelTag = config.weatherModel && config.weatherModel !== 'best_match' ? ` (${modelName})` : '';
  // A cached reading older than the fresh window is labelled with its age so stale data is never
  // mistaken for the current forecast.
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const stamp = info.fromCache && info.age > WX_FRESH_MS
    ? `cached · ${Weather.formatAge(info.age)}`
    : new Date(c.time).toLocaleTimeString(LOCALE);
  $('condMeta').textContent = `${c.source}${modelTag} forecast · ${stamp}${offline ? ' · offline' : ''}`;
  updateWindBarb(lastFix, c);
}

/* ---------- Wind/wave field across the visible chart ---------- */

function clearField() {
  for (const marker of fieldMarkers) marker.remove();
  fieldMarkers = [];
}

// Hover text for a field cell: mean wind, gusts and wave height. Shown because field cells are
// interactive (see the .field-cell rule); the boat barb stays non-interactive over the hull.
function fieldTitle(point) {
  const bits = [];
  if (point.windSpeed !== null && point.windSpeed !== undefined) {
    const compass = Weather.degToCompass(point.windDir);
    const gust = point.windGust !== null && point.windGust !== undefined ? `, gusts ${Math.round(point.windGust)} kn` : '';
    bits.push(`Wind ${Math.round(point.windSpeed)} kn${gust}${compass ? ' from ' + compass : ''}`);
  }
  if (point.waveHeight !== null && point.waveHeight !== undefined) {
    bits.push(`Waves ${point.waveHeight.toFixed(1)} m`);
  }
  return bits.join(' · ');
}

function renderField(points) {
  clearField();
  if (!mapReady) return;
  for (const point of points) {
    let html = '';
    if (config.windFieldEnabled && point.windSpeed !== null && point.windSpeed !== undefined) {
      html += Weather.windBarbSvg(point.windSpeed, point.windDir, { size: 56, width: 1.6 });
    }
    if (config.waveFieldEnabled && point.waveHeight !== null && point.waveHeight !== undefined) {
      html += Weather.waveArrowSvg(point.waveHeight, point.waveDir, { size: 34 });
    }
    if (!html) continue;
    const element = document.createElement('div');
    element.className = 'field-cell';
    element.innerHTML = html;
    element.title = fieldTitle(point);
    const marker = new maplibregl.Marker({ element, rotationAlignment: 'map' })
      .setLngLat([point.lon, point.lat])
      .addTo(map);
    fieldMarkers.push(marker);
  }
}

// Fetches the 72 h hourly field for the visible grid (kept in memory), then draws the selected hour.
async function requestFieldSeries() {
  if (!mapReady || (!config.windFieldEnabled && !config.waveFieldEnabled)) {
    fieldSeries = null;
    clearField();
    return;
  }
  // Show the last saved field at once (e.g. after an offline reload) while a fresh one loads.
  if (!fieldSeries) {
    const saved = loadFieldSeries(config.weatherModel);
    if (saved) { fieldSeries = saved; renderFieldAtHour(); }
  }
  const b = map.getBounds();
  const points = Weather.gridPoints({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
  if (fieldAbort) fieldAbort.abort();
  fieldAbort = new AbortController();
  try {
    const raw = await Weather.fetchFieldSeries(points, {
      wind: config.windFieldEnabled,
      wave: config.waveFieldEnabled,
      model: config.weatherModel,
      signal: fieldAbort.signal
    });
    const start = Weather.nowIndex(raw.times, Date.now());
    fieldSeries = {
      times: raw.times.slice(start, start + FORECAST_WINDOW_H + 1),
      points: raw.points.map(p => ({ lat: p.lat, lon: p.lon, hours: p.hours.slice(start, start + FORECAST_WINDOW_H + 1) }))
    };
    if (fieldSeries.points[0] && fieldSeries.points[0].hours.length) saveFieldSeries(fieldSeries, config.weatherModel);
    renderFieldAtHour();
  } catch (error) {
    // Offline or the API failed: keep whatever field is already shown (in memory or just restored).
    if (error.name !== 'AbortError') log('Wind/wave field unavailable — showing the last cached field.');
  }
}

// Debounced: panning or zooming moves the visible area, so the field is re-fetched for the new bounds.
function scheduleField() {
  if (!config.windFieldEnabled && !config.waveFieldEnabled) return;
  clearTimeout(fieldTimer);
  fieldTimer = setTimeout(requestFieldSeries, 500);
}

// Draws the maritime wind barb at the boat, as a non-interactive map marker offset above the hull.
function updateWindBarb(fix, c) {
  const show = mapReady && config.windBarbEnabled && fix && c && c.windSpeed !== null && c.windSpeed !== undefined;
  if (!show) {
    if (windMarker) { windMarker.remove(); windMarker = null; }
    return;
  }
  const svg = Weather.windBarbSvg(c.windSpeed, c.windDir);
  const compass = Weather.degToCompass(c.windDir);
  const title = `Wind ${Math.round(c.windSpeed)} kn${compass ? ' from ' + compass : ''}`;
  if (windMarker) {
    windMarker.setLngLat([fix.lon, fix.lat]);
    const element = windMarker.getElement();
    element.innerHTML = svg;
    element.title = title;
  } else {
    const element = document.createElement('div');
    element.className = 'wind-barb';
    element.innerHTML = svg;
    element.title = title;
    windMarker = new maplibregl.Marker({ element, rotationAlignment: 'map', offset: [0, -34] })
      .setLngLat([fix.lon, fix.lat])
      .addTo(map);
  }
}

function boatElement() {
  const element = document.createElement('div');
  element.className = 'boat-marker';
  element.innerHTML = '<svg width="34" height="34" viewBox="0 0 34 34" aria-label="Boat"><circle cx="17" cy="17" r="15" fill="#fff" stroke="#073b55" stroke-width="2"/><path d="M17 4 L25 27 L17 22 L9 27 Z" fill="#ef4d4d" stroke="#9e2727" stroke-width="1"/><circle cx="17" cy="17" r="2.2" fill="#073b55"/></svg>';
  return element;
}

/* ---------- Map ---------- */

function initializeMap() {
  maplibregl.setWorkerUrl(GPSPlatform.url('vendor/maplibre-gl-csp-worker.js'));
  TileCache.configure(config);
  if (map) {
    map.remove();
    map = null;
    boatMarker = null;
    windMarker = null;
    mapReady = false;
  }
  const wrap = TileCache.wrap;
  const center = lastFix || DEFAULT_FIX;
  map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      glyphs: wrap(GLYPHS_URL),
      sources: {
        ...GPSBathymetry.sources(wrap),
        chart: {
          type: 'raster',
          tiles: [wrap(config.tileUrl)],
          tileSize: 256,
          minzoom: Number(config.tileMinZoom),
          maxzoom: Number(config.tileMaxZoom),
          attribution: config.attribution
        },
        seamarks: {
          type: 'raster',
          tiles: [wrap(SEAMARKS_URL)],
          tileSize: 256,
          minzoom: 0,
          maxzoom: 18,
          attribution: '© OpenSeaMap'
        }
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#d8e5ea' } },
        { id: 'chart', type: 'raster', source: 'chart' },
        ...GPSBathymetry.layers(config),
        { id: 'seamarks', type: 'raster', source: 'seamarks' }
      ]
    },
    center: [center.lon, center.lat],
    zoom: Number(config.zoom) || 13.76,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('style.load', () => {
    GPSBathymetry.applyVisibility(map, config);
    map.addSource('track', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: track } }
    });
    map.addLayer({
      id: 'track', type: 'line', source: 'track',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#e63946', 'line-width': 3, 'line-opacity': 0.85 }
    });
    mapReady = true;
    if (lastFix) updateMap(lastFix);
    if (lastFix && boatSeries && currentHour()) updateWindBarb(lastFix, currentHour());
    requestFieldSeries();
  });
  map.on('error', event => {
    const message = event?.error?.message || 'Chart resource error';
    // Tiles missing while offline are expected; they are counted in the cache usage instead.
    if (message.startsWith('Offline:')) return;
    if (message.startsWith('Blocked:')) {
      log('OpenStreetMap refused some tiles ("Access blocked"); they are hidden. Esri World Ocean Base avoids this.');
      return;
    }
    // Tiles missing at a zoom level (HTTP 404) are normal for regional chart sources.
    if (event?.error?.status === 404) return;
    log(message.slice(0, 150));
  });
  map.on('dragstart', () => { $('followBoat').checked = false; });
  map.on('moveend', scheduleField);
}

// The follow zoom is not limited by the chart's max zoom: MapLibre enlarges the deepest tiles beyond it.
function updateMap(fix) {
  if (!map || !mapReady) return;
  const position = [fix.lon, fix.lat];
  if (!boatMarker) {
    boatMarker = new maplibregl.Marker({ element: boatElement(), rotationAlignment: 'map' })
      .setLngLat(position).addTo(map);
  } else {
    boatMarker.setLngLat(position);
  }
  boatMarker.setRotation(Number(fix.cog ?? fix.heading) || 0);
  const previous = track[track.length - 1];
  if (!previous || Math.abs(previous[0] - fix.lon) > 0.000005 || Math.abs(previous[1] - fix.lat) > 0.000005) {
    track.push(position);
    if (track.length > 1000) track = track.slice(-1000);
    map.getSource('track').setData({
      type: 'Feature', geometry: { type: 'LineString', coordinates: track }
    });
  }
  if ($('followBoat').checked) {
    map.easeTo({ center: position, duration: 650, zoom: Number(config.zoom) || 13.76 });
  }
}

/* ---------- Offline cache ---------- */

function updateNetworkState() {
  const online = navigator.onLine;
  $('netDot').className = `dot ${online ? 'live' : 'error'}`;
  $('netText').textContent = online
    ? (config.cacheMode === 'offline' ? 'Internet online · offline mode' : 'Internet online')
    : 'Internet offline · using cache';
}

async function refreshCacheStats() {
  try {
    const stats = await TileCache.stats();
    const percent = stats.maxBytes ? Math.round(stats.bytes / stats.maxBytes * 100) : 0;
    const oldest = stats.oldest ? ` · oldest ${new Date(stats.oldest).toLocaleDateString(LOCALE)}` : '';
    const misses = stats.offlineMisses ? ` · ${stats.offlineMisses} tiles missing offline` : '';
    const blocked = stats.blockedTiles ? ` · ${stats.blockedTiles} OpenStreetMap tiles refused` : '';
    $('cacheStats').textContent = `${stats.count} items · ${formatBytes(stats.bytes)} of ${formatBytes(stats.maxBytes)} (${percent} %)${oldest}${misses}${blocked}`;
  } catch (error) {
    $('cacheStats').textContent = `Cache unavailable: ${error.message}`;
  }
}

function prefetchSources() {
  const sources = [
    { tiles: [config.tileUrl], minzoom: Number(config.tileMinZoom), maxzoom: Number(config.tileMaxZoom), tileSize: 256 },
    { tiles: [SEAMARKS_URL], minzoom: 0, maxzoom: 18, tileSize: 256 }
  ];
  if (config.bathymetryEnabled !== false) sources.push(...TileCache.templates());
  return sources;
}

function glyphUrls() {
  // Digits (0-255) and subscript decimals (U+2080 range) used by the contour and sounding labels.
  const urls = [];
  for (const font of ['Noto Sans Medium', 'Noto Sans Medium Italic']) {
    for (const range of ['0-255', '8192-8447']) {
      urls.push(GLYPHS_URL.replace('{fontstack}', font).replace('{range}', range));
    }
  }
  return urls;
}

async function prefetchVisibleArea() {
  if (prefetchAbort) {
    prefetchAbort.abort();
    return;
  }
  if (!map || !mapReady) {
    log('The chart is not ready yet.');
    return;
  }
  if (!config.cacheEnabled) {
    log('Enable the offline cache first.');
    return;
  }
  if (TileCache.isOffline()) {
    log('Saving an area needs an internet connection and a mode other than Offline only.');
    return;
  }
  const bounds = map.getBounds().toArray().flat();
  const levels = Math.max(0, Math.min(4, Number(config.prefetchLevels) || 0));
  const plan = TileCache.planPrefetch(prefetchSources(), bounds, map.getZoom(), levels);
  if (plan.tooMany) {
    log(`More than ${TileCache.MAX_PREFETCH_TILES} tiles. Zoom in or reduce the extra zoom levels.`);
    return;
  }
  const urls = [...plan.urls, ...(config.bathymetryEnabled !== false ? glyphUrls() : [])];
  if (!urls.length) {
    log('Nothing to download for this area.');
    return;
  }
  prefetchAbort = new AbortController();
  $('prefetchArea').textContent = 'Stop saving';
  $('prefetchProgress').classList.remove('hidden');
  const bar = $('prefetchProgress').firstElementChild;
  bar.style.width = '0';
  const skippedNote = plan.skippedHosts.length ? ` ${plan.skippedHosts.join(', ')} skipped (its terms do not allow downloading tiles for offline use).` : '';
  log(`Saving ${urls.length} tiles…${skippedNote}`);
  try {
    const result = await TileCache.prefetch(urls, {
      signal: prefetchAbort.signal,
      onProgress: progress => {
        bar.style.width = `${Math.round(progress.completed / progress.total * 100)}%`;
        $('cacheStats').textContent = `Saving ${progress.completed}/${progress.total} · ${progress.failed} failed · ${progress.skipped} already cached`;
      }
    });
    const summary = `${result.completed - result.failed - result.skipped} saved, ${result.skipped} already cached, ${result.failed} failed.`;
    log(result.aborted ? `Saving stopped. ${summary}` : `Area saved for offline use. ${summary}${skippedNote}`);
  } finally {
    prefetchAbort = null;
    $('prefetchArea').textContent = 'Save visible area for offline use';
    $('prefetchProgress').classList.add('hidden');
    refreshCacheStats();
  }
}

/* ---------- Settings ---------- */

function validProviderFix(fix) {
  return fix && Number.isFinite(fix.lat) && Number.isFinite(fix.lon) &&
    fix.lat >= -90 && fix.lat <= 90 && fix.lon >= -180 && fix.lon <= 180;
}

function providerName(provider) {
  return provider === 'garmin' ? 'Garmin Marine' : provider === 'cmap' ? 'C-MAP' : 'i-Boating';
}

function updateProviderUi() {
  const provider = $('provider').value;
  const garmin = provider === 'garmin';
  $('zoom').disabled = garmin;
  $('autoCenterProvider').disabled = garmin;
  $('updateSeconds').disabled = garmin;
  if (garmin) {
    $('providerHint').textContent = GPSPlatform.isExtension
      ? 'Garmin opens at the vessel position and tries once to place its native marker. Click the map centre if the marker is not shown. Continuous follow is off to avoid reloads. The position is sent to Garmin in the URL only when you open it.'
      : 'Opens Garmin at the current position in a new tab. Click the map centre if the marker is not shown. The position is sent to Garmin in the URL. Following and marker control need the Chrome extension.';
  } else if (!GPSPlatform.isExtension) {
    $('providerHint').textContent = `Opens ${providerName(provider)} in a new tab at the current position. Following the boat on provider sites needs the Chrome extension on a computer.`;
  } else if (provider === 'cmap') {
    $('providerHint').textContent = 'C-MAP shows the boat as a Pinned location. It resets its zoom on each update and ignores the URL zoom; a longer interval leaves time to zoom in between.';
  } else {
    $('providerHint').textContent = 'i-Boating draws its own boat marker with a heading line and keeps your zoom. With auto-centre off the marker still moves but the chart stays put.';
  }
}

function updateModeRows() {
  const mode = $('connectionMode').value;
  $('wsRow').classList.toggle('hidden', mode !== 'websocket');
  $('wsHint').classList.toggle('hidden', mode !== 'websocket');
  $('serialRows').classList.toggle('hidden', mode !== 'serial');
  $('serialHint').classList.toggle('hidden', mode !== 'serial');
  $('deviceHint').classList.toggle('hidden', mode !== 'device');
  if (mode === 'serial') refreshPorts().catch(error => log(error.message));
}

/* Removes connection modes this browser cannot offer (no Web Serial on iPhone, for example). */
function pruneConnectionModes() {
  const select = $('connectionMode');
  if (!('serial' in navigator)) select.querySelector('option[value="serial"]')?.remove();
  if (!('geolocation' in navigator) || !window.isSecureContext) select.querySelector('option[value="device"]')?.remove();
}

async function saveSetting(id) {
  let value;
  if ($(id).type === 'checkbox') value = $(id).checked;
  else if ($(id).type === 'number') value = Number($(id).value);
  else value = $(id).value;
  const changed = config[id] !== value;
  config[id] = value;
  if (id === 'provider') updateProviderUi();
  await GPSPlatform.storage.set({ [id]: value });
  if (id === 'depthUnits' && changed) {
    GPSBathymetry.applyUnits(map, config);
    log(`Depths shown in ${value === 'ft' ? 'feet' : 'metres'}.`);
    await GPSPlatform.send({ type: 'SETTINGS_CHANGED', id });
  }
  if (['bathymetryEnabled', 'bathymetryShading'].includes(id)) {
    GPSBathymetry.applyVisibility(map, config);
    log(id === 'bathymetryEnabled'
      ? (value ? 'Open bathymetry enabled.' : 'Open bathymetry disabled.')
      : (value ? 'Depth shading enabled.' : 'Depth shading disabled.'));
  }
  if (CACHE_IDS.includes(id)) {
    TileCache.configure(config);
    updateNetworkState();
    if (id === 'cacheEnabled') {
      initializeMap();
      log(value ? 'Offline cache enabled.' : 'Offline cache disabled; stored tiles are kept.');
    } else if (id === 'cacheMode') {
      log(`Cache mode: ${$('cacheMode').selectedOptions[0].textContent}.`);
    }
    refreshCacheStats();
  }
  if (['provider', 'zoom', 'autoCenterProvider', 'updateSeconds'].includes(id)) {
    await GPSPlatform.send({ type: 'SETTINGS_CHANGED' });
  }
}

/* ---------- Base chart ---------- */

function baseChartKey() {
  return Object.keys(BASE_CHARTS).find(key => BASE_CHARTS[key].tileUrl === config.tileUrl) || 'custom';
}

function updateBaseChartUi() {
  const key = $('baseChart').value;
  $('customChartRows').classList.toggle('hidden', key !== 'custom');
  $('baseChartHint').textContent = BASE_CHARTS[key]?.hint || 'Any XYZ raster source your licence allows. It must contain {z}, {x} and {y}.';
}

async function applyChartSource(source) {
  const values = Object.fromEntries(CHART_IDS.map(id => [id, source[id]]));
  Object.assign(config, values);
  for (const id of CHART_IDS) $(id).value = values[id];
  await GPSPlatform.storage.set(values);
  $('baseChart').value = baseChartKey();
  updateBaseChartUi();
  initializeMap();
}

/* ---------- Menus ---------- */

async function setupMenus() {
  const saved = await GPSPlatform.storage.get(['sidebarCollapsed', 'collapsedSections']);
  const collapsedSections = new Set(saved.collapsedSections || []);
  const setSidebar = collapsed => {
    document.querySelector('.layout').classList.toggle('collapsed', collapsed);
    const label = collapsed ? 'Show menus' : 'Hide menus';
    $('toggleSidebar').title = label;
    $('toggleSidebar').setAttribute('aria-label', label);
    $('toggleSidebar').setAttribute('aria-expanded', String(!collapsed));
    if (map) map.resize();
  };
  // On a phone the menus cover the chart, so they start hidden there unless the user chose otherwise.
  const narrow = window.matchMedia('(max-width: 700px)');
  setSidebar(saved.sidebarCollapsed ?? narrow.matches);
  $('toggleSidebar').addEventListener('click', () => {
    const collapsed = !document.querySelector('.layout').classList.contains('collapsed');
    setSidebar(collapsed);
    GPSPlatform.storage.set({ sidebarCollapsed: collapsed }).catch(() => {});
  });
  // Touching the chart closes the menus when they cover it.
  document.querySelector('.map-area').addEventListener('pointerdown', () => {
    if (narrow.matches && !document.querySelector('.layout').classList.contains('collapsed')) {
      setSidebar(true);
      GPSPlatform.storage.set({ sidebarCollapsed: true }).catch(() => {});
    }
  });
  for (const heading of document.querySelectorAll('.sidebar section > h2')) {
    const section = heading.parentElement;
    const name = heading.textContent.trim();
    const setSection = collapsed => {
      section.classList.toggle('collapsed', collapsed);
      heading.setAttribute('aria-expanded', String(!collapsed));
    };
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    setSection(collapsedSections.has(name));
    const toggle = () => {
      const collapsed = !section.classList.contains('collapsed');
      setSection(collapsed);
      if (collapsed) collapsedSections.add(name);
      else collapsedSections.delete(name);
      GPSPlatform.storage.set({ collapsedSections: [...collapsedSections] }).catch(() => {});
    };
    heading.addEventListener('click', toggle);
    heading.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
  }
}

/* ---------- Serial ports ---------- */

function selectedPortEntry() {
  return availablePorts.find(entry => entry.key === $('serialPort').value) || null;
}

async function refreshPorts(preferredKey) {
  const select = $('serialPort');
  if (!('serial' in navigator)) {
    select.innerHTML = '<option value="">Web Serial is not available in this browser</option>';
    $('scanPorts').disabled = $('addPort').disabled = true;
    return;
  }
  availablePorts = await SerialPorts.list();
  const wanted = preferredKey ?? select.value ?? config.serialPortKey;
  select.textContent = '';
  if (!availablePorts.length) {
    select.add(new Option('No authorised ports — click Add port…', ''));
    return;
  }
  for (const entry of availablePorts) {
    const inUse = entry.port === serialPort ? ' — connected' : '';
    select.add(new Option(`${entry.label}${inUse}`, entry.key));
  }
  const match = availablePorts.find(entry => entry.key === wanted)
    || availablePorts.find(entry => entry.key === config.serialPortKey)
    || availablePorts[0];
  select.value = match.key;
}

async function saveSelectedPort() {
  config.serialPortKey = $('serialPort').value;
  await GPSPlatform.storage.set({ serialPortKey: config.serialPortKey });
}

async function addPort() {
  try {
    const port = await navigator.serial.requestPort();
    await refreshPorts();
    const entry = availablePorts.find(item => item.port === port);
    if (entry) {
      $('serialPort').value = entry.key;
      await saveSelectedPort();
      log(`Port authorised: ${entry.label}.`);
    }
  } catch (error) {
    if (error.name !== 'NotFoundError') log(error.message);
  }
}

async function scanPorts() {
  if (serialBusy) return;
  if (!availablePorts.length) await refreshPorts();
  if (!availablePorts.length) {
    // Still inside the click's user activation, so Chrome's picker can open.
    await addPort();
    if (!availablePorts.length) return;
  }
  serialBusy = true;
  $('scanPorts').disabled = $('addPort').disabled = $('connect').disabled = true;
  const results = [];
  let found = null;
  try {
    for (const entry of availablePorts) {
      if (entry.port === serialPort) {
        results.push(`${entry.label}: connected`);
        continue;
      }
      try {
        const result = await SerialPorts.detect(entry.port, GPSParser.checksumIsValid, config.serialBaud, baud => {
          $('scanResult').textContent = `Scanning ${entry.label} at ${baud} baud…`;
        });
        if (result.baudRate) {
          results.push(`${entry.label}: NMEA at ${result.baudRate} baud ✓`);
          if (!found) found = { entry, baudRate: result.baudRate };
        } else {
          results.push(`${entry.label}: ${result.sawData ? 'data but no valid NMEA' : 'no data'}`);
        }
      } catch (error) {
        results.push(`${entry.label}: ${error.name === 'InvalidStateError' || /open/i.test(error.message) ? 'busy or in use by another app' : error.message}`);
      }
    }
  } finally {
    serialBusy = false;
    $('scanPorts').disabled = $('addPort').disabled = false;
    if (!serialPort) $('connect').disabled = false;
  }
  $('scanResult').textContent = results.join(' · ');
  if (found) {
    $('serialPort').value = found.entry.key;
    $('serialBaud').value = String(found.baudRate);
    await saveSelectedPort();
    await saveSetting('serialBaud');
    log(`GPS found on ${found.entry.label} at ${found.baudRate} baud.`);
  } else {
    log('Scan finished: no NMEA source detected.');
  }
}

/* ---------- Connections ---------- */

async function connectWebSocket() {
  intentionallyDisconnected = false;
  const url = config.wsUrl.trim();
  if (!/^wss?:\/\//i.test(url)) throw new Error('The address must start with ws:// or wss://');
  setConnectionState('connecting', 'Connecting WebSocket…');
  socket = new WebSocket(url);
  socket.onopen = () => {
    setConnectionState('live', 'WebSocket connected · waiting for GPS');
    log(`Connected to ${url}`);
  };
  socket.onmessage = async event => {
    const text = typeof event.data === 'string' ? event.data : await event.data.text();
    parser.push(`${text}\n`, 'WebSocket');
  };
  socket.onerror = () => {
    setConnectionState('error', 'WebSocket connection error');
    // A page served over HTTPS (the web app) may only open secure wss:// sockets, except to this device.
    const insecure = location.protocol === 'https:' && /^ws:\/\//i.test(url) && !/^ws:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url);
    log(insecure
      ? 'Could not connect: this web app uses HTTPS, so the browser only allows secure wss:// addresses. Use a wss:// address (for example a Signal K server with TLS), or the Device GPS.'
      : 'Could not communicate with the WebSocket.');
  };
  socket.onclose = () => {
    socket = null;
    if (!intentionallyDisconnected) {
      setConnectionState('error', 'WebSocket disconnected');
      log('The WebSocket connection closed.');
    }
  };
}

async function connectSerial() {
  if (!('serial' in navigator)) throw new Error('Web Serial is not available in this Chrome.');
  if (serialBusy) throw new Error('Wait for the port scan to finish.');
  intentionallyDisconnected = false;
  serialStopped = false;
  let entry = selectedPortEntry();
  if (!entry) {
    setConnectionState('connecting', 'Select the serial port…');
    await addPort();
    entry = selectedPortEntry();
    if (!entry) throw new Error('No serial port selected.');
  }
  setConnectionState('connecting', `Opening ${entry.label}…`);
  serialPort = entry.port;
  const baud = Number(config.serialBaud) || 4800;
  await serialPort.open({ baudRate: baud });
  await saveSelectedPort();
  await refreshPorts(entry.key);
  setConnectionState('live', `Serial connected · ${baud} baud`);
  log(`Receiving data from ${entry.label}.`);

  serialReadTask = (async () => {
    const decoder = new TextDecoderStream();
    const closed = serialPort.readable.pipeTo(decoder.writable);
    serialReader = decoder.readable.getReader();
    try {
      while (!serialStopped) {
        const { value, done } = await serialReader.read();
        if (done) break;
        if (value) parser.push(value, 'Serial port');
      }
    } catch (error) {
      if (!serialStopped) {
        log(`Serial error: ${error.message}`);
        setConnectionState('error', 'Serial port error');
      }
    } finally {
      try { serialReader.releaseLock(); } catch (_) {}
      serialReader = null;
      await closed.catch(() => {});
    }
  })();
}

/* The device's own GPS (phone or tablet) through the Geolocation API. */
async function connectDevice() {
  if (!('geolocation' in navigator)) throw new Error('This browser cannot read the device location.');
  intentionallyDisconnected = false;
  setConnectionState('connecting', 'Waiting for the device GPS…');
  log('Allow location access when the browser asks. The first position can take a few seconds outdoors.');
  geoWatchId = navigator.geolocation.watchPosition(position => {
    const c = position.coords;
    const knots = Number.isFinite(c.speed) && c.speed !== null ? c.speed * 1.9438444924406046 : null;
    receiveFix({
      lat: c.latitude,
      lon: c.longitude,
      sog: knots,
      // Browsers report no heading (NaN or null) while stationary.
      cog: Number.isFinite(c.heading) && c.heading !== null && knots > 0.3 ? c.heading : null,
      altitude: Number.isFinite(c.altitude) ? c.altitude : null,
      accuracy: c.accuracy,
      time: new Date(position.timestamp).toISOString(),
      quality: `±${Math.round(c.accuracy)} m`,
      source: 'Device GPS',
      receivedAt: new Date().toISOString()
    });
  }, error => {
    if (error.code === error.PERMISSION_DENIED) {
      stopDeviceGps();
      setConnectionState('error', 'Location access denied');
      log('Location access was denied. Allow it for this site in the browser or phone settings, then connect again.');
    } else if (!intentionallyDisconnected) {
      setConnectionState('error', 'Device GPS unavailable');
      log(error.code === error.TIMEOUT ? 'No position from the device GPS yet; still trying.' : `Device GPS error: ${error.message}`);
    }
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}

function stopDeviceGps() {
  if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = null;
}

/* Keeps the screen on while a GPS source is connected, so a phone does not lock mid-passage. */
async function keepScreenOn(on) {
  wakeLockWanted = on;
  if (!('wakeLock' in navigator)) return;
  try {
    if (on && !wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (_) {}
}

async function disconnect() {
  intentionallyDisconnected = true;
  serialStopped = true;
  stopDeviceGps();
  keepScreenOn(false);
  if (socket) {
    const current = socket;
    socket = null;
    current.close();
  }
  if (serialReader) {
    try { await serialReader.cancel(); } catch (_) {}
  }
  if (serialReadTask) {
    try { await serialReadTask; } catch (_) {}
    serialReadTask = null;
  }
  if (serialPort) {
    try { await serialPort.close(); } catch (_) {}
    serialPort = null;
    refreshPorts().catch(() => {});
  }
  setConnectionState('idle', 'No GPS connection');
  log('Connection closed by the user.');
}

async function connect() {
  $('connect').disabled = true;
  try {
    const mode = $('connectionMode').value;
    if (mode === 'serial') await connectSerial();
    else if (mode === 'device') await connectDevice();
    else await connectWebSocket();
    keepScreenOn(true);
  } catch (error) {
    setConnectionState('error', 'Connection failed');
    log(error.name === 'InvalidStateError' ? 'The port is already open, possibly in another app or tab.' : error.message);
    if (serialPort) {
      try { await serialPort.close(); } catch (_) {}
      serialPort = null;
    }
  }
}

/* ---------- Start-up ---------- */

async function initialize() {
  const keys = [...SETTING_IDS, 'tileUrl', 'tileMinZoom', 'tileMaxZoom', 'attribution', 'latestFix', 'serialPortKey'];
  config = await GPSPlatform.storage.get(keys);
  if (config.weatherEnabled === undefined) config.weatherEnabled = true;
  if (config.windBarbEnabled === undefined) config.windBarbEnabled = true;
  if (!config.tempUnits) config.tempUnits = 'C';
  if (!config.waveUnits) config.waveUnits = 'm';
  pruneConnectionModes();
  for (const id of SETTING_IDS) {
    if (config[id] !== undefined) {
      if ($(id).type === 'checkbox') $(id).checked = Boolean(config[id]);
      else $(id).value = config[id];
    }
    $(id).addEventListener('change', () => saveSetting(id).catch(error => log(error.message)));
  }
  for (const id of CHART_IDS) {
    if (config[id] !== undefined) $(id).value = config[id];
  }
  if (!$('connectionMode').value) $('connectionMode').selectedIndex = 0;
  $('baseChart').value = baseChartKey();
  if (!GPSPlatform.isExtension) setupWebApp();
  updateProviderUi();
  GPSPlatform.listen(message => log(message.text));
  await setupMenus();
  TileCache.install(maplibregl);
  TileCache.configure(config);
  $('connectionMode').addEventListener('change', updateModeRows);
  updateModeRows();
  $('weatherEnabled').addEventListener('change', () => {
    if ($('weatherEnabled').checked) {
      if (lastFix) requestSeries(lastFix, true);
    } else {
      stopPlay();
      boatSeries = null;
      $('timeline').classList.add('hidden');
      clearConditions('Forecast off.');
      updateWindBarb(lastFix, null);
    }
  });
  $('windBarbEnabled').addEventListener('change', () => {
    updateWindBarb(lastFix, currentHour());
  });
  for (const id of ['windFieldEnabled', 'waveFieldEnabled']) {
    $(id).addEventListener('change', () => { requestFieldSeries().catch(() => {}); });
  }
  $('weatherModel').addEventListener('change', () => {
    if (lastFix) requestSeries(lastFix, true);
    requestFieldSeries().catch(() => {});
  });
  for (const id of ['tempUnits', 'waveUnits']) {
    $(id).addEventListener('change', () => {
      if (boatSeries) renderSelectedHour();
    });
  }
  $('timeSlider').addEventListener('input', () => { stopPlay(); setHour(Number($('timeSlider').value) || 0); });
  $('timePlay').addEventListener('click', togglePlay);
  $('timeNow').addEventListener('click', () => { stopPlay(); setHour(0); });
  // Refresh as soon as the network returns, and otherwise every few hours in the background.
  window.addEventListener('online', refreshWeather);
  window.addEventListener('offline', () => { if (boatSeries) renderSelectedHour(); });
  weatherRefreshTimer = setInterval(() => { if (navigator.onLine) refreshWeather(); }, WEATHER_REFRESH_MS);
  $('connect').addEventListener('click', connect);
  $('disconnect').addEventListener('click', disconnect);
  $('serialPort').addEventListener('change', () => saveSelectedPort().catch(error => log(error.message)));
  $('addPort').addEventListener('click', addPort);
  $('scanPorts').addEventListener('click', () => scanPorts().catch(error => log(error.message)));
  if ('serial' in navigator) {
    navigator.serial.addEventListener('connect', () => {
      refreshPorts().catch(() => {});
      log('Serial adapter connected.');
    });
    navigator.serial.addEventListener('disconnect', event => {
      if (event.target === serialPort) {
        serialStopped = true;
        serialPort = null;
        setConnectionState('error', 'Serial adapter unplugged');
      }
      refreshPorts().catch(() => {});
      log('Serial adapter disconnected.');
    });
  }
  $('simulate').addEventListener('click', () => {
    const fix = { lat: 50.775, lon: -1.3, sog: 5.2, cog: 45, source: 'Simulation', quality: 'TEST', receivedAt: new Date().toISOString() };
    receiveFix(fix);
    log('Test position applied in the Solent, off Cowes.');
  });
  $('openProvider').addEventListener('click', async () => {
    const provider = $('provider').value;
    if (provider === 'garmin' && !validProviderFix(lastFix)) {
      log('Garmin needs a valid current or last known GPS position; no demonstration position is used.');
      return;
    }
    if (!GPSPlatform.isExtension) {
      // Opened straight away, while the tap still counts as a user action for the pop-up blocker.
      GPSPlatform.openProviderPage(provider, lastFix || DEFAULT_FIX, Number($('zoom').value) || 13.76, config.depthUnits);
      await Promise.all(SETTING_IDS.map(saveSetting));
      log(`${providerName(provider)} opened at the boat's position.${provider === 'garmin' ? ' Click the map centre if its marker is not shown.' : ''}`);
      return;
    }
    await Promise.all(SETTING_IDS.map(saveSetting));
    const response = await GPSPlatform.send({
      type: 'OPEN_PROVIDER',
      provider: config.provider,
      follow: config.provider === 'garmin' ? false : config.autoCenterProvider
    });
    if (!response?.ok) log(response?.error || 'Could not open the provider.');
    else log(`${providerName(config.provider)} opened at the vessel position.${config.provider === 'garmin' ? ' Waiting for the native marker check…' : ''}`);
  });
  $('applyTiles').addEventListener('click', async () => {
    const url = $('tileUrl').value.trim();
    if (!['{z}', '{x}', '{y}'].every(part => url.includes(part))) {
      log('The raster template must contain {z}, {x} and {y}.');
      return;
    }
    await applyChartSource({
      tileUrl: url,
      tileMinZoom: Number($('tileMinZoom').value),
      tileMaxZoom: Number($('tileMaxZoom').value),
      attribution: $('attribution').value.trim()
    });
    log('Chart source applied.');
  });
  $('baseChart').addEventListener('change', async () => {
    const preset = BASE_CHARTS[$('baseChart').value];
    updateBaseChartUi();
    if (!preset) return;
    await applyChartSource(preset);
    log(`Base chart: ${$('baseChart').selectedOptions[0].textContent}.`);
  });
  updateBaseChartUi();
  $('centerBoat').addEventListener('click', () => {
    if (!lastFix) {
      log('There is no GPS position to centre the chart on yet.');
      return;
    }
    if (!mapReady) {
      log('The chart is not ready yet. Try again in a moment.');
      return;
    }
    $('followBoat').checked = true;
    updateMap(lastFix);
    log('Chart centred on the boat; auto-follow enabled.');
  });
  $('clearTrack').addEventListener('click', () => {
    track = [];
    if (mapReady) map.getSource('track').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    log('Track cleared.');
  });
  $('prefetchArea').addEventListener('click', () => prefetchVisibleArea().catch(error => log(error.message)));
  $('refreshCacheStats').addEventListener('click', refreshCacheStats);
  $('clearCache').addEventListener('click', async () => {
    if (!confirm('Delete all stored chart tiles? The chart will not be available offline until it is downloaded again.')) return;
    await TileCache.clear();
    refreshCacheStats();
    log('Offline cache cleared.');
  });
  window.addEventListener('online', () => {
    updateNetworkState();
    log('Internet connection restored.');
  });
  window.addEventListener('offline', () => {
    updateNetworkState();
    log(config.cacheEnabled ? 'Internet connection lost: serving charts from the cache.' : 'Internet connection lost and the offline cache is disabled.');
  });
  updateNetworkState();
  if (config.latestFix && Number.isFinite(config.latestFix.lat)) {
    lastFix = config.latestFix;
    receiveFix(lastFix);
    setConnectionState('idle', 'Last saved position · GPS stopped');
  }
  initializeMap();
  TileCache.purgeUncacheable()
    .then(removed => { if (removed) log(`${removed} OpenStreetMap tiles removed from the offline cache (not allowed by its policy).`); })
    .catch(() => {})
    .finally(refreshCacheStats);
  setInterval(updateClock, 1000);
}

/* The web app cannot drive another site's tab, so the provider is only opened at the boat's position. */
function setupWebApp() {
  document.documentElement.classList.add('web-app');
  $('autoCenterProvider').closest('label').classList.add('hidden');
  $('updateSeconds').closest('label').classList.add('hidden');
  $('openProvider').textContent = 'Open provider at the boat position';
  $('providerHint').textContent = 'Opens i-Boating or C-MAP in a new tab at the current position. Following the boat on those sites needs the Chrome extension on a computer.';
}

document.addEventListener('visibilitychange', () => {
  // The browser drops the wake lock when the page is hidden; take it again on return.
  if (document.visibilityState === 'visible' && wakeLockWanted) keepScreenOn(true);
});

window.addEventListener('beforeunload', () => {
  intentionallyDisconnected = true;
  serialStopped = true;
  if (socket) socket.close();
  stopDeviceGps();
  if (serialReader) serialReader.cancel().catch(() => {});
  if (prefetchAbort) prefetchAbort.abort();
});

initialize().catch(error => {
  log(`Start-up failed: ${error.message}`);
  setConnectionState('error', 'Start-up error');
});
