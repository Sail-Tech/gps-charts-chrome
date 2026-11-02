'use strict';
const assert = require('node:assert/strict');
const { Parser, nmeaCoordinate, checksumIsValid } = require('../nmea.js');

function capture() {
  const fixes = [], errors = [];
  const parser = new Parser(fix => fixes.push(fix), error => errors.push(error));
  return { parser, fixes, errors };
}

const RMC = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A';
const GGA = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';

assert.ok(Math.abs(nmeaCoordinate('4807.038', 'N', true) - 48.1173) < 1e-9);
assert.equal(nmeaCoordinate('01131.000', 'W', false), -11.516666666666667);
assert.equal(checksumIsValid(RMC), true);
assert.equal(checksumIsValid(RMC.replace('*6A', '*00')), false);

{
  const { parser, fixes } = capture();
  parser.processLine(RMC, 'test');
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].sog, 22.4);
  assert.equal(fixes[0].cog, 84.4);
  assert.equal(fixes[0].time, '1994-03-23T12:35:19.000Z');
}

{
  const { parser, fixes } = capture();
  parser.processLine(GGA, 'test');
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].altitude, 545.4);
  assert.equal(fixes[0].satellites, 8);
}

{
  const { parser, fixes } = capture();
  parser.push(RMC.slice(0, 24), 'test');
  assert.equal(fixes.length, 0);
  parser.push(`${RMC.slice(24)}\r\n`, 'test');
  assert.equal(fixes.length, 1);
}

{
  const { parser, fixes, errors } = capture();
  parser.processLine(RMC.replace('*6A', '*00'), 'test');
  assert.equal(fixes.length, 0);
  assert.equal(errors.length, 1);
}

{
  const { parser, fixes } = capture();
  parser.processLine('{"latitude":50.775,"longitude":-1.3,"sog":5.2,"cog":45}', 'JSON');
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].lat, 50.775);
  assert.equal(fixes[0].sog, 5.2);
}

{
  const { parser, fixes } = capture();
  const message = { updates: [{ timestamp: '2026-10-30T12:00:00Z', values: [
    { path: 'navigation.position', value: { latitude: 50.775, longitude: -1.3 } },
    { path: 'navigation.speedOverGround', value: 2.5 },
    { path: 'navigation.courseOverGroundTrue', value: Math.PI / 2 }
  ] }] };
  parser.processLine(JSON.stringify(message), 'Signal K');
  assert.equal(fixes.length, 1);
  assert.ok(Math.abs(fixes[0].sog - 4.85961123110151) < 1e-9);
  assert.equal(fixes[0].cog, 90);
}

{
  const { parser, fixes } = capture();
  parser.processLine(RMC, 'test');
  parser.processLine('$GPVTG,054.7,T,034.4,M,005.5,N,010.2,K*48', 'test');
  assert.equal(fixes.length, 2);
  assert.equal(fixes[1].sog, 5.5);
  assert.equal(fixes[1].cog, 54.7);
}

// Tag blocks before AIS sentences are removed before the checksum check.
{
  const ais = [], errors = [];
  const parser = new Parser(() => {}, error => errors.push(error), sentence => ais.push(sentence));
  parser.processLine('\\c:1793581798108*66\\!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C', 'test');
  assert.deepEqual(errors, []);
  assert.equal(ais[0], '!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C');
}

console.log('All NMEA/JSON tests passed.');
