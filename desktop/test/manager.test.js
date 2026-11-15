'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { createServer, makeData, sha } = require('./server');
const { Manager } = require('../src/engine/manager');

const MB = 1024 * 1024;
const FAST = { minSegment: 64 * 1024, retryBaseMs: 10, retryMaxMs: 40, maxRetries: 3, stallMs: 600 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'srot-mgr-'));
const fileSha = (p) => sha(fs.readFileSync(p));
const until = async (cond, ms = 10000) => {
  const t0 = Date.now();
  while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 15)); }
};
const mkManager = (extra = {}, settings = {}) => {
  const dataDir = extra.dataDir || tmp(); const dir = settings.downloadDir || tmp();
  const m = new Manager({ dataDir, taskOpts: FAST, tickMs: 25, persistMs: 100, ...extra, settings: { downloadDir: dir, connections: 4, ...settings } });
  return { m, dataDir, dir };
};
const get = (m, id) => m.snapshot().tasks.find((t) => t.id === id);

let srv; const data = makeData(2 * MB, 21); const small = makeData(200 * 1024, 22);
test.before(async () => { srv = await createServer({ 'a.bin': data, 'b.bin': small, 'c.bin': small, 'd.bin': small }); });
test.after(async () => { await srv.close(); });

test('queue never runs more downloads at once than allowed', async () => {
  const { m } = mkManager({}, { maxConcurrent: 1 });
  await m.load(); m.start();
  let peak = 0;
  m.on('update', (s) => { peak = Math.max(peak, s.tasks.filter((t) => t.status === 'downloading').length); });
  const ids = ['b.bin', 'c.bin', 'd.bin'].map((n) => m.add({ url: srv.url('ok', n, { bps: 800 * 1024 }) }).id);
  await until(() => ids.every((id) => get(m, id).status === 'completed'));
  assert.equal(peak, 1);
  const done = ids.map((id) => get(m, id).completedAt);
  assert.ok(done[0] <= done[1] && done[1] <= done[2], 'finished in queue order');
  await m.shutdown();
});

test('paused download survives a restart of the app and then finishes', async () => {
  const { m, dataDir, dir } = mkManager();
  await m.load(); m.start();
  const id = m.add({ url: srv.url('ok', 'a.bin', { bps: 1 * MB }) }).id;
  await until(() => get(m, id).downloaded > 300 * 1024);
  await m.pause(id);
  assert.equal(get(m, id).status, 'paused');
  const kept = get(m, id).downloaded;
  await m.shutdown();

  const { m: m2 } = mkManager({ dataDir }, { downloadDir: dir });
  await m2.load(); m2.start();
  const again = get(m2, id);
  assert.equal(again.status, 'paused', 'still paused, not auto-started');
  assert.equal(again.downloaded, kept);
  m2.resume(id);
  await until(() => get(m2, id).status === 'completed');
  assert.equal(fileSha(get(m2, id).path), sha(data));
  await m2.shutdown();
});

test('scheduled download waits for its time', async () => {
  let now = 1_000_000;
  const { m } = mkManager({ now: () => now });
  await m.load(); m.start();
  const id = m.add({ url: srv.url('ok', 'b.bin'), scheduleAt: now + 60_000 }).id;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(get(m, id).status, 'scheduled');
  now += 61_000;
  await until(() => get(m, id).status === 'completed');
  await m.shutdown();
});

test('outside the allowed hours nothing starts, but "start now" overrides', async () => {
  const noon = new Date(2026, 0, 5, 12, 0, 0).getTime();
  const { m } = mkManager({ now: () => noon }, { window: { enabled: true, start: '23:00', end: '07:00' } });
  await m.load(); m.start();
  const id = m.add({ url: srv.url('ok', 'b.bin') }).id;
  const id2 = m.add({ url: srv.url('ok', 'c.bin') }).id;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(get(m, id).status, 'queued');
  m.startNow(id2);
  await until(() => get(m, id2).status === 'completed');
  assert.equal(get(m, id).status, 'queued');
  await m.shutdown();
});

test('inside overnight hours downloads run', async () => {
  const night = new Date(2026, 0, 5, 2, 30, 0).getTime();
  const { m } = mkManager({ now: () => night }, { window: { enabled: true, start: '23:00', end: '07:00' } });
  await m.load(); m.start();
  const id = m.add({ url: srv.url('ok', 'b.bin') }).id;
  await until(() => get(m, id).status === 'completed');
  await m.shutdown();
});

test('temporary server outage: retried automatically and completes', async () => {
  const { m } = mkManager({}, { autoRetry: 5, autoRetryDelayMs: 60 });
  await m.load(); m.start();
  srv.state.down = true;
  const id = m.add({ url: srv.url('down', 'b.bin') }).id;
  await until(() => get(m, id).status === 'error');
  assert.ok(get(m, id).retryAt, 'a retry is planned');
  srv.state.down = false;
  await until(() => get(m, id).status === 'completed');
  assert.equal(fileSha(get(m, id).path), sha(small));
  await m.shutdown();
});

test('missing file (404) is reported as failed, not retried forever', async () => {
  const { m } = mkManager({}, { autoRetry: 5, autoRetryDelayMs: 30 });
  await m.load(); m.start();
  const failed = [];
  m.on('failed', (t) => failed.push(t.id));
  const id = m.add({ url: srv.url('ok', 'nope.bin') }).id;
  await until(() => failed.includes(id));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(get(m, id).status, 'error');
  assert.equal(get(m, id).retryAt, null);
  await m.shutdown();
});

