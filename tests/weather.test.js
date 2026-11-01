'use strict';
const assert = require('node:assert/strict');
const Weather = require('../weather.js');

// URL building: rounds coordinates, asks for knots and Celsius, hits the right origins.
{
  const url = new URL(Weather.forecastUrl(50.7753219, -1.3001));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.pathname, '/v1/forecast');
  assert.equal(url.searchParams.get('latitude'), '50.7753');
  assert.equal(url.searchParams.get('longitude'), '-1.3001');
  assert.equal(url.searchParams.get('wind_speed_unit'), 'kn');
  assert.equal(url.searchParams.get('temperature_unit'), 'celsius');
  assert.ok(url.searchParams.get('current').includes('wind_speed_10m'));

  const marine = new URL(Weather.marineUrl(50.775, -1.3));
  assert.equal(marine.origin, 'https://marine-api.open-meteo.com');
  assert.equal(marine.pathname, '/v1/marine');
  assert.ok(marine.searchParams.get('current').includes('wave_height'));
}

// Forecast parsing maps Open-Meteo fields to the dashboard's shape; missing values become null.
{
  const parsed = Weather.parseForecast({
    current: { time: '2026-10-31T12:00', wind_speed_10m: 14.2, wind_direction_10m: 225, wind_gusts_10m: 21, temperature_2m: 16.8, surface_pressure: 1012.4 }
  });
  assert.deepEqual(parsed, { windSpeed: 14.2, windDir: 225, windGust: 21, airTemp: 16.8, pressure: 1012.4, time: '2026-10-31T12:00' });

  const empty = Weather.parseForecast({});
  assert.equal(empty.windSpeed, null);
  assert.equal(empty.pressure, null);
  assert.equal(empty.time, null);
}

// Marine parsing.
{
  const parsed = Weather.parseMarine({ current: { wave_height: 1.6, wave_direction: 240, wave_period: 7, ocean_current_velocity: 3.704, ocean_current_direction: 45 } });
  assert.deepEqual(parsed, { waveHeight: 1.6, waveDir: 240, wavePeriod: 7, currentSpeed: 2, currentDir: 45 });
  assert.equal(Weather.parseMarine({}).waveHeight, null);
  assert.equal(Weather.parseMarine({}).currentSpeed, null);
  assert.ok(Weather.marineUrl(50, -1).includes('ocean_current_velocity'));
}

// Ocean current helpers: km/h to knots, and the land mask from Open-Meteo's point elevation.
{
  assert.equal(Weather.knotsFromKmh(1.852), 1);
  assert.equal(Weather.knotsFromKmh(null), null);
  assert.equal(Weather.isLand(9), true);
  assert.equal(Weather.isLand(2), false);
  assert.equal(Weather.isLand(0), false);
  assert.equal(Weather.isLand(null), false);
}

// Compass from degrees (16-point), wrapping and nulls.
assert.equal(Weather.degToCompass(0), 'N');
assert.equal(Weather.degToCompass(225), 'SW');
assert.equal(Weather.degToCompass(360), 'N');
assert.equal(Weather.degToCompass(-45), 'NW');
assert.equal(Weather.degToCompass(null), null);

// Haversine distance: Cowes to about 2 km east is ~1.4 km across this longitude span, and a degree of
// latitude is ~111 km.
{
  assert.ok(Math.abs(Weather.distanceMeters(50.775, -1.3, 50.775, -1.28) - 1407) < 50);
  assert.ok(Math.abs(Weather.distanceMeters(0, 0, 1, 0) - 111195) < 200);
  assert.equal(Weather.distanceMeters(50.775, -1.3, 50.775, -1.3), 0);
}

// Refresh policy: no previous reading, aged out, or moved far enough.
{
  const now = 1_000_000;
  assert.equal(Weather.needsRefresh(null, 50.775, -1.3, now, 2000, 600000), true);
  const fresh = { lat: 50.775, lon: -1.3, time: now - 1000 };
  assert.equal(Weather.needsRefresh(fresh, 50.775, -1.3, now, 2000, 600000), false);
  assert.equal(Weather.needsRefresh({ ...fresh, time: now - 700000 }, 50.775, -1.3, now, 2000, 600000), true);
  assert.equal(Weather.needsRefresh(fresh, 50.775, -1.26, now, 2000, 600000), true);
}

