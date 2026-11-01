# GPS Charts for Chrome

Chrome extension (Manifest V3) that takes your boat's GPS position (NMEA 0183, JSON or Signal K over a serial port, WebSocket, TCP or UDP) and shows it on its own chart dashboard, on [i-Boating](https://fishing-app.gpsnauticalcharts.com/i-boating-fishing-web-app/fishing-marine-charts-navigation.html), on [C-MAP Chart Explorer](https://appchart.c-map.com/core/map) or on [Garmin Marine](https://maps.garmin.com/en-GB/marine/).

The same dashboard also runs as a **web app for iPhone and Android** at **<https://sail-tech.github.io/gps-charts-chrome/>**, using the phone's own GPS (see [Web app for phones and tablets](#web-app-for-phones-and-tablets)).

> ⚠️ Experimental. Not for navigation. Do not use as a substitute for official charts, certified equipment or a proper lookout.

## Summary

- **Dashboard chart** with a boat marker oriented to its course, auto-follow and a track. Base chart: Esri World Ocean Base (default), OpenStreetMap or any XYZ source. On top: OpenSeaMap seamarks plus Open Waters depth contours, soundings and depth colours, in **metres or feet**. Hover over or tap a light, buoy, beacon or other mark for its details, and a wind, wave or current symbol for its values.
- **Offline cache**: chart tiles you view are stored and shown again when the internet connection drops. You can also save an area before leaving harbour.
- **Serial ports**: a list of authorised ports with USB adapter names, and **Scan ports**, which finds the port and baud rate that send NMEA.
- **i-Boating**: the boat appears as i-Boating's own marker with a heading line and moves without reloading the page, keeping your zoom.
- **C-MAP**: the boat appears as a *Pinned location* that moves with the GPS without reloading the page.
- **Garmin Marine**: opens centred on a 12-character geohash of the GPS position. The extension tries once to place Garmin's native marker; if it does not appear, click the map centre.
- **Collapsible menus** so the chart can use the whole window.
- **Web app (PWA)** for iPhone, iPad and Android: installable from the browser, works offline, uses the device's GPS.

## Quick installation

