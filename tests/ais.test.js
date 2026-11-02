'use strict';
const assert = require('node:assert/strict');
const AIS = require('../ais.js');

const near = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

// Reference sentences from the gpsd AIVDM/AIVDO documentation.
{
  const d = new AIS.Decoder();
  const m = d.push('!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C');
  assert.equal(m.type, 1);
  assert.equal(m.class, 'A');
  assert.equal(m.mmsi, 477553000);
  assert.equal(m.navStatus, 5);
  assert.ok(near(m.lat, 47.582833) && near(m.lon, -122.345832));
  assert.equal(m.sog, 0);
  assert.equal(m.cog, 51);
  assert.equal(m.heading, 181);
  assert.equal(m.own, false);
}
{
  const d = new AIS.Decoder();
  assert.equal(d.push('!AIVDM,2,1,1,A,55?MbV02;H;s<HtKR20EHE:0@T4@Dn2222222216L961O5Gf0NSQEp6ClRp8,0*1C'), null);
  const m = d.push('!AIVDM,2,2,1,A,88888888880,2*25');
  assert.equal(m.type, 5);
  assert.equal(m.mmsi, 351759000);
  assert.equal(m.name, 'EVER DIADEM');
  assert.equal(m.callsign, '3FOF8');
  assert.equal(m.destination, 'NEW YORK');
  assert.equal(m.imo, 9134270);
  assert.equal(m.shipType, 70);
  assert.equal(m.draught, 12.2);
  assert.deepEqual([m.toBow, m.toStern, m.toPort, m.toStarboard], [225, 70, 1, 31]);
  // A second part without its first is dropped.
  assert.equal(new AIS.Decoder().push('!AIVDM,2,2,1,A,88888888880,2*25'), null);
}
{
  const m = new AIS.Decoder().push('!AIVDM,1,1,,A,B52K>;h00Fc>jpUlNV@ikwpUoP06,0*4C');
  assert.equal(m.type, 18);
  assert.equal(m.class, 'B');
  assert.equal(m.mmsi, 338087471);
  assert.ok(near(m.lat, 40.68454, 1e-4) && near(m.lon, -74.072132, 1e-4));
  assert.equal(m.sog, 0.1);
  assert.equal(m.cog, 79.6);
  assert.equal(m.heading, null);
}
{
  const a = new AIS.Decoder().push('!AIVDM,1,1,,A,H42O55i18tMET00000000000000,2*6D');
  assert.equal(a.type, 24);
  assert.equal(a.part, 'A');
  assert.equal(a.mmsi, 271041815);
  assert.equal(a.name, 'PROGUY');
  const b = new AIS.Decoder().push('!AIVDM,1,1,,A,H42O55lti4hhhilD3nink000?050,0*40');
  assert.equal(b.part, 'B');
  assert.equal(b.shipType, 60);
  assert.equal(b.callsign, 'TC6163');
  assert.deepEqual([b.toBow, b.toStern, b.toPort, b.toStarboard], [0, 15, 0, 5]);
}

// The encoder round-trips through the decoder, with valid checksums and split long messages.
{
  const checksumOk = s => AIS.checksum(s.slice(1, s.indexOf('*'))) === s.slice(s.indexOf('*') + 1);
  const d = new AIS.Decoder();
  const a = { mmsi: 999000001, class: 'A', navStatus: 0, lat: 50.7712, lon: -1.2931, sog: 12.3, cog: 254.5, heading: 256, second: 12 };
  const [s1] = AIS.encodePosition(a);
  assert.ok(checksumOk(s1));
  const m1 = d.push(s1);
  assert.equal(m1.mmsi, a.mmsi);
  assert.ok(near(m1.lat, a.lat) && near(m1.lon, a.lon));
  assert.equal(m1.sog, 12.3);
  assert.equal(m1.cog, 254.5);
  assert.equal(m1.heading, 256);

  const b = { mmsi: 999000002, class: 'B', lat: -33.9, lon: 151.2, sog: 5.5, cog: 10, heading: null };
  const m2 = d.push(AIS.encodePosition(b)[0]);
  assert.equal(m2.type, 18);
  assert.ok(near(m2.lat, -33.9) && near(m2.lon, 151.2));
  assert.equal(m2.heading, null);

  const st = AIS.encodeStatic({ mmsi: 999000001, class: 'A', name: 'DEMO CARGO', callsign: 'DEMO1', shipType: 70, toBow: 120, toStern: 30, toPort: 10, toStarboard: 12, draught: 8.5, destination: 'SOUTHAMPTON', eta: { month: 11, day: 2, hour: 14, minute: 30 } });
  assert.equal(st.length, 2);
  assert.ok(st.every(checksumOk));
  assert.equal(d.push(st[0]), null);
  const m3 = d.push(st[1]);
  assert.equal(m3.name, 'DEMO CARGO');
  assert.equal(m3.destination, 'SOUTHAMPTON');
  assert.equal(m3.draught, 8.5);
  assert.deepEqual(m3.eta, { month: 11, day: 2, hour: 14, minute: 30 });

  const sb = AIS.encodeStatic({ mmsi: 999000002, class: 'B', name: 'DEMO YACHT', shipType: 36, callsign: 'DY2', toBow: 8, toStern: 4, toPort: 2, toStarboard: 2 });
  assert.equal(sb.length, 2);
  assert.equal(d.push(sb[0]).name, 'DEMO YACHT');
  assert.equal(d.push(sb[1]).shipType, 36);

  const aton = d.push(AIS.encodeAton({ mmsi: 992351001, aidType: 13, name: 'DEMO BUOY', lat: 50.78, lon: -1.31, virtual: true })[0]);
  assert.equal(aton.kind, 'aton');
  assert.equal(aton.name, 'DEMO BUOY');
  assert.equal(aton.virtual, true);
  assert.ok(near(aton.lat, 50.78));

  const own = new AIS.Decoder().push(AIS.encodePosition(a, { talker: 'AIVDO' })[0]);
  assert.equal(own.own, true);
}

// Labels and categories.
{
  assert.equal(AIS.shipTypeName(70), 'Cargo');
  assert.equal(AIS.shipTypeName(37), 'Pleasure craft');
  assert.equal(AIS.shipTypeName(0), null);
  assert.equal(AIS.category({ mmsi: 970123456 }), 'emergency');
  assert.equal(AIS.category({ mmsi: 1, shipType: 84 }), 'tanker');
  assert.equal(AIS.category({ mmsi: 1, shipType: 52 }), 'service');
  assert.equal(AIS.category({ mmsi: 1, kind: 'aton' }), 'aton');
  assert.equal(AIS.NAV_STATUS[1], 'At anchor');
  assert.equal(AIS.specialMmsi(972000001), 'MOB device');
  assert.equal(new AIS.Decoder().push('$GPRMC,1,2,3*00'), null);
}

// An IEC 61162-450 tag block before the sentence (AIS-catcher, online feeds) is skipped.
{
  const m = new AIS.Decoder().push('\\s:n2k,c:1793581797884*36\\!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C');
  assert.equal(m.mmsi, 477553000);
}

console.log('ais.test.js: all assertions passed');