// Wind barb (maritime symbol, knots): calm circle, half/full barbs, pennants and rotation.
{
  const count = (svg, tag) => (svg.match(new RegExp('<' + tag, 'g')) || []).length;

  assert.ok(Weather.windBarbSvg(1, 0).includes('<circle'), 'calm shows a circle');
  assert.ok(!Weather.windBarbSvg(1, 0).includes('<polygon'));

  // 15 kn = one full barb (10) + one half barb (5): staff + 2 lines, no pennant.
  const light = Weather.windBarbSvg(15, 45);
  assert.equal(count(light, 'line'), 3);
  assert.equal(count(light, 'polygon'), 0);
  assert.ok(light.includes('rotate(45)'));

  // 50 kn = one pennant; 65 kn = pennant + full barb + half barb.
  assert.equal(count(Weather.windBarbSvg(50, 0), 'polygon'), 1);
  const strong = Weather.windBarbSvg(65, 180);
  assert.equal(count(strong, 'polygon'), 1);
  assert.equal(count(strong, 'line'), 3); // staff + full barb + half barb
  assert.ok(strong.includes('rotate(180)'));

  // Direction wraps; a missing speed yields an empty SVG (no marks).
  assert.ok(Weather.windBarbSvg(20, 450).includes('rotate(90)'));
  const none = Weather.windBarbSvg(null, 0);
  assert.ok(none.includes('<svg') && !none.includes('<line') && !none.includes('<circle'));
}

// Wave arrow: points the way the waves run (dir + 180), scaled colour, empty when height is missing.
{
  const arrow = Weather.waveArrowSvg(1.2, 90);
  assert.ok(arrow.includes('<line') && arrow.includes('<path'));
  assert.ok(arrow.includes('rotate(270)'));
  const none = Weather.waveArrowSvg(null, 0);
  assert.ok(none.includes('<svg') && !none.includes('<line'));
}

// Current arrow: red, pointing the way the current flows (no +180), longer with speed up to 3 kn.
{
  const slow = Weather.currentArrowSvg(0, 90);
  const fast = Weather.currentArrowSvg(3, 90);
  const faster = Weather.currentArrowSvg(6, 90);
  assert.ok(fast.includes('#d62828') && fast.includes('rotate(90)'));
  const shaftEnd = svg => Number(/<line x1="0" y1="([\d.]+)"/.exec(svg)[1]);
  assert.equal(shaftEnd(slow), 7);    // 14 px long at 0 kn
  assert.equal(shaftEnd(fast), 23);   // 46 px long at 3 kn
  assert.equal(shaftEnd(faster), 23); // capped at 3 kn
  assert.ok(Weather.currentArrowSvg(1, 400).includes('rotate(40)'));
  const none = Weather.currentArrowSvg(null, 90);
  assert.ok(none.includes('<svg') && !none.includes('<line'));
}

// Grid of points across bounds: rows*cols, inset off the edges, within the box.
{
  const pts = Weather.gridPoints({ west: -2, east: 0, south: 50, north: 51 });
  assert.equal(pts.length, 35);
  for (const p of pts) {
    assert.ok(p.lon >= -2 && p.lon <= 0 && p.lat >= 50 && p.lat <= 51);
  }
  assert.ok(Math.abs(pts[0].lon - (-1.857)) < 0.01);
  assert.ok(Math.abs(pts[0].lat - 50.9) < 0.01);
  assert.equal(Weather.gridPoints({ west: 0, east: 1, south: 0, north: 1 }, 3, 2).length, 6);
}