1. Download this repository: **Code → Download ZIP** on GitHub, or `git clone https://github.com/Sail-Tech/gps-charts-chrome.git`.
2. Unzip it into a permanent folder. Chrome loads the extension from that folder, so do not move or delete it afterwards.
3. In Chrome (version 116 or later), open `chrome://extensions`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and choose the folder that contains `manifest.json`.
6. Click the **GPS Charts** icon in the toolbar, then **Open GPS dashboard and chart**.
7. Click **Test with a simulated position** to check the chart, then connect your GPS under **GPS input** (see [Serial port](#serial-port-nmea-0183) or [Direct WebSocket input](#direct-websocket-input)).

To update later, replace the folder's files (or `git pull`), then click the reload button on the GPS Charts card in `chrome://extensions`. See [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## Features

- NMEA 0183: RMC, GGA, GLL, VTG, HDT and HDG.
- Plain JSON and Signal K messages.
- Direct WebSocket, serial port through Web Serial, and TCP/UDP through the included bridge.
- NMEA 2000/N2K through a gateway that converts the data to NMEA 0183, JSON or Signal K.
- Serial port list with USB adapter names, remembered selection and an automatic **Scan ports** that finds the port and baud rate sending NMEA.
- Course-oriented boat marker, auto-follow, **Centre on the boat** button and a track of the last 1000 positions.
- **Base chart** selector: Esri World Ocean Base (default), OpenStreetMap or any custom XYZ raster source, with OpenSeaMap seamarks on top.
- Open bathymetry with depth contours, labels, soundings and depth colours from Open Waters Seascape/EMODnet/GEBCO, in **metres or feet**.
- **Collapsible menus**: the ☰ button hides or shows the whole side panel, and each section heading folds its section. Both are remembered.
- **Offline cache** for every chart tile viewed (base chart, seamarks, bathymetry and label fonts), with size limit, refresh age, three modes and **Save visible area for offline use**.
- i-Boating opened at the boat position, with its own boat marker and heading line moved as the GPS updates, keeping your zoom.
- C-MAP opened at the boat position as a *Pinned location*, with the pin moved as the GPS updates.
- Garmin Marine opened at the boat position through a 12-character geohash, with a single native-marker attempt and a manual-click fallback.

## Web app for phones and tablets

Phone browsers do not run Chrome extensions: on iPhone every browser is Safari's engine, and Chrome for Android has no extensions. The dashboard therefore also runs as a stand-alone web app (PWA) from the same code.

### Install it

**iPhone / iPad (Safari, or Chrome on iOS 16.4+):** open <https://sail-tech.github.io/gps-charts-chrome/>, tap **Share** → **Add to Home Screen**, then start **GPS Charts** from the home screen.

**Android (Chrome):** open <https://sail-tech.github.io/gps-charts-chrome/>, then tap **Install app** in the menu (⋮) or in the banner.

Starting it from the home screen opens it full screen, and the browser keeps its offline data. Safari may clear the data of websites that are not used for a while.

### Use it

1. Tap ☰ to open the menus. On a phone they cover the chart; touching the chart closes them.
2. In **GPS input**, **Device GPS (this phone, tablet or laptop)** is selected. Tap **Connect** and allow location access.
3. The boat, speed and course come from the phone's GPS. The screen stays on while connected (Screen Wake Lock), and the last position is kept.
4. Before leaving harbour, open the areas you need (or use **Save visible area for offline use**), so the chart is available without internet.

### What differs from the extension

| | Extension (computer) | Web app (phone/tablet) |
|---|---|---|
| GPS sources | WebSocket, serial port, device location | Device GPS; WebSocket only to secure `wss://` addresses; serial port only on Android (Bluetooth) |
| Chart, bathymetry, metres/feet, offline cache | Yes | Yes |
| i-Boating and C-MAP | Opened and followed (marker / pin moves with the GPS) | Opened at the boat's position in a new tab; not followed |
| Garmin Marine | Opened at the boat's position; one native-marker attempt, then manual-click fallback | Opened at the boat's position; click the map centre if no marker appears |
| Works without internet | Yes, from the cache | Yes: the app itself is kept by a service worker, the chart by the cache |

Notes:

- **WebSocket on the web app:** the web app is served over HTTPS, and browsers then block unencrypted `ws://` connections to other devices. To use a Signal K server or the TCP/UDP bridge, it must offer `wss://` with a certificate the phone trusts. Otherwise use the Device GPS.
- **Serial port on the web app:** Chrome for Android can open serial ports over **Bluetooth** (a paired NMEA Bluetooth GPS or gateway). Wired USB-OTG serial and the iPhone are not supported by the browsers.
- **When the screen is off:** iOS and Android stop location updates while the phone is locked or the app is in the background.

### Host it yourself

The web app is the repository itself served as static files: `dashboard.html` is the app, `app.webmanifest` its manifest, `sw.js` its service worker, and `index.html` opens the dashboard. Any HTTPS static host works. GitHub Pages serves it from the `main` branch root. Location access and the service worker need HTTPS, or `localhost` for testing:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/dashboard.html`.

## Requirements

- Google Chrome or Chromium 116 or later.
- For TCP or UDP: Python 3 and the dependency in `bridge/requirements.txt`.
- For a serial port: an adapter supported by the operating system and by Chrome's Web Serial.
- For N2K: an NMEA 2000 gateway configured by the user. Chrome does not read the CAN bus or binary N2K frames directly.

## Installation

1. Unzip into a permanent folder. Do not delete or move that folder after installing.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Choose the folder that contains `manifest.json`.
6. Click the **GPS Charts** icon and then **Open GPS dashboard and chart**.

Keep the dashboard tab open while using the WebSocket or the serial port. The popup on its own does not keep those connections alive.

### Updating from an earlier version

Replace the files in the extension folder with the new ones, open `chrome://extensions` and click the reload button on the GPS Charts card. Close and reopen the dashboard. Saved settings are kept, and new options get their default values. Version 0.3.0 adds the `scripting` permission, used only to move the boat inside the i-Boating or C-MAP tab, and `unlimitedStorage`, so the browser does not evict the offline cache.

### Quick test without equipment

On the dashboard, click **Test with a simulated position**. A position in the Solent, off Cowes (UK), should appear: `50.775000, -1.300000`, at 5.2 knots on a course of 45°.

After dragging or zooming the chart, use **Centre on the boat** to return to the last GPS position. This also turns **Follow the boat on the dashboard** back on.

## Direct WebSocket input

1. In **Connection mode**, select **WebSocket / TCP-UDP bridge**.
2. Enter the address, for example `ws://127.0.0.1:8765`.
3. Click **Connect**.

The source must send NMEA 0183 text, plain JSON or Signal K. Plain JSON example:

```json
{
  "latitude": 50.775,
  "longitude": -1.3,
  "sog": 5.2,
  "cog": 45
}
```

In this format `sog` is in knots and `cog` in degrees. Signal K speed in m/s and course in radians are converted automatically.

## UDP input

Install the dependency once:

```bash
pip install -r bridge/requirements.txt
```

Run the bridge:

```bash
python3 bridge/gps_bridge.py udp --host 0.0.0.0 --port 10110
```

On the dashboard, connect to `ws://127.0.0.1:8765`. The GPS equipment must send its datagrams to this computer's IP address, UDP port 10110.

If the equipment runs on the same computer, you can use `--host 127.0.0.1`.

## TCP input

### The computer connects to a GPS TCP server

```bash
python3 bridge/gps_bridge.py tcp --host 192.168.1.10 --port 10110
```

Replace `192.168.1.10` with the address of the device or gateway.

### The device connects to the computer

```bash
python3 bridge/gps_bridge.py tcp-server --host 0.0.0.0 --port 10110
```

In both modes the dashboard connects to `ws://127.0.0.1:8765`.

The WebSocket port and interface can be changed, for example:

```bash
python3 bridge/gps_bridge.py udp --host 0.0.0.0 --port 10110 --ws-host 127.0.0.1 --ws-port 9000
```

In that case, use `ws://127.0.0.1:9000` on the dashboard.

## Serial port (NMEA 0183)

1. Plug in the USB/serial adapter or the gateway's serial output.
2. Select **Serial port / N2K gateway**.
3. Click **Add port…** and pick the adapter in Chrome's dialog. That dialog lists every serial port on the system. For security, Chrome only gives a page the ports you authorise there, so each adapter has to be added once.
4. Pick the port from **Serial port**. Adapters are named by their USB vendor (FTDI, Prolific, CP210x, CH340, u-blox, Garmin and others).
5. Choose the baud rate set on the equipment (NMEA 0183 is often 4800, AIS and fast GPS often 38400), or click **Scan ports**.
6. Click **Connect**. Click **Disconnect** before unplugging the adapter.

**Scan ports** opens each authorised port, listens at 4800, 38400, 9600, 115200, 19200 and 57600 baud, and selects the first port and baud rate that send NMEA sentences with a valid checksum. If no port has been authorised yet, it opens Chrome's picker first. A port that is open in another program is reported as busy. The result for every port appears under the baud rate.

The selected port is remembered between sessions and the list refreshes when adapters are plugged in or removed. Web Serial does not expose system device names such as `/dev/tty.usbserial-…` or `COM3`, so ports are identified by vendor and product ID.

## N2K / NMEA 2000 gateway

Set the gateway to output one of the accepted formats and route it through WebSocket, TCP, UDP or a serial port. RMC or GGA/GLL are useful for position and motion, plus VTG and HDT/HDG.

The bridge does not decode PGNs or binary N2K frames; the gateway must do that conversion.

## Charts and providers

### Dashboard

**Base chart** offers:

| Option | Source | Offline |
|---|---|---|
| Esri World Ocean Base (default) | `server.arcgisonline.com` Ocean basemap | Cached as you view it in the extension's offline cache. Not bulk-saved. |
| OpenStreetMap | `tile.openstreetmap.org` | Only the browser's own HTTP cache (see below). |
| Custom XYZ source… | Any raster template you enter | Cached and bulk-saved, unless the host is one of the above. |

Choosing an option applies it immediately. **Custom XYZ source…** shows the template, zoom and attribution fields and the **Apply chart source** button.

The default uses:

- `https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}?blankTile=false` (Esri World Ocean Base; note `{y}` before `{x}`) as the base chart, a marine-style map with coastline, depth tints and seabed names. **Max zoom** is 10: in many areas outside North America (the European Atlantic coast that was tested, for example) Esri has no data above level 10 and would otherwise show a grey "Map data not yet available" tile (`blankTile=false` makes it answer 404 instead). Beyond zoom 10 the chart is an enlarged overview, so **Show depth colours and shading** is on by default to draw the coastline and depth areas at harbour zoom. Where Esri has more detail (for example the US coast, up to level 16), raise **Max zoom**;
- `https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png` as the seamark layer;
- Open Waters Seascape for the open bathymetry layers.

With **Custom XYZ source…** you can enter any reachable XYZ raster source in **Raster XYZ template**, set the minimum and maximum zoom and the attribution. The template must contain `{z}`, `{x}` and `{y}`.

The dashboard zoom is not limited by the base chart's **Max zoom**: beyond it, the deepest tiles are enlarged.

### Menus

The ☰ button at the top left hides the side panel so the chart uses the whole window, and shows it again. Clicking a section heading (Position, GPS input, Provider page, Dashboard chart, Offline cache) folds or unfolds that section; headings can also be toggled with Enter or Space. Both choices are kept for the next time the dashboard opens.

### Open bathymetry

**Show depth contours and soundings** is on by default and shows depth contours, their values and point soundings. **Show depth colours and shading** adds coloured depth areas, land and seabed relief. It is on by default because it draws the coastline where the base chart has little detail; it uses more data and can be turned off on its own. **Follow the boat on the dashboard** is also on whenever the dashboard opens; dragging the chart turns it off until **Centre on the boat** is used.

Version 0.3.0 turns depth contours and depth colours on once for earlier installations too; after that, your choice is kept.

**Depth units** switches between **metres** and **feet**. Open Waters publishes separate contour sets for each system, so feet shows the real feet contours (for example 6, 18, 30 and 60 ft, with 30 ft emphasised), not converted metre lines. Soundings show whole feet, or metres with the decimal as a subscript. The same setting opens i-Boating with `?depth=ft` or `?depth=m`, and an open i-Boating tab is reloaded when it changes. Depth colours keep their metre bands (0–2, 2–5, 5–10, 10–20, 20–50 m and deeper). C-MAP's units are set in C-MAP itself.

The layers use these Open Waters resources:

- `https://tiles.openwaters.io/seascape/vector.json` for contours, areas and soundings;
- `https://tiles.openwaters.io/seascape/raster.json` for the digital depth model;
- `https://tiles.openwaters.io/fonts/{fontstack}/{range}.pbf` for the labels.

On the European coast tested, the coverage is EMODnet Bathymetry 2024 DTM, with a native resolution of about 115 metres. Lines stay visible at high zoom, but zooming in does not add measurements. This is not equivalent to C-MAP High Resolution Bathymetry, Genesis or i-Boating Sonar Contours.

Open Waters data is published under CC BY 4.0, with the attribution and terms of the original sources. The layer depends on an external service with no availability guarantee; if it fails, the base chart and the GPS keep working.

The C-MAP raster endpoints tested returned HTTP 403 when called by the extension. The C-MAP and i-Boating vector PBFs need authorisation, and i-Boating raster URLs are signed. The extension does not bypass authentication, tokens or access controls. To use a commercial source on the dashboard, set a raster endpoint your licence allows and that Chrome can reach.

### Offline cache

The **Offline cache** section of the dashboard stores every tile the chart loads in the browser (IndexedDB): base chart, seamarks, bathymetry tiles, TileJSON and label fonts. When the internet connection drops, the dashboard keeps showing every area already viewed, and the header shows **Internet offline · using cache**.

| Setting | Effect |
|---|---|
| Cache chart tiles for offline use | Turns the cache on or off. Turning it off keeps the stored tiles. |
| Mode: *Network first, cache when offline* | Default. Always tries the network, with an 8-second timeout, and falls back to the cache on any failure: no network, timeout, an HTTP error (for example the 403 a router or a blocked tile server returns when there is no internet) or an HTML login page from a captive portal. Such pages are never stored in place of a tile. Suits an unreliable marine connection. |
| Mode: *Cache first (saves data)* | Uses stored tiles while they are younger than the refresh age. Useful on metered or satellite links. |
| Mode: *Offline only (no downloads)* | Never uses the network; shows only what is stored. The exception is OpenStreetMap: the browser's cache cannot be read without allowing a download, so a tile the browser does not hold may still be fetched. |
| Max size (MB) | When exceeded, the oldest tiles are removed until the cache is at 90 % of the limit. |
| Refresh after (days) | Age after which *Cache first* and *Save visible area* download a tile again. |
| Extra zoom levels to save | How many levels deeper than the current zoom **Save visible area** downloads (0–4). |

**Save visible area for offline use** downloads the area shown on the chart from the current zoom to the extra levels set, up to 5000 tiles per run, four at a time. Click it again to stop. Before leaving harbour, zoom out to the cruising area and save it, then zoom in on the harbour and save again.

Esri World Ocean Base tiles are cached as you view them but are not bulk-downloaded by **Save visible area**: Esri's service reports `exportTilesAllowed: false`. Check Esri's terms at <https://goto.arcgisonline.com/maps/World_Ocean_Base> for your use. Its attribution is *Esri, Garmin, GEBCO, NOAA NGDC, and other contributors*, and its GEBCO data must not be used for navigation. 
**OpenStreetMap and offline use.** The [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) states that offline use is not permitted on `tile.openstreetmap.org`, so OpenStreetMap tiles are never written to the extension's offline cache nor bulk-saved, and entries stored by earlier versions are deleted when the dashboard opens. They use the browser's own HTTP cache instead, which the policy asks clients to honour: online, tiles are loaded normally; when the internet drops or the mode is *Offline only*, the dashboard asks for the copy the browser already holds. Areas viewed recently usually stay visible offline, but the browser decides how long it keeps them, so this is not as reliable as the Esri or custom base chart.

**"Access blocked · 403" tiles.** OpenStreetMap's servers sometimes answer with an image saying *Access blocked — App is not following the tile usage policy* ([osm.wiki/Blocked](https://wiki.openstreetmap.org/wiki/Blocked)) in place of the map tile. The dashboard recognises that image (the yellow and black stripe on its left edge) and does not draw it: that square stays empty, the bathymetry and seamarks still show, the footer says some tiles were refused, and the cache usage line counts them. The extension does not disguise its requests to get around the block; if many tiles are refused, choose **Esri World Ocean Base**. Installations still on the old OpenStreetMap default are moved to Esri automatically when the extension updates.

The cache covers only the extension's dashboard. The C-MAP, i-Boating and Garmin websites need an internet connection.

### Light and mark details, and symbol read-outs

Hover over (or tap, on a phone or tablet) any symbol on the chart for a small read-out:

- **Wind barb:** speed and the direction it comes from, and the gusts.
- **Wave arrow:** height (in the wave-height units) and the direction the waves come from, and the period.
- **Current arrow:** speed in knots and the direction it flows to.
- **Lights, buoys, beacons and other marks** (from zoom 11): name, kind and category, colour and shape, every light in chart notation (for example *Fl(2) G 5s 8m 3M*, and each sector with its bearings), topmark, fog signal, water level and List of Lights number.

A tapped read-out stays open until you tap somewhere else. The OpenSeaMap seamark layer is a picture, so the mark details come from the same OpenStreetMap data (`seamark:*` tags), read from the public [Overpass API](https://overpass-api.de) for the visible area, one tile of about 35 × 25 km at a time. Each tile is kept in the browser for 30 days (up to 24 tiles), so the details also work offline where you have been. Overpass is a shared service that is sometimes busy: the first details of a new area can take up to a minute, and failed requests are retried later, waiting up to 30 minutes. Switch the details off with **Show light and mark details on hover or tap** under **Dashboard chart**. OpenStreetMap data is © OpenStreetMap contributors (ODbL) and is not for navigation: check lights and marks against official charts and the List of Lights.

### Weather forecast

The dashboard overlays a live marine forecast from [Open-Meteo](https://open-meteo.com) (no API key). The **Conditions** panel shows wind, gusts, air temperature, pressure, wave height and the ocean (tidal) **current** at the boat; a maritime **wind barb** (in knots) is drawn at the vessel; and an optional **wind field**, **wave arrows** and red **current arrows** cover the whole chart, re-fetched as you pan. Choose the forecast **model** (best match, ECMWF IFS, GFS, ICON, Météo-France or UK Met Office) and the air-temperature (°C/°F) and wave-height (m/ft) units.

A **forecast timeline** at the bottom of the chart scrubs the next 72 hours: drag it, or press play, to watch the wind, waves and tidal streams change across the map. Readings are cached for an hour and kept up to 72 hours as an offline fallback, shown with their age, so a stale forecast is never mistaken for the current one. This is not a substitute for an official marine forecast.

**Current arrows.** With **Show current arrows (red) at the boat and across the chart**, a red arrow at the boat (just below it) and one per field point show the ocean current from Open-Meteo's marine model, which includes tides. Like the OpenCPN Online Charts plugin, an arrow points the way the water flows and grows from 14 px with the speed, up to 3 kn; the panel and the hover text give the speed in knots and the direction it flows to (for example *2.2 kn to ESE*). The marine model answers a land point with its nearest sea cell, so waves and currents are left out where the point's terrain is above 2 m. The model's grid is about 8 km, so in narrow channels and close to the coast use official tidal-stream atlases and tables.

### i-Boating

Select **i-Boating**, set the zoom and click **Open / centre provider**. The tab opens at the boat position with this URL:

```text
https://fishing-app.gpsnauticalcharts.com/i-boating-fishing-web-app/fishing-marine-charts-navigation.html?depth=m#13.76/50.775000/-1.300000
```

The i-Boating chart has a bridge for its mobile apps, `mapboxgl.external_to_js.callFromExternalBinding()`. Its `set_current_location` message draws the app's own boat marker (a red dot with a dashed heading line, the same one as its *My location* button). The extension uses that bridge (the `scripting` permission), like the C-MAP pin:

- As soon as the page loads, the boat appears at the last GPS position, even when the boat is stationary.
- With each new position (subject to **Minimum interval** and a minimum movement of 2 m), the marker and heading line move without reloading the page.
- With **Auto-centre on the GPS position** on, the chart glides to the boat and **keeps the zoom you chose**. With it off, the marker still moves but the chart stays where you left it.
- Changing **URL zoom** applies the new zoom once, through the `#zoom/lat/lon` hash.
- If the bridge is unavailable (page still loading after 15 s, or the site changed), the extension falls back to updating the hash, which i-Boating follows without a reload, but without the marker.

Tested in October 2026 on i-Boating's web chart (Mapbox GL 0.21). The bridge is not a documented API and may change without notice.

### C-MAP: Pin location

C-MAP Chart Explorer has a *Pin location* route that opens the chart centred on a coordinate, with a red pin and a **Pinned location** panel showing the coordinates, weather and depth:

```text
https://appchart.c-map.com/core/select/new_place/@-1.300000,50.775000
```

The order is **longitude, latitude**, the reverse of i-Boating.

Tested behaviour (October 2026):

- Opening the URL centres the chart on the coordinate and places the pin.
- C-MAP is a React single-page app. When the provider tab is already on C-MAP, the extension moves the pin by replacing the route in the page's history and firing `popstate` (the `scripting` permission). The pin and chart move without reloading the page, so the session, layers and cookie choice stay as they are, and the back button history does not grow.
- If the tab has left C-MAP or is still loading, the extension loads the URL instead.
- C-MAP resets the zoom to its own level (about a 50 m scale bar) each time the pin moves, and ignores any zoom in the URL. **URL zoom** therefore applies only to i-Boating. To zoom out on C-MAP between updates, raise **Minimum interval** or turn off **Auto-centre on the GPS position**.
- The left panel stays open and covers part of the chart. It can be collapsed in C-MAP.

This route is not a documented C-MAP API and may change without notice. If C-MAP stops honouring it, the tab still opens, but the pin no longer follows the boat.

### Garmin Marine

Select **Garmin Marine** and click **Open / centre provider**. A valid current or last known GPS position is required; Garmin never receives the demonstration fallback. The extension converts the unrounded latitude and longitude to a standard 12-character geohash and opens:

```text
https://maps.garmin.com/en-GB/marine/?maps=another-brand&overlay=false&key=<12-character-geohash>
```

Garmin decodes `key` and centres its map on that position. The page opens in English, like the dashboard. The `key` is a location encoding, not an authentication token; `maps=another-brand` only selects Garmin's chart-product list for non-Garmin chartplotters.

After the page loads, the extension makes **one** attempt to click the map centre through its public DOM and waits up to eight seconds for Garmin's native `pin-location` marker. Garmin then rewrites `key` with the marker position, and the extension compares it with the requested geohash: it reports success only when the marker is present and within 500 m of the vessel. Otherwise (no marker, or the map moved before the click, for example while a cookie banner was answered) it asks you to **click the map centre yourself**. At Garmin's opening zoom one screen pixel is about 100 m, so the marker is placed to within a few hundred metres; zoom in and click again for a closer position. Tested in Chrome on Garmin's English page.

- Continuous follow and the provider update interval are disabled for Garmin, because loading a new geohash URL can remove the existing marker.
- The web app can only open the centred page; it cannot control Garmin's marker in a cross-origin tab.
- **From OpenCPN:** the OpenCPN Online Charts plugin opens Garmin in Chrome with `gpscharts=pin` added to the address. The extension makes the same single marker attempt and check on such a tab, once per tab, even though it did not open it. Only Garmin Marine pages with a geohash `key` qualify.
- No routes or saved points are created, no cookie choice is made for you, and no Garmin credentials, cookies, tokens or internal application state are read.
- The position is sent to Garmin in the URL only after your explicit open action. Extension logs and status messages do not include coordinates, geohashes or complete Garmin URLs.

## Security

- The bridge WebSocket listens only on `127.0.0.1` by default.
- Do not expose that WebSocket directly to the internet or an untrusted network: the bridge has no authentication.
- Opening UDP or TCP on `0.0.0.0` accepts data from devices on the network; apply suitable firewall rules.
- The `scripting` permission is used only in the provider tab opened by the extension: on `appchart.c-map.com` to change its route, on i-Boating to send its boat-position message, and on `maps.garmin.com` for the single marker attempt and native-marker check.
- External pages are subject to the providers' accounts, licences, cookies and terms.
- Light and mark details are requested from the Overpass API with the bounds of a map tile around the visible area, not the boat's exact position. Switching the details off stops these requests.

## Structure

```text
manifest.json                 Manifest V3 configuration (extension)
background.js                 GPS state and provider tabs (i-Boating, C-MAP and Garmin)
garmin-content.js             Single Garmin marker attempt and native-marker verification
dashboard.html/css/js         Dashboard, connections, map and settings (extension page and web app)
shared.js                     Settings defaults and provider URLs (extension and web app)
platform.js                   Storage/messaging layer: chrome.* in the extension, localStorage in the web app
app.webmanifest, sw.js        Web app manifest and service worker (offline app shell)
index.html                    Web app entry point (opens dashboard.html)
tilecache.js                  Offline tile cache (MapLibre cached:// protocol + IndexedDB)
serialports.js                Serial port listing, naming and NMEA/baud detection
bathymetry.js                 Open bathymetry sources and layers
popup.html/css/js             Extension popup
nmea.js                       NMEA 0183, JSON and Signal K parser
weather.js                    Open-Meteo forecast, wind barbs, wave and current arrows, field and timeline
seamarks.js                   Light and mark details from OpenStreetMap (Overpass): tiles, chart-notation lights, descriptions
bridge/gps_bridge.py          TCP/UDP to WebSocket bridge
bridge/requirements.txt       Python dependency
vendor/                       MapLibre GL JS 5.24.0 and its licence
icons/                        Extension and web app icons (icon.svg is the source)
tests/nmea.test.js            Parser tests
tests/tilecache.test.js       Cache maths, prefetch planning and serial helper tests
tests/weather.test.js         Weather module tests
tests/seamarks.test.js        Light and mark detail tests
tests/provider.test.js        Provider URLs and 12-character Garmin geohash tests
```

To run the tests:

```bash
for test in tests/*.test.js; do node "$test" || exit 1; done
```

## Navigation warning

Experimental project. Do not use as a primary source of navigation or as a substitute for official charts, certified equipment, up-to-date nautical publications or a proper lookout. Check the licences and terms of every chart source.

## Licence

The extension's code is released under the [MIT licence](LICENSE). The bundled MapLibre GL JS in `vendor/` keeps its own BSD 3-Clause licence ([vendor/LICENSE.txt](vendor/LICENSE.txt)). Chart and bathymetry data shown by the extension (Esri, OpenStreetMap, OpenSeaMap, Open Waters, C-MAP, i-Boating, Garmin) are not covered by this licence and remain under their providers' own terms.
