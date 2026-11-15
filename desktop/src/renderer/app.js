'use strict';
/* global srot */

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

const ICONS = {
  play: '<path d="M5 3.5v9l7.500-4.500z" fill="currentColor"/>',
  pause: '<path d="M4.500 3.500h2.500v9H4.500zM9 3.500h2.500v9H9z" fill="currentColor"/>',
  trash: '<path d="M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.6 8.500h5.800l.6-8.500" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  more: '<circle cx="3.500" cy="8" r="1.300" fill="currentColor"/><circle cx="8" cy="8" r="1.300" fill="currentColor"/><circle cx="12.500" cy="8" r="1.300" fill="currentColor"/>',
  gear: '<circle cx="8" cy="8" r="2.200" fill="none" stroke="currentColor" stroke-width="1.400"/><path d="M8 1.800v1.700M8 12.500v1.700M1.800 8h1.700M12.500 8h1.700M3.600 3.600l1.200 1.200M11.200 11.200l1.200 1.200M3.600 12.400l1.200-1.200M11.200 4.800l1.200-1.200" stroke="currentColor" stroke-width="1.400" stroke-linecap="round"/>',
  video: '<rect x="2" y="3.500" width="12" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.400"/><path d="M6.800 6v4l3.400-2z" fill="currentColor"/>',
  audio: '<path d="M6 11.500V4l6-1.200v7.200" fill="none" stroke="currentColor" stroke-width="1.400" stroke-linejoin="round"/><circle cx="4.500" cy="11.500" r="1.600" fill="currentColor"/><circle cx="10.500" cy="10" r="1.600" fill="currentColor"/>',
  document: '<path d="M4 2h5.500l2.500 2.500V14H4z" fill="none" stroke="currentColor" stroke-width="1.400" stroke-linejoin="round"/><path d="M6 8h4M6 10.500h4" stroke="currentColor" stroke-width="1.200" stroke-linecap="round"/>',
  archive: '<rect x="2.500" y="3" width="11" height="10.500" rx="1.500" fill="none" stroke="currentColor" stroke-width="1.400"/><path d="M8 3v2M8 6.500v2M8 10v1.500" stroke="currentColor" stroke-width="1.400" stroke-linecap="round"/>',
  program: '<rect x="2" y="3" width="12" height="10" rx="1.500" fill="none" stroke="currentColor" stroke-width="1.400"/><path d="M4.500 6.500l2 1.800-2 1.800M8 10.500h3" fill="none" stroke="currentColor" stroke-width="1.300" stroke-linecap="round" stroke-linejoin="round"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.500" fill="none" stroke="currentColor" stroke-width="1.400"/><circle cx="5.800" cy="6.500" r="1.100" fill="currentColor"/><path d="M3 12l3.500-3.500 2.500 2.300 2-1.800 2 2" fill="none" stroke="currentColor" stroke-width="1.300" stroke-linejoin="round"/>',
  other: '<path d="M8 2.500v8M4.800 7.500L8 10.700l3.200-3.200M3 13.500h10" fill="none" stroke="currentColor" stroke-width="1.500" stroke-linecap="round" stroke-linejoin="round"/>',
  contrast: '<circle cx="8" cy="8" r="5.600" fill="none" stroke="currentColor" stroke-width="1.400"/><path d="M8 2.400a5.600 5.600 0 0 0 0 11.200z" fill="currentColor"/>',
  done: '<path d="M3 8.500l3.200 3.200L13 4.800" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = (name) => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] || ICONS.other}</svg>`;

const FILTERS = [
  ['all', 'All downloads', () => true],
  ['active', 'Downloading', (t) => t.status === 'downloading'],
  ['waiting', 'Waiting', (t) => ['queued', 'scheduled', 'paused'].includes(t.status)],
  ['finished', 'Finished', (t) => t.status === 'completed'],
  ['failed', 'Failed', (t) => t.status === 'error'],
  null,
  ['video', 'Video', (t) => t.category === 'video'],
  ['audio', 'Music', (t) => t.category === 'audio'],
  ['document', 'Documents', (t) => t.category === 'document'],
  ['archive', 'Archives', (t) => t.category === 'archive'],
  ['program', 'Programs', (t) => t.category === 'program'],
  ['image', 'Images', (t) => t.category === 'image'],
  ['other', 'Other', (t) => t.category === 'other'],
];
const QUALITY_LABELS = { best: 'Best available', 2160: '4K (2160p)', 1440: '1440p', 1080: '1080p', 720: '720p', 480: '480p', 360: '360p', audio: 'Audio only' };
const LIMITS = [0, 256, 512, 1024, 2048, 5120, 10240];

const state = {
  tasks: [], speed: 0, active: 0, inWindow: true,
  settings: null, filter: 'all', search: '',
  selected: new Set(), anchor: null,
  rows: new Map(),
  pendingRemove: [], pendingUrl: null, pendingSchedule: null,
  addDir: null, vidDir: null, probeTimer: null, probeSeq: 0,
};

// ---- formatting ----------------------------------------------------------------------------------

function fmtBytes(n) {
  if (n == null || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}
const fmtSpeed = (n) => (n > 0 ? `${fmtBytes(n)}/s` : '');
function fmtEta(s) {
  if (s == null) return '';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
function fmtWhen(ms) {
  if (!ms) return '';
  const d = new Date(ms); const now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}
const fmtLimit = (kb) => (kb >= 1024 ? `${kb / 1024} MB/s` : `${kb} KB/s`);
const pct = (t) => (t.status === 'completed' ? 100 : t.size > 0 ? Math.min(100, (t.downloaded / t.size) * 100) : 0);
const toLocalInput = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const urlsIn = (text) => String(text || '').split(/\s+/).filter((s) => /^https?:\/\/\S+$/i.test(s));

function subline(t) {
  switch (t.status) {
    case 'downloading': {
      const got = t.size > 0 ? `${fmtBytes(t.downloaded)} of ${fmtBytes(t.size)}` : `${fmtBytes(t.downloaded)} so far`;
      return t.kind === 'http' && t.connections > 1 ? `${got}, ${t.connections} connections` : got;
    }
    case 'queued': return state.inWindow ? 'Waiting for its turn' : 'Waiting for the allowed hours';
    case 'scheduled': return `Starts ${fmtWhen(t.scheduleAt)}`;
    case 'paused':
      if (t.resumable === false) return 'Paused. This server cannot resume, so it will start over';
      return t.downloaded > 0 ? `Paused at ${fmtBytes(t.downloaded)}` : 'Paused';
    case 'error': {
      const wait = t.retryAt ? Math.max(0, Math.ceil((t.retryAt - Date.now()) / 1000)) : null;
      return wait != null ? `${t.error}. Trying again in ${wait}s` : (t.error || 'Failed');
    }
    case 'completed': return `Finished ${fmtWhen(t.completedAt)}`;
    default: return '';
  }
}

// ---- rendering -----------------------------------------------------------------------------------

function visibleTasks() {
  const f = FILTERS.find((x) => x && x[0] === state.filter) || FILTERS[0];
  const q = state.search.trim().toLowerCase();
  return state.tasks.filter((t) => f[2](t) && (!q || (t.name || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q)));
}

function renderSide() {
  const side = $('side');
  if (!side.childElementCount) {
    for (const f of FILTERS) {
      if (!f) { side.appendChild(el('hr')); continue; }
      const b = el('button');
      b.dataset.filter = f[0];
      b.append(el('span', null, f[1]), el('span', 'count'));
      b.addEventListener('click', () => { state.filter = f[0]; state.selected.clear(); render(); });
      side.appendChild(b);
    }
  }
  for (const b of side.querySelectorAll('button')) {
    const f = FILTERS.find((x) => x && x[0] === b.dataset.filter);
    const n = state.tasks.filter(f[2]).length;
    b.querySelector('.count').textContent = n || '';
    b.setAttribute('aria-current', String(state.filter === f[0]));
  }
}

function makeRow(t) {
  const row = el('div', 'row');
  row.dataset.id = t.id;
  row.setAttribute('role', 'option');
  const name = el('div', 'name');
  const kind = el('span', 'kind');
  const text = el('div', 'text');
  text.append(el('div', 'title clip'), el('div', 'sub clip'));
  name.append(kind, text);
  const prog = el('div', 'prog');
  const track = el('div', 'track');
  track.appendChild(el('div', 'fill'));
  prog.append(track, el('span', 'pct'));
  row.append(name, el('span', 'num size'), prog, el('span', 'num speed'), el('span', 'num eta'), el('span', 'num added muted'));
  row.addEventListener('mousedown', (e) => { if (e.button === 0) selectRow(t.id, e); });
  row.addEventListener('dblclick', () => activate(t.id));
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!state.selected.has(t.id)) { state.selected = new Set([t.id]); state.anchor = t.id; render(); }
    openMenu(rowMenu(), e.clientX, e.clientY);
  });
  return row;
}