// Field URLs carry comma-separated coordinates; the parser aligns an array answer to the points.
{
  const pts = [{ lat: 50, lon: -1 }, { lat: 50.5, lon: -1.5 }];
  const url = new URL(Weather.fieldForecastUrl(pts));
  assert.equal(url.searchParams.get('latitude'), '50,50.5');
  assert.equal(url.searchParams.get('longitude'), '-1,-1.5');
  assert.ok(url.searchParams.get('current').includes('wind_gusts_10m'));
  assert.equal(url.searchParams.get('models'), null);
  const parsed = Weather.parseFieldForecast([
    { current: { wind_speed_10m: 10, wind_direction_10m: 180, wind_gusts_10m: 15 } },
    { current: { wind_speed_10m: 12, wind_direction_10m: 200 } }
  ], pts);
  assert.deepEqual(parsed, [
    { windSpeed: 10, windDir: 180, windGust: 15 },
    { windSpeed: 12, windDir: 200, windGust: null }
  ]);
  // A single-object answer (one point) still parses, and a short answer fills the rest with nulls.
  assert.equal(Weather.parseFieldMarine({ current: { wave_height: 1.1, wave_direction: 90 } }, [{ lat: 0, lon: 0 }])[0].waveHeight, 1.1);
  assert.equal(Weather.parseFieldForecast([], pts)[1].windSpeed, null);
}

// Weather model selection: a chosen model is passed through; best_match stays the API default.
{
  const pts = [{ lat: 50, lon: -1 }];
  assert.equal(new URL(Weather.forecastUrl(50, -1, { model: 'ecmwf_ifs025' })).searchParams.get('models'), 'ecmwf_ifs025');
  assert.equal(new URL(Weather.forecastUrl(50, -1, { model: 'best_match' })).searchParams.get('models'), null);
  assert.equal(new URL(Weather.forecastUrl(50, -1)).searchParams.get('models'), null);
  assert.equal(new URL(Weather.fieldForecastUrl(pts, { model: 'gfs_seamless' })).searchParams.get('models'), 'gfs_seamless');
}

// Cache: key rounding, freshness window, 72 h fallback, eviction and age formatting.
{
  const HOUR = 3600000;
  const now = 1_000_000_000;
  assert.equal(Weather.cacheKey('cond', 50.7753, -1.3009, 'ecmwf_ifs025'), 'cond:ecmwf_ifs025:50.8,-1.3');
  assert.equal(Weather.cacheKey('field', 0, 0), 'field:best_match:0.0,0.0');

  const store = {};
  Weather.cachePut(store, 'k', { windSpeed: 10 }, now, 100, 72 * HOUR);
  assert.equal(Weather.cacheGet(store, 'k', now, HOUR, 72 * HOUR).fresh, true);
  // Two hours later: still within 72 h but no longer fresh.
  const later = Weather.cacheGet(store, 'k', now + 2 * HOUR, HOUR, 72 * HOUR);
  assert.equal(later.fresh, false);
  assert.equal(later.age, 2 * HOUR);
  // Past 72 h: discarded.
  assert.equal(Weather.cacheGet(store, 'k', now + 73 * HOUR, HOUR, 72 * HOUR), null);

  // Eviction: expired entries dropped on write, and the store capped to the newest N.
  const aged = { old: { data: 1, time: now - 100 * HOUR } };
  Weather.cachePut(aged, 'new', 2, now, 100, 72 * HOUR);
  assert.ok(!('old' in aged) && 'new' in aged);
  const capped = {};
  for (let i = 0; i < 5; i++) Weather.cachePut(capped, 'k' + i, i, now + i, 3, 72 * HOUR);
  assert.equal(Object.keys(capped).length, 3);
  assert.ok('k4' in capped && !('k0' in capped));

  assert.equal(Weather.formatAge(30 * 1000), 'just now');
  assert.equal(Weather.formatAge(5 * 60000), '5 min ago');
  assert.equal(Weather.formatAge(2 * HOUR), '2 h ago');
  assert.equal(Weather.formatAge(50 * HOUR), '2 d ago');
}

