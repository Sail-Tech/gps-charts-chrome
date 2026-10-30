/* Offline tile cache for the dashboard map. Tiles, TileJSON and glyphs requested through the
   "cached://" MapLibre protocol are stored in IndexedDB and served from it when the network fails. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TileCache = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PROTOCOL = 'cached';
  const PREFIX = `${PROTOCOL}://`;
  const DB_NAME = 'gps-cartas-tile-cache';
  const NETWORK_TIMEOUT_MS = 8000;
  const MAX_PREFETCH_TILES = 5000;
  // Hosts whose usage policy forbids offline use and bulk downloading (OpenStreetMap). Their tiles are
  // never written to this cache or saved with "Save visible area"; they only use the browser's own HTTP
  // cache, which honours the server's caching headers, and blocked-access images are filtered out.
  const NO_CACHE_HOSTS = ['tile.openstreetmap.org'];
  // Hosts that do not allow exporting tiles (Esri: exportTilesAllowed false). Viewed tiles are cached,
  // but "Save visible area" does not bulk-download them.
  const NO_PREFETCH_HOSTS = ['server.arcgisonline.com'];

  const settings = { enabled: true, mode: 'network', maxBytes: 500 * 1024 * 1024, maxAgeMs: 30 * 86400000 };
  const tileJsonTemplates = new Map();
  let dbPromise = null;
  let totalBytes = null;
  let evicting = false;
  let offlineMisses = 0;
  let cacheHits = 0;
  let blockedTiles = 0;

  /* ---------- Pure helpers (also used by the tests) ---------- */

  function lonToTileX(lon, z) {
    return Math.floor((lon + 180) / 360 * 2 ** z);
  }

  function latToTileY(lat, z) {
    const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
    const rad = clamped * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * 2 ** z);
  }

  /* Tiles covering a bounding box [west, south, east, north] at zoom z. */
  function tileRange(bounds, z) {
    const max = 2 ** z - 1;
    const clamp = v => Math.max(0, Math.min(max, v));
    return {
      z,
      minX: clamp(lonToTileX(bounds[0], z)),
      maxX: clamp(lonToTileX(bounds[2], z)),
      minY: clamp(latToTileY(bounds[3], z)),
      maxY: clamp(latToTileY(bounds[1], z))
    };
  }

  function rangeSize(range) {
    return (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
  }

  function expandTemplate(template, z, x, y) {
    return template.replace('{z}', z).replace('{x}', x).replace('{y}', y)
      .replace('{-y}', 2 ** z - 1 - y).replace('{ratio}', '').replace('{r}', '');
  }

  function hostOf(url) {
    try { return new URL(url.replace(/[{}]/g, '')).hostname; } catch (_) { return ''; }
  }

  function cacheable(url) {
    const host = hostOf(url);
    return !NO_CACHE_HOSTS.some(blocked => host === blocked || host.endsWith(`.${blocked}`));
  }

  function wrap(url) {
    if (typeof url !== 'string' || url.startsWith(PREFIX)) return url;
    // Non-cacheable sources always go through the protocol so blocked-access images can be filtered.
    if (!settings.enabled && cacheable(url)) return url;
    return PREFIX + url;
  }

  function unwrap(url) {
    return url.startsWith(PREFIX) ? url.slice(PREFIX.length) : url;
  }

  /* ---------- IndexedDB ---------- */

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, 1);
        open.onupgradeneeded = () => {
          const database = open.result;
          database.createObjectStore('data', { keyPath: 'url' });
          const meta = database.createObjectStore('meta', { keyPath: 'url' });
          meta.createIndex('time', 'time');
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return dbPromise;
  }

  async function read(url) {
    const database = await db();
    const tx = database.transaction('data', 'readonly');
    return request(tx.objectStore('data').get(url));
  }

  async function write(url, buffer, contentType) {
    const database = await db();
    const tx = database.transaction(['data', 'meta'], 'readwrite');
    const time = Date.now();
    const metaStore = tx.objectStore('meta');
    const previous = await request(metaStore.get(url));
    tx.objectStore('data').put({ url, buffer, contentType, time });
    metaStore.put({ url, size: buffer.byteLength, time });
    await done(tx);
    if (totalBytes !== null) totalBytes += buffer.byteLength - (previous ? previous.size : 0);
    if (totalBytes !== null && totalBytes > settings.maxBytes) evict().catch(() => {});
  }

  async function stats() {
    const database = await db();
    const tx = database.transaction('meta', 'readonly');
    let count = 0, bytes = 0, oldest = null;
    await new Promise((resolve, reject) => {
      const cursor = tx.objectStore('meta').openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return resolve();
        count++;
        bytes += current.value.size;
        if (oldest === null || current.value.time < oldest) oldest = current.value.time;
        current.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    totalBytes = bytes;
    return { count, bytes, oldest, maxBytes: settings.maxBytes, hits: cacheHits, offlineMisses, blockedTiles };
  }

  /* Removes the oldest entries until the cache is at 90 % of its limit. */
  async function evict() {
    if (evicting) return;
    evicting = true;
    try {
      if (totalBytes === null) await stats();
      const target = settings.maxBytes * 0.9;
      if (totalBytes <= target) return;
      const database = await db();
      const tx = database.transaction(['data', 'meta'], 'readwrite');
      const meta = tx.objectStore('meta');
      const data = tx.objectStore('data');
      await new Promise((resolve, reject) => {
        const cursor = meta.index('time').openCursor();
        cursor.onsuccess = () => {
          const current = cursor.result;
          if (!current || totalBytes <= target) return resolve();
          totalBytes -= current.value.size;
          data.delete(current.value.url);
          current.delete();
          current.continue();
        };
        cursor.onerror = () => reject(cursor.error);
      });
      await done(tx);
    } finally {
      evicting = false;
    }
  }

  async function clear() {
    const database = await db();
    const tx = database.transaction(['data', 'meta'], 'readwrite');
    tx.objectStore('data').clear();
    tx.objectStore('meta').clear();
    await done(tx);
    totalBytes = 0;
    cacheHits = 0;
    offlineMisses = 0;
    blockedTiles = 0;
  }

  /* ---------- Network ---------- */

  function isOffline() {
    return settings.mode === 'offline' || (typeof navigator !== 'undefined' && navigator.onLine === false);
  }

  async function fetchNetwork(url, signal, cache = 'default') {
    const signals = [AbortSignal.timeout(NETWORK_TIMEOUT_MS)];
    if (signal) signals.push(signal);
    const response = await fetch(url, { signal: AbortSignal.any(signals), credentials: 'omit', cache });
    if (!response.ok && response.status !== 204) {
      const AJAXError = typeof maplibregl !== 'undefined' && maplibregl.AJAXError;
      const message = `HTTP ${response.status}`;
      throw AJAXError ? new AJAXError(response.status, response.statusText, url, new Blob()) : new Error(message);
    }
    // A captive portal or block page answers 200 with HTML; never store it in place of a tile.
    if (/text\/html/i.test(response.headers.get('content-type') || '')) {
      throw new Error(`Offline: HTML page received instead of ${url}`);
    }
    return {
      buffer: response.status === 204 ? new ArrayBuffer(0) : await response.arrayBuffer(),
      contentType: response.headers.get('content-type') || ''
    };
  }

  /* Converts a stored or downloaded body into what MapLibre expects for the request type. */
  function toResponse(url, buffer, type) {
    if (type !== 'json') return { data: buffer };
    const json = JSON.parse(new TextDecoder().decode(buffer));
    if (Array.isArray(json.tiles)) {
      tileJsonTemplates.set(url, {
        tiles: json.tiles.slice(),
        minzoom: Number.isFinite(json.minzoom) ? json.minzoom : 0,
        maxzoom: Number.isFinite(json.maxzoom) ? json.maxzoom : 22,
        tileSize: Number(json.tileSize) || 512
      });
      json.tiles = json.tiles.map(wrap);
    }
    return { data: json };
  }

  /* OpenStreetMap answers refused requests with an "Access blocked" image instead of the tile. It is
     recognised by the yellow and black hazard stripe down its left side, inside a white border. */
  async function isBlockTile(buffer) {
    try {
      const bitmap = await createImageBitmap(new Blob([buffer]));
      const k = bitmap.width / 256;
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const column = x => {
        const data = context.getImageData(Math.round(x * k), 0, 1, bitmap.height).data;
        let yellow = 0, black = 0, white = 0, n = 0;
        for (let y = Math.round(4 * k); y < bitmap.height - 4 * k; y += 2) {
          const r = data[y * 4], g = data[y * 4 + 1], b = data[y * 4 + 2];
          n++;
          if (r > 200 && g > 200 && b < 120) yellow++;
          else if (r < 70 && g < 70 && b < 70) black++;
          else if (r > 235 && g > 235 && b > 235) white++;
        }
        return { yellow: yellow / n, black: black / n, white: white / n };
      };
      const stripe = column(13);
      return stripe.yellow > 0.25 && stripe.black > 0.25 && column(4).white > 0.9 && column(250).white > 0.9;
    } catch (_) {
      return false;
    }
  }

  /* Sources that must not be stored offline: the browser's HTTP cache only, also when offline. */
  async function loadUncached(url, params, abortController) {
    const signal = abortController && abortController.signal;
    const offline = isOffline();
    let result = null;
    try {
      // force-cache returns the copy the browser already holds, even if stale, before trying the network.
      result = await fetchNetwork(url, signal, offline ? 'force-cache' : 'default');
    } catch (error) {
      if (signal && signal.aborted) throw error;
      if (!offline) result = await fetchNetwork(url, signal, 'force-cache').catch(() => null);
      if (!result) {
        if (!error || !error.status) offlineMisses++;
        throw offline ? new Error(`Offline: not in the browser cache ${url}`) : error;
      }
    }
    if (params.type === 'image' && await isBlockTile(result.buffer)) {
      blockedTiles++;
      throw new Error(`Blocked: ${hostOf(url)} refused ${url}`);
    }
    return toResponse(url, result.buffer, params.type);
  }

  async function load(params, abortController) {
    const url = unwrap(params.url);
    if (!cacheable(url)) return loadUncached(url, params, abortController);
    const entry = await read(url).catch(() => null);
    const fresh = entry && Date.now() - entry.time < settings.maxAgeMs;
    if (entry && (isOffline() || (settings.mode === 'cache' && fresh))) {
      cacheHits++;
      return toResponse(url, entry.buffer, params.type);
    }
    if (isOffline()) {
      offlineMisses++;
      throw new Error(`Offline: not in cache ${url}`);
    }
    try {
      const { buffer, contentType } = await fetchNetwork(url, abortController && abortController.signal);
      // Store a copy: MapLibre transfers the returned buffer to its worker, which detaches it.
      write(url, buffer.slice(0), contentType).catch(() => {});
      return toResponse(url, buffer, params.type);
    } catch (error) {
      if (abortController && abortController.signal.aborted) throw error;
      // Any failure falls back to the stored copy: without internet, routers and captive portals
      // often answer with HTTP errors such as 403 instead of a network error.
      if (entry) {
        cacheHits++;
        return toResponse(url, entry.buffer, params.type);
      }
      if (!entry && (!error || !error.status)) offlineMisses++;
      throw error;
    }
  }

  /* Deletes stored entries from hosts that must not be cached (kept by earlier versions). */
  async function purgeUncacheable() {
    const database = await db();
    const tx = database.transaction(['data', 'meta'], 'readwrite');
    const data = tx.objectStore('data');
    let removed = 0;
    await new Promise((resolve, reject) => {
      const cursor = tx.objectStore('meta').openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return resolve();
        if (!cacheable(current.value.url)) {
          data.delete(current.value.url);
          current.delete();
          removed++;
        }
        current.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    await done(tx);
    if (removed) totalBytes = null;
    return removed;
  }

  /* ---------- Public API ---------- */

  function install(maplibre) {
    maplibre.addProtocol(PROTOCOL, load);
  }

  function configure(config) {
    settings.enabled = config.cacheEnabled !== false;
    settings.mode = ['network', 'cache', 'offline'].includes(config.cacheMode) ? config.cacheMode : 'network';
    settings.maxBytes = Math.max(10, Number(config.cacheMaxMB) || 500) * 1024 * 1024;
    settings.maxAgeMs = Math.max(1, Number(config.cacheMaxAgeDays) || 30) * 86400000;
    if (totalBytes !== null && totalBytes > settings.maxBytes) evict().catch(() => {});
  }

  /* Builds the list of tile URLs for the given sources and bounds.
     sources: [{ tiles: [template], minzoom, maxzoom, tileSize }] */
  function planPrefetch(sources, bounds, mapZoom, extraLevels) {
    const urls = [];
    const skippedHosts = new Set();
    for (const source of sources) {
      const template = source.tiles && source.tiles[0];
      if (!template) continue;
      if (!cacheable(template) || NO_PREFETCH_HOSTS.includes(hostOf(template))) {
        skippedHosts.add(hostOf(template));
        continue;
      }
      // MapLibre zoom is based on 512 px tiles, so 256 px sources are requested one level deeper.
      const offset = source.tileSize === 256 ? 1 : 0;
      const first = Math.max(source.minzoom || 0, Math.floor(mapZoom) + offset);
      const last = Math.min(source.maxzoom ?? 22, Math.floor(mapZoom) + offset + extraLevels);
      for (let z = first; z <= last; z++) {
        const range = tileRange(bounds, z);
        if (urls.length + rangeSize(range) > MAX_PREFETCH_TILES) {
          return { urls, skippedHosts: [...skippedHosts], tooMany: true };
        }
        for (let x = range.minX; x <= range.maxX; x++) {
          for (let y = range.minY; y <= range.maxY; y++) urls.push(expandTemplate(template, z, x, y));
        }
      }
    }
    return { urls, skippedHosts: [...skippedHosts], tooMany: false };
  }

  /* Downloads and stores each URL. Already cached, still fresh entries are skipped. */
  async function prefetch(urls, { concurrency = 4, onProgress, signal } = {}) {
    let next = 0, completed = 0, failed = 0, skipped = 0;
    const worker = async () => {
      while (next < urls.length && !(signal && signal.aborted)) {
        const url = urls[next++];
        try {
          const entry = await read(url);
          if (entry && Date.now() - entry.time < settings.maxAgeMs) {
            skipped++;
          } else {
            const { buffer, contentType } = await fetchNetwork(url, signal);
            await write(url, buffer, contentType);
          }
        } catch (_) {
          failed++;
        }
        completed++;
        if (onProgress) onProgress({ completed, total: urls.length, failed, skipped });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
    return { completed, total: urls.length, failed, skipped, aborted: Boolean(signal && signal.aborted) };
  }

  return {
    PROTOCOL, MAX_PREFETCH_TILES,
    install, configure, wrap, unwrap, stats, clear, prefetch, planPrefetch, purgeUncacheable, cacheable, isBlockTile,
    templates: () => [...tileJsonTemplates.values()],
    isOffline,
    tileRange, rangeSize, expandTemplate, lonToTileX, latToTileY
  };
});
