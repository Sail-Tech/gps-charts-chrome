'use strict';
const assert = require('node:assert/strict');
const T = require('../targets.js');

const near = (a, b, eps) => Math.abs(a - b) < eps;

// Position and static data merge into one target; own-ship and base stations are not targets.
{
  const t = new T.Targets();
  const now = 1_000_000;
  assert.equal(t.update({ kind: 'static', mmsi: 1, name: 'EARLY', class: 'A' }, 'NMEA', now).name, 'EARLY');
  assert.equal(t.list(now).length, 0);   // no position yet
  t.update({ kind: 'position', class: 'A', mmsi: 1, lat: 50, lon: -1, sog: 10, cog: 90, heading: 91 }, 'NMEA', now);
  const list = t.list(now);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'EARLY');
  assert.equal(list[0].heading, 91);
  assert.equal(t.update({ kind: 'position', mmsi: 2, lat: 50, lon: -1, own: true }, 'NMEA', now), null);
  assert.equal(t.update({ kind: 'base', mmsi: 3, lat: 50, lon: -1 }, 'NMEA', now), null);
  assert.equal(t.update({ kind: 'position', mmsi: 4, lat: null, lon: null }, 'NMEA', now), null);
  // Blank static fields never overwrite known ones.
  t.update({ kind: 'static', mmsi: 1, name: '', destination: 'COWES' }, 'NMEA', now);
  assert.equal(t.get(1).name, 'EARLY');
  assert.equal(t.get(1).destination, 'COWES');
  // Removed after 20 minutes of silence; removeSource drops a source's targets.
  assert.equal(t.list(now + T.REMOVE_AFTER_MS + 1).length, 0);
  t.update({ kind: 'position', mmsi: 5, lat: 50, lon: -1 }, 'AIS demo', now);
  t.update({ kind: 'position', mmsi: 6, lat: 50, lon: -1 }, 'WebSocket', now);
  t.removeSource('AIS demo');
  assert.deepEqual(t.list(now).map(x => x.mmsi), [6]);
}

// Staleness follows the reporting interval of the class and state.
{
  assert.equal(T.isStale({ class: 'A', sog: 12, lastPosition: 0 }, 59000), false);
  assert.equal(T.isStale({ class: 'A', sog: 12, lastPosition: 0 }, 61000), true);
  assert.equal(T.isStale({ class: 'A', sog: 0, navStatus: 1, lastPosition: 0 }, 8 * 60000), false);
  assert.equal(T.isStale({ class: 'B', sog: 6, lastPosition: 0 }, 80000), false);
  assert.equal(T.isStale({ class: 'B', sog: 6, lastPosition: 0 }, 100000), true);
}

// CPA/TCPA: a target 2 NM east heading west at 10 kn towards a stopped own boat meets it in 12 min.
{
  const own = { lat: 50, lon: -1, sog: 0, cog: 0 };
  const k = Math.cos(50 * Math.PI / 180);
  const head = { lat: 50, lon: -1 + 2 / (60 * k), sog: 10, cog: 270 };
  const r = T.relative(own, head);
  assert.ok(near(r.rangeNm, 2, 1e-6));
  assert.ok(near(r.bearing, 90, 1e-6));
  assert.ok(near(r.cpaNm, 0, 1e-6));
  assert.ok(near(r.tcpaMin, 12, 1e-6));
  assert.equal(T.isDangerous(r), true);
  // Passing 1 NM north of the own boat: CPA 1 NM, not dangerous.
  const pass = { lat: 50 + 1 / 60, lon: -1 + 2 / (60 * k), sog: 10, cog: 270 };
  const p = T.relative(own, pass);
  assert.ok(near(p.cpaNm, 1, 1e-6));
  assert.equal(T.isDangerous(p), false);
  // Opening: TCPA negative, CPA is the current range.
  const away = T.relative(own, { lat: 50, lon: -1 + 2 / (60 * k), sog: 10, cog: 90 });
  assert.ok(away.tcpaMin < 0 && near(away.cpaNm, 2, 1e-6));
  assert.equal(T.isDangerous(away), false);
  assert.equal(T.relative(null, head), null);
}

// Course vector end point: 6 minutes at 10 kn due north = 1 NM.
{
  const e = T.project({ lat: 50, lon: -1, sog: 10, cog: 0 }, 6);
  assert.ok(near(e.lat, 50 + 1 / 60, 1e-9) && near(e.lon, -1, 1e-9));
  assert.equal(T.project({ lat: 50, lon: -1, sog: 0.1, cog: 0 }, 6), null);
}

console.log('targets.test.js: all assertions passed');