// Hourly series: URLs, parsing (times tagged UTC), the "now" index and the field series.
{
  const u = new URL(Weather.hourlyForecastUrl(50, -1, { model: 'ecmwf_ifs025' }));
  assert.ok(u.searchParams.get('hourly').includes('wind_gusts_10m'));
  assert.equal(u.searchParams.get('forecast_days'), '4');
  assert.equal(u.searchParams.get('models'), 'ecmwf_ifs025');

  const s = Weather.parseSeries(
    { hourly: { time: ['2026-10-31T12:00', '2026-10-31T13:00'], wind_speed_10m: [10, 12], wind_direction_10m: [180, 190], wind_gusts_10m: [15, 18], temperature_2m: [14, 15], surface_pressure: [1010, 1011] } },
    { hourly: { time: ['2026-10-31T12:00', '2026-10-31T13:00'], wave_height: [1.0, 1.2], wave_direction: [200, 210], wave_period: [6, 7], ocean_current_velocity: [1.852, 0], ocean_current_direction: [270, 90] } }
  );
  assert.equal(s.hours[0].currentSpeed, 1);
  assert.equal(s.hours[0].currentDir, 270);
  assert.equal(s.times.length, 2);
  assert.equal(s.times[0], '2026-10-31T12:00Z');
  assert.equal(s.hours[0].windSpeed, 10);
  assert.equal(s.hours[1].waveHeight, 1.2);
  assert.equal(s.hours[0].source, 'Open-Meteo');
  assert.equal(Weather.parseSeries({}, {}).hours.length, 0);

  const times = ['2026-10-31T12:00Z', '2026-10-31T13:00Z', '2026-10-31T14:00Z'];
  assert.equal(Weather.nowIndex(times, Date.parse('2026-10-31T13:10Z')), 1);
  assert.equal(Weather.nowIndex(times, Date.parse('2026-10-31T13:40Z')), 2);
  assert.equal(Weather.nowIndex([], 0), 0);

  const fs = Weather.parseFieldSeries(
    [{ hourly: { time: times.map(t => t.slice(0, -1)), wind_speed_10m: [10, 11, 12], wind_direction_10m: [180, 185, 190], wind_gusts_10m: [15, 16, 17] } },
     { hourly: { time: times.map(t => t.slice(0, -1)), wind_speed_10m: [20, 21, 22], wind_direction_10m: [200, 205, 210], wind_gusts_10m: [25, 26, 27] } }],
    [{ elevation: 0, hourly: { time: times.map(t => t.slice(0, -1)), wave_height: [1, 1.1, 1.2], wave_direction: [100, 110, 120], ocean_current_velocity: [3.704, 1.852, 0], ocean_current_direction: [10, 20, 30] } },
     { elevation: 9, hourly: { time: times.map(t => t.slice(0, -1)), wave_height: [2, 2.1, 2.2], wave_direction: [120, 130, 140] } }],
    [{ lat: 50, lon: -1 }, { lat: 51, lon: -2 }]
  );
  assert.equal(fs.times.length, 3);
  assert.equal(fs.points.length, 2);
  assert.equal(fs.points[0].hours[0].windSpeed, 10);
  assert.equal(fs.points[1].hours[2].waveHeight, 2.2);
  assert.equal(fs.points[0].hours[0].currentSpeed, 2);
  assert.equal(fs.points[0].hours[2].currentDir, 30);
  assert.equal(fs.points[1].hours[0].currentSpeed, null);
  assert.equal(fs.points[0].elevation, 0);
  assert.equal(fs.points[1].elevation, 9);
  assert.ok(Weather.fieldHourlyMarineUrl([{ lat: 50, lon: -1 }]).includes('ocean_current_direction'));
}

