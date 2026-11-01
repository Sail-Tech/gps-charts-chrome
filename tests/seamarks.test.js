'use strict';
const assert = require('node:assert/strict');
const Seamarks = require('../seamarks.js');

// Chunks: z10 tiles around the Solent, nearest the view centre first, capped.
{
  assert.equal(Seamarks.tileX(-1.3, 10), 508);
  assert.equal(Seamarks.tileY(50.775, 10), 343);
  const b = Seamarks.chunkBounds(508, 343);
  assert.ok(b.west < -1.3 && b.east > -1.3 && b.south < 50.775 && b.north > 50.775);
  const chunks = Seamarks.chunksFor({ west: -1.45, east: -1.15, south: 50.70, north: 50.85 });
  assert.ok(chunks.length >= 1 && chunks.length <= 6);
  assert.ok(chunks.some(c => c.id === '10/508/343'));
  assert.equal(Seamarks.chunksFor({ west: -10, east: 10, south: 40, north: 55 }, 3).length, 3);
}

// The Overpass query asks for seamark nodes in south, west, north, east order.
{
  const q = Seamarks.overpassQuery({ west: -1.4, east: -1.2, south: 50.7, north: 50.8 });
  assert.ok(q.includes('node["seamark:type"](50.70000,-1.40000,50.80000,-1.20000)'));
  assert.ok(q.startsWith('[out:json]'));
}

// Parsing keeps seamark tags and the name only, and skips non-seamark or incomplete elements.
{
  const features = Seamarks.parseOverpass({
    elements: [
      { type: 'node', id: 1, lat: 50.77, lon: -1.29, tags: { 'seamark:type': 'buoy_cardinal', name: 'Prince Consort', 'source': 'survey' } },
      { type: 'node', id: 2, lat: 50.7, lon: -1.2, tags: { amenity: 'bench' } },
      { type: 'node', id: 3, lat: 50.7, tags: { 'seamark:type': 'rock' } },
      { type: 'way', id: 4, tags: { 'seamark:type': 'harbour' } }
    ]
  });
  assert.equal(features.length, 1);
  assert.deepEqual(features[0], { id: 1, lon: -1.29, lat: 50.77, tags: { 'seamark:type': 'buoy_cardinal', name: 'Prince Consort' } });
  assert.deepEqual(Seamarks.parseOverpass(null), []);
}

// Light characteristics in chart notation.
{
  assert.equal(Seamarks.colourCodes('white;red'), 'WR');
  assert.equal(Seamarks.lightText({ 'seamark:light:character': 'Fl', 'seamark:light:group': '2', 'seamark:light:colour': 'green', 'seamark:light:period': '5', 'seamark:light:height': '8', 'seamark:light:range': '3' }, 'seamark:light:'), 'Fl(2) G 5s 8m 3M');
  assert.equal(Seamarks.lightText({ 'seamark:light:character': 'F', 'seamark:light:colour': 'red', 'seamark:light:multiple': '2', 'seamark:light:category': 'vertical' }, 'seamark:light:'), '2 F R (vert)');
  assert.equal(Seamarks.lightText({}, 'seamark:light:'), '');
}

// A north cardinal buoy with a light and topmark.
{
  const d = Seamarks.describe({
    'seamark:type': 'buoy_cardinal', name: 'Prince Consort',
    'seamark:buoy_cardinal:category': 'north', 'seamark:buoy_cardinal:colour': 'black;yellow', 'seamark:buoy_cardinal:shape': 'pillar',
    'seamark:light:character': 'VQ', 'seamark:light:colour': 'white',
    'seamark:topmark:shape': '2 cones up', 'seamark:topmark:colour': 'black'
  });
  assert.equal(d.title, 'Prince Consort');
  assert.deepEqual(d.lines, ['Cardinal buoy · north (black/yellow, pillar)', 'Light: VQ W', 'Topmark: 2 cones up (black)']);
}

// A sectored major light without a name, and a rock awash.
{
  const d = Seamarks.describe({
    'seamark:type': 'light_major', 'seamark:light:reference': 'A 0665.8',
    'seamark:light:1:character': 'Oc', 'seamark:light:1:colour': 'green', 'seamark:light:1:period': '10', 'seamark:light:1:sector_start': '220.8', 'seamark:light:1:sector_end': '224.3',
    'seamark:light:2:character': 'Oc', 'seamark:light:2:colour': 'white', 'seamark:light:2:period': '10', 'seamark:light:2:sector_start': '224.3', 'seamark:light:2:sector_end': '225.8'
  });
  assert.equal(d.title, 'Major light');
  assert.deepEqual(d.lines, ['Major light', 'Light: Oc G 10s · 220.8°–224.3°', 'Light: Oc W 10s · 224.3°–225.8°', 'List of Lights: A 0665.8']);
  const rock = Seamarks.describe({ 'seamark:type': 'rock', 'seamark:rock:water_level': 'awash' });
  assert.deepEqual(rock.lines, ['Rock', 'Water level: awash']);
  assert.equal(Seamarks.describe({ 'seamark:type': 'some_new_type' }).title, 'Some new type');
}

// fetchChunk falls back to the second endpoint when the first is busy.
(async () => {
  const realFetch = global.fetch;
  const asked = [];
  global.fetch = async url => {
    asked.push(url);
    if (asked.length === 1) return { ok: false, status: 504 };
    return { ok: true, json: async () => ({ elements: [{ type: 'node', id: 9, lat: 50.76, lon: -1.3, tags: { 'seamark:type': 'wreck', name: 'Yellowfin' } }] }) };
  };
  const features = await Seamarks.fetchChunk(508, 343);
  assert.equal(asked.length, 2);
  assert.equal(asked[0], Seamarks.ENDPOINTS[0]);
  assert.equal(features[0].tags.name, 'Yellowfin');

  global.fetch = async () => ({ ok: false, status: 429 });
  await assert.rejects(Seamarks.fetchChunk(508, 343), /HTTP 429/);
  global.fetch = realFetch;
  console.log('seamarks.test.js: all assertions passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
