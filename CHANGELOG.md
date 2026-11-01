# Changelog

## 0.12.1

- **No more "CONTEXT_LOST_WEBGL" error:** changing the base chart or turning the offline cache on or off rebuilt the dashboard's chart, and Chrome listed the old chart's release of its graphics context as an extension error (*WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost*). It was harmless, but the chart is now kept: the base chart is swapped in place, and every source always goes through the cache layer, which simply skips storing when the cache is off. The chart also keeps its position, boat and track.

## 0.12.0

Brings the depth chart in line with the current [Open Waters Seascape viewer](https://openwaters.io/charts/seascape/viewer/).

- **Depth colours, Topo:** a new **Depth colours** choice under **Dashboard chart**. **Chart** keeps the light blues; **Topo** gives each depth band its own colour, from red in the shallows through orange, yellow and green to deep blue, with a finer relief shading, so banks and channels stand out at a glance. Drying areas are pink and land is left clear for the base chart. The choice is remembered.
- **2 m contour near the coast:** from zoom 11 the emphasised contour is 2 m (6 ft) instead of 10 m (30 ft), as on Open Waters' chart view. Zoomed out, 10 m (30 ft) stays emphasised.
- **Where the depths come from:** the sidebar names the survey under the boat, or under the chart centre when the boat is out of view, with the zoom it is detailed to, and the other surveys that cover the spot (for example *CCO Multibeam Bathymetry (England & Wales nearshore, 0.25–4 m), detailed to zoom 15*). It reads Open Waters' new coverage layer, which replaces the fixed "usually EMODnet (~115 m)" note.

## 0.11.0

- **Brightness and night mode:** a button under the chart's zoom buttons dims the dashboard one step per press, Day → Dusk 75% → Dusk 55% → Dusk 40% → Night (red), and then back to Day. Night turns the light chart and panels dark and every colour red to keep night vision; the dark top bar and forecast timeline are only reddened, and the read-outs stay dark. The level is remembered.

## 0.10.0

- **AIS targets from the boat's own receiver:** `!AIVDM` sentences arriving over the WebSocket, the bridge or the serial port (until now ignored) are decoded: Class A and B positions, static and voyage data, aids to navigation, SAR aircraft and safety messages, with multi-sentence messages joined. No online AIS service is used.
- **On the chart:** vessels coloured by type and turned to their heading, Class B smaller, aids to navigation as diamonds, AIS-SART/MOB/EPIRB as a crossed red circle; course vectors (6 minutes by default), names from zoom 12; silent targets fade and are removed after 20 minutes.
- **CPA/TCPA:** vessels closing to under 0.5 NM within 20 minutes get a red ring and lead the new **AIS targets** list in the sidebar. Hover over or tap a target for its details, range, bearing and CPA/TCPA.
- **AIS demo:** an option sends nine simulated *DEMO* vessels as real AIS sentences through the same decoder, for testing without a receiver. It is never saved.

## 0.9.0

- **Read-outs on hover or tap:** every chart symbol now explains itself. A wind barb gives the wind speed, direction and gusts; a wave arrow the height, direction and period; a current arrow the speed and the direction it flows to. It works with a mouse (hover) and a finger (tap; the read-out stays until you tap elsewhere), and replaces the old "?" cursor and the single combined tooltip per field point.
- **Light and mark details:** from zoom 11, hovering over or tapping a light, buoy, beacon, wreck, rock, harbour or other mark shows its name, kind, colour and shape, its light(s) in chart notation (for example *Fl(2) G 5s 8m 3M*, with sector bearings), topmark, fog signal and List of Lights number. The data is OpenStreetMap's seamark tagging (the same data the OpenSeaMap layer draws), read from the Overpass API one map tile at a time and kept for 30 days, so it also works offline. Option **Show light and mark details on hover or tap** under **Dashboard chart**.

## 0.8.0

- **Ocean current:** a red current arrow at the boat and, optionally, across the chart, as in the OpenCPN Online Charts plugin. It points the way the water flows and grows with the speed up to 3 kn. The Conditions panel shows the current at the boat (for example *2.2 kn to ESE*), and the forecast timeline animates it over the next 72 hours. Data from Open-Meteo's marine model (`ocean_current_velocity`, `ocean_current_direction`), which includes tides.
- **No waves or currents on land:** the marine model answers land points with its nearest sea cell, so field points whose terrain is above 2 m no longer get wave or current arrows.
- The weather caches start afresh, because readings saved by earlier versions have no current.

## 0.7.1

- **Garmin marker for the OpenCPN plugin:** a Garmin Marine tab opened in Chrome by another program with `gpscharts=pin` in its address (the OpenCPN Online Charts plugin's **Open provider → Open Garmin Marine**) now gets the same single marker attempt and 500 m check as a tab opened from the dashboard. Each tab is tried once; only Garmin Marine pages with a geohash `key` qualify.

## 0.7.0

- **Garmin Marine provider:** opens Garmin's public Marine chart centred on the current or last known GPS position, encoded as a standard 12-character geohash, on Garmin's English page. Garmin is never opened at the demonstration fallback position.
- **Garmin marker:** after the page loads, the extension clicks the map centre once and checks both that Garmin's own `pin-location` marker appears and that Garmin reports it within 500 m of the vessel. Otherwise the dashboard asks you to click the map centre. Follow, provider zoom and update interval are disabled for Garmin, because loading a new position would remove its marker.
- **Privacy:** no coordinates, geohashes or complete Garmin URLs go into logs or status messages; no Garmin credentials, cookies, tokens or application state are read.
- **Dashboard, popup and web app:** Garmin in the provider list and popup, with provider-specific help and status messages; the web app opens the centred page but cannot place the marker.
- **Web app offline:** the service worker now also keeps `weather.js`, and its cache version follows the release.
- **Tests:** geohash reference values, decode round trips, coordinate limits, invalid values and the Garmin URL.
- **Wind barbs:** drawn to the standard convention. The staff points to where the wind comes from, with feathers at the far end on its right, slanting outwards: pennant 50 kn, full barb 10 kn, half barb 5 kn, and a double circle for calm. Feathers no longer get cut off at the edge of the symbol, and the wind-field barbs are slightly larger.

## 0.6.1

- **Offline weather:** the conditions, the wind/wave field and the timeline now stay from cache when the network drops (the field is kept too), marked "offline". They refresh when the connection returns and every few hours otherwise. Fixes the field being cleared and its cache overwritten while offline.

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
