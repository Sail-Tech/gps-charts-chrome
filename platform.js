/* The dashboard runs both as the Chrome extension page and as a stand-alone web app (PWA, for phones and
   tablets). This layer gives it the same storage, messaging and URL calls in both. */
'use strict';

const GPSPlatform = (() => {
  const isExtension = typeof chrome !== 'undefined' && Boolean(chrome.runtime && chrome.runtime.id);

  if (isExtension) {
    return {
      isExtension,
      storage: chrome.storage.local,
      send: message => chrome.runtime.sendMessage(message),
      url: path => chrome.runtime.getURL(path)
    };
  }

  const STORAGE_KEY = 'gps-charts-settings';
  // A phone or tablet has its own GPS, so the web app starts on it.
  const WEB_DEFAULTS = { ...GPS_DEFAULTS, connectionMode: 'device' };

  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  const storage = {
    async get(keys) {
      const saved = { ...WEB_DEFAULTS, ...readAll() };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(key => saved[key] !== undefined).map(key => [key, saved[key]]));
    },
    async set(values) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), ...values }));
      } catch (_) {}
    }
  };

  // The extension's background worker handles these messages; in the web app only the last fix is kept.
  async function send(message) {
    if (message.type === 'GPS_FIX') await storage.set({ latestFix: message.fix });
    return { ok: true };
  }

  // Opens the provider at the boat's position in a new tab. Following the boat there needs the extension.
  function openProviderPage(provider, fix, zoom, units) {
    const url = provider === 'cmap' ? GPS_PROVIDER_URLS.cmap(fix) : GPS_PROVIDER_URLS.iboating(fix, zoom, units);
    window.open(url, '_blank', 'noopener');
  }

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  // Asks the browser not to evict the offline chart cache under storage pressure (the extension's
  // unlimitedStorage permission does this there).
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  return {
    isExtension,
    storage,
    send,
    url: path => new URL(path, document.baseURI).href,
    openProviderPage
  };
})();