function updateRow(row, t) {
  const set = (sel, value) => { const n = row.querySelector(sel); if (n.textContent !== value) n.textContent = value; };
  row.dataset.status = t.status;
  row.classList.toggle('unknown', t.size <= 0 && t.status === 'downloading');
  row.setAttribute('aria-selected', String(state.selected.has(t.id)));
  const kindName = t.status === 'completed' ? 'done' : t.category;
  const kind = row.querySelector('.kind');
  if (kind.dataset.icon !== kindName) { kind.dataset.icon = kindName; kind.innerHTML = icon(kindName); }
  set('.title', t.name || t.url);
  row.querySelector('.title').title = t.name || t.url;
  set('.sub', subline(t));
  set('.size', t.size > 0 ? fmtBytes(t.size) : '');
  const p = pct(t);
  row.querySelector('.fill').style.width = `${p}%`;
  set('.pct', t.size > 0 || t.status === 'completed' ? `${Math.floor(p)}%` : '');
  set('.speed', fmtSpeed(t.speed));
  set('.eta', t.status === 'downloading' ? fmtEta(t.eta) : '');
  set('.added', fmtWhen(t.addedAt));
}

function renderRows() {
  const list = visibleTasks();
  const box = $('rows');
  const seen = new Set();
  let prev = null;
  for (const t of list) {
    let row = state.rows.get(t.id);
    if (!row) { row = makeRow(t); state.rows.set(t.id, row); }
    updateRow(row, t);
    const want = prev ? prev.nextSibling : box.firstChild;
    if (row !== want) box.insertBefore(row, want);
    prev = row;
    seen.add(t.id);
  }
  for (const [id, row] of state.rows) if (!seen.has(id)) { row.remove(); state.rows.delete(id); }
  for (const id of [...state.selected]) if (!seen.has(id)) state.selected.delete(id);

  const empty = $('empty');
  empty.hidden = list.length > 0;
  box.hidden = list.length === 0;
  if (!list.length) {
    const fresh = state.tasks.length === 0;
    empty.querySelector('.empty-title').textContent = fresh ? 'No downloads yet' : 'Nothing matches here';
    empty.querySelector('.empty-hint').textContent = fresh
      ? `Copy a link and press ${state.mac ? '⌘V' : 'Ctrl+V'}, drop a link onto this window, or choose Add link.`
      : 'Pick another group on the left or clear the search.';
  }
}

