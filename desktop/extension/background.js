// Srot browser integration: hands downloads and video pages to the Srot app on this computer.
const DEFAULTS = { enabled: true, port: 47821, token: '', minSizeKB: 1024 };

const config = () => chrome.storage.local.get(DEFAULTS);
const isWeb = (url) => /^https?:\/\//i.test(url || '');

async function api(path, body) {
  const cfg = await config();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const res = await fetch(`http://127.0.0.1:${cfg.port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Srot-Token': cfg.token || '' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } finally { clearTimeout(timer); }
}

async function cookieHeader(url) {
  try {
    const list = await chrome.cookies.getAll({ url });
    return list.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch { return ''; }
}

async function flash(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  } catch { /* badge is cosmetic */ }
}

/** Send a file link to the app. Resolves true if the app took it. */
async function sendLink(url, extra = {}) {
  try {
    const res = await api('/add', {
      url, filename: extra.filename || undefined, referrer: extra.referrer || undefined,
      cookies: await cookieHeader(url), userAgent: navigator.userAgent,
    });
    if (res.ok) flash('✓', '#0B7A85');
    else if (res.status === 401) { flash('!', '#B3362E'); chrome.runtime.openOptionsPage(); }
    return res.ok;
  } catch { return false; }
}

async function sendVideo(url) {
  try {
    const res = await api('/video', { url });
    flash(res.ok ? '✓' : '!', res.ok ? '#0B7A85' : '#B3362E');
    if (res.status === 401) chrome.runtime.openOptionsPage();
    return res.ok;
  } catch { flash('!', '#B3362E'); return false; }
}

// Every download the browser starts: offer it to the app, and only cancel the browser's copy once the app has it.
chrome.downloads.onCreated.addListener(async (item) => {
  const cfg = await config();
  const url = item.finalUrl || item.url;
  if (!cfg.enabled || !cfg.token) return;
  if (item.state !== 'in_progress' || item.byExtensionId || !isWeb(url)) return;
  if (item.totalBytes > 0 && item.totalBytes < cfg.minSizeKB * 1024) return;
  const name = (item.filename || '').split(/[\\/]/).pop();
  if (await sendLink(url, { filename: name, referrer: item.referrer })) {
    try { await chrome.downloads.cancel(item.id); await chrome.downloads.erase({ id: item.id }); } catch { /* already gone */ }
  }
});

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'srot-link', title: 'Download link with Srot', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'srot-media', title: 'Download this video or audio with Srot', contexts: ['video', 'audio'] });
    chrome.contextMenus.create({ id: 'srot-page', title: 'Download the video on this page with Srot', contexts: ['page'] });
  });
}
chrome.runtime.onInstalled.addListener(buildMenus);
chrome.runtime.onStartup.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'srot-link' && isWeb(info.linkUrl)) return sendLink(info.linkUrl, { referrer: info.pageUrl });
  if (info.menuItemId === 'srot-media') {
    if (isWeb(info.srcUrl)) return sendLink(info.srcUrl, { referrer: info.pageUrl });
    if (isWeb(info.pageUrl)) return sendVideo(info.pageUrl);       // streamed media: let the app work it out from the page
  }
  if (info.menuItemId === 'srot-page' && isWeb(info.pageUrl)) return sendVideo(info.pageUrl);
  return false;
});

// Messages from the popup and the options page.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    const cfg = await config();
    if (msg.type === 'status') {
      try {
        const res = await api('/ping');
        reply({ running: res.ok, paired: !!(res.json && res.json.paired), enabled: cfg.enabled });
      } catch { reply({ running: false, paired: false, enabled: cfg.enabled }); }
    } else if (msg.type === 'video') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      reply({ ok: !!(tab && isWeb(tab.url) && await sendVideo(tab.url)) });
    } else reply({});
  })();
  return true;      // reply comes later
});
