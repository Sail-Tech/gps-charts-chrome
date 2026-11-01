/* Settings defaults and provider URLs shared by the extension (background, dashboard) and the web app. */
'use strict';

const GPS_DEFAULTS = {
  provider: 'iboating',
  zoom: 13.76,
  autoCenterProvider: true,
  updateSeconds: 5,
  connectionMode: 'websocket',
  wsUrl: 'ws://127.0.0.1:8765',
  serialBaud: 4800,
  serialPortKey: '',
  // blankTile=false: Esri answers 404 instead of its "Map data not yet available" image.
  tileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}?blankTile=false',
  tileMinZoom: 0,
  // Deepest Esri Ocean Base level with data in many areas outside North America; MapLibre enlarges it beyond that.
  tileMaxZoom: 10,
  bathymetryEnabled: true,
  bathymetryShading: true,
  seamarkInfoEnabled: true,
  aisEnabled: true,
  aisVectorMinutes: 6,
  displayLevel: 0,
  depthUnits: 'm',
  weatherEnabled: true,
  weatherModel: 'best_match',
  windBarbEnabled: true,
  windFieldEnabled: false,
  waveFieldEnabled: false,
  currentFieldEnabled: false,
  tempUnits: 'C',
  waveUnits: 'm',
  attribution: 'Esri, Garmin, GEBCO, NOAA NGDC, and other contributors · Not for navigation',
  cacheEnabled: true,
  cacheMode: 'network',
  cacheMaxMB: 500,
  cacheMaxAgeDays: 30,
  prefetchLevels: 2
};

const GPS_PROVIDER_URLS = {
  CMAP_ORIGIN: 'https://appchart.c-map.com',
  IBOATING_URL: 'https://fishing-app.gpsnauticalcharts.com/i-boating-fishing-web-app/fishing-marine-charts-navigation.html',
  GARMIN_ORIGIN: 'https://maps.garmin.com',
  // English page, like the dashboard (LOCALE in dashboard.js).
  GARMIN_URL: 'https://maps.garmin.com/en-GB/marine/',
  // Added by other programs (the OpenCPN Online Charts plugin) that open Garmin in Chrome
  // and want this extension to place Garmin's marker; Garmin keeps it in its URL.
  GARMIN_PIN_PARAM: 'gpscharts',
  isGarminPinRequest(url) {
    try {
      const parsed = new URL(url);
      return parsed.origin === this.GARMIN_ORIGIN && /^\/[^/]+\/marine\/?$|^\/marine\/?$/.test(parsed.pathname) &&
        parsed.searchParams.get(this.GARMIN_PIN_PARAM) === 'pin' && /^[0-9b-hjkmnp-z]{1,12}$/.test(parsed.searchParams.get('key') || '');
    } catch (_) {
      return false;
    }
  },
  iboatingHash: (fix, zoom) => `#${zoom}/${fix.lat.toFixed(6)}/${fix.lon.toFixed(6)}`,
  // ?depth=m|ft sets i-Boating's depth units (read by its apply_params_from_url).
  iboating(fix, zoom, units = 'm') {
    return `${this.IBOATING_URL}?depth=${units === 'ft' ? 'ft' : 'm'}${this.iboatingHash(fix, zoom)}`;
  },
  // The C-MAP "Pin location" route takes longitude first: /core/select/new_place/@<lon>,<lat>
  cmapPath: fix => `/core/select/new_place/@${fix.lon.toFixed(6)},${fix.lat.toFixed(6)}`,
  cmap(fix) {
    return this.CMAP_ORIGIN + this.cmapPath(fix);
  },
  geohash(latitude, longitude, precision = 12) {
    const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
    if (latitude === null || longitude === null || latitude === '' || longitude === '' ||
        typeof latitude === 'boolean' || typeof longitude === 'boolean') {
      throw new RangeError('No valid GPS position is available.');
    }
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new RangeError('No valid GPS position is available.');
    }
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
    let even = true, bit = 0, value = 0, result = '';
    while (result.length < precision) {
      if (even) {
        const middle = (lonMin + lonMax) / 2;
        if (lon >= middle) { value = value * 2 + 1; lonMin = middle; }
        else { value *= 2; lonMax = middle; }
      } else {
        const middle = (latMin + latMax) / 2;
        if (lat >= middle) { value = value * 2 + 1; latMin = middle; }
        else { value *= 2; latMax = middle; }
      }
      even = !even;
      if (++bit === 5) {
        result += alphabet[value];
        bit = 0;
        value = 0;
      }
    }
    return result;
  },
  // Garmin decodes the public key query parameter as a geohash and centres its map there.
  garmin(fix) {
    const key = this.geohash(fix?.lat, fix?.lon, 12);
    return `${this.GARMIN_URL}?maps=another-brand&overlay=false&key=${key}`;
  }
};
