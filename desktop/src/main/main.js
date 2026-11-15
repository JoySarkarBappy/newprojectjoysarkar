'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, powerSaveBlocker, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Manager } = require('../engine/manager');
const { VideoTask } = require('../engine/video');
const { probe } = require('../engine/probe');
const tools = require('../engine/ytdlp');
const { Settings } = require('./settings');
const { createApi } = require('./server');

const TEST = process.env.SROT_TEST === '1' && !app.isPackaged;
const CREDIT = 'Joy Sarkar and Dhrubo Das';
const MAC = process.platform === 'darwin';
if (process.env.SROT_DATA_DIR) app.setPath('userData', process.env.SROT_DATA_DIR);
if (TEST) app.disableHardwareAcceleration();

let win = null;
let manager = null;
let settings = null;
let api = null;
let apiError = null;
let blocker = null;
let quitting = false;
const versions = new Map();

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const dataDir = () => app.getPath('userData');
const publicSettings = () => ({ ...settings.get(), apiError, version: app.getVersion(), platform: process.platform, credit: CREDIT });
const isWebUrl = (s) => { try { return /^https?:$/.test(new URL(s).protocol); } catch { return false; } };

// ---- helpers for video sites -------------------------------------------------------------------

/** yt-dlp needs a JavaScript runtime for some sites. Offer deno if the user has it, and always this app's own Node. */
function jsRuntime() {
  const specs = [];
  const home = app.getPath('home');
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.deno', 'bin')]) {
    const p = path.join(dir, 'deno');
    if (fs.existsSync(p)) { specs.push(`deno:${p}`); break; }
  }
  let node = process.execPath;
  if (process.platform === 'darwin') {
    const base = path.basename(process.execPath);
    const helper = path.join(path.dirname(process.execPath), '..', 'Frameworks', `${base} Helper.app`, 'Contents', 'MacOS', `${base} Helper`);
    if (fs.existsSync(helper)) node = helper;            // the helper has no Dock icon
  }
  specs.push(`node:${node}`);
  return { spec: specs, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

async function toolsStatus() {
  const out = {};
  for (const name of ['yt-dlp', 'ffmpeg']) {
    const p = tools.findTool(name, dataDir());
    let version = null;
    if (p && name === 'yt-dlp') {
      if (!versions.has(p)) versions.set(p, await tools.toolVersion(p));
      version = versions.get(p);
    }
    out[name] = { path: p, version, own: !!p && p.startsWith(dataDir()) };
  }
  return out;
}

// ---- window ------------------------------------------------------------------------------------

const paperColor = () => (nativeTheme.shouldUseDarkColors ? '#0E181D' : '#F4F7F8');

/** Light, dark, or whatever the computer is set to. The page's colours follow this through prefers-color-scheme. */
function applyTheme() {
  nativeTheme.themeSource = settings.get().theme;
  if (win && !win.isDestroyed()) win.setBackgroundColor(paperColor());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1120, height: 720, minWidth: 880, minHeight: 540,
    title: 'Srot',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 19, y: 19 },
    backgroundColor: paperColor(),
    show: false,
    autoHideMenuBar: true,
    ...(MAC ? {} : { icon: path.join(__dirname, '..', 'assets', 'icon.png') }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (isWebUrl(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('close', (e) => {
    if (quitting) return;
    if (MAC) { e.preventDefault(); win.hide(); return; }               // on a Mac the app lives on in the Dock
    const active = manager ? manager.snapshot().active : 0;
    if (!active) return;                                               // nothing running: closing the window quits
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Keep downloading', 'Quit'], defaultId: 0, cancelId: 0, title: 'Srot',
      message: active === 1 ? '1 download is still running' : `${active} downloads are still running`,
      detail: 'Srot has to stay open to keep downloading. If you quit, unfinished downloads continue the next time you open it.',
    });
    if (choice === 0) win.minimize(); else app.quit();
  });
  win.on('closed', () => { win = null; });
}

function showWindow() {
  if (!win) createWindow();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  const template = [
    ...(mac ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => { showWindow(); send('ui:settings'); } },
        { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Add Link…', accelerator: 'CmdOrCtrl+N', click: () => { showWindow(); send('ui:add', {}); } },
        { label: 'Add Video…', accelerator: 'CmdOrCtrl+Shift+N', click: () => { showWindow(); send('ui:video', {}); } },
        ...(mac ? [] : [{ type: 'separator' }, { label: 'Settings…', click: () => send('ui:settings') }, { role: 'quit' }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'windowMenu' },
    ...(mac ? [] : [{
      label: 'Help',
      submenu: [{
        label: 'About Srot',
        click: () => dialog.showMessageBox(win, {
          type: 'info', title: 'About Srot', message: `Srot Download Manager ${app.getVersion()}`, detail: `Developed by ${CREDIT}`,
        }),
      }],
    }]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- local API for the browser extension -------------------------------------------------------

function startApi() {
  if (api) { api.close(); api = null; }
  apiError = null;
  const port = settings.get().port;
  const server = createApi({
    version: app.getVersion(),
    getToken: () => settings.get().token,
    onAdd: async (item) => {
      const view = manager.add(item);
      send('toast', { text: view.duplicate ? `Already in the list: ${view.name}` : `Added from browser: ${view.name}` });
      return { id: view.id };
    },
    onVideo: async ({ url }) => {
      const view = manager.add({ kind: 'video', url, quality: settings.get().videoQuality });
      send('toast', { text: 'Video added from browser' });
      return { id: view.id };
    },
  });
  server.on('error', (e) => {
    apiError = e.code === 'EADDRINUSE' ? `Port ${port} is used by another program. Choose another port.` : e.message;
    send('settings', publicSettings());
  });
  server.listen(port, '127.0.0.1');
  api = server;
}

// ---- reacting to download activity -------------------------------------------------------------

function onUpdate(snap) {
  send('update', snap);
  const active = snap.tasks.filter((t) => t.status === 'downloading');
  if (app.dock) app.dock.setBadge(active.length ? String(active.length) : '');
  if (win && !win.isDestroyed()) {
    const sized = active.filter((t) => t.size > 0);
    const total = sized.reduce((a, t) => a + t.size, 0);
    const done = sized.reduce((a, t) => a + t.downloaded, 0);
    win.setProgressBar(!active.length ? -1 : total > 0 ? Math.min(1, done / total) : 2);
  }
  const want = active.length > 0 && settings.get().keepAwake;
  if (want && blocker == null) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!want && blocker != null) { powerSaveBlocker.stop(blocker); blocker = null; }
}

function notify(title, view, reveal) {
  if (!settings.get().notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body: view.name || '' });
  if (reveal && view.path) n.on('click', () => shell.showItemInFolder(view.path));
  n.show();
}

// ---- commands from the window ------------------------------------------------------------------

function registerIpc() {
  const h = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => fn(...args));
  const each = async (ids, fn) => { for (const id of [].concat(ids || [])) await fn(String(id)); };

  h('app:init', async () => ({ settings: publicSettings(), snapshot: manager.snapshot() }));

  h('dl:add', async (req) => {
    const urls = [].concat((req && req.urls) || []).map((u) => String(u).trim()).filter(Boolean).slice(0, 500);
    return urls.map((url) => {
      try {
        const view = manager.add({
          url,
          dir: req.dir || undefined,
          connections: req.connections || undefined,
          scheduleAt: req.scheduleAt || undefined,
          paused: !!req.paused,
          name: urls.length === 1 && req.name ? String(req.name) : undefined,
        });
        return { ok: true, id: view.id, duplicate: !!view.duplicate, name: view.name };
      } catch (e) { return { ok: false, url, error: e.message }; }
    });
  });

  h('dl:probe', async (url) => {
    try {
      const info = await probe(String(url), {}, { timeout: 15000 });
      return { ok: true, name: info.filename, size: info.size, resumable: info.resumable };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  h('dl:pause', (ids) => each(ids, (id) => manager.pause(id)));
  h('dl:resume', (ids) => each(ids, (id) => manager.resume(id)));
  h('dl:startNow', (ids) => each(ids, (id) => manager.startNow(id)));
  h('dl:remove', (ids, deleteFile) => each(ids, (id) => manager.remove(id, { deleteFile: !!deleteFile })));
  h('dl:move', (id, delta) => manager.move(String(id), Number(delta) || 0));
  h('dl:pauseAll', () => manager.pauseAll());
  h('dl:resumeAll', () => manager.resumeAll());
  h('dl:clearFinished', () => manager.clearCompleted());
  h('dl:schedule', (id, when) => manager.schedule(String(id), when ? Number(when) : null));
  h('dl:detail', (id) => manager.detail(String(id)));
  h('dl:updateUrl', (id, url) => {
    try { manager.updateUrl(String(id), String(url)); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });

  h('file:open', async (id) => {
    const d = manager.detail(String(id));
    if (!d || d.status !== 'completed' || !d.path || !fs.existsSync(d.path)) return { ok: false, error: 'The file is no longer where it was saved' };
    const err = await shell.openPath(d.path);
    return err ? { ok: false, error: err } : { ok: true };
  });
  h('file:reveal', async (id) => {
    const d = manager.detail(String(id));
    if (!d) return;
    if (d.status === 'completed' && d.path && fs.existsSync(d.path)) shell.showItemInFolder(d.path);
    else if (d.dir) await shell.openPath(d.dir);
  });
  h('dialog:folder', async (current) => {
    const r = await dialog.showOpenDialog(win, { defaultPath: current || settings.get().downloadDir, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  h('settings:set', async (patch) => {
    const before = settings.get().port;
    await settings.set(patch || {});
    manager.updateSettings(settings.get());
    applyTheme();
    if (settings.get().port !== before) startApi();
    return publicSettings();
  });

  h('video:probe', async (url) => {
    const bin = tools.findTool('yt-dlp', dataDir());
    if (!bin) return { ok: false, missing: true };
    try {
      const rt = jsRuntime();
      const info = await tools.probeVideo(bin, String(url), { env: rt.env, jsRuntime: rt.spec });
      return { ok: true, info, hasFfmpeg: !!tools.findTool('ffmpeg', dataDir()) };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  h('video:add', async (req) => {
    try {
      const view = manager.add({
        kind: 'video', url: String(req.url), quality: req.quality || settings.get().videoQuality,
        playlist: !!req.playlist, dir: req.dir || undefined, title: req.title || undefined,
      });
      return { ok: true, id: view.id, duplicate: !!view.duplicate };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  h('tools:status', () => toolsStatus());
  h('tools:install', async (name) => {
    if (name !== 'yt-dlp' && name !== 'ffmpeg') return { ok: false, error: 'Unknown tool' };
    try {
      const p = await tools.installTool(name, dataDir(), {
        onProgress: (downloaded, size) => send('tools:progress', { name, downloaded, size }),
      });
      versions.clear();
      return { ok: true, path: p };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  h('tools:update', async () => {
    const bin = tools.findTool('yt-dlp', dataDir());
    if (!bin) return { ok: false, error: 'Not installed' };
    try { const message = await tools.updateYtDlp(bin); versions.clear(); return { ok: true, message }; } catch (e) { return { ok: false, error: e.message }; }
  });

  h('ext:export', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose where to put the browser extension folder', defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Save here',
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const dest = path.join(r.filePaths[0], 'Srot Browser Extension');
    try {
      fs.cpSync(path.join(__dirname, '..', '..', 'extension'), dest, { recursive: true, force: true });
      shell.showItemInFolder(dest);
      return { ok: true, path: dest };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  h('clipboard:write', (text) => clipboard.writeText(String(text)));
  h('clipboard:url', async () => {
    let text = '';
    try { text = await clipboard.readText(); } catch { /* clipboard unavailable */ }
    const lines = String(text || '').split(/\s+/).filter(isWebUrl);
    return lines.length ? lines.slice(0, 100).join('\n') : null;
  });
}

// ---- startup -----------------------------------------------------------------------------------

async function main() {
  await app.whenReady();
  if (process.platform === 'win32') app.setAppUserModelId('app.srot.downloadmanager');   // needed for notifications
  app.setAboutPanelOptions({
    applicationName: 'Srot', applicationVersion: app.getVersion(),
    credits: `Developed by ${CREDIT}`, copyright: `Developed by ${CREDIT}`,
  });
  settings = new Settings(dataDir(), { downloadDir: app.getPath('downloads') });
  if (!settings.get().downloadDir) await settings.set({ downloadDir: app.getPath('downloads') });
  await settings.save();
  applyTheme();

  manager = new Manager({
    dataDir: dataDir(),
    settings: settings.get(),
    kinds: { video: VideoTask },
    taskOpts: {
      ytdlp: () => tools.findTool('yt-dlp', dataDir()),
      ffmpeg: () => tools.findTool('ffmpeg', dataDir()),
      jsRuntime,
    },
  });
  await manager.load();
  manager.on('update', onUpdate);
  manager.on('completed', (view) => notify('Download finished', view, true));
  manager.on('failed', (view) => notify('Download failed', view, false));

  registerIpc();
  buildMenu();
  startApi();
  createWindow();
  manager.start();

  if (TEST && process.env.SROT_TEST_SCRIPT) require(process.env.SROT_TEST_SCRIPT)({ app, manager, settings, getWindow: () => win });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    quitting = true;
    const done = () => { if (api) api.close(); app.quit(); };
    (manager ? manager.shutdown() : Promise.resolve()).then(done, done);
  });
  main().catch((e) => { dialog.showErrorBox('Srot could not start', String((e && e.stack) || e)); app.exit(1); });
}
