const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, port: 47821, token: '', minSizeKB: 1024 };

async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  $('token').value = cfg.token;
  $('port').value = cfg.port;
  $('min').value = cfg.minSizeKB;
  $('enabled').checked = cfg.enabled;
}

$('save').addEventListener('click', async () => {
  const port = Math.round(Number($('port').value));
  await chrome.storage.local.set({
    token: $('token').value.trim(),
    port: port >= 1024 && port <= 65535 ? port : DEFAULTS.port,
    minSizeKB: Math.max(0, Math.round(Number($('min').value) || 0)),
    enabled: $('enabled').checked,
  });
  const s = await chrome.runtime.sendMessage({ type: 'status' });
  const state = $('state');
  state.className = `state ${s.running && s.paired ? 'ok' : 'bad'}`;
  state.textContent = !s.running ? 'Saved, but Srot is not running or the port is different. Open the app and try again.'
    : !s.paired ? 'Saved, but the pairing code does not match the one in Srot.'
      : 'Connected. Downloads from this browser now go to Srot.';
  load();
});
load();
