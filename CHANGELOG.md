# Changelog

## 0.6.0

- **Forecast timeline:** a slider (with play) at the bottom of the chart scrubs the next 72 hours, so the wind, waves and conditions animate across the map.
- **Weather cache:** each reading is kept for an hour as fresh and up to 72 hours as an offline fallback, labelled with its age so a stale forecast is never shown as current.

## 0.5.0

- **Weather forecast (Open-Meteo, no API key):** wind, gusts, air temperature, pressure and wave height at the boat; a maritime wind barb at the vessel and an optional wind field and wave arrows across the chart; a choice of forecast model (best match, ECMWF IFS, GFS, ICON, Météo-France, UK Met Office); and configurable air-temperature (°C/°F) and wave-height (m/ft) units.

## 0.4.0

### Web app for phones and tablets (PWA)
- **Same dashboard:** the dashboard also runs as an installable web app for iPhone, iPad and Android, built from the same code as the extension and published at https://sail-tech.github.io/gps-charts-chrome/.
- **Platform layer:** a new `platform.js` uses `chrome.*` in the extension and `localStorage` in the web app.
- **Shared settings:** defaults and provider URLs moved to `shared.js`, used by the background worker, the dashboard and the web app.
- **Works offline:** a service worker (`sw.js`) keeps the app's own files so it opens without internet; chart tiles keep using the offline cache.
- **Installing:** web manifest, icons (180, 192, 512 and maskable 512, from `icons/icon.svg`), iPhone home-screen support and safe areas for the notch.
- **Phone layout:** the menus become a drawer over the chart, closed at start and when the chart is touched.
- **Web-only behaviour:** provider pages open at the boat's position in a new tab. WebSocket errors explain the `wss://` requirement on HTTPS. Connection modes the browser cannot offer are hidden.

### Extension and web app
- **Device GPS:** a new GPS source, the device's own location (Geolocation API), with speed converted to knots and the course ignored while stationary.
- **Screen kept on:** while a GPS source is connected (Screen Wake Lock).
- **Remembered choices:** the connection mode is now saved.
- **Depth units:** changing them reloads an open i-Boating tab only when they actually change.

## 0.3.0

### Providers
- **C-MAP:** the boat is shown through C-MAP's *Pin location* route (`/core/select/new_place/@<lon>,<lat>`). The pin moves with the GPS without reloading the page. C-MAP resets its own zoom on each update.
- **i-Boating:** the boat is shown with i-Boating's own marker and heading line, through the bridge its mobile apps use. The marker moves without reloading the page and keeps your zoom. With auto-centre off, the marker still moves but the chart stays where you left it.
- **i-Boating depth units:** i-Boating opens with the dashboard's depth units (`?depth=m` / `?depth=ft`).

### Dashboard chart
- **Base chart selector:** Esri World Ocean Base (new default), OpenStreetMap, or a custom XYZ source.
- **Depth units:** metres or feet, using Open Waters' native feet contours and soundings.
- **Defaults:** depth contours, depth colours and *Follow the boat* are on by default. Depth contours and colours are turned on once for earlier installations.
- **Zoom:** the dashboard zoom is no longer limited by the base chart's maximum zoom.
- **Collapsible menus:** a ☰ button hides or shows the side panel, and each section heading folds its section. Both are remembered.

### Offline cache
- **What is stored:** tiles, TileJSON and label fonts are stored in IndexedDB.
- **Modes:** *Network first*, *Cache first* or *Offline only*.
- **Limits:** maximum size, refresh age and an internet status indicator.
- **Save visible area for offline use:** downloads up to 5000 tiles, with extra zoom levels.
- **Failures fall back to the cache:** no network, timeout, HTTP errors such as a router's 403, or a captive-portal HTML page. Such pages are never stored as tiles.
- **OpenStreetMap:** never stored or bulk-saved, because its tile policy does not allow offline use. It uses the browser's own HTTP cache, also when offline. Its "Access blocked" images are recognised and not drawn.
- **Esri:** cached as you view it, but not bulk-saved, because the service does not allow tile export.

### Serial port
- **Port list:** authorised ports with USB adapter names. The selection is remembered, and the list refreshes when adapters are plugged in or removed.
- **Add port…:** opens Chrome's port picker.
- **Scan ports:** tries 4800–115200 baud on each port and selects the port and speed that send valid NMEA.

### Other
- **English:** the interface, messages, README and Python bridge are now in English.
- **New permissions:** `scripting` (used only in the provider tab the extension opens) and `unlimitedStorage` (keeps the offline cache from being evicted).
- **Tests:** added tests for the tile cache and the serial port helpers.

## 0.2.1

- **Bathymetry:** open bathymetry (Open Waters) with depth contours, soundings and optional shading.
- **Centre on the boat:** new button that returns the chart to the boat and turns following back on.
