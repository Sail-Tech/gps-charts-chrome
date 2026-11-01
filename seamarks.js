/* Details of lights, buoys, beacons and other seamarks for the chart's hover and tap read-out. The
   OpenSeaMap overlay is a picture, so its OpenStreetMap data (seamark:* tags) is read from the Overpass
   API, one z10 tile ("chunk", about 35 × 25 km in mid-latitudes) per request, and kept for 30 days. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Seamarks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHUNK_ZOOM = 10;
  const MIN_ZOOM = 11;                     // details are fetched and shown from this map zoom
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  const TIMEOUT_MS = 90000;               // the shared service queues requests when busy

  const COLOUR_CODES = {
    white: 'W', red: 'R', green: 'G', yellow: 'Y', blue: 'Bu', orange: 'Or', violet: 'Vi', amber: 'Am'
  };

  const TYPE_NAMES = {
    buoy_lateral: 'Lateral buoy', buoy_cardinal: 'Cardinal buoy', buoy_isolated_danger: 'Isolated danger buoy',
    buoy_safe_water: 'Safe water buoy', buoy_special_purpose: 'Special purpose buoy', buoy_installation: 'Installation buoy',
    beacon_lateral: 'Lateral beacon', beacon_cardinal: 'Cardinal beacon', beacon_isolated_danger: 'Isolated danger beacon',
    beacon_safe_water: 'Safe water beacon', beacon_special_purpose: 'Special purpose beacon',
    light_major: 'Major light', light_minor: 'Light', light_vessel: 'Light vessel', light_float: 'Light float',
    landmark: 'Landmark', wreck: 'Wreck', rock: 'Rock', obstruction: 'Obstruction', pile: 'Pile',
    harbour: 'Harbour', anchorage: 'Anchorage', mooring: 'Mooring', small_craft_facility: 'Small craft facility',
    pilot_boarding: 'Pilot boarding place', gate: 'Gate', bridge: 'Bridge', fog_signal: 'Fog signal',
    radar_transponder: 'Racon', notice: 'Notice mark', signal_station_traffic: 'Traffic signal station',
    signal_station_warning: 'Warning signal station', rescue_station: 'Rescue station', platform: 'Platform'
  };

  /* ---------- Chunks (z10 tiles) ---------- */

  function tileX(lon, z) {
    return Math.floor((lon + 180) / 360 * 2 ** z);
  }

  function tileY(lat, z) {
    const r = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
    return Math.floor((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * 2 ** z);
  }

  function chunkBounds(x, y, z = CHUNK_ZOOM) {
    const n = 2 ** z;
    const lat = t => Math.atan(Math.sinh(Math.PI * (1 - 2 * t / n))) * 180 / Math.PI;
    return { west: x / n * 360 - 180, east: (x + 1) / n * 360 - 180, north: lat(y), south: lat(y + 1) };
  }

  // The chunks covering a view, nearest the centre first, at most `limit` of them.
  function chunksFor(bounds, limit = 6) {
    const z = CHUNK_ZOOM;
    const x0 = tileX(bounds.west, z), x1 = tileX(bounds.east, z);
    const y0 = tileY(bounds.north, z), y1 = tileY(bounds.south, z);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const list = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) list.push({ id: `${z}/${x}/${y}`, x, y, d: (x - cx) ** 2 + (y - cy) ** 2 });
    }
    return list.sort((a, b) => a.d - b.d).slice(0, limit).map(({ id, x, y }) => ({ id, x, y }));
  }

  function overpassQuery(b) {
    const f = v => v.toFixed(5);
    return `[out:json][timeout:25];node["seamark:type"](${f(b.south)},${f(b.west)},${f(b.north)},${f(b.east)});out body;`;
  }

  // Keeps only the seamark tags and the name, as compact point features for a GeoJSON source.
  function parseOverpass(json) {
    const elements = (json && Array.isArray(json.elements)) ? json.elements : [];
    const features = [];
    for (const element of elements) {
      if (element.type !== 'node' || !Number.isFinite(element.lat) || !Number.isFinite(element.lon) || !element.tags) continue;
      const tags = {};
      for (const [key, value] of Object.entries(element.tags)) {
        if (key.startsWith('seamark:') || key === 'name') tags[key] = value;
      }
      if (!tags['seamark:type']) continue;
      features.push({ id: element.id, lon: element.lon, lat: element.lat, tags });
    }
    return features;
  }

  /* ---------- Descriptions ---------- */

  const words = value => String(value).replace(/_/g, ' ').replace(/;/g, '/');
  const capital = text => text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

  function colourCodes(value) {
    if (!value) return '';
    return String(value).split(';').map(c => COLOUR_CODES[c.trim()] || c.trim()).join('');
  }

  // Chart-style light characteristic, e.g. "Fl(2) G 5s 8m 3M" or "2 F R (vert)".
  function lightText(tags, prefix) {
    const get = key => tags[`${prefix}${key}`];
    const character = get('character');
    const colour = colourCodes(get('colour'));
    if (!character && !colour && !get('period')) return '';
    const parts = [];
    const multiple = Number(get('multiple'));
    let head = character || '';
    if (get('group')) head += `(${get('group')})`;
    if (multiple > 1) head = `${multiple} ${head}`.trim();
    if (head) parts.push(head);
    if (colour) parts.push(colour);
    if (get('period')) parts.push(`${get('period')}s`);
    if (get('height')) parts.push(`${get('height')}m`);
    if (get('range')) parts.push(`${get('range')}M`);
    if (multiple > 1 && get('category') === 'vertical') parts.push('(vert)');
    let text = parts.join(' ');
    const start = get('sector_start');
    const end = get('sector_end');
    if (start !== undefined && end !== undefined) text += ` · ${start}°–${end}°`;
    return text;
  }

  // Every light on the mark: the unnumbered one and sectors seamark:light:1:…, :2:… and so on.
  function lights(tags) {
    const list = [];
    const main = lightText(tags, 'seamark:light:');
    if (main) list.push(main);
    const numbers = new Set();
    for (const key of Object.keys(tags)) {
      const match = /^seamark:light:(\d+):/.exec(key);
      if (match) numbers.add(Number(match[1]));
    }
    for (const n of [...numbers].sort((a, b) => a - b)) {
      const text = lightText(tags, `seamark:light:${n}:`);
      if (text) list.push(text);
    }
    return list;
  }

  // { title, lines } for the read-out: the name (or the kind of mark), what it is, its light(s),
  // topmark, fog signal and List of Lights number.
  function describe(tags) {
    const type = tags['seamark:type'] || '';
    const kind = TYPE_NAMES[type] || capital(words(type)) || 'Seamark';
    const lines = [];
    const detail = [];
    const category = tags[`seamark:${type}:category`];
    if (category) detail.push(words(category));
    const colour = tags[`seamark:${type}:colour`];
    const shape = tags[`seamark:${type}:shape`];
    const look = [colour && words(colour), shape && words(shape)].filter(Boolean).join(', ');
    lines.push(`${kind}${detail.length ? ' · ' + detail.join(', ') : ''}${look ? ` (${look})` : ''}`);
    const level = tags[`seamark:${type}:water_level`];
    if (level) lines.push(`Water level: ${words(level)}`);
    for (const light of lights(tags)) lines.push(`Light: ${light}`);
    const topmark = tags['seamark:topmark:shape'];
    if (topmark) {
      const topColour = tags['seamark:topmark:colour'];
      lines.push(`Topmark: ${words(topmark)}${topColour ? ` (${words(topColour)})` : ''}`);
    }
    const fog = tags['seamark:fog_signal:category'];
    if (fog) {
      const period = tags['seamark:fog_signal:period'];
      lines.push(`Fog signal: ${words(fog)}${period ? ` ${period}s` : ''}`);
    }
    if (tags['seamark:radar_transponder:category'] || type === 'radar_transponder') lines.push('Racon');
    const reference = tags['seamark:light:reference'];
    if (reference) lines.push(`List of Lights: ${reference}`);
    const info = tags['seamark:information'];
    if (info) lines.push(info);
    return { title: tags.name || kind, lines };
  }

  /* ---------- Network ---------- */

  // Asks each endpoint in turn; Overpass answers 429 or 504 when busy, and the caller retries later.
  async function fetchChunk(x, y, signal) {
    const query = overpassQuery(chunkBounds(x, y));
    let lastError = null;
    for (const endpoint of ENDPOINTS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const onAbort = () => controller.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseOverpass(await response.json());
      } catch (error) {
        if (signal && signal.aborted) throw error;
        lastError = error;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    }
    throw lastError || new Error('Overpass unavailable');
  }

  return {
    CHUNK_ZOOM, MIN_ZOOM, ENDPOINTS,
    tileX, tileY, chunkBounds, chunksFor, overpassQuery, parseOverpass,
    colourCodes, lightText, lights, describe, fetchChunk
  };
});
