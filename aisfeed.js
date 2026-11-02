/* Online AIS from Open Waters (https://openwaters.io/ais/) for the dashboard's AIS demo: a WebSocket
   subscribed to the chart's view, reconnecting with back-off. Anonymous access needs no key; it allows
   areas up to 100 square degrees and about 20 events a second. Each event carries the raw !AIVDM
   sentences, which go through the same decoder as the boat's receiver. No external dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AISFeed = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STREAM_URL = 'wss://ais.openwaters.io/v1/stream';
  const MAX_AREA = 99;              // square degrees; the anonymous limit is 100
  const RETRY_MS = [2000, 5000, 15000, 30000, 60000];

  // The subscription box [minLat, minLon, maxLat, maxLon] for a view, shrunk about its centre to the
  // allowed area. Null when the bounds are unusable.
  function bbox(south, west, north, east) {
    if (![south, west, north, east].every(Number.isFinite)) return null;
    let lat0 = Math.max(-90, Math.min(south, north)), lat1 = Math.min(90, Math.max(south, north));
    let lon0 = Math.max(-180, west), lon1 = Math.min(180, east);
    if (lon1 <= lon0 || lat1 <= lat0) return null;
    const area = (lat1 - lat0) * (lon1 - lon0);
    if (area > MAX_AREA) {
      const f = Math.sqrt(MAX_AREA / area);
      const cLat = (lat0 + lat1) / 2, cLon = (lon0 + lon1) / 2;
      const hLat = (lat1 - lat0) * f / 2, hLon = (lon1 - lon0) * f / 2;
      [lat0, lat1, lon0, lon1] = [cLat - hLat, cLat + hLat, cLon - hLon, cLon + hLon];
    }
    const r = value => Math.round(value * 1e4) / 1e4;
    return [r(lat0), r(lon0), r(lat1), r(lon1)];
  }

  // The parts of an event the dashboard uses: its sentences, when it was received and whom to credit.
  function parseEvent(data) {
    let event;
    try { event = typeof data === 'string' ? JSON.parse(data) : data; } catch (error) { return null; }
    if (!event || event.type !== 'event' || !Array.isArray(event.nmea)) return null;
    const time = Date.parse(event.time);
    return {
      mmsi: event.mmsi,
      sentences: event.nmea.filter(s => typeof s === 'string'),
      time: Number.isFinite(time) ? time : null,
      source: String(event.source || ''),
      attribution: String(event.attribution || '')
    };
  }

  // "Open Waters AIS (…). AISHub (…)" → ["Open Waters AIS (…)", "AISHub (…)"], for a de-duplicated credit line.
  function attributionParts(text) {
    return String(text || '').split(/(?<=\)|[a-z]{2})\.\s+/).map(s => s.trim().replace(/\.$/, '')).filter(Boolean);
  }

  class Feed {
    constructor({ onEvent, onStatus, WebSocketImpl, url = STREAM_URL } = {}) {
      this.onEvent = onEvent || function () {};
      this.onStatus = onStatus || function () {};
      this.WebSocketImpl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
      this.url = url;
      this.socket = null;
      this.box = null;
      this.welcomed = false;
      this.attempt = 0;
      this.retryTimer = null;
      this.stopped = true;
    }

    start(box) {
      this.stopped = false;
      this.box = box || this.box;
      this.connect();
    }

    // A new subscription replaces the previous one; the snapshot fills the area at once with the last
    // known reports, some of them old, before live traffic.
    subscribe(box) {
      if (!box) return;
      const same = this.box && box.every((v, i) => v === this.box[i]);
      this.box = box;
      if (!same && this.socket && this.socket.readyState === 1) this.send();
    }

    send() {
      this.socket.send(JSON.stringify({ type: 'subscribe', bbox: [this.box], snapshot: true }));
    }

    connect() {
      if (this.stopped || !this.WebSocketImpl) return;
      this.onStatus('connecting');
      const socket = new this.WebSocketImpl(this.url);
      this.socket = socket;
      socket.onopen = () => { if (this.box) this.send(); };
      socket.onmessage = ({ data }) => {
        if (socket !== this.socket) return;
        const event = parseEvent(data);
        if (event) { this.onEvent(event); return; }
        let message = null;
        try { message = JSON.parse(data); } catch (error) { return; }
        if (message.type === 'welcome') {
          this.welcomed = true;
          this.attempt = 0;
          this.onStatus('live', message);
        } else if (message.type === 'error') {
          this.onStatus('error', message);
        }
      };
      socket.onclose = () => {
        if (socket !== this.socket) return;
        this.socket = null;
        if (this.stopped) return;
        const delay = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)];
        this.attempt += 1;
        this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(); }, delay);
        // Last, so a listener may stop the feed (and its retry) from here.
        this.onStatus('closed', { delay, welcomed: this.welcomed });
      };
    }

    stop() {
      this.stopped = true;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      const socket = this.socket;
      this.socket = null;
      if (socket) try { socket.close(); } catch (error) { /* already closed */ }
    }
  }

  return { STREAM_URL, MAX_AREA, bbox, parseEvent, attributionParts, Feed };
});
