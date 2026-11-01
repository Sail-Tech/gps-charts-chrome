/* Service worker of the web app (PWA). It keeps the app's own files so the dashboard opens without
   internet. Chart tiles are not handled here: tilecache.js stores them in IndexedDB. */
'use strict';

const VERSION = 'gps-charts-0.11.0';
const APP_FILES = [
  './',
  './dashboard.html',
  './dashboard.css',
  './dashboard.js',
  './shared.js',
  './platform.js',
  './tilecache.js',
  './bathymetry.js',
  './nmea.js',
  './weather.js',
  './seamarks.js',
  './ais.js',
  './targets.js',
  './serialports.js',
  './app.webmanifest',
  './vendor/maplibre-gl.js',
  './vendor/maplibre-gl.css',
  './vendor/maplibre-gl-csp-worker.js',
  './icons/icon32.png',
  './icons/icon180.png',
  './icons/icon192.png',
  './icons/icon512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// App files: answer from the cache at once and refresh it in the background (stale-while-revalidate),
// so the app starts offline and picks up a new version on the next start.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => cached || Response.error());
    return cached || network;
  }));
});