function selectedTasks() { return state.tasks.filter((t) => state.selected.has(t.id)); }

function renderToolbar() {
  const sel = selectedTasks();
  $('btn-resume').disabled = !sel.some((t) => ['paused', 'error', 'scheduled'].includes(t.status));
  $('btn-pause').disabled = !sel.some((t) => ['downloading', 'queued', 'scheduled'].includes(t.status));
  $('btn-remove').disabled = sel.length === 0;
}

function renderStatus() {
  $('s-speed').textContent = state.speed > 0 ? `↓ ${fmtSpeed(state.speed)}` : 'Idle';
  $('s-active').textContent = state.active ? `${state.active} downloading` : '';
  const s = state.settings;
  if (!s) return;
  $('s-limit').textContent = s.speedLimit > 0 ? `Speed limit ${fmtLimit(Math.round(s.speedLimit / 1024))}` : 'No speed limit';
  $('s-hours').textContent = s.window.enabled ? `Allowed hours ${s.window.start} to ${s.window.end}${state.inWindow ? '' : ' (waiting)'}` : '';
}

async function renderDetail() {
  const panel = $('detail');
  if (state.selected.size !== 1) { panel.hidden = true; return; }
  const id = [...state.selected][0];
  const d = await srot.detail(id);
  if (!d || state.selected.size !== 1 || !state.selected.has(id)) { panel.hidden = true; return; }
  panel.hidden = false;
  $('d-name').textContent = d.name || d.url;
  $('d-state').textContent = subline(d);
  $('d-url').textContent = d.url;
  $('d-path').textContent = d.path || d.dir || '';
  const map = $('d-map');
  map.textContent = '';
  if (d.status === 'completed') {
    const full = el('i'); full.style.left = '0'; full.style.width = '100%'; map.appendChild(full);
  } else if (d.size > 0 && d.segments && d.segments.length) {
    for (const g of d.segments) {
      if (g.pos > g.start) {
        const part = el('i', g.active ? 'live' : '');
        part.style.left = `${(g.start / d.size) * 100}%`;
        part.style.width = `${((g.pos - g.start) / d.size) * 100}%`;
        map.appendChild(part);
      }
      if (g.start > 0) { const cut = el('b'); cut.style.left = `${(g.start / d.size) * 100}%`; map.appendChild(cut); }
    }
  } else if (d.size > 0) {
    const part = el('i'); part.style.left = '0'; part.style.width = `${pct(d)}%`; map.appendChild(part);
  }
  map.hidden = !(d.size > 0 || d.status === 'completed');
}

