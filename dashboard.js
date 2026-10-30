'use strict';

const $ = id => document.getElementById(id);
const DEFAULT_FIX = { lat: 50.775, lon: -1.3 };
const SETTING_IDS = [
  'connectionMode', 'provider', 'zoom', 'autoCenterProvider', 'updateSeconds', 'wsUrl', 'serialBaud',
  'bathymetryEnabled', 'bathymetryShading', 'depthUnits',
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
  GPSPlatform.send({ type: 'GPS_FIX', fix }).catch(error => log(`State not synchronised: ${error.message}`));
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
  await setupMenus();
  TileCache.install(maplibregl);
  TileCache.configure(config);
  $('connectionMode').addEventListener('change', updateModeRows);
  updateModeRows();
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
    if (!GPSPlatform.isExtension) {
      // Opened straight away, while the tap still counts as a user action for the pop-up blocker.
      GPSPlatform.openProviderPage($('provider').value, lastFix || DEFAULT_FIX, Number($('zoom').value) || 13.76, config.depthUnits);
      await Promise.all(SETTING_IDS.map(saveSetting));
      log(`${config.provider === 'cmap' ? 'C-MAP' : 'i-Boating'} opened at the boat's position.`);
      return;
    }
    await Promise.all(SETTING_IDS.map(saveSetting));
    const response = await GPSPlatform.send({ type: 'OPEN_PROVIDER', provider: config.provider, follow: config.autoCenterProvider });
    if (!response?.ok) log(response?.error || 'Could not open the provider.');
    else log(`${config.provider === 'cmap' ? 'C-MAP' : 'i-Boating'} opened.`);
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
