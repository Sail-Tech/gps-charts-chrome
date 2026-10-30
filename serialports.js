/* Serial port listing, naming and NMEA auto-detection on top of Web Serial. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SerialPorts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BAUD_RATES = [4800, 38400, 9600, 115200, 19200, 57600];
  const USB_VENDORS = {
    0x0403: 'FTDI',
    0x067b: 'Prolific PL2303',
    0x10c4: 'Silicon Labs CP210x',
    0x1a86: 'WCH CH340',
    0x0483: 'STMicroelectronics',
    0x1546: 'u-blox GNSS',
    0x091e: 'Garmin',
    0x303a: 'Espressif ESP32',
    0x2341: 'Arduino',
    0x239a: 'Adafruit',
    0x2e8a: 'Raspberry Pi',
    0x04d8: 'Microchip',
    0x0525: 'Netchip / Linux gadget',
    0x1d50: 'OpenMoko / open hardware'
  };
  const USB_PRODUCTS = {
    '0403:6001': 'FTDI FT232R',
    '0403:6015': 'FTDI FT231X',
    '1546:01a7': 'u-blox 7 GNSS',
    '1546:01a8': 'u-blox 8 GNSS',
    '1546:01a9': 'u-blox 9 GNSS'
  };

  function hex(value) {
    return `0x${value.toString(16).padStart(4, '0')}`;
  }

  function describe(info) {
    if (info && Number.isInteger(info.usbVendorId)) {
      const key = `${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}`;
      const name = USB_PRODUCTS[key] || USB_VENDORS[info.usbVendorId] || 'USB serial adapter';
      return `${name} (VID ${hex(info.usbVendorId)} · PID ${hex(info.usbProductId ?? 0)})`;
    }
    if (info && info.bluetoothServiceClassId) return 'Bluetooth serial port';
    return 'Serial port (built-in or virtual)';
  }

  /* Stable identifier for a port across page reloads: vendor/product plus position among identical adapters. */
  function keysFor(infos) {
    const seen = {};
    return infos.map(info => {
      const base = info && Number.isInteger(info.usbVendorId)
        ? `${info.usbVendorId}:${info.usbProductId ?? 0}`
        : (info && info.bluetoothServiceClassId ? `bt:${info.bluetoothServiceClassId}` : 'native');
      seen[base] = (seen[base] || 0) + 1;
      return `${base}#${seen[base]}`;
    });
  }

  async function list() {
    if (typeof navigator === 'undefined' || !('serial' in navigator)) return [];
    const ports = await navigator.serial.getPorts();
    const infos = ports.map(port => port.getInfo());
    const keys = keysFor(infos);
    return ports.map((port, index) => ({ port, key: keys[index], label: describe(infos[index]) }));
  }

  function isNmeaSentence(line, checksumIsValid) {
    const text = line.trim();
    return /^[$!][A-Z0-9]{3,6},[^*]*\*[0-9A-Fa-f]{2}$/.test(text) && checksumIsValid(text);
  }

  /* Opens the port at one baud rate and counts valid NMEA sentences for up to `ms` milliseconds. */
  async function probe(port, baudRate, checksumIsValid, ms = 1800, wanted = 2) {
    await port.open({ baudRate });
    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let valid = 0;
    let bytes = 0;
    const timer = setTimeout(() => reader.cancel().catch(() => {}), ms);
    try {
      while (valid < wanted) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        pending += decoder.decode(value, { stream: true });
        const lines = pending.split(/\r\n|\n|\r/);
        pending = lines.pop() || '';
        if (pending.length > 2048) pending = pending.slice(-256);
        for (const line of lines) if (isNmeaSentence(line, checksumIsValid)) valid++;
      }
    } finally {
      clearTimeout(timer);
      try { await reader.cancel(); } catch (_) {}
      try { reader.releaseLock(); } catch (_) {}
      try { await port.close(); } catch (_) {}
    }
    return { valid, bytes };
  }

  /* Tries each baud rate (the preferred one first) until valid NMEA is found. */
  async function detect(port, checksumIsValid, preferredBaud, onStep) {
    const rates = [...new Set([Number(preferredBaud), ...BAUD_RATES].filter(Boolean))];
    let sawData = false;
    for (const baudRate of rates) {
      if (onStep) onStep(baudRate);
      const result = await probe(port, baudRate, checksumIsValid);
      if (result.valid > 0) return { baudRate, valid: result.valid };
      if (result.bytes > 0) sawData = true;
    }
    return { baudRate: null, sawData };
  }

  return { BAUD_RATES, describe, keysFor, list, probe, detect, isNmeaSentence };
});
