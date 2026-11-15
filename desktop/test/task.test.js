'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer, makeData, sha } = require('./server');
const { DownloadTask } = require('../src/engine/task');

const MB = 1024 * 1024;
const FAST = { minSegment: 64 * 1024, retryBaseMs: 10, retryMaxMs: 60, maxRetries: 6, stallMs: 600 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'srot-task-'));
const fileSha = (p) => sha(fs.readFileSync(p));
const until = async (cond, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
};
const mk = (url, dir, spec = {}, opts = {}) => new DownloadTask({ id: 't', url, dir, connections: 4, ...spec }, { ...FAST, ...opts });

let srv; const data = makeData(3 * MB, 1); const small = makeData(300 * 1024, 2);
test.before(async () => { srv = await createServer({ 'big.bin': data, 'small.bin': small, 'doc': small }); });
test.after(async () => { await srv.close(); });

test('downloads with several connections and the file is byte-identical', async () => {
  const dir = tmp(); const t = mk(srv.url('ok', 'big.bin', { bps: 4 * MB }), dir);
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(fileSha(t.path), sha(data));
  assert.equal(t.path, path.join(dir, 'big.bin'));
  assert.deepEqual(fs.readdirSync(dir), ['big.bin'], 'no temp file left behind');
  assert.ok(srv.stats.maxActive >= 3, `used parallel connections (saw ${srv.stats.maxActive})`);
  assert.equal(t.downloaded, data.length);
});

test('server that ignores Range: falls back to one connection, file correct', async () => {
  const dir = tmp(); const t = mk(srv.url('norange', 'big.bin'), dir);
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(t.resumable, false);
  assert.equal(fileSha(t.path), sha(data));
});

test('unknown length (chunked): completes and reports the real size', async () => {
  const dir = tmp(); const t = mk(srv.url('chunked', 'big.bin'), dir);
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(t.size, data.length);
  assert.equal(fileSha(t.path), sha(data));
});

test('connection dropped mid-segment: retries from the exact byte', async () => {
  const dir = tmp(); const before = srv.stats.requests;
  const t = mk(srv.url('flaky', 'big.bin', { drop: 200000 }), dir, {}, { maxRetries: 50 });
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(fileSha(t.path), sha(data));
  assert.ok(srv.stats.requests - before > 10, 'had to reconnect many times');
});

test('server caps connections with 503: completes with fewer', async () => {
  const dir = tmp(); const t = mk(srv.url('cap', 'big.bin', { max: 2, bps: 6 * MB }), dir, { connections: 8 });
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(fileSha(t.path), sha(data));
});

test('pause then resume continues instead of starting over', async () => {
  const dir = tmp(); const url = srv.url('ok', 'big.bin', { bps: 1.5 * MB });
  const t = mk(url, dir);
  const run = t.start();
  await until(() => t.downloaded > 600 * 1024);
  await t.pause(); await run;
  assert.equal(t.status, 'paused');
  const atPause = t.downloaded;
  assert.ok(fs.existsSync(t.tempPath), 'partial file kept');
  const sentBefore = srv.stats.bytesSent;
  const t2 = new DownloadTask(JSON.parse(JSON.stringify(t.toJSON())), FAST);   // as if reloaded from disk
  await t2.start();
  assert.equal(t2.status, 'completed', t2.error);
  assert.equal(fileSha(t2.path), sha(data));
  const resent = srv.stats.bytesSent - sentBefore;
  assert.ok(resent <= data.length - atPause + 4096, `only the rest was fetched (${resent} vs ${data.length - atPause})`);
});

test('file changed on the server between pause and resume: restarts, never mixes', async () => {
  const dir = tmp(); const s2 = await createServer({ 'v.bin': makeData(2 * MB, 10) });
  try {
    const t = mk(s2.url('ok', 'v.bin', { bps: 1 * MB }), dir);
    const run = t.start();
    await until(() => t.downloaded > 400 * 1024);
    await t.pause(); await run;
    const v2 = makeData(2 * MB, 11); s2.state.files['v.bin'] = v2;
    const t2 = new DownloadTask(t.toJSON(), FAST);
    await t2.start();
    assert.equal(t2.status, 'completed', t2.error);
    assert.equal(fileSha(t2.path), sha(v2));
  } finally { await s2.close(); }
});

test('partial file deleted while paused: starts again cleanly', async () => {
  const dir = tmp(); const t = mk(srv.url('ok', 'big.bin', { bps: 1.5 * MB }), dir);
  const run = t.start();
  await until(() => t.downloaded > 300 * 1024);
  await t.pause(); await run;
  fs.unlinkSync(t.tempPath);
  const t2 = new DownloadTask(t.toJSON(), FAST);
  await t2.start();
  assert.equal(t2.status, 'completed', t2.error);
  assert.equal(fileSha(t2.path), sha(data));
});

