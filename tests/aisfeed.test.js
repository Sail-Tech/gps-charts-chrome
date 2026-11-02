'use strict';
const assert = require('node:assert/strict');
const F = require('../aisfeed.js');
const AIS = require('../ais.js');
const T = require('../targets.js');

// The subscription box: [minLat, minLon, maxLat, maxLon], shrunk about its centre to the anonymous area limit.
{
  assert.deepEqual(F.bbox(50.6, -1.6, 50.9, -1.0), [50.6, -1.6, 50.9, -1]);
  const big = F.bbox(40, -20, 60, 0);
  const area = (big[2] - big[0]) * (big[3] - big[1]);
  assert.ok(area <= F.MAX_AREA + 0.01 && area > F.MAX_AREA - 1);
  assert.ok(Math.abs((big[0] + big[2]) / 2 - 50) < 1e-3 && Math.abs((big[1] + big[3]) / 2 + 10) < 1e-3);
  assert.deepEqual(F.bbox(-95, -200, 95, 200).map(Math.abs).every(v => v <= 180), true);
  assert.equal(F.bbox(NaN, 0, 1, 1), null);
  assert.equal(F.bbox(50, 1, 51, 1), null);
}

// Events as Open Waters sends them: raw sentences (some with a tag block), time and credit.
const event = {
  type: 'event', time: '2026-11-02T01:08:06.429853985Z', source: 'aisstream',
  attribution: 'Open Waters AIS (https://openwaters.io/ais/). aisstream.io',
  nmea: ['\\c:1793581797884*36\\!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C'], mmsi: 477553000
};
{
  const e = F.parseEvent(JSON.stringify(event));
  assert.equal(e.time, Date.parse('2026-11-02T01:08:06.429Z'));
  assert.equal(e.sentences.length, 1);
  assert.deepEqual(F.attributionParts(e.attribution), ['Open Waters AIS (https://openwaters.io/ais/)', 'aisstream.io']);
  assert.equal(F.parseEvent('{"type":"welcome"}'), null);
  assert.equal(F.parseEvent('not json'), null);
  const m = new AIS.Decoder().push(e.sentences[0]);
  assert.equal(m.mmsi, 477553000);
}

// An older position (relayed late) does not move a target back.
{
  const t = new T.Targets();
  t.update({ kind: 'position', mmsi: 7, lat: 50, lon: -1 }, 'feed', 2000);
  t.update({ kind: 'position', mmsi: 7, lat: 49, lon: -2 }, 'feed', 1000);
  assert.equal(t.get(7).lat, 50);
  assert.equal(t.get(7).lastPosition, 2000);
  t.update({ kind: 'position', mmsi: 7, lat: 51, lon: 0 }, 'feed', 3000);
  assert.equal(t.get(7).lat, 51);
}

// The feed subscribes on open, replaces the area on change, and retries after a drop.
{
  const sockets = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.sent = []; this.readyState = 0; sockets.push(this); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
    open() { this.readyState = 1; this.onopen(); }
  }
  const events = [], statuses = [];
  const feed = new F.Feed({ WebSocketImpl: FakeSocket, onEvent: e => events.push(e), onStatus: s => statuses.push(s) });
  feed.start([50, -2, 51, -1]);
  const s = sockets[0];
  assert.equal(s.url, F.STREAM_URL);
  s.open();
  assert.deepEqual(s.sent[0], { type: 'subscribe', bbox: [[50, -2, 51, -1]], snapshot: true });
  s.onmessage({ data: '{"type":"welcome","role":"anonymous"}' });
  s.onmessage({ data: JSON.stringify(event) });
  assert.equal(events.length, 1);
  feed.subscribe([50, -2, 51, -1]);
  assert.equal(s.sent.length, 1);
  feed.subscribe([59, 10, 60, 11]);
  assert.deepEqual(s.sent[1].bbox, [[59, 10, 60, 11]]);
  s.onclose();
  assert.ok(feed.retryTimer);
  feed.stop();
  assert.equal(feed.retryTimer, null);
  assert.deepEqual(statuses, ['connecting', 'live', 'closed']);
}

console.log('aisfeed.test.js: all assertions passed');
