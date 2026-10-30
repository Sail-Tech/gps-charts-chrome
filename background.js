'use strict';

importScripts('shared.js');

const DEFAULTS = GPS_DEFAULTS;
const { CMAP_ORIGIN, IBOATING_URL } = GPS_PROVIDER_URLS;

// Runs inside the C-MAP page (main world). C-MAP is a React single-page app: replacing its
// "Pin location" route and firing popstate moves the pin and recentres the chart without a reload.
// replaceState keeps the tab's back-button history from growing with every GPS update.
function moveCmapPin(path) {
  if (location.pathname === path) return true;
  history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  return true;
}

// Runs inside the i-Boating page (main world). The chart exposes the bridge its mobile apps use,
// mapboxgl.external_to_js.callFromExternalBinding(); its "set_current_location" message draws the
// app's own boat marker with a heading line and, with c: true, flies there keeping the user's zoom.
async function moveIboatingBoat(lon, lat, heading, center, hash, redraw) {
  if (hash && location.hash !== hash) location.hash = hash; // applies a changed zoom setting
  const message = { type: 'set_current_location', x: lon, y: lat, c: center && !hash };
  if (heading !== null) message.h = heading;
  // The chart may still be loading after the page itself: retry for up to 15 s.
  for (let attempt = 0; attempt < 20; attempt++) {
    const bridge = window.mapboxgl?.external_to_js;
    if (bridge && document.querySelector('.mapboxgl-canvas')) {
      try {
        bridge.callFromExternalBinding(JSON.stringify(message));
        if (redraw) {
          // Right after the page loads, the heading icon may not be ready yet; draw the marker again.
          setTimeout(() => {
            try {
              bridge.callFromExternalBinding(JSON.stringify({ type: 'clear_my_location' }));
              bridge.callFromExternalBinding(JSON.stringify({ ...message, c: false }));
            } catch (_) {}
          }, 3000);
        }
        return true;
      } catch (_) {}
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }
  return false;
}

const PROVIDERS = {
  iboating: {
    name: 'i-Boating',
    supportsFollow: true,
    // The boat marker can move without moving the chart, so it keeps updating with auto-centre off.
    markerWithoutCenter: true,
    hash: (fix, zoom) => GPS_PROVIDER_URLS.iboatingHash(fix, zoom),
    build: (fix, zoom, units) => GPS_PROVIDER_URLS.iboating(fix, zoom, units),
    async move(tabId, fix, { center, zoom, zoomChanged, redraw = false }) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url?.startsWith(IBOATING_URL) || tab.status !== 'complete') return false;
      const heading = Number(fix.cog ?? fix.heading);
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: moveIboatingBoat,
        args: [fix.lon, fix.lat, Number.isFinite(heading) ? heading : null, center, zoomChanged ? this.hash(fix, zoom) : null, redraw]
      });
      return result?.result === true;
    }
  },
  cmap: {
    name: 'C-MAP',
    supportsFollow: true,
    path: fix => GPS_PROVIDER_URLS.cmapPath(fix),
    build: fix => GPS_PROVIDER_URLS.cmap(fix),
    async move(tabId, fix) {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url?.startsWith(`${CMAP_ORIGIN}/`) || tab.status !== 'complete') return false;
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: moveCmapPin,
        args: [this.path(fix)]
      });
      return result?.result === true;
    }
  }
};

let latestFix = null;
let providerTabId = null;
let providerAutoCenter = true;
let lastProviderUpdate = 0;
let lastProviderPosition = null;

async function settings() {
  const saved = await chrome.storage.local.get([...Object.keys(DEFAULTS), 'latestFix']);
  return { ...DEFAULTS, ...saved };
}

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function openProvider(provider, fix, zoom, units, force = false) {
  const builder = PROVIDERS[provider] || PROVIDERS.iboating;
  const url = builder.build(fix, zoom, units);
  if (providerTabId !== null) {
    try {
      await chrome.tabs.get(providerTabId);
      await chrome.tabs.update(providerTabId, { url, active: true });
    } catch (_) {
      const tab = await chrome.tabs.create({ url, active: true });
      providerTabId = tab.id;
    }
  } else {
    const tab = await chrome.tabs.create({ url, active: true });
    providerTabId = tab.id;
  }
  lastProviderUpdate = Date.now();
  lastProviderPosition = { lat: fix.lat, lon: fix.lon, zoom };
  await chrome.storage.local.set({ provider, zoom });
  return providerTabId;
}

