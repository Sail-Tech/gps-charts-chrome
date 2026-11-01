// Runs once per Garmin page load. It uses only the page's public DOM and URL and never
// reads application state, credentials or cookies. The vessel position is read back
// only as the geohash already in the page URL, to check where the marker landed.
async function gpsChartsGarminMarker() {
  // Garmin's default zoom shows about 100 m per pixel, so a centre click lands within a
  // few hundred metres; further away means the map moved before the click.
  const MAX_OFFSET_METRES = 500;
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const hasNativeMarker = () => Boolean(document.querySelector(
    '.leaflet-marker-pane img[src*="pin-location"], ' +
    '.leaflet-marker-icon[src*="pin-location"]'
  ));
  const currentKey = () => new URLSearchParams(location.search).get('key');
  const decode = hash => {
    const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
    const lat = [-90, 90];
    const lon = [-180, 180];
    let even = true;
    for (const character of hash) {
      const value = alphabet.indexOf(character);
      if (value < 0) return null;
      for (let mask = 16; mask; mask >>= 1) {
        const range = even ? lon : lat;
        const middle = (range[0] + range[1]) / 2;
        if (value & mask) range[0] = middle; else range[1] = middle;
        even = !even;
      }
    }
    return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
  };
  const metresBetween = (a, b) => {
    const radians = Math.PI / 180;
    const x = (b.lon - a.lon) * radians * Math.cos((a.lat + b.lat) / 2 * radians);
    const y = (b.lat - a.lat) * radians;
    return Math.hypot(x, y) * 6371000;
  };

  const requestedKey = currentKey();
  let map = null;
  for (let waited = 0; waited < 15000; waited += 250) {
    map = document.querySelector('.leaflet-container');
    if (map || hasNativeMarker()) break;
    await sleep(250);
  }
  if (hasNativeMarker()) return 'marked';
  if (!map) return 'unavailable';
  if (map.dataset.gpsChartsMarkerAttempt === 'true') return 'manual';
  map.dataset.gpsChartsMarkerAttempt = 'true';

  const rect = map.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  let target = document.elementFromPoint(clientX, clientY);
  if (!target || !map.contains(target)) target = map;

  const base = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    screenX: clientX,
    screenY: clientY,
    button: 0,
    buttons: 0
  };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    const init = { ...base, buttons: type.endsWith('down') ? 1 : 0 };
    let event;
    if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
      event = new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true });
    } else {
      event = new MouseEvent(type, { ...init, detail: type === 'click' ? 1 : 0 });
    }
    target.dispatchEvent(event);
  }

  for (let waited = 0; waited < 8000; waited += 250) {
    if (hasNativeMarker()) break;
    await sleep(250);
  }
  if (!hasNativeMarker()) return 'manual';

  // Garmin rewrites the key with the marker position; compare it with the requested one.
  const requested = requestedKey && decode(requestedKey);
  if (!requested) return 'marked';
  for (let waited = 0; waited < 2000 && currentKey() === requestedKey; waited += 250) await sleep(250);
  const placed = currentKey() && decode(currentKey());
  if (!placed) return 'marked';
  return metresBetween(requested, placed) <= MAX_OFFSET_METRES ? 'marked' : 'offset';
}
