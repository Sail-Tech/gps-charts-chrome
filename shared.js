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
  depthUnits: 'm',
  weatherEnabled: true,
  weatherModel: 'best_match',
  windBarbEnabled: true,
  windFieldEnabled: false,
  waveFieldEnabled: false,
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
  iboatingHash: (fix, zoom) => `#${zoom}/${fix.lat.toFixed(6)}/${fix.lon.toFixed(6)}`,
  // ?depth=m|ft sets i-Boating's depth units (read by its apply_params_from_url).
  iboating(fix, zoom, units = 'm') {
    return `${this.IBOATING_URL}?depth=${units === 'ft' ? 'ft' : 'm'}${this.iboatingHash(fix, zoom)}`;
  },
  // The C-MAP "Pin location" route takes longitude first: /core/select/new_place/@<lon>,<lat>
  cmapPath: fix => `/core/select/new_place/@${fix.lon.toFixed(6)},${fix.lat.toFixed(6)}`,
  cmap(fix) {
    return this.CMAP_ORIGIN + this.cmapPath(fix);
  }
};