test('redirect is followed and Content-Disposition names the file', async () => {
  const dir = tmp();
  const t = mk(`${srv.base}/ok/small.bin?cd=${encodeURIComponent('attachment; filename="Lecture 5.pdf"')}`, dir);
  await t.start();
  assert.equal(path.basename(t.path), 'Lecture 5.pdf');
  const r = mk(srv.url('redirect', 'small.bin'), dir);
  await r.start();
  assert.equal(r.status, 'completed', r.error);
  assert.equal(fileSha(r.path), sha(small));
});

test('hostile filename from the server stays inside the download folder', async () => {
  const dir = tmp();
  const t = mk(`${srv.base}/ok/small.bin?cd=${encodeURIComponent('attachment; filename="../../../evil.sh"')}`, dir);
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(path.dirname(t.path), dir);
  assert.equal(path.basename(t.path), 'evil.sh');
});

test('existing file is never overwritten: gets a numbered name', async () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'small.bin'), 'mine');
  const t = mk(srv.url('ok', 'small.bin'), dir);
  await t.start();
  assert.equal(path.basename(t.path), 'small (1).bin');
  assert.equal(fs.readFileSync(path.join(dir, 'small.bin'), 'utf8'), 'mine');
});

test('name without extension gets one from the content type', async () => {
  const dir = tmp(); const t = mk(srv.url('ok', 'doc', { type: 'application/pdf' }), dir);
  await t.start();
  assert.equal(path.basename(t.path), 'doc.pdf');
});

test('404: ends in error with a clear message and leaves nothing behind', async () => {
  const dir = tmp(); const t = mk(srv.url('ok', 'missing.bin'), dir);
  await t.start();
  assert.equal(t.status, 'error');
  assert.match(t.error, /404/);
  assert.equal(t.errorCode, 'http_404');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('stalled connection is detected and replaced', async () => {
  const dir = tmp(); const t = mk(srv.url('stall', 'big.bin'), dir);
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(fileSha(t.path), sha(data));
});

test('gzip-encoded response is stored decoded', async () => {
  const dir = tmp(); const t = mk(srv.url('gz', 'small.bin'), dir);
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(fileSha(t.path), sha(small));
});

test('expired link: fails with a link error, continues after the URL is replaced', async () => {
  const dir = tmp(); srv.state.validKeys.add('k1');
  const t = mk(srv.url('expire', 'big.bin', { key: 'k1', bps: 1.5 * MB }), dir);
  const run = t.start();
  await until(() => t.downloaded > 400 * 1024);
  await t.pause(); await run;
  srv.state.validKeys.delete('k1'); srv.state.validKeys.add('k2');
  const t2 = new DownloadTask(t.toJSON(), FAST);
  await t2.start();
  assert.equal(t2.status, 'error');
  assert.equal(t2.errorCode, 'http_403');
  const kept = t2.downloaded;
  assert.ok(kept >= 400 * 1024, 'progress kept after the failure');
  t2.setUrl(srv.url('expire', 'big.bin', { key: 'k2' }));
  await t2.start();
  assert.equal(t2.status, 'completed', t2.error);
  assert.equal(fileSha(t2.path), sha(data));
});

test('speed limit slows the download down', async () => {
  const dir = tmp(); const t = mk(srv.url('ok', 'small.bin'), dir, { speedLimit: 100 * 1024 });
  const t0 = Date.now();
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.ok(Date.now() - t0 >= 1200, `300 KB at 100 KB/s should take well over a second, took ${Date.now() - t0} ms`);
  assert.equal(fileSha(t.path), sha(small));
});

test('a slow part is taken over by faster connections', async () => {
  const dir = tmp();
  // Requests that begin in the first 750 KB crawl at 60 KB/s; alone that part would need ~12 s.
  const t = mk(srv.url('slowhead', 'big.bin', { below: 750 * 1024, slow: 60 * 1024 }), dir);
  const t0 = Date.now();
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(fileSha(t.path), sha(data));
  assert.ok(Date.now() - t0 < 9000, `finished in ${Date.now() - t0} ms`);
});

test('request carries the custom headers that were given', async () => {
  const dir = tmp();
  const t = mk(srv.url('ok', 'small.bin'), dir, { headers: { Cookie: 'sid=abc', Referer: 'https://example.com/page' } });
  await t.start();
  const last = srv.stats.headers[srv.stats.headers.length - 1];
  assert.equal(last.cookie, 'sid=abc');
  assert.equal(last.referer, 'https://example.com/page');
  assert.equal(last['accept-encoding'], 'identity');
});

test('servers that disagree about the ETag still get a parallel, resumable download', async () => {
  const dir = tmp(); const t = mk(srv.url('flipetag', 'big.bin', { bps: 4 * MB }), dir);
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(t.resumable, true, 'did not fall back to a single unresumable stream');
  assert.equal(fileSha(t.path), sha(data));
});
