'use strict';
// Runs the extension's background script against a fake `chrome` object and the real local API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createApi } = require('../src/main/server');

const TOKEN = 'c'.repeat(32);
const SRC = fs.readFileSync(path.join(__dirname, '..', 'extension', 'background.js'), 'utf8');

function fakeChrome(store) {
  const ev = () => { const fns = []; return { addListener: (f) => fns.push(f), fire: (...a) => Promise.all(fns.map((f) => f(...a))) }; };
  const calls = { cancel: [], erase: [], badge: [], menus: [] };
  const chrome = {
    calls,
    runtime: { onInstalled: ev(), onStartup: ev(), onMessage: ev(), openOptionsPage: () => { calls.options = true; } },
    storage: { local: { get: async (d) => ({ ...d, ...store }), set: async (v) => { Object.assign(store, v); } }, onChanged: ev() },
    downloads: {
      onCreated: ev(),
      cancel: async (id) => { calls.cancel.push(id); },
      erase: async (q) => { calls.erase.push(q.id); },
    },
    cookies: { getAll: async ({ url }) => (url.includes('files.example') ? [{ name: 'sid', value: 'abc' }, { name: 't', value: '1' }] : []) },
    contextMenus: { create: (m) => calls.menus.push(m.id), removeAll: (cb) => cb && cb(), onClicked: ev() },
    action: { setBadgeText: async (b) => { calls.badge.push(b.text); }, setBadgeBackgroundColor: async () => {} },
    tabs: { query: async () => [{ url: 'https://video.example/watch?v=9' }] },
  };
  return chrome;
}

async function boot(storeOverrides = {}, apiOverrides = {}) {
  const got = { add: [], video: [] };
  const server = createApi({
    version: '1.0.0', getToken: () => TOKEN,
    onAdd: async (i) => { got.add.push(i); return { id: 'x' }; },
    onVideo: async (i) => { got.video.push(i); return { id: 'v' }; },
    ...apiOverrides,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const store = { token: TOKEN, port: server.address().port, enabled: true, minSizeKB: 1024, ...storeOverrides };
  const chrome = fakeChrome(store);
  // The extension origin header is what a real browser would send.
  const fetchAsExtension = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), Origin: 'chrome-extension://testtesttest' } });
  const ctx = vm.createContext({ chrome, fetch: fetchAsExtension, navigator: { userAgent: 'TestBrowser/1' }, console, setTimeout, clearTimeout, URL, AbortController, self: {} });
  vm.runInContext(SRC, ctx);
  return { chrome, got, close: () => new Promise((r) => server.close(r)) };
}
const item = (over = {}) => ({ id: 7, url: 'https://files.example/big.zip', finalUrl: 'https://cdn.files.example/big.zip', referrer: 'https://files.example/page', filename: '', totalBytes: 50 * 1024 * 1024, state: 'in_progress', ...over });

test('a browser download is handed to the app with cookies and referrer, then cancelled in the browser', async () => {
  const x = await boot();
  try {
    await x.chrome.downloads.onCreated.fire(item());
    assert.equal(x.got.add.length, 1);
    assert.equal(x.got.add[0].url, 'https://cdn.files.example/big.zip');
    assert.deepEqual(x.got.add[0].headers, { Referer: 'https://files.example/page', Cookie: 'sid=abc; t=1', 'User-Agent': 'TestBrowser/1' });
    assert.deepEqual(x.chrome.calls.cancel, [7]);
    assert.deepEqual(x.chrome.calls.erase, [7]);
  } finally { await x.close(); }
});

test('when the app is not running the browser keeps its own download', async () => {
  const x = await boot();
  await x.close();
  await x.chrome.downloads.onCreated.fire(item());
  assert.deepEqual(x.chrome.calls.cancel, []);
});

test('when the app refuses the link the browser keeps its own download', async () => {
  const x = await boot({}, { onAdd: async () => { throw new Error('nope'); } });
  try {
    await x.chrome.downloads.onCreated.fire(item());
    assert.deepEqual(x.chrome.calls.cancel, []);
  } finally { await x.close(); }
});

test('nothing is captured when switched off, unpaired, too small, not a web link, or started by an extension', async () => {
  for (const [store, over] of [
    [{ enabled: false }, {}],
    [{ token: '' }, {}],
    [{}, { totalBytes: 200 * 1024 }],
    [{}, { url: 'blob:https://x/1', finalUrl: 'blob:https://x/1' }],
    [{}, { url: 'data:text/plain,hi', finalUrl: '' }],
    [{}, { byExtensionId: 'someotherextension' }],
    [{}, { state: 'complete' }],
  ]) {
    const x = await boot(store);
    try {
      await x.chrome.downloads.onCreated.fire(item(over));
      assert.equal(x.got.add.length, 0, JSON.stringify([store, over]));
      assert.deepEqual(x.chrome.calls.cancel, []);
    } finally { await x.close(); }
  }
});

test('unknown size is captured (many servers do not announce it up front)', async () => {
  const x = await boot();
  try {
    await x.chrome.downloads.onCreated.fire(item({ totalBytes: -1 }));
    assert.equal(x.got.add.length, 1);
  } finally { await x.close(); }
});

test('context menu: link goes to /add, page goes to /video', async () => {
  const x = await boot();
  try {
    await x.chrome.runtime.onInstalled.fire();
    assert.deepEqual(x.chrome.calls.menus.sort(), ['srot-link', 'srot-media', 'srot-page']);
    await x.chrome.contextMenus.onClicked.fire({ menuItemId: 'srot-link', linkUrl: 'https://files.example/a.pdf', pageUrl: 'https://files.example/p' }, {});
    assert.equal(x.got.add[0].url, 'https://files.example/a.pdf');
    await x.chrome.contextMenus.onClicked.fire({ menuItemId: 'srot-page', pageUrl: 'https://video.example/watch?v=1' }, {});
    assert.equal(x.got.video[0].url, 'https://video.example/watch?v=1');
    await x.chrome.contextMenus.onClicked.fire({ menuItemId: 'srot-media', srcUrl: 'blob:https://video.example/1', pageUrl: 'https://video.example/watch?v=2' }, {});
    assert.equal(x.got.video[1].url, 'https://video.example/watch?v=2', 'blob media falls back to the page link');
    await x.chrome.contextMenus.onClicked.fire({ menuItemId: 'srot-media', srcUrl: 'https://files.example/clip.mp4', pageUrl: 'https://files.example/p' }, {});
    assert.equal(x.got.add[1].url, 'https://files.example/clip.mp4');
  } finally { await x.close(); }
});

test('popup messages: status reports pairing, video sends the current tab', async () => {
  const x = await boot();
  try {
    const ask = (msg) => new Promise((resolve) => { x.chrome.runtime.onMessage.fire(msg, {}, (v) => resolve(JSON.parse(JSON.stringify(v)))); });
    assert.deepEqual(await ask({ type: 'status' }), { running: true, paired: true, enabled: true });
    assert.deepEqual(await ask({ type: 'video' }), { ok: true });
    assert.equal(x.got.video[0].url, 'https://video.example/watch?v=9');
  } finally { await x.close(); }
  const y = await boot({ token: 'd'.repeat(32) });
  try {
    const ask = (msg) => new Promise((resolve) => { y.chrome.runtime.onMessage.fire(msg, {}, (v) => resolve(JSON.parse(JSON.stringify(v)))); });
    assert.deepEqual(await ask({ type: 'status' }), { running: true, paired: false, enabled: true });
  } finally { await y.close(); }
});
