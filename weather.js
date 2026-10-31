/* Marine conditions from Open-Meteo (no API key, CORS-enabled): wind, air temperature, pressure and
   waves at the boat position. The forecast and marine endpoints are queried together; either may fail
   on its own (the marine model has no data for inland lakes), so whatever answers is shown. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Weather = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORECAST_ORIGIN = 'https://api.open-meteo.com';
  const MARINE_ORIGIN = 'https://marine-api.open-meteo.com';
  const TIMEOUT_MS = 8000;
  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  /* ---------- Pure helpers (also used by the tests) ---------- */

  function number(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // Four decimals (~11 m) is finer than the models' grids and keeps the URL cacheable between fixes.
  function round(value) {
    return Math.round(Number(value) * 1e4) / 1e4;
  }

  function degToCompass(deg) {
    if (number(deg) === null) return null;
    const index = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16;
    return COMPASS[index];
  }

  function distanceMeters(aLat, aLon, bLat, bLon) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(bLat - aLat);
    const dLon = toRad(bLon - aLon);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function forecastUrl(lat, lon, opts = {}) {
    const params = new URLSearchParams({
      latitude: round(lat),
      longitude: round(lon),
      current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,surface_pressure',
      wind_speed_unit: 'kn',
      temperature_unit: 'celsius'
    });
    if (opts.model && opts.model !== 'best_match') params.set('models', opts.model);
    return `${FORECAST_ORIGIN}/v1/forecast?${params}`;
  }

  function marineUrl(lat, lon) {
    const params = new URLSearchParams({
      latitude: round(lat),
      longitude: round(lon),
      current: 'wave_height,wave_direction,wave_period'
    });
    return `${MARINE_ORIGIN}/v1/marine?${params}`;
  }

  function parseForecast(json) {
    const current = json && json.current ? json.current : {};
    return {
      windSpeed: number(current.wind_speed_10m),
      windDir: number(current.wind_direction_10m),
      windGust: number(current.wind_gusts_10m),
      airTemp: number(current.temperature_2m),
      pressure: number(current.surface_pressure),
      time: current.time || null
    };
  }

  function parseMarine(json) {
    const current = json && json.current ? json.current : {};
    return {
      waveHeight: number(current.wave_height),
      waveDir: number(current.wave_direction),
      wavePeriod: number(current.wave_period)
    };
  }

  // True when the cached reading is too old or the boat has moved far enough to be worth a new request.
  function needsRefresh(previous, lat, lon, now, minMoveMeters, maxAgeMs) {
    if (!previous) return true;
    if (now - previous.time >= maxAgeMs) return true;
    return distanceMeters(previous.lat, previous.lon, lat, lon) >= minMoveMeters;
  }

  // A maritime wind barb (knots): the staff points towards the direction the wind comes FROM, half
  // barbs are 5 kn, full barbs 10 kn and pennants 50 kn. Returns a self-contained SVG string.
  function windBarbSvg(speedKn, dirDeg, opts = {}) {
    const size = opts.size || 64;
    const color = opts.color || '#073b55';
    const sw = opts.width || 2;
    const cx = size / 2;
    const cy = size / 2;
    const header = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;
    const speed = number(speedKn);
    if (speed === null) return `${header}</svg>`;
    // Calm (under 2.5 kn rounds to nothing): the standard open circle.
    if (speed < 2.5) {
      return `${header}<circle cx="${cx}" cy="${cy}" r="${(size * 0.1).toFixed(1)}" fill="none" stroke="${color}" stroke-width="${sw}"/></svg>`;
    }
    const dir = (((Number(dirDeg) || 0) % 360) + 360) % 360;
    const staffLen = size * 0.34;
    const barbLen = size * 0.22;
    const bx = -barbLen * 0.9;      // barbs reach to the left of the staff
    const by = -barbLen * 0.45;     // and slant towards the tip
    const step = size * 0.085;      // spacing between symbols
    const tipY = -staffLen;
    let remaining = Math.round(speed / 5) * 5;
    const parts = [`<line x1="0" y1="0" x2="0" y2="${tipY.toFixed(1)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`];
    let pos = tipY;
    while (remaining >= 50) {
      parts.push(`<polygon points="0,${pos.toFixed(1)} ${bx.toFixed(1)},${(pos + by).toFixed(1)} 0,${(pos + step).toFixed(1)}" fill="${color}"/>`);
      pos += step * 1.2;
      remaining -= 50;
    }
    while (remaining >= 10) {
      parts.push(`<line x1="0" y1="${pos.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${(pos + by).toFixed(1)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`);
      pos += step;
      remaining -= 10;
    }
    if (remaining >= 5) {
      if (pos === tipY) pos += step;   // a lone half barb sits one step in from the tip
      parts.push(`<line x1="0" y1="${pos.toFixed(1)}" x2="${(bx * 0.5).toFixed(1)}" y2="${(pos + by * 0.5).toFixed(1)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`);
    }
    return `${header}<g transform="translate(${cx},${cy}) rotate(${dir.toFixed(0)})">${parts.join('')}</g></svg>`;
  }

  // A wave arrow pointing the way the waves run (Open-Meteo gives the direction they come from, so the
   // arrow is drawn 180° opposite). Its colour scales with significant wave height.
  function waveColor(heightM) {
    if (heightM < 0.5) return '#56b4e9';
    if (heightM < 1.25) return '#1f8fc3';
    if (heightM < 2.5) return '#f0a202';
    if (heightM < 4) return '#e8590c';
    return '#c1121f';
  }

  function waveArrowSvg(heightM, dirDeg, opts = {}) {
    const size = opts.size || 38;
    const sw = opts.width || 2.4;
    const cx = size / 2;
    const cy = size / 2;
    const header = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;
    const h = number(heightM);
    if (h === null) return `${header}</svg>`;
    const travel = (((Number(dirDeg) || 0) + 180) % 360 + 360) % 360;
    const color = opts.color || waveColor(h);
    const half = size * 0.34;
    const head = size * 0.13;
    const parts = [
      `<line x1="0" y1="${half.toFixed(1)}" x2="0" y2="${(-half).toFixed(1)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`,
      `<path d="M ${(-head).toFixed(1)} ${(-half + head).toFixed(1)} L 0 ${(-half).toFixed(1)} L ${head.toFixed(1)} ${(-half + head).toFixed(1)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
    ];
    return `${header}<g transform="translate(${cx},${cy}) rotate(${travel.toFixed(0)})">${parts.join('')}</g></svg>`;
  }

  // An evenly spaced grid of points across the visible bounds (inset off the edges), for a wind/wave
  // field. Returns rows*cols points in {lat, lon}.
  function gridPoints(bounds, cols = 7, rows = 5, inset = 0.5) {
    const points = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const fx = (c + inset) / cols;
        const fy = (r + inset) / rows;
        points.push({
          lat: bounds.north + (bounds.south - bounds.north) * fy,
          lon: bounds.west + (bounds.east - bounds.west) * fx
        });
      }
    }
    return points;
  }

  /* ---------- Cache (pure; the page backs it with localStorage) ---------- */

  // Cache key rounded to 0.1° (~11 km, about the models' grid) so nearby requests share an entry.
  function cacheKey(kind, lat, lon, model) {
    const r = v => (Math.round(v * 10) / 10).toFixed(1);
    return `${kind}:${model || 'best_match'}:${r(lat)},${r(lon)}`;
  }

  // Returns the entry when it is within maxAgeMs, flagging whether it is still fresh (within freshMs).
  function cacheGet(store, key, now, freshMs, maxAgeMs) {
    const entry = store && store[key];
    if (!entry || typeof entry.time !== 'number') return null;
    const age = now - entry.time;
    if (age < 0 || age > maxAgeMs) return null;
    return { data: entry.data, time: entry.time, age, fresh: age <= freshMs };
  }

  // Writes an entry, then drops anything past maxAgeMs and keeps only the newest maxEntries.
  function cachePut(store, key, data, now, maxEntries, maxAgeMs) {
    store[key] = { data, time: now };
    for (const k of Object.keys(store)) {
      if (typeof store[k].time !== 'number' || now - store[k].time > maxAgeMs) delete store[k];
    }
    const keys = Object.keys(store);
    if (keys.length > maxEntries) {
      keys.sort((a, b) => store[a].time - store[b].time);
      for (const k of keys.slice(0, keys.length - maxEntries)) delete store[k];
    }
    return store;
  }

  function formatAge(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
  }

  /* ---------- Network ---------- */

  async function fetchJson(url, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Resolves with whatever the two endpoints returned; throws only if neither gave a usable value.
  async function fetchConditions(lat, lon, options = {}) {
    const [forecast, marine] = await Promise.allSettled([
      fetchJson(forecastUrl(lat, lon, { model: options.model }), options.signal),
      fetchJson(marineUrl(lat, lon), options.signal)
    ]);
    const conditions = { source: 'Open-Meteo', time: null };
    if (forecast.status === 'fulfilled') Object.assign(conditions, parseForecast(forecast.value));
    if (marine.status === 'fulfilled') Object.assign(conditions, parseMarine(marine.value));
    const hasValue = ['windSpeed', 'airTemp', 'pressure', 'waveHeight']
      .some(key => number(conditions[key]) !== null);
    if (!hasValue) throw new Error('no forecast data for this position');
    if (!conditions.time) conditions.time = new Date().toISOString();
    return conditions;
  }

  /* ---------- Field (grid of points in one request) ---------- */

  function fieldForecastUrl(points, opts = {}) {
    const params = new URLSearchParams({
      latitude: points.map(p => round(p.lat)).join(','),
      longitude: points.map(p => round(p.lon)).join(','),
      current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      wind_speed_unit: 'kn'
    });
    if (opts.model && opts.model !== 'best_match') params.set('models', opts.model);
    return `${FORECAST_ORIGIN}/v1/forecast?${params}`;
  }

  function fieldMarineUrl(points) {
    const params = new URLSearchParams({
      latitude: points.map(p => round(p.lat)).join(','),
      longitude: points.map(p => round(p.lon)).join(','),
      current: 'wave_height,wave_direction'
    });
    return `${MARINE_ORIGIN}/v1/marine?${params}`;
  }

  // Open-Meteo answers a multi-location request with an array (one entry per point), or a single object
  // for one point; normalise to an array aligned with the points.
  function asArray(json, length) {
    const list = Array.isArray(json) ? json : (json ? [json] : []);
    return Array.from({ length }, (_, i) => (list[i] && list[i].current) || {});
  }

  function parseFieldForecast(json, points) {
    return asArray(json, points.length).map(c => ({
      windSpeed: number(c.wind_speed_10m),
      windDir: number(c.wind_direction_10m),
      windGust: number(c.wind_gusts_10m)
    }));
  }

  function parseFieldMarine(json, points) {
    return asArray(json, points.length).map(c => ({
      waveHeight: number(c.wave_height),
      waveDir: number(c.wave_direction)
    }));
  }

  async function fetchField(points, options = {}) {
    const wantWind = options.wind !== false;
    const wantWave = options.wave === true;
    const [forecast, marine] = await Promise.allSettled([
      wantWind ? fetchJson(fieldForecastUrl(points, { model: options.model }), options.signal) : Promise.resolve(null),
      wantWave ? fetchJson(fieldMarineUrl(points), options.signal) : Promise.resolve(null)
    ]);
    const wind = forecast.status === 'fulfilled' && forecast.value ? parseFieldForecast(forecast.value, points) : null;
    const wave = marine.status === 'fulfilled' && marine.value ? parseFieldMarine(marine.value, points) : null;
    return points.map((p, i) => ({
      lat: p.lat,
      lon: p.lon,
      windSpeed: wind ? wind[i].windSpeed : null,
      windDir: wind ? wind[i].windDir : null,
      windGust: wind ? wind[i].windGust : null,
      waveHeight: wave ? wave[i].waveHeight : null,
      waveDir: wave ? wave[i].waveDir : null
    }));
  }

  /* ---------- Hourly series (forecast timeline) ---------- */

  function at(arr, i) {
    return arr ? number(arr[i]) : null;
  }

  function hourlyForecastUrl(lat, lon, opts = {}) {
    const params = new URLSearchParams({
      latitude: round(lat),
      longitude: round(lon),
      hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,surface_pressure',
      wind_speed_unit: 'kn',
      temperature_unit: 'celsius',
      forecast_days: String(opts.days || 4)
    });
    if (opts.model && opts.model !== 'best_match') params.set('models', opts.model);
    return `${FORECAST_ORIGIN}/v1/forecast?${params}`;
  }

  function hourlyMarineUrl(lat, lon, opts = {}) {
    const params = new URLSearchParams({
      latitude: round(lat),
      longitude: round(lon),
      hourly: 'wave_height,wave_direction,wave_period',
      forecast_days: String(opts.days || 4)
    });
    return `${MARINE_ORIGIN}/v1/marine?${params}`;
  }

  function fieldHourlyForecastUrl(points, opts = {}) {
    const params = new URLSearchParams({
      latitude: points.map(p => round(p.lat)).join(','),
      longitude: points.map(p => round(p.lon)).join(','),
      hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
      wind_speed_unit: 'kn',
      forecast_days: String(opts.days || 4)
    });
    if (opts.model && opts.model !== 'best_match') params.set('models', opts.model);
    return `${FORECAST_ORIGIN}/v1/forecast?${params}`;
  }

  function fieldHourlyMarineUrl(points, opts = {}) {
    const params = new URLSearchParams({
      latitude: points.map(p => round(p.lat)).join(','),
      longitude: points.map(p => round(p.lon)).join(','),
      hourly: 'wave_height,wave_direction',
      forecast_days: String(opts.days || 4)
    });
    return `${MARINE_ORIGIN}/v1/marine?${params}`;
  }

  // The hourly API returns GMT times like "2026-10-31T14:00"; a trailing Z makes them unambiguous UTC,
  // which the page then shows in the viewer's own locale.
  function parseSeries(forecastJson, marineJson) {
    const f = (forecastJson && forecastJson.hourly) || {};
    const m = (marineJson && marineJson.hourly) || {};
    const raw = f.time || m.time || [];
    const times = raw.map(t => `${t}Z`);
    const hours = times.map((t, i) => ({
      time: t,
      source: 'Open-Meteo',
      windSpeed: at(f.wind_speed_10m, i),
      windDir: at(f.wind_direction_10m, i),
      windGust: at(f.wind_gusts_10m, i),
      airTemp: at(f.temperature_2m, i),
      pressure: at(f.surface_pressure, i),
      waveHeight: at(m.wave_height, i),
      waveDir: at(m.wave_direction, i),
      wavePeriod: at(m.wave_period, i)
    }));
    return { times, hours };
  }

  function parseFieldSeries(forecastJson, marineJson, points) {
    const fList = Array.isArray(forecastJson) ? forecastJson : (forecastJson ? [forecastJson] : []);
    const mList = Array.isArray(marineJson) ? marineJson : (marineJson ? [marineJson] : []);
    let times = [];
    const series = points.map((p, idx) => {
      const fh = (fList[idx] && fList[idx].hourly) || {};
      const mh = (mList[idx] && mList[idx].hourly) || {};
      const t = fh.time || mh.time || [];
      if (t.length > times.length) times = t;
      const hours = t.map((_, i) => ({
        windSpeed: at(fh.wind_speed_10m, i),
        windDir: at(fh.wind_direction_10m, i),
        windGust: at(fh.wind_gusts_10m, i),
        waveHeight: at(mh.wave_height, i),
        waveDir: at(mh.wave_direction, i)
      }));
      return { lat: p.lat, lon: p.lon, hours };
    });
    return { times: times.map(t => `${t}Z`), points: series };
  }

  // Index of the hour nearest to `now` (defaults to the current time), used to start the window at "now".
  function nowIndex(times, now) {
    const t = now === undefined ? Date.now() : now;
    if (!times || !times.length) return 0;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(new Date(times[i]).getTime() - t);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    }
    return best;
  }

  async function fetchSeries(lat, lon, options = {}) {
    const [forecast, marine] = await Promise.allSettled([
      fetchJson(hourlyForecastUrl(lat, lon, { model: options.model, days: options.days }), options.signal),
      fetchJson(hourlyMarineUrl(lat, lon, { days: options.days }), options.signal)
    ]);
    const series = parseSeries(
      forecast.status === 'fulfilled' ? forecast.value : null,
      marine.status === 'fulfilled' ? marine.value : null
    );
    if (!series.hours.length) throw new Error('no forecast series for this position');
    return series;
  }

  async function fetchFieldSeries(points, options = {}) {
    const [forecast, marine] = await Promise.allSettled([
      options.wind !== false ? fetchJson(fieldHourlyForecastUrl(points, { model: options.model, days: options.days }), options.signal) : Promise.resolve(null),
      options.wave === true ? fetchJson(fieldHourlyMarineUrl(points, { days: options.days }), options.signal) : Promise.resolve(null)
    ]);
    const series = parseFieldSeries(
      forecast.status === 'fulfilled' ? forecast.value : null,
      marine.status === 'fulfilled' ? marine.value : null,
      points
    );
    // Both endpoints are best-effort (allSettled), so an empty result means the fetch failed (offline);
    // throw so the caller keeps the cached field instead of overwriting it with nothing.
    if (!series.times.length) throw new Error('no forecast field for this area');
    return series;
  }

  return {
    FORECAST_ORIGIN, MARINE_ORIGIN,
    forecastUrl, marineUrl, parseForecast, parseMarine,
    hourlyForecastUrl, hourlyMarineUrl, fieldHourlyForecastUrl, fieldHourlyMarineUrl,
    parseSeries, parseFieldSeries, nowIndex, fetchSeries, fetchFieldSeries,
    degToCompass, distanceMeters, needsRefresh, fetchConditions, windBarbSvg,
    waveArrowSvg, gridPoints, fieldForecastUrl, fieldMarineUrl, parseFieldForecast, parseFieldMarine, fetchField,
    cacheKey, cacheGet, cachePut, formatAge
  };
});
