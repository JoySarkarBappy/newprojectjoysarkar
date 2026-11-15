'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApi } = require('../src/main/server');

const TOKEN = 'a'.repeat(32);
let server; let port; let added; let videos;

const call = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    let text = '';
    res.on('data', (c) => { text += c; });
    res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
  });
  req.on('error', reject);
  if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
  req.end();
});
const auth = { 'X-Srot-Token': TOKEN, 'Content-Type': 'application/json' };

test.before(async () => {
  server = createApi({
    version: '1.0.0', getToken: () => TOKEN,
    onAdd: async (item) => { added.push(item); return { id: 'new-id' }; },
    onVideo: async (item) => { videos.push(item); return { id: 'vid-id' }; },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.beforeEach(() => { added = []; videos = []; });
test.after(() => new Promise((r) => server.close(r)));

test('ping tells the extension the app is there and whether its code matches', async () => {
  const a = await call('/ping');
  assert.equal(a.status, 200);
  assert.deepEqual(a.json, { app: 'srot', version: '1.0.0', paired: false });
  const b = await call('/ping', { headers: auth });
  assert.equal(b.json.paired, true);
});

test('add is refused without the pairing code', async () => {
  const r = await call('/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { url: 'https://x.com/a.zip' } });
  assert.equal(r.status, 401);
  assert.equal(added.length, 0);
  const wrong = await call('/add', { method: 'POST', headers: { ...auth, 'X-Srot-Token': 'b'.repeat(32) }, body: { url: 'https://x.com/a.zip' } });
  assert.equal(wrong.status, 401);
});

test('add with the pairing code hands the link, name and browser headers to the app', async () => {
  const r = await call('/add', { method: 'POST', headers: auth, body: {
    url: 'https://x.com/a.zip', filename: 'a.zip', referrer: 'https://x.com/page', cookies: 'sid=1', userAgent: 'UA/1',
  } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, id: 'new-id' });
  assert.deepEqual(added[0], {
    url: 'https://x.com/a.zip', name: 'a.zip', source: 'https://x.com/page',
    headers: { Referer: 'https://x.com/page', Cookie: 'sid=1', 'User-Agent': 'UA/1' },
  });
});

test('video endpoint passes the page link on', async () => {
  const r = await call('/video', { method: 'POST', headers: auth, body: { url: 'https://video.example/watch?v=1' } });
  assert.deepEqual(r.json, { ok: true, id: 'vid-id' });
  assert.equal(videos[0].url, 'https://video.example/watch?v=1');
});

test('a web page cannot use the API even if it somehow knew the code', async () => {
  const r = await call('/add', { method: 'POST', headers: { ...auth, Origin: 'https://evil.example' }, body: { url: 'https://x.com/a.zip' } });
  assert.equal(r.status, 403);
  assert.equal(added.length, 0);
  const pre = await call('/add', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 403);
  assert.equal(pre.headers['access-control-allow-origin'], undefined);
});

test('the browser extension origin is allowed through CORS', async () => {
  const origin = 'chrome-extension://abcdefghijklmnop';
  const pre = await call('/add', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], origin);
  assert.match(pre.headers['access-control-allow-headers'], /x-srot-token/i);
  const r = await call('/add', { method: 'POST', headers: { ...auth, Origin: origin }, body: { url: 'https://x.com/a.zip' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], origin);
});

test('requests addressed to another host name are refused (DNS rebinding)', async () => {
  const r = await call('/ping', { headers: { Host: 'evil.example' } });
  assert.equal(r.status, 403);
});

test('only http and https links are accepted', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://x/y', 'javascript:alert(1)', '', 'not a url']) {
    const r = await call('/add', { method: 'POST', headers: auth, body: { url } });
    assert.equal(r.status, 400, url);
  }
  assert.equal(added.length, 0);
});

test('broken or oversized bodies are rejected', async () => {
  const bad = await call('/add', { method: 'POST', headers: auth, body: '{"url": ' });
  assert.equal(bad.status, 400);
  const big = await call('/add', { method: 'POST', headers: auth, body: JSON.stringify({ url: 'https://x.com/a', pad: 'x'.repeat(2 * 1024 * 1024) }) });
  assert.equal(big.status, 413);
});

test('unknown paths give 404, app errors give 500 with the message', async () => {
  assert.equal((await call('/nope', { headers: auth })).status, 404);
  const s2 = createApi({ version: '1', getToken: () => TOKEN, onAdd: async () => { throw new Error('Disk is on fire'); }, onVideo: async () => ({}) });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const p2 = s2.address().port;
  const r = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: p2, path: '/add', method: 'POST', headers: auth }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(t) }));
    });
    req.end(JSON.stringify({ url: 'https://x.com/a' }));
  });
  assert.equal(r.status, 500);
  assert.equal(r.json.error, 'Disk is on fire');
  await new Promise((res) => s2.close(res));
});
