'use strict';
const assert = require('node:assert/strict');
const TileCache = require('../tilecache.js');
const SerialPorts = require('../serialports.js');
const { checksumIsValid } = require('../nmea.js');

// Tile maths: the Solent off Cowes (50.775 N, 1.3 W) at zoom 14.
assert.equal(TileCache.lonToTileX(-1.3, 14), 8132);
assert.equal(TileCache.latToTileY(50.775, 14), 5501);
assert.equal(TileCache.lonToTileX(-180, 3), 0);
assert.equal(TileCache.lonToTileX(179.999, 3), 7);

{
  const range = TileCache.tileRange([-1.35, 50.74, -1.25, 50.80], 14);
  assert.ok(range.minX <= range.maxX && range.minY <= range.maxY);
  assert.equal(TileCache.rangeSize(range), (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1));
}

assert.equal(TileCache.expandTemplate('https://t/{z}/{x}/{y}.png', 3, 4, 5), 'https://t/3/4/5.png');
assert.equal(TileCache.expandTemplate('https://t/{z}/{x}/{-y}.png', 3, 4, 5), 'https://t/3/4/2.png');

// The cached:// wrapper is applied once and can be removed.
TileCache.configure({ cacheEnabled: true });
assert.equal(TileCache.wrap('https://a/{z}'), 'cached://https://a/{z}');
assert.equal(TileCache.wrap(TileCache.wrap('https://a/{z}')), 'cached://https://a/{z}');
assert.equal(TileCache.unwrap('cached://https://a/1'), 'https://a/1');
// With the cache off the URL is the same: the protocol fetches from the network without storing.
TileCache.configure({ cacheEnabled: false });
assert.equal(TileCache.wrap('https://a/{z}'), 'cached://https://a/{z}');
TileCache.configure({ cacheEnabled: true });

// OpenStreetMap's servers do not allow offline use: their tiles never go through the cache.
assert.equal(TileCache.cacheable('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), false);
assert.equal(TileCache.cacheable('https://a.tile.openstreetmap.org/1/0/0.png'), false);
assert.equal(TileCache.cacheable('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'), true);
// They still go through the protocol, even with the cache off, so "Access blocked" images are filtered.
assert.equal(TileCache.wrap('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), 'cached://https://tile.openstreetmap.org/{z}/{x}/{y}.png');
TileCache.configure({ cacheEnabled: false });
assert.equal(TileCache.wrap('https://tile.openstreetmap.org/{z}/{x}/{y}.png'), 'cached://https://tile.openstreetmap.org/{z}/{x}/{y}.png');
TileCache.configure({ cacheEnabled: true });

// Prefetch planning: 256 px sources go one level deeper, OSM is never downloaded.
{
  const bounds = [-1.35, 50.74, -1.25, 50.80];
  const plan = TileCache.planPrefetch([
    { tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 19, tileSize: 256 },
    { tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 18, tileSize: 256 },
    { tiles: ['https://v/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 12, tileSize: 512 }
  ], bounds, 12.4, 1);
  assert.deepEqual(plan.skippedHosts, ['tile.openstreetmap.org']);
  const esri = TileCache.planPrefetch([
    { tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'], minzoom: 0, maxzoom: 16, tileSize: 256 }
  ], bounds, 12.4, 1);
  assert.deepEqual(esri.skippedHosts, ['server.arcgisonline.com']);
  assert.equal(esri.urls.length, 0);
  assert.equal(TileCache.cacheable('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/1/0/0'), true);
  assert.equal(plan.tooMany, false);
  assert.ok(plan.urls.every(url => !url.includes('openstreetmap.org')));
  assert.ok(plan.urls.some(url => url.includes('/seamark/13/')));
  assert.ok(plan.urls.some(url => url.includes('/seamark/14/')));
  assert.ok(!plan.urls.some(url => url.includes('/seamark/12/')));
  assert.ok(plan.urls.some(url => url.startsWith('https://v/12/')));
  assert.ok(!plan.urls.some(url => url.startsWith('https://v/13/')), 'clamped to the source maxzoom');
}

{
  const plan = TileCache.planPrefetch([
    { tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'], minzoom: 0, maxzoom: 18, tileSize: 256 }
  ], [-20, 30, 10, 50], 8, 4);
  assert.equal(plan.tooMany, true);
}

// Serial port helpers.
assert.equal(SerialPorts.describe({ usbVendorId: 0x1a86, usbProductId: 0x7523 }), 'WCH CH340 (VID 0x1a86 · PID 0x7523)');
assert.equal(SerialPorts.describe({ usbVendorId: 0x1546, usbProductId: 0x01a8 }), 'u-blox 8 GNSS (VID 0x1546 · PID 0x01a8)');
assert.equal(SerialPorts.describe({}), 'Serial port (built-in or virtual)');
assert.deepEqual(
  SerialPorts.keysFor([{ usbVendorId: 1027, usbProductId: 24577 }, {}, { usbVendorId: 1027, usbProductId: 24577 }]),
  ['1027:24577#1', 'native#1', '1027:24577#2']
);
assert.equal(SerialPorts.isNmeaSentence('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A\r', checksumIsValid), true);
assert.equal(SerialPorts.isNmeaSentence('$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*00', checksumIsValid), false);
assert.equal(SerialPorts.isNmeaSentence('ÿ\u0012garbage at the wrong baud', checksumIsValid), false);

console.log('All tile cache and serial port tests passed.');