async function followProvider(fix, force = false) {
  if (providerTabId === null) return;
  const config = await settings();
  const provider = PROVIDERS[config.provider];
  if (!provider?.supportsFollow) return;
  if (!providerAutoCenter && !provider.markerWithoutCenter) return;
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return;
  const now = Date.now();
  const elapsed = now - lastProviderUpdate;
  const moved = distanceMeters(lastProviderPosition, fix);
  const zoomChanged = !lastProviderPosition || lastProviderPosition.zoom !== config.zoom;
  if (!force && elapsed < config.updateSeconds * 1000) return;
  if (!force && moved < 2 && !zoomChanged) return;
  // Recorded before moving: an in-page move can wait for the chart to load, and later fixes must not pile up.
  lastProviderUpdate = now;
  lastProviderPosition = { lat: fix.lat, lon: fix.lon, zoom: config.zoom };
  try {
    let updated = false;
    const options = { center: providerAutoCenter, zoom: config.zoom, zoomChanged };
    if (provider.move) updated = await provider.move(providerTabId, fix, options).catch(() => false);
    if (!updated && providerAutoCenter) await chrome.tabs.update(providerTabId, { url: provider.build(fix, config.zoom, config.depthUnits), active: false });
  } catch (_) {
    providerTabId = null;
  }
}

// i-Boating only reads its depth units when the page loads, so an open i-Boating tab is reloaded.
async function reloadProviderUnits() {
  if (providerTabId === null) return;
  const config = await settings();
  const tab = await chrome.tabs.get(providerTabId).catch(() => null);
  if (config.provider !== 'iboating' || !tab?.url?.startsWith(IBOATING_URL)) return;
  const fix = latestFix || config.latestFix || { lat: 50.775, lon: -1.3 };
  await chrome.tabs.update(providerTabId, { url: PROVIDERS.iboating.build(fix, config.zoom, config.depthUnits) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'GPS_FIX') {
      latestFix = message.fix;
      await chrome.storage.local.set({ latestFix });
      await followProvider(latestFix);
      sendResponse({ ok: true });
    } else if (message.type === 'OPEN_PROVIDER') {
      const config = await settings();
      const fix = latestFix || config.latestFix || { lat: 50.775, lon: -1.3 };
      const provider = message.provider || config.provider;
      providerAutoCenter = message.follow ?? config.autoCenterProvider;
      await chrome.storage.local.set({ autoCenterProvider: providerAutoCenter });
      const tabId = await openProvider(provider, fix, config.zoom, config.depthUnits, true);
      sendResponse({ ok: true, tabId });
    } else if (message.type === 'GET_STATUS') {
      const config = await settings();
      providerAutoCenter = config.autoCenterProvider;
      sendResponse({
        ok: true,
        fix: latestFix || config.latestFix || null,
        providerTabId,
        providerAutoCenter,
        settings: config
      });
    } else if (message.type === 'SET_PROVIDER_FOLLOW') {
      providerAutoCenter = Boolean(message.enabled);
      await chrome.storage.local.set({ autoCenterProvider: providerAutoCenter });
      sendResponse({ ok: true });
    } else if (message.type === 'OPEN_DASHBOARD') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html'), active: true });
      sendResponse({ ok: true });
    } else if (message.type === 'SETTINGS_CHANGED') {
      if (message.id === 'depthUnits') await reloadProviderUnits();
      else await followProvider(latestFix, true);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'Unknown message' });
    }
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === providerTabId) providerTabId = null;
});

// Place the boat on the provider chart as soon as its page finishes loading, even when stationary.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId !== providerTabId || changeInfo.status !== 'complete') return;
  (async () => {
    const config = await settings();
    const provider = PROVIDERS[config.provider];
    const fix = latestFix || config.latestFix;
    if (!provider?.move || !fix || !Number.isFinite(fix.lat)) return;
    await provider.move(tabId, fix, { center: providerAutoCenter, zoom: config.zoom, zoomChanged: false, redraw: true });
  })().catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULTS));
  const additions = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) additions[key] = value;
  }
  // Move users still on the previous OpenStreetMap default to Esri World Ocean Base: OSM's tile servers
  // block this extension and do not allow offline use. A custom tile source is left untouched.
  if (current.tileUrl === 'https://tile.openstreetmap.org/{z}/{x}/{y}.png') {
    // Depth colours draw the coastline at harbour zoom, where the Esri chart is only an enlarged overview.
    Object.assign(additions, {
      tileUrl: DEFAULTS.tileUrl, tileMaxZoom: DEFAULTS.tileMaxZoom, attribution: DEFAULTS.attribution, bathymetryShading: true
    });
  }
  // Settings version 2: depth contours and depth colours are on by default, also for earlier installs.
  const { settingsVersion = 1 } = await chrome.storage.local.get('settingsVersion');
  if (settingsVersion < 2) Object.assign(additions, { bathymetryEnabled: true, bathymetryShading: true, settingsVersion: 2 });
  await chrome.storage.local.set(additions);
});