function render() { renderSide(); renderRows(); renderToolbar(); renderStatus(); renderDetail(); }

// ---- selection and row actions -------------------------------------------------------------------

function selectRow(id, e) {
  const ids = visibleTasks().map((t) => t.id);
  if (e.shiftKey && state.anchor && ids.includes(state.anchor)) {
    const [a, b] = [ids.indexOf(state.anchor), ids.indexOf(id)].sort((x, y) => x - y);
    state.selected = new Set(ids.slice(a, b + 1));
  } else if (e.metaKey || e.ctrlKey) {
    if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
    state.anchor = id;
  } else {
    state.selected = new Set([id]);
    state.anchor = id;
  }
  render();
}

async function activate(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  if (t.status === 'completed') {
    const r = await srot.openFile(id);
    if (r && !r.ok) toast(r.error);
  } else if (t.status === 'downloading' || t.status === 'queued') await srot.pause([id]);
  else await srot.resume([id]);
}

const idsWhere = (statuses) => selectedTasks().filter((t) => statuses.includes(t.status)).map((t) => t.id);
const doResume = () => srot.resume(idsWhere(['paused', 'error', 'scheduled']));
const doPause = () => srot.pause(idsWhere(['downloading', 'queued', 'scheduled']));

function askRemove() {
  const sel = selectedTasks();
  if (!sel.length) return;
  state.pendingRemove = sel.map((t) => t.id);
  const finished = sel.filter((t) => t.status === 'completed').length;
  $('rm-title').textContent = sel.length === 1 ? 'Remove this download?' : `Remove ${sel.length} downloads?`;
  $('rm-text').textContent = sel.length === 1 ? sel[0].name : 'Unfinished downloads lose their progress.';
  $('rm-files-row').hidden = finished === 0;
  $('rm-files').checked = false;
  $('dlg-remove').showModal();
}

function rowMenu() {
  const sel = selectedTasks();
  const one = sel.length === 1 ? sel[0] : null;
  const waiting = (t) => ['queued', 'scheduled', 'paused', 'error'].includes(t.status);
  return [
    one && one.status === 'completed' ? ['Open', () => activate(one.id)] : null,
    one ? ['Show in folder', () => srot.reveal(one.id)] : null,
    one ? 'sep' : null,
    ['Resume', doResume, !sel.some((t) => ['paused', 'error', 'scheduled'].includes(t.status))],
    ['Pause', doPause, !sel.some((t) => ['downloading', 'queued', 'scheduled'].includes(t.status))],
    ['Start now, skip the queue', () => srot.startNow(sel.filter(waiting).map((t) => t.id)), !sel.some(waiting)],
    'sep',
    one ? ['Move up', () => srot.move(one.id, -1)] : null,
    one ? ['Move down', () => srot.move(one.id, 1)] : null,
    one ? ['Start later…', () => openSchedule(one), !waiting(one)] : null,
    one && one.kind === 'http' ? ['Update link…', () => openUrl(one), !['paused', 'error', 'queued'].includes(one.status)] : null,
    one ? ['Copy link', () => { srot.copyText(one.url); toast('Link copied'); }] : null,
    one ? 'sep' : null,
    ['Remove…', askRemove],
  ].filter(Boolean);
}

// ---- menus, toasts -------------------------------------------------------------------------------

