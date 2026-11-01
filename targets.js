/* AIS targets: one record per MMSI built from decoded messages (position and static data arrive
   separately), with ageing, removal and CPA/TCPA against the own boat. No external dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AISTargets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REMOVE_AFTER_MS = 20 * 60 * 1000;
  const NM_PER_DEGREE = 60;

  // Reporting interval the target should keep (ITU-R M.1371), so a silent target can be judged stale.
  function expectedIntervalMs(target) {
    if (target.kind === 'aton' || target.kind === 'base') return 3 * 60 * 1000;
    const moving = (target.sog || 0) > 3;
    if (target.class === 'B') return moving ? 30000 : 3 * 60 * 1000;
    if (target.class === 'SAR') return 10000;
    const anchored = target.navStatus === 1 || target.navStatus === 5;
    return anchored && !moving ? 3 * 60 * 1000 : 10000;
  }

  // Stale after three missed reports (at least a minute): drawn faded until it is removed.
  function isStale(target, now) {
    return now - target.lastPosition > Math.max(60000, 3 * expectedIntervalMs(target));
  }

  // Range, bearing, CPA and TCPA on a local flat plane, fine over the few miles that matter.
  function relative(own, target) {
    if (!own || !Number.isFinite(own.lat) || !Number.isFinite(own.lon) ||
        !Number.isFinite(target.lat) || !Number.isFinite(target.lon)) return null;
    const k = Math.cos(own.lat * Math.PI / 180);
    const dx = (target.lon - own.lon) * NM_PER_DEGREE * k;   // east, NM
    const dy = (target.lat - own.lat) * NM_PER_DEGREE;       // north, NM
    const range = Math.hypot(dx, dy);
    const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const v = (sog, cog) => {
      const s = Number.isFinite(sog) ? sog : 0;
      const c = (Number.isFinite(cog) ? cog : 0) * Math.PI / 180;
      return [s * Math.sin(c), s * Math.cos(c)];             // knots east, north
    };
    const [ox, oy] = v(own.sog, own.cog);
    const [tx, ty] = v(target.sog, target.cog);
    const rvx = tx - ox, rvy = ty - oy;
    const speed2 = rvx * rvx + rvy * rvy;
    let tcpaH = speed2 > 1e-9 ? -(dx * rvx + dy * rvy) / speed2 : 0;
    const cpa = Math.hypot(dx + rvx * tcpaH, dy + rvy * tcpaH);
    return { rangeNm: range, bearing, cpaNm: tcpaH > 0 ? cpa : range, tcpaMin: tcpaH * 60 };
  }

  // A target closing to within cpaNm in less than tcpaMin minutes.
  function isDangerous(rel, cpaNm = 0.5, tcpaMin = 20) {
    return Boolean(rel && rel.tcpaMin > 0 && rel.tcpaMin < tcpaMin && rel.cpaNm < cpaNm);
  }

  // Position after `minutes` along COG at SOG, for the course vector.
  function project(target, minutes) {
    if (!Number.isFinite(target.sog) || !Number.isFinite(target.cog) || target.sog < 0.2) return null;
    const distance = target.sog * minutes / 60;              // NM
    const c = target.cog * Math.PI / 180;
    const lat = target.lat + distance * Math.cos(c) / NM_PER_DEGREE;
    const lon = target.lon + distance * Math.sin(c) / (NM_PER_DEGREE * Math.cos(target.lat * Math.PI / 180));
    return { lat, lon };
  }

  const POSITION_FIELDS = ['lat', 'lon', 'sog', 'cog', 'heading', 'rot', 'navStatus', 'altitude', 'accuracy', 'offPosition', 'virtual', 'aidType'];
  const STATIC_FIELDS = ['name', 'callsign', 'imo', 'shipType', 'toBow', 'toStern', 'toPort', 'toStarboard', 'draught', 'destination', 'eta'];

  class Targets {
    constructor() {
      this.byMmsi = new Map();
    }

    // Merges a decoded message. Own-ship (VDO) messages, base stations and messages without a usable
    // position are not targets. Returns the updated target or null.
    update(message, source, now = Date.now()) {
      if (!message || !message.mmsi || message.own) return null;
      if (!['position', 'static', 'aton'].includes(message.kind)) return null;
      const hasPosition = Number.isFinite(message.lat) && Number.isFinite(message.lon);
      let target = this.byMmsi.get(message.mmsi);
      if (!target) {
        if (!hasPosition && message.kind !== 'static') return null;
        target = { mmsi: message.mmsi, kind: message.kind === 'aton' ? 'aton' : 'vessel', class: message.class || null, lastPosition: 0, lastStatic: 0, source };
        this.byMmsi.set(message.mmsi, target);
      }
      if (message.class) target.class = message.class;
      if (message.kind === 'aton') target.kind = 'aton';
      if (hasPosition) {
        for (const key of POSITION_FIELDS) if (message[key] !== undefined) target[key] = message[key];
        target.lastPosition = now;
        target.source = source || target.source;
      }
      if (message.kind === 'static' || message.name || message.shipType) {
        for (const key of STATIC_FIELDS) {
          if (message[key] !== undefined && message[key] !== null && message[key] !== '') target[key] = message[key];
        }
        target.lastStatic = now;
      }
      return target;
    }

    // Targets with a position, without those silent for 20 minutes.
    list(now = Date.now()) {
      const out = [];
      for (const [mmsi, target] of this.byMmsi) {
        const last = Math.max(target.lastPosition, target.lastStatic);
        if (now - last > REMOVE_AFTER_MS) { this.byMmsi.delete(mmsi); continue; }
        if (target.lastPosition) out.push(target);
      }
      return out;
    }

    get(mmsi) {
      return this.byMmsi.get(Number(mmsi)) || null;
    }

    removeSource(source) {
      for (const [mmsi, target] of this.byMmsi) if (target.source === source) this.byMmsi.delete(mmsi);
    }

    clear() {
      this.byMmsi.clear();
    }
  }

  return { Targets, expectedIntervalMs, isStale, relative, isDangerous, project, REMOVE_AFTER_MS };
});
