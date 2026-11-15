const $ = (id) => document.getElementById(id);

async function refresh() {
  const s = await chrome.runtime.sendMessage({ type: 'status' });
  const state = $('state');
  state.className = `state ${s.running && s.paired ? 'ok' : 'bad'}`;
  state.textContent = !s.running ? 'Srot is not running. Open the app.'
    : !s.paired ? 'Pairing code needed. Open the options.'
      : 'Connected to Srot';
  $('enabled').checked = s.enabled;
  $('video').disabled = !(s.running && s.paired);
}

$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
$('video').addEventListener('click', async () => {
  $('video').disabled = true;
  const r = await chrome.runtime.sendMessage({ type: 'video' });
  $('video').textContent = r.ok ? 'Sent to Srot' : 'Could not send this page';
});
refresh();