function openMenu(items, x, y) {
  const menu = $('menu');
  menu.textContent = '';
  let lastSep = true;
  for (const it of items) {
    if (it === 'sep') { if (!lastSep) menu.appendChild(el('hr')); lastSep = true; continue; }
    const b = el('button', null, it[0]);
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it[2];
    b.addEventListener('click', () => { closeMenu(); it[1](); });
    menu.appendChild(b);
    lastSep = false;
  }
  if (menu.lastChild && menu.lastChild.tagName === 'HR') menu.lastChild.remove();
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 6))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 6))}px`;
}
function closeMenu() { $('menu').hidden = true; }

function toast(text) {
  if (!text) return;
  const t = el('div', 'toast', text);
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ---- add link ------------------------------------------------------------------------------------

async function clipboardLinks() {
  try { return (await srot.clipboardUrl()) || ''; } catch { return ''; }
}

function openAdd(prefill) {
  const s = state.settings;
  state.addDir = s.downloadDir;
  $('add-urls').value = prefill || '';
  $('add-name').value = '';
  $('add-name-row').hidden = true;
  $('add-info').textContent = '';
  $('add-dir').textContent = state.addDir; $('add-dir').title = state.addDir;
  $('add-conn').value = s.connections;
  document.querySelector('input[name="add-when"][value="now"]').checked = true;
  $('add-at').value = toLocalInput(Date.now() + 3600000);
  $('dlg-add').showModal();
  $('add-urls').focus();
  onAddInput();
}

function onAddInput() {
  const urls = urlsIn($('add-urls').value);
  const info = $('add-info');
  clearTimeout(state.probeTimer);
  const seq = ++state.probeSeq;
  $('add-ok').disabled = urls.length === 0;
  $('add-ok').textContent = urls.length > 1 ? `Download ${urls.length} files` : 'Download';
  $('add-name-row').hidden = true;
  if (urls.length === 0) { info.textContent = $('add-urls').value.trim() ? 'That does not look like a link. Links start with http:// or https://' : ''; return; }
  if (urls.length > 1) { info.textContent = `${urls.length} links found`; return; }
  info.textContent = 'Checking the link…';
  state.probeTimer = setTimeout(async () => {
    const r = await srot.probe(urls[0]);
    if (seq !== state.probeSeq) return;
    if (!r.ok) { info.textContent = `Could not check the link: ${r.error}. You can still try to download it.`; return; }
    const bits = [r.size > 0 ? fmtBytes(r.size) : 'size unknown', r.resumable ? 'can be paused and resumed' : 'cannot be resumed if interrupted'];
    info.textContent = bits.join(', ');
    $('add-name-row').hidden = false;
    if (!$('add-name').value) $('add-name').value = r.name;
  }, 400);
}

async function submitAdd() {
  const urls = urlsIn($('add-urls').value);
  if (!urls.length) return;
  const when = document.querySelector('input[name="add-when"]:checked').value;
  const at = when === 'later' ? new Date($('add-at').value).getTime() : null;
  const results = await srot.add({
    urls, dir: state.addDir,
    connections: Number($('add-conn').value) || undefined,
    paused: when === 'paused',
    scheduleAt: at && at > Date.now() ? at : undefined,
    name: !$('add-name-row').hidden ? $('add-name').value.trim() : undefined,
  });
  const failed = results.filter((r) => !r.ok);
  const dup = results.filter((r) => r.ok && r.duplicate);
  if (failed.length) toast(`${failed.length} link${failed.length > 1 ? 's' : ''} could not be added: ${failed[0].error}`);
  else if (dup.length) toast(dup.length === 1 ? 'That link is already in the list' : `${dup.length} links were already in the list`);
}

// ---- add video -----------------------------------------------------------------------------------

function fillQuality(select, heights, value) {
  select.textContent = '';
  const opts = ['best', ...(heights && heights.length ? heights.map(String) : ['2160', '1440', '1080', '720', '480', '360']), 'audio'];
  for (const q of opts) {
    const o = el('option', null, QUALITY_LABELS[q] || `${q}p`);
    o.value = q;
    select.appendChild(o);
  }
  select.value = opts.includes(String(value)) ? String(value) : 'best';
}

async function renderVideoTools() {
  const box = $('vid-tools');
  const st = await srot.toolsStatus();
  box.textContent = '';
  const line = (text, name) => {
    const p = el('p', null, text);
    const b = el('button', 'btn small', 'Install');
    b.type = 'button';
    b.addEventListener('click', () => installTool(name, b, renderVideoTools));
    p.appendChild(b);
    box.appendChild(p);
  };
  if (!st['yt-dlp'].path) line('Video downloads need the helper yt-dlp (about 35 MB, one time).', 'yt-dlp');
  if (!st.ffmpeg.path) line('For 1080p and above, and for MP3, also install ffmpeg (about 45 MB).', 'ffmpeg');
  box.hidden = box.childElementCount === 0;
  return st;
}

async function installTool(name, button, after) {
  button.disabled = true;
  const off = srot.onToolProgress((p) => {
    if (p.name === name) button.textContent = p.size > 0 ? `${Math.floor((p.downloaded / p.size) * 100)}%` : 'Downloading…';
  });
  button.textContent = 'Downloading…';
  const r = await srot.toolsInstall(name);
  off();
  if (!r.ok) { toast(`Could not install ${name}: ${r.error}`); button.disabled = false; button.textContent = 'Install'; return; }
  toast(`${name} is installed`);
  if (after) after();
}

function openVideo(prefill) {
  state.vidDir = state.settings.downloadDir;
  $('vid-url').value = prefill || '';
  $('vid-info').textContent = '';
  $('vid-playlist').checked = false;
  $('vid-dir').textContent = state.vidDir; $('vid-dir').title = state.vidDir;
  fillQuality($('vid-quality'), null, state.settings.videoQuality);
  renderVideoTools();
  $('dlg-video').showModal();
  $('vid-url').focus();
}

async function checkVideo() {
  const url = urlsIn($('vid-url').value)[0];
  const info = $('vid-info');
  if (!url) { info.textContent = 'Paste the link of the page that plays the video.'; return; }
  info.textContent = 'Asking the site about this video…';
  $('vid-check').disabled = true;
  const r = await srot.videoProbe(url);
  $('vid-check').disabled = false;
  if (r.missing) { info.textContent = 'Install yt-dlp below first.'; renderVideoTools(); return; }
  if (!r.ok) { info.textContent = `The site said: ${r.error}`; return; }
  const mins = r.info.duration ? `, ${fmtEta(Math.round(r.info.duration))}` : '';
  info.textContent = `${r.info.title}${mins}${r.info.uploader ? `, by ${r.info.uploader}` : ''}`;
  fillQuality($('vid-quality'), r.info.heights, $('vid-quality').value);
  state.vidTitle = r.info.title;
}

async function submitVideo() {
  const url = urlsIn($('vid-url').value)[0];
  if (!url) { toast('That does not look like a link'); return; }
  const r = await srot.videoAdd({
    url, quality: $('vid-quality').value, playlist: $('vid-playlist').checked, dir: state.vidDir, title: state.vidTitle || undefined,
  });
  state.vidTitle = null;
  if (!r.ok) toast(r.error); else if (r.duplicate) toast('That video is already in the list');
}

// ---- settings ------------------------------------------------------------------------------------

async function renderToolsInSettings() {
  $('tool-ytdlp').textContent = 'checking…';
  const st = await srot.toolsStatus();
  const y = st['yt-dlp']; const f = st.ffmpeg;
  $('tool-ytdlp').textContent = y.path ? `installed${y.version ? `, version ${y.version}` : ''}` : 'not installed';
  $('tool-ytdlp-install').hidden = !!y.path;
  $('tool-ytdlp-install').disabled = false; $('tool-ytdlp-install').textContent = 'Install';
  $('tool-ytdlp-update').hidden = !y.path || !y.own;
  $('tool-ffmpeg').textContent = f.path ? 'installed' : 'not installed (needed for 1080p and above, and MP3)';
  $('tool-ffmpeg-install').hidden = !!f.path;
  $('tool-ffmpeg-install').disabled = false; $('tool-ffmpeg-install').textContent = 'Install';
}

function fillSettings() {
  const s = state.settings;
  $('set-theme').value = s.theme;
  $('set-dir').textContent = s.downloadDir; $('set-dir').title = s.downloadDir;
  $('set-concurrent').value = s.maxConcurrent;
  $('set-conn').value = s.connections;
  $('set-limit').value = Math.round(s.speedLimitPreset / 1024);
  $('set-hours-on').checked = s.window.enabled;
  $('set-hours-start').value = s.window.start.padStart(5, '0');
  $('set-hours-end').value = s.window.end.padStart(5, '0');
  $('set-notify').checked = s.notify;
  $('set-awake').checked = s.keepAwake;
  $('set-token').textContent = s.token;
  $('set-port').value = s.port;
  $('set-api-error').hidden = !s.apiError;
  $('set-api-error').textContent = s.apiError || '';
  fillQuality($('set-quality'), null, s.videoQuality);
  $('set-version').textContent = `Srot ${s.version}, developed by ${s.credit}`;
}

function openSettings() { fillSettings(); renderToolsInSettings(); $('dlg-settings').showModal(); }

async function saveSettings(patch) {
  state.settings = await srot.setSettings(patch);
  fillSettings();
  renderStatus();
}

function wireSettings() {
  const num = (id, key, mul = 1) => $(id).addEventListener('change', () => {
    const v = Number($(id).value);
    if (Number.isFinite(v) && v > 0) saveSettings({ [key]: v * mul }); else fillSettings();
  });
  num('set-concurrent', 'maxConcurrent');
  num('set-conn', 'connections');
  num('set-port', 'port');
  $('set-limit').addEventListener('change', () => {
    const preset = Math.max(16, Number($('set-limit').value) || 1024) * 1024;
    saveSettings({ speedLimitPreset: preset, ...(state.settings.speedLimit > 0 ? { speedLimit: preset } : {}) });
  });
  const hours = () => saveSettings({ window: { enabled: $('set-hours-on').checked, start: $('set-hours-start').value, end: $('set-hours-end').value } });
  for (const id of ['set-hours-on', 'set-hours-start', 'set-hours-end']) $(id).addEventListener('change', hours);
  $('set-notify').addEventListener('change', () => saveSettings({ notify: $('set-notify').checked }));
  $('set-awake').addEventListener('change', () => saveSettings({ keepAwake: $('set-awake').checked }));
  $('set-theme').addEventListener('change', () => saveSettings({ theme: $('set-theme').value }));
  $('set-quality').addEventListener('change', () => saveSettings({ videoQuality: $('set-quality').value }));
  $('set-dir-pick').addEventListener('click', async () => {
    const dir = await srot.pickFolder(state.settings.downloadDir);
    if (dir) saveSettings({ downloadDir: dir });
  });
  $('set-token-copy').addEventListener('click', () => { srot.copyText(state.settings.token); toast('Pairing code copied'); });
  $('set-ext').addEventListener('click', async () => {
    const r = await srot.exportExtension();
    if (r.ok) toast('Extension folder saved. Load it from the browser’s Extensions page.');
    else if (!r.canceled) toast(`Could not save the folder: ${r.error}`);
  });
  $('tool-ytdlp-install').addEventListener('click', () => installTool('yt-dlp', $('tool-ytdlp-install'), renderToolsInSettings));
  $('tool-ffmpeg-install').addEventListener('click', () => installTool('ffmpeg', $('tool-ffmpeg-install'), renderToolsInSettings));
  $('tool-ytdlp-update').addEventListener('click', async () => {
    $('tool-ytdlp-update').disabled = true;
    const r = await srot.toolsUpdate();
    $('tool-ytdlp-update').disabled = false;
    toast(r.ok ? (r.message || 'yt-dlp is up to date') : `Update failed: ${r.error}`);
    renderToolsInSettings();
  });
}

// ---- small dialogs -------------------------------------------------------------------------------

function openUrl(t) {
  state.pendingUrl = t.id;
  $('url-new').value = '';
  $('url-error').hidden = true;
  $('dlg-url').showModal();
  $('url-new').focus();
}
function openSchedule(t) {
  state.pendingSchedule = t.id;
  $('sch-at').value = toLocalInput(t.scheduleAt || Date.now() + 3600000);
  $('dlg-schedule').showModal();
}

function openLimitMenu(anchor) {
  const cur = Math.round(state.settings.speedLimit / 1024);
  const preset = Math.round(state.settings.speedLimitPreset / 1024);
  const values = [...new Set([...LIMITS, preset])].sort((a, b) => a - b);
  const items = values.map((kb) => [`${kb === cur ? '✓ ' : ''}${kb === 0 ? 'No limit' : fmtLimit(kb)}`, () => saveSettings({ speedLimit: kb * 1024 })]);
  const r = anchor.getBoundingClientRect();
  openMenu(items, r.right - 200, r.top - items.length * 26 - 16);
}

// ---- wiring --------------------------------------------------------------------------------------

function wire() {
  $('btn-resume').innerHTML = icon('play');
  $('btn-pause').innerHTML = icon('pause');
  $('btn-remove').innerHTML = icon('trash');
  $('btn-more').innerHTML = icon('more');
  $('btn-settings').innerHTML = icon('gear');
  $('btn-theme').innerHTML = icon('contrast');
  const darkNow = matchMedia('(prefers-color-scheme: dark)');
  const labelTheme = () => { $('btn-theme').title = darkNow.matches ? 'Switch to light mode' : 'Switch to dark mode'; };
  darkNow.addEventListener('change', labelTheme);
  labelTheme();
  $('btn-theme').addEventListener('click', () => saveSettings({ theme: darkNow.matches ? 'light' : 'dark' }));

  $('btn-add').addEventListener('click', async () => openAdd(await clipboardLinks()));
  $('btn-video').addEventListener('click', () => openVideo());
  $('btn-resume').addEventListener('click', doResume);
  $('btn-pause').addEventListener('click', doPause);
  $('btn-remove').addEventListener('click', askRemove);
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-more').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu([
      ['Resume all', () => srot.resumeAll()],
      ['Pause all', () => srot.pauseAll()],
      'sep',
      ['Clear finished from the list', () => srot.clearFinished(), !state.tasks.some((t) => t.status === 'completed')],
    ], r.left, r.bottom + 4);
  });
  $('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
  $('s-limit').addEventListener('click', (e) => openLimitMenu(e.currentTarget));
  $('d-copy').addEventListener('click', () => { srot.copyText($('d-url').textContent); toast('Link copied'); });
  $('d-reveal').addEventListener('click', () => { const id = [...state.selected][0]; if (id) srot.reveal(id); });

  for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close('cancel'));

  $('add-urls').addEventListener('input', onAddInput);
  $('add-dir-pick').addEventListener('click', async () => {
    const dir = await srot.pickFolder(state.addDir);
    if (dir) { state.addDir = dir; $('add-dir').textContent = dir; $('add-dir').title = dir; }
  });
  $('add-at').addEventListener('focus', () => { document.querySelector('input[name="add-when"][value="later"]').checked = true; });
  $('dlg-add').querySelector('form').addEventListener('submit', submitAdd);

  $('vid-check').addEventListener('click', checkVideo);
  $('vid-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); checkVideo(); } });
  $('vid-dir-pick').addEventListener('click', async () => {
    const dir = await srot.pickFolder(state.vidDir);
    if (dir) { state.vidDir = dir; $('vid-dir').textContent = dir; $('vid-dir').title = dir; }
  });
  $('dlg-video').querySelector('form').addEventListener('submit', submitVideo);

  $('dlg-remove').querySelector('form').addEventListener('submit', async () => {
    const ids = state.pendingRemove; state.pendingRemove = [];
    await srot.remove(ids, $('rm-files').checked);
    state.selected.clear();
  });
  $('dlg-url').querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlsIn($('url-new').value)[0];
    const r = url ? await srot.updateUrl(state.pendingUrl, url) : { ok: false, error: 'That does not look like a link' };
    if (!r.ok) { $('url-error').textContent = r.error; $('url-error').hidden = false; return; }
    $('dlg-url').close();
  });
  $('dlg-schedule').querySelector('form').addEventListener('submit', () => {
    const at = new Date($('sch-at').value).getTime();
    if (at > Date.now()) srot.schedule(state.pendingSchedule, at); else toast('Pick a time in the future');
  });
  $('sch-clear').addEventListener('click', () => { srot.schedule(state.pendingSchedule, null); $('dlg-schedule').close(); });
  wireSettings();

  document.addEventListener('mousedown', (e) => { if (!$('menu').hidden && !$('menu').contains(e.target)) closeMenu(); });
  window.addEventListener('blur', closeMenu);
  $('rows').addEventListener('mousedown', (e) => { if (e.target === $('rows')) { state.selected.clear(); render(); } });

  const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  const modalOpen = () => !!document.querySelector('dialog[open]');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
    if (typing() || modalOpen()) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); askRemove(); }
    else if (e.key === ' ') { e.preventDefault(); if (idsWhere(['downloading', 'queued']).length) doPause(); else doResume(); }
    else if (e.key === 'Enter') { const id = [...state.selected][0]; if (id) activate(id); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); state.selected = new Set(visibleTasks().map((t) => t.id)); render(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('search').focus(); }
  });
  document.addEventListener('paste', (e) => {
    if (typing() || modalOpen()) return;
    const urls = urlsIn(e.clipboardData.getData('text'));
    if (urls.length) { e.preventDefault(); openAdd(urls.join('\n')); } else toast('The clipboard does not hold a link');
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (modalOpen()) return;
    const urls = urlsIn(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
    if (urls.length) openAdd(urls.join('\n'));
  });

  srot.onUpdate((snap) => {
    state.tasks = snap.tasks; state.speed = snap.speed; state.active = snap.active; state.inWindow = snap.inWindow;
    render();
  });
  srot.onSettings((s) => { state.settings = s; if ($('dlg-settings').open) fillSettings(); renderStatus(); });
  srot.onOpenAdd(async () => { if (!modalOpen()) openAdd(await clipboardLinks()); });
  srot.onOpenVideo(() => { if (!modalOpen()) openVideo(); });
  srot.onOpenSettings(() => { if (!modalOpen()) openSettings(); });
  srot.onToast((t) => toast(t.text));
}

(async function boot() {
  const init = await srot.init();
  state.settings = init.settings;
  state.tasks = init.snapshot.tasks; state.speed = init.snapshot.speed; state.active = init.snapshot.active; state.inWindow = init.snapshot.inWindow;
  state.mac = init.settings.platform === 'darwin';
  const names = String(init.settings.credit || '').split(/\s+and\s+/);
  $('credit-a').textContent = names[0] || '';
  $('credit-b').textContent = names.slice(1).join(' and ');
  document.body.classList.toggle('mac', state.mac);
  if (!state.mac) {
    for (const n of document.querySelectorAll('[title]')) {
      n.title = n.title.replace('⇧⌘N', 'Ctrl+Shift+N').replace('⌘N', 'Ctrl+N').replace(' (⌘,)', '');
    }
  }
  wire();
  render();
}());
