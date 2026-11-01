'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8'), context);
const providers = vm.runInContext('GPS_PROVIDER_URLS', context);

function decodeGeohash(hash) {
  const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  let even = true;
  for (const character of hash) {
    const value = alphabet.indexOf(character);
    assert.notEqual(value, -1, 'invalid test geohash');
    for (let mask = 16; mask; mask >>= 1) {
      const isOne = Boolean(value & mask);
      if (even) {
        const middle = (lonMin + lonMax) / 2;
        if (isOne) lonMin = middle; else lonMax = middle;
      } else {
        const middle = (latMin + latMax) / 2;
        if (isOne) latMin = middle; else latMax = middle;
      }
      even = !even;
    }
  }
  return { lat: (latMin + latMax) / 2, lon: (lonMin + lonMax) / 2 };
}

const cowes = { lat: 50.7629, lon: -1.298 };
const cowesHash = providers.geohash(cowes.lat, cowes.lon, 12);
assert.equal(cowesHash, 'gcp0f3ng66mj');
assert.equal(cowesHash.length, 12);
const cowesCentre = decodeGeohash(cowesHash);
assert.ok(Math.abs(cowesCentre.lat - cowes.lat) < 0.000001);
assert.ok(Math.abs(cowesCentre.lon - cowes.lon) < 0.000001);
assert.equal(
  providers.garmin(cowes),
  'https://maps.garmin.com/en-GB/marine/?maps=another-brand&overlay=false&key=gcp0f3ng66mj'
);

assert.equal(providers.geohash(0, 0), 's00000000000');
assert.equal(providers.geohash(-90, -180), '000000000000');
assert.equal(providers.geohash(90, 180), 'zzzzzzzzzzzz');
assert.equal(providers.geohash('50.7629', '-1.298'), cowesHash);
assert.match(providers.geohash(39.11206464283168, -74.70647351816297), /^dqfys00kkcrc$/);

for (const [lat, lon] of [
  [NaN, 0], [0, NaN], [Infinity, 0], [0, -Infinity],
  [-90.000001, 0], [90.000001, 0], [0, -180.000001], [0, 180.000001],
  [null, 0], [0, null], ['', 0], [0, ''], [true, 0], [0, false]
]) {
  assert.throws(() => providers.geohash(lat, lon), error => error.name === 'RangeError', `${lat}, ${lon}`);
}
assert.throws(() => providers.garmin(null), error => error.name === 'RangeError');
assert.throws(() => providers.garmin({}), error => error.name === 'RangeError');

// Existing providers retain their coordinate order and depth-unit behavior.
assert.equal(providers.cmapPath(cowes), '/core/select/new_place/@-1.298000,50.762900');
assert.ok(providers.iboating(cowes, 13.76, 'ft').includes('?depth=ft#13.76/50.762900/-1.298000'));

console.log('Provider URL and 12-character geohash tests passed.');
