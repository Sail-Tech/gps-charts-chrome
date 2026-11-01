/* AIS (ITU-R M.1371) from NMEA 0183 !AIVDM / !AIVDO sentences: joins multi-sentence messages and
   decodes position reports (1, 2, 3, 18, 19), static data (5, 24), aids to navigation (21), base
   stations (4), SAR aircraft (9) and safety broadcasts (14). The encoder builds the same sentences for
   the dashboard's AIS demo and the tests. No external dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AIS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TEXT = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !"#$%&\'()*+,-./0123456789:;<=>?';
  const FRAGMENT_TTL_MS = 10000;

  /* ---------- Bits ---------- */

  // The payload's 6-bit ASCII armouring, unpacked to one bit per array element.
  function payloadBits(payload, fillBits = 0) {
    const bits = [];
    for (const character of payload) {
      let value = character.charCodeAt(0) - 48;
      if (value > 40) value -= 8;
      if (value < 0 || value > 63) return null;
      for (let b = 5; b >= 0; b--) bits.push((value >> b) & 1);
    }
    if (fillBits > 0) bits.length = Math.max(0, bits.length - fillBits);
    return bits;
  }

  function uint(bits, start, length) {
    let value = 0;
    for (let i = start; i < start + length; i++) value = value * 2 + (bits[i] || 0);
    return value;
  }

  function int(bits, start, length) {
    const value = uint(bits, start, length);
    return bits[start] ? value - 2 ** length : value;
  }

  function text(bits, start, length) {
    let out = '';
    for (let i = start; i + 6 <= Math.min(start + length, bits.length); i += 6) out += TEXT[uint(bits, i, 6)];
    return out.replace(/@.*$/, '').trim();
  }

  /* ---------- Fields with "not available" values ---------- */

  const coordinate = (raw, limit) => {
    const value = raw / 600000;
    return Math.abs(value) > limit ? null : value;
  };
  const speed = raw => (raw === 1023 ? null : raw / 10);            // knots; 102.2 = 102.2 or more
  const course = raw => (raw >= 3600 ? null : raw / 10);            // degrees true
  const heading = raw => (raw === 511 || raw > 359 ? null : raw);   // degrees true
  const rateOfTurn = raw => {
    if (raw === -128) return null;
    if (raw === 0) return 0;
    const value = (raw / 4.733) ** 2;                               // degrees per minute
    return raw < 0 ? -value : value;
  };
  const dimension = bits => ({
    toBow: uint(bits.data, bits.at, 9),
    toStern: uint(bits.data, bits.at + 9, 9),
    toPort: uint(bits.data, bits.at + 18, 6),
    toStarboard: uint(bits.data, bits.at + 24, 6)
  });

  /* ---------- Messages ---------- */

  function decodeBits(bits) {
    if (!bits || bits.length < 38) return null;
    const type = uint(bits, 0, 6);
    const mmsi = uint(bits, 8, 30);
    const base = { type, mmsi };
    if ((type === 1 || type === 2 || type === 3) && bits.length >= 149) {
      return {
        ...base, kind: 'position', class: 'A',
        navStatus: uint(bits, 38, 4),
        rot: rateOfTurn(int(bits, 42, 8)),
        sog: speed(uint(bits, 50, 10)),
        accuracy: bits[60] === 1,
        lon: coordinate(int(bits, 61, 28), 180),
        lat: coordinate(int(bits, 89, 27), 90),
        cog: course(uint(bits, 116, 12)),
        heading: heading(uint(bits, 128, 9)),
        second: uint(bits, 137, 6)
      };
    }
    if ((type === 18 || type === 19) && bits.length >= 168) {
      const message = {
        ...base, kind: 'position', class: 'B',
        sog: speed(uint(bits, 46, 10)),
        accuracy: bits[56] === 1,
        lon: coordinate(int(bits, 57, 28), 180),
        lat: coordinate(int(bits, 85, 27), 90),
        cog: course(uint(bits, 112, 12)),
        heading: heading(uint(bits, 124, 9)),
        second: uint(bits, 133, 6)
      };
      if (type === 19 && bits.length >= 312) {
        Object.assign(message, {
          name: text(bits, 143, 120),
          shipType: uint(bits, 263, 8),
          ...dimension({ data: bits, at: 271 })
        });
      }
      return message;
    }
    if (type === 5 && bits.length >= 420) {
      const month = uint(bits, 274, 4), day = uint(bits, 278, 5), hour = uint(bits, 283, 5), minute = uint(bits, 288, 6);
      return {
        ...base, kind: 'static', class: 'A',
        imo: uint(bits, 40, 30) || null,
        callsign: text(bits, 70, 42),
        name: text(bits, 112, 120),
        shipType: uint(bits, 232, 8),
        ...dimension({ data: bits, at: 240 }),
        eta: month && day ? { month, day, hour: hour < 24 ? hour : null, minute: minute < 60 ? minute : null } : null,
        draught: uint(bits, 294, 8) / 10 || null,
        destination: text(bits, 302, 120)
      };
    }
    if (type === 24 && bits.length >= 160) {
      const part = uint(bits, 38, 2);
      if (part === 0) return { ...base, kind: 'static', class: 'B', part: 'A', name: text(bits, 40, 120) };
      if (part === 1 && bits.length >= 162) {
        return {
          ...base, kind: 'static', class: 'B', part: 'B',
          shipType: uint(bits, 40, 8),
          callsign: text(bits, 90, 42),
          ...dimension({ data: bits, at: 132 })
        };
      }
      return null;
    }
    if (type === 21 && bits.length >= 272) {
      return {
        ...base, kind: 'aton',
        aidType: uint(bits, 38, 5),
        name: (text(bits, 43, 120) + text(bits, 272, bits.length - 272)).trim(),
        accuracy: bits[163] === 1,
        lon: coordinate(int(bits, 164, 28), 180),
        lat: coordinate(int(bits, 192, 27), 90),
        ...dimension({ data: bits, at: 219 }),
        offPosition: bits[259] === 1,
        virtual: bits[269] === 1
      };
    }
    if (type === 4 && bits.length >= 168) {
      return {
        ...base, kind: 'base',
        lon: coordinate(int(bits, 79, 28), 180),
        lat: coordinate(int(bits, 107, 27), 90)
      };
    }
    if (type === 9 && bits.length >= 168) {
      const sog = uint(bits, 50, 10);
      return {
        ...base, kind: 'position', class: 'SAR',
        altitude: uint(bits, 38, 12) === 4095 ? null : uint(bits, 38, 12),
        sog: sog === 1023 ? null : sog,
        lon: coordinate(int(bits, 61, 28), 180),
        lat: coordinate(int(bits, 89, 27), 90),
        cog: course(uint(bits, 116, 12))
      };
    }
    if (type === 14 && bits.length >= 40) {
      return { ...base, kind: 'safety', text: text(bits, 40, bits.length - 40) };
    }
    return { ...base, kind: 'other' };
  }

  function checksum(body) {
    let value = 0;
    for (let i = 0; i < body.length; i++) value ^= body.charCodeAt(i);
    return value.toString(16).toUpperCase().padStart(2, '0');
  }

  // Joins the parts of multi-sentence messages (by sequence id and channel) and decodes complete ones.
  class Decoder {
    constructor() {
      this.parts = new Map();
    }

    push(sentence, now = Date.now()) {
      const text = String(sentence || '').trim();
      const star = text.indexOf('*');
      if (!/^!..VD[MO],/.test(text) || star < 0) return null;
      const fields = text.slice(1, star).split(',');
      if (fields.length < 7) return null;
      const own = fields[0].endsWith('VDO');
      const count = Number(fields[1]), number = Number(fields[2]);
      const id = fields[3], channel = fields[4], payload = fields[5], fill = Number(fields[6]) || 0;
      if (!(count >= 1 && number >= 1 && number <= count)) return null;
      let full = payload;
      if (count > 1) {
        const key = `${id}:${channel}:${count}`;
        for (const [k, v] of this.parts) if (now - v.time > FRAGMENT_TTL_MS) this.parts.delete(k);
        if (number === 1) {
          this.parts.set(key, { time: now, payloads: [payload] });
          return null;
        }
        const entry = this.parts.get(key);
        // A missing or out-of-order part drops the whole message.
        if (!entry || entry.payloads.length !== number - 1) {
          this.parts.delete(key);
          return null;
        }
        entry.payloads.push(payload);
        if (number < count) return null;
        this.parts.delete(key);
        full = entry.payloads.join('');
      }
      // The fill bits are those of the last part.
      const message = decodeBits(payloadBits(full, fill));
      if (message) message.own = own;
      return message;
    }
  }

  /* ---------- Encoder (demo and tests) ---------- */

  class BitWriter {
    constructor() { this.bits = []; }
    uint(value, length) {
      const v = Math.max(0, Math.round(value));
      for (let b = length - 1; b >= 0; b--) this.bits.push(Math.floor(v / 2 ** b) % 2);
      return this;
    }
    int(value, length) {
      const v = Math.round(value);
      return this.uint(v < 0 ? 2 ** length + v : v, length);
    }
    text(value, length) {
      const chars = String(value || '').toUpperCase().slice(0, length / 6).padEnd(length / 6, '@');
      for (const c of chars) this.uint(Math.max(0, TEXT.indexOf(c)), 6);
      return this;
    }
  }

  function armour(bits) {
    const fill = (6 - (bits.length % 6)) % 6;
    const padded = bits.concat(new Array(fill).fill(0));
    let out = '';
    for (let i = 0; i < padded.length; i += 6) {
      let value = uint(padded, i, 6) + 48;
      if (value > 87) value += 8;
      out += String.fromCharCode(value);
    }
    return { payload: out, fill };
  }

  // NMEA sentences for one message: one sentence up to 60 payload characters, otherwise several.
  function sentences(bits, { channel = 'A', sequence = 1, talker = 'AIVDM' } = {}) {
    const { payload, fill } = armour(bits);
    const chunks = [];
    for (let i = 0; i < payload.length; i += 60) chunks.push(payload.slice(i, i + 60));
    return chunks.map((chunk, i) => {
      const last = i === chunks.length - 1;
      const body = `${talker},${chunks.length},${i + 1},${chunks.length > 1 ? sequence % 10 : ''},${channel},${chunk},${last ? fill : 0}`;
      return `!${body}*${checksum(body)}`;
    });
  }

  const na = (value, missing) => (value === null || value === undefined || Number.isNaN(value) ? missing : value);

  function encodePosition(t, options) {
    const w = new BitWriter();
    const lon = Math.round(na(t.lon, 181) * 600000), lat = Math.round(na(t.lat, 91) * 600000);
    const sog = t.sog === null || t.sog === undefined ? 1023 : Math.min(1022, t.sog * 10);
    const cog = t.cog === null || t.cog === undefined ? 3600 : ((t.cog % 360) + 360) % 360 * 10;
    const hdg = t.heading === null || t.heading === undefined ? 511 : Math.round(((t.heading % 360) + 360) % 360) % 360;
    if (t.class === 'B') {
      w.uint(18, 6).uint(0, 2).uint(t.mmsi, 30).uint(0, 8).uint(sog, 10).uint(1, 1)
        .int(lon, 28).int(lat, 27).uint(cog, 12).uint(hdg, 9).uint(na(t.second, 60), 6)
        .uint(0, 2).uint(1, 1).uint(0, 1).uint(1, 1).uint(1, 1).uint(1, 1).uint(0, 1).uint(0, 1).uint(0, 20);
    } else {
      w.uint(t.type || 1, 6).uint(0, 2).uint(t.mmsi, 30).uint(na(t.navStatus, 15), 4).int(t.rot === null || t.rot === undefined ? -128 : 0, 8)
        .uint(sog, 10).uint(1, 1).int(lon, 28).int(lat, 27).uint(cog, 12).uint(hdg, 9).uint(na(t.second, 60), 6)
        .uint(0, 2).uint(0, 3).uint(0, 1).uint(0, 19);
    }
    return sentences(w.bits, options);
  }

  function encodeStatic(t, options) {
    if (t.class === 'B') {
      const a = new BitWriter().uint(24, 6).uint(0, 2).uint(t.mmsi, 30).uint(0, 2).text(t.name, 120);
      const b = new BitWriter().uint(24, 6).uint(0, 2).uint(t.mmsi, 30).uint(1, 2).uint(na(t.shipType, 0), 8)
        .text('', 42).text(t.callsign, 42)
        .uint(na(t.toBow, 0), 9).uint(na(t.toStern, 0), 9).uint(na(t.toPort, 0), 6).uint(na(t.toStarboard, 0), 6).uint(0, 6);
      return [...sentences(a.bits, options), ...sentences(b.bits, options)];
    }
    const eta = t.eta || {};
    const w = new BitWriter().uint(5, 6).uint(0, 2).uint(t.mmsi, 30).uint(0, 2).uint(na(t.imo, 0), 30)
      .text(t.callsign, 42).text(t.name, 120).uint(na(t.shipType, 0), 8)
      .uint(na(t.toBow, 0), 9).uint(na(t.toStern, 0), 9).uint(na(t.toPort, 0), 6).uint(na(t.toStarboard, 0), 6)
      .uint(1, 4).uint(na(eta.month, 0), 4).uint(na(eta.day, 0), 5).uint(na(eta.hour, 24), 5).uint(na(eta.minute, 60), 6)
      .uint(na(t.draught, 0) * 10, 8).text(t.destination, 120).uint(0, 1).uint(0, 1);
    return sentences(w.bits, options);
  }

  function encodeAton(t, options) {
    const w = new BitWriter().uint(21, 6).uint(0, 2).uint(t.mmsi, 30).uint(na(t.aidType, 0), 5).text(t.name, 120)
      .uint(1, 1).int(Math.round(t.lon * 600000), 28).int(Math.round(t.lat * 600000), 27)
      .uint(0, 9).uint(0, 9).uint(0, 6).uint(0, 6).uint(1, 4).uint(60, 6).uint(t.offPosition ? 1 : 0, 1)
      .uint(0, 8).uint(0, 1).uint(t.virtual ? 1 : 0, 1).uint(0, 1).uint(0, 1);
    return sentences(w.bits, options);
  }

  /* ---------- Labels ---------- */

  const NAV_STATUS = [
    'Under way using engine', 'At anchor', 'Not under command', 'Restricted manoeuvrability',
    'Constrained by draught', 'Moored', 'Aground', 'Engaged in fishing', 'Under way sailing',
    'Reserved (HSC)', 'Reserved (WIG)', 'Power-driven vessel towing astern', 'Power-driven vessel pushing ahead',
    'Reserved', 'AIS-SART active', null
  ];

  function shipTypeName(code) {
    const c = Number(code);
    if (!c) return null;
    const exact = {
      30: 'Fishing', 31: 'Towing', 32: 'Towing (large)', 33: 'Dredging', 34: 'Diving', 35: 'Military',
      36: 'Sailing', 37: 'Pleasure craft', 50: 'Pilot', 51: 'Search and rescue', 52: 'Tug', 53: 'Port tender',
      54: 'Anti-pollution', 55: 'Law enforcement', 58: 'Medical transport'
    };
    if (exact[c]) return exact[c];
    const decade = Math.floor(c / 10);
    return { 2: 'Wing in ground', 4: 'High-speed craft', 6: 'Passenger', 7: 'Cargo', 8: 'Tanker', 9: 'Other' }[decade] || 'Other';
  }

  // A colour group for the chart symbol.
  function category(target) {
    const m = String(target.mmsi || '');
    if (/^97[024]/.test(m)) return 'emergency';
    if (target.kind === 'aton') return 'aton';
    if (target.class === 'SAR') return 'sar';
    const c = Number(target.shipType);
    const decade = Math.floor(c / 10);
    if (c === 30) return 'fishing';
    if (c === 36 || c === 37) return 'pleasure';
    if ((c >= 31 && c <= 35) || decade === 5) return 'service';
    if (decade === 4) return 'hsc';
    if (decade === 6) return 'passenger';
    if (decade === 7) return 'cargo';
    if (decade === 8) return 'tanker';
    return 'unknown';
  }

  function specialMmsi(mmsi) {
    const m = String(mmsi || '');
    if (m.startsWith('970')) return 'AIS-SART (survivor locator)';
    if (m.startsWith('972')) return 'MOB device';
    if (m.startsWith('974')) return 'EPIRB-AIS';
    return null;
  }

  return {
    TEXT, payloadBits, decodeBits, Decoder, checksum,
    encodePosition, encodeStatic, encodeAton,
    NAV_STATUS, shipTypeName, category, specialMmsi
  };
});
