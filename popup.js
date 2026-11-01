'use strict';

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
  if (!response?.ok) return;
  const fix = response.fix;
  document.getElementById('follow').checked = response.providerAutoCenter;
  if (!fix) {
    document.getElementById('status').textContent = 'No GPS data';
    return;
  }
  const age = Math.round((Date.now() - new Date(fix.receivedAt).getTime()) / 1000);
  document.getElementById('dot').className = `dot ${age < 15 ? 'live' : ''}`;
  document.getElementById('status').textContent = age < 15 ? `GPS live · ${fix.source}` : `Last position ${age} s ago`;
  document.getElementById('position').textContent = `${Number(fix.lat).toFixed(6)}°, ${Number(fix.lon).toFixed(6)}°`;
  const sog = fix.sog !== null && fix.sog !== undefined && fix.sog !== '' && Number.isFinite(Number(fix.sog)) ? `${Number(fix.sog).toFixed(1)} kn` : '—';
  const cog = fix.cog !== null && fix.cog !== undefined && fix.cog !== '' && Number.isFinite(Number(fix.cog)) ? `${Number(fix.cog).toFixed(0)}°` : '—';
  document.getElementById('motion').textContent = `${sog} · Course ${cog}`;
}

document.getElementById('dashboard').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  window.close();
});

document.querySelectorAll('[data-provider]').forEach(button => {
  button.addEventListener('click', async () => {
    const provider = button.dataset.provider;
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'OPEN_PROVIDER',
        provider,
        follow: provider === 'garmin' ? false : document.getElementById('follow').checked
      });
      if (!response?.ok) {
        document.getElementById('status').textContent = response?.error || 'Could not open the provider';
        return;
      }
      window.close();
    } catch (error) {
      document.getElementById('status').textContent = error.message || 'Could not open the provider';
    }
  });
});

document.getElementById('follow').addEventListener('change', event => {
  chrome.runtime.sendMessage({ type: 'SET_PROVIDER_FOLLOW', enabled: event.target.checked });
});

refresh().catch(() => {
  document.getElementById('status').textContent = 'Could not read the status';
});