test('removing an unfinished download deletes its partial file', async () => {
  const { m, dir } = mkManager();
  await m.load(); m.start();
  const id = m.add({ url: srv.url('ok', 'a.bin', { bps: 1 * MB }) }).id;
  await until(() => get(m, id).downloaded > 100 * 1024);
  await m.remove(id);
  assert.equal(get(m, id), undefined);
  assert.deepEqual(fs.readdirSync(dir), []);
  await m.shutdown();
});

test('removing a finished download keeps the file unless asked to delete it', async () => {
  const { m, dir } = mkManager();
  await m.load(); m.start();
  const a = m.add({ url: srv.url('ok', 'b.bin') }).id;
  const b = m.add({ url: srv.url('ok', 'c.bin') }).id;
  await until(() => get(m, a).status === 'completed' && get(m, b).status === 'completed');
  await m.remove(a);
  await m.remove(b, { deleteFile: true });
  assert.deepEqual(fs.readdirSync(dir), ['b.bin']);
  await m.shutdown();
});

test('adding the same link twice does not create a second download', async () => {
  const { m } = mkManager({}, { window: { enabled: true, start: '00:00', end: '00:01' } });
  await m.load();
  const url = srv.url('ok', 'b.bin');
  const first = m.add({ url });
  const second = m.add({ url });
  assert.equal(second.id, first.id);
  assert.equal(second.duplicate, true);
  assert.equal(m.snapshot().tasks.length, 1);
  await m.shutdown();
});

test('moving a download up changes what starts next', async () => {
  const { m } = mkManager({}, { maxConcurrent: 1 });
  await m.load();
  const a = m.add({ url: srv.url('ok', 'b.bin', { bps: 600 * 1024 }) }).id;
  const b = m.add({ url: srv.url('ok', 'c.bin', { bps: 600 * 1024 }) }).id;
  const c = m.add({ url: srv.url('ok', 'd.bin', { bps: 600 * 1024 }) }).id;
  m.move(c, -2);
  assert.deepEqual(m.snapshot().tasks.map((t) => t.id), [c, a, b]);
  m.start();
  await until(() => [a, b, c].every((id) => get(m, id).status === 'completed'));
  assert.ok(get(m, c).completedAt <= get(m, a).completedAt);
  await m.shutdown();
});

test('global speed limit is shared by all downloads', async () => {
  const { m } = mkManager({}, { speedLimit: 150 * 1024, maxConcurrent: 3 });
  await m.load(); m.start();
  const t0 = Date.now();
  const ids = ['b.bin', 'c.bin'].map((n) => m.add({ url: srv.url('ok', n) }).id);
  await until(() => ids.every((id) => get(m, id).status === 'completed'));
  assert.ok(Date.now() - t0 >= 1200, `400 KB at 150 KB/s took ${Date.now() - t0} ms`);
  await m.shutdown();
});

test('process killed mid-download: next start resumes and the file is intact', async () => {
  const dataDir = tmp(); const dir = tmp();
  const url = srv.url('ok', 'a.bin', { bps: 700 * 1024 });
  const child = fork(path.join(__dirname, 'crash-child.js'), [dataDir, dir, url], { stdio: 'ignore' });
  const state = path.join(dataDir, 'downloads.json');
  const savedBytes = () => {
    try {
      const t = JSON.parse(fs.readFileSync(state, 'utf8')).tasks[0];
      return t.segments.reduce((a, g) => a + (g.pos - g.start), 0);
    } catch { return 0; }
  };
  await until(() => savedBytes() > 500 * 1024);
  child.kill('SIGKILL');
  await new Promise((r) => child.on('exit', r));
  const saved = savedBytes();
  assert.ok(saved > 500 * 1024 && saved < data.length, 'killed in the middle');

  const sentBefore = srv.stats.bytesSent;
  const { m } = mkManager({ dataDir }, { downloadDir: dir });
  await m.load(); m.start();
  const id = m.snapshot().tasks[0].id;
  await until(() => get(m, id).status === 'completed');
  assert.equal(fileSha(get(m, id).path), sha(data));
  const resent = srv.stats.bytesSent - sentBefore;
  assert.ok(resent <= data.length - saved + 4096, `resumed from saved progress (${resent} re-sent, ${data.length - saved} were missing)`);
  await m.shutdown();
});

test('running download is put back in the queue when the allowed hours end, and continues later', async () => {
  let now = new Date(2026, 0, 5, 2, 30, 0).getTime();
  const { m } = mkManager({ now: () => now }, { window: { enabled: true, start: '23:00', end: '07:00' } });
  await m.load(); m.start();
  const id = m.add({ url: srv.url('ok', 'a.bin', { bps: 1 * MB }) }).id;
  await until(() => get(m, id).downloaded > 300 * 1024);
  now = new Date(2026, 0, 5, 12, 0, 0).getTime();
  await until(() => get(m, id).status === 'queued');
  const kept = get(m, id).downloaded;
  assert.ok(kept > 300 * 1024 && kept < data.length);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(get(m, id).downloaded, kept, 'nothing moves outside the hours');
  now = new Date(2026, 0, 5, 23, 30, 0).getTime();
  await until(() => get(m, id).status === 'completed');
  assert.equal(fileSha(get(m, id).path), sha(data));
  await m.shutdown();
});

test('quitting while a save is in flight still records the final state', async () => {
  const { m, dataDir } = mkManager();
  await m.load(); m.start();
  const id = m.add({ url: srv.url('ok', 'a.bin', { bps: 1 * MB }) }).id;
  await until(() => get(m, id).downloaded > 200 * 1024);
  m._persist();                                   // a save starts...
  await m.shutdown();                             // ...and the app quits right behind it
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'downloads.json'), 'utf8')).tasks[0];
  assert.equal(saved.status, 'queued');
  const bytes = saved.segments.reduce((a, g) => a + (g.pos - g.start), 0);
  assert.equal(bytes, get(m, id).downloaded, 'saved progress equals what was written at quit');
});