// fetchConditions merges both endpoints and throws only when neither has data.
(async () => {
  const realFetch = global.fetch;
  global.fetch = async url => ({
    ok: true,
    json: async () => url.includes('marine')
      ? { current: { wave_height: 1.2, wave_direction: 200, wave_period: 6 } }
      : { current: { wind_speed_10m: 10, wind_direction_10m: 180, temperature_2m: 15, surface_pressure: 1008, time: '2026-10-31T12:00' } }
  });
  const merged = await Weather.fetchConditions(50.775, -1.3);
  assert.equal(merged.windSpeed, 10);
  assert.equal(merged.waveHeight, 1.2);
  assert.equal(merged.source, 'Open-Meteo');
  assert.equal(merged.time, '2026-10-31T12:00');

  // Marine fails, forecast succeeds: still resolves with the wind/temperature it got.
  global.fetch = async url => {
    if (url.includes('marine')) throw new Error('network');
    return { ok: true, json: async () => ({ current: { wind_speed_10m: 8, temperature_2m: 14 } }) };
  };
  const windOnly = await Weather.fetchConditions(50.775, -1.3);
  assert.equal(windOnly.windSpeed, 8);
  assert.equal(windOnly.waveHeight, undefined);
  assert.ok(windOnly.time);

  // Both empty: rejects.
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  await assert.rejects(Weather.fetchConditions(50.775, -1.3), /no forecast data/);

  // fetchField aligns array answers to the points and leaves waves null when not requested.
  global.fetch = async url => ({
    ok: true,
    json: async () => url.includes('marine')
      ? [{ current: { wave_height: 1.1, wave_direction: 200 } }, { current: { wave_height: 1.3, wave_direction: 210 } }]
      : [{ current: { wind_speed_10m: 12, wind_direction_10m: 180 } }, { current: { wind_speed_10m: 14, wind_direction_10m: 190 } }]
  });
  const field = await Weather.fetchField([{ lat: 50, lon: -1 }, { lat: 50.1, lon: -1.1 }], { wind: true, wave: true });
  assert.equal(field.length, 2);
  assert.equal(field[0].windSpeed, 12);
  assert.equal(field[1].waveHeight, 1.3);

  global.fetch = async url => {
    if (url.includes('marine')) throw new Error('should not be called');
    return { ok: true, json: async () => [{ current: { wind_speed_10m: 9, wind_direction_10m: 100 } }] };
  };
  const windOnly2 = await Weather.fetchField([{ lat: 50, lon: -1 }], { wind: true, wave: false });
  assert.equal(windOnly2[0].windSpeed, 9);
  assert.equal(windOnly2[0].waveHeight, null);

  // fetchSeries merges the hourly forecast and marine series.
  global.fetch = async url => ({
    ok: true,
    json: async () => url.includes('marine')
      ? { hourly: { time: ['2026-10-31T12:00'], wave_height: [1.2], wave_direction: [200], wave_period: [6] } }
      : { hourly: { time: ['2026-10-31T12:00'], wind_speed_10m: [10], wind_direction_10m: [180], wind_gusts_10m: [15], temperature_2m: [14], surface_pressure: [1010] } }
  });
  const series = await Weather.fetchSeries(50, -1);
  assert.equal(series.hours.length, 1);
  assert.equal(series.hours[0].windSpeed, 10);
  assert.equal(series.hours[0].waveHeight, 1.2);

  // Currents alone still request the marine series (wind off, waves off).
  const asked = [];
  global.fetch = async url => {
    asked.push(url.includes('marine') ? 'marine' : 'forecast');
    return { ok: true, json: async () => [{ elevation: 0, hourly: { time: ['2026-10-31T12:00'], ocean_current_velocity: [1.852], ocean_current_direction: [90] } }] };
  };
  const currentsOnly = await Weather.fetchFieldSeries([{ lat: 50, lon: -1 }], { wind: false, current: true });
  assert.deepEqual(asked, ['marine']);
  assert.equal(currentsOnly.points[0].hours[0].currentSpeed, 1);

  // Offline (both endpoints fail), fetchFieldSeries rejects so the cached field is not overwritten.
  global.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(Weather.fetchFieldSeries([{ lat: 50, lon: -1 }], { wind: true }), /no forecast field/);

  global.fetch = realFetch;
  console.log('weather.test.js: all assertions passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
