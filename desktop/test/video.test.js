'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createServer } = require('./server');
const { VideoTask, buildArgs, parseProgress, killCommand } = require('../src/engine/video');
const tools = require('../src/engine/ytdlp');

const FAKE = path.join(__dirname, 'fake-ytdlp.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'srot-video-'));
const until = async (cond, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 10)); }
};
const mk = (url, dir, spec = {}, opts = {}) => new VideoTask({ id: 'v', url, dir, ...spec }, { ytdlp: () => FAKE, ffmpeg: () => null, ...opts });
const fmt = (args) => args[args.indexOf('-f') + 1];

test('format: with ffmpeg, picks separate best video and audio up to the chosen height', () => {
  const a = buildArgs({ url: 'https://v/x', dir: '/d', quality: '720' }, { ffmpeg: '/bin/ffmpeg' });
  assert.equal(fmt(a), 'bv*[height<=720]+ba/b[height<=720]/b');
  assert.ok(a.includes('--ffmpeg-location'));
  assert.equal(a[a.length - 1], 'https://v/x');
});
test('format: without ffmpeg, only asks for ready-made single files', () => {
  const a = buildArgs({ url: 'https://v/x', dir: '/d', quality: '720' }, { ffmpeg: null });
  assert.equal(fmt(a), 'b[height<=720]/b');
  assert.ok(!a.includes('--ffmpeg-location'));
});
test('format: best quality', () => {
  assert.equal(fmt(buildArgs({ url: 'u', dir: '/d', quality: 'best' }, { ffmpeg: '/f' })), 'bv*+ba/b');
  assert.equal(fmt(buildArgs({ url: 'u', dir: '/d', quality: 'best' }, { ffmpeg: null })), 'b');
});
test('format: audio only converts to mp3 when ffmpeg exists, otherwise takes m4a as-is', () => {
  const withF = buildArgs({ url: 'u', dir: '/d', quality: 'audio' }, { ffmpeg: '/f' });
  assert.ok(withF.includes('-x') && withF.includes('mp3'));
  const without = buildArgs({ url: 'u', dir: '/d', quality: 'audio' }, { ffmpeg: null });
  assert.equal(fmt(without), 'ba[ext=m4a]/ba/b');
  assert.ok(!without.includes('-x'));
});
test('args: playlist only when asked, speed limit passed through, url is last and cannot be read as a flag', () => {
  const a = buildArgs({ url: 'https://v/x', dir: '/d', quality: 'best', speedLimit: 500000 }, { ffmpeg: null });
  assert.ok(a.includes('--no-playlist'));
  assert.equal(a[a.indexOf('-r') + 1], '500000');
  assert.equal(a[a.length - 2], '--');
  const j = buildArgs({ url: 'https://v/x', dir: '/d', quality: 'best' }, { ffmpeg: null, jsRuntime: 'node:/opt/node' });
  assert.equal(j[j.indexOf('--js-runtimes') + 1], 'node:/opt/node');
  const p = buildArgs({ url: 'https://v/x', dir: '/d', quality: 'best', playlist: true }, { ffmpeg: null });
  assert.ok(p.includes('--yes-playlist'));
});

test('parseProgress: numbers, NA and estimates', () => {
  assert.deepEqual(parseProgress('SROT|100|1000|NA|250.5|4'), { downloaded: 100, total: 1000, speed: 251, eta: 4 });
  assert.deepEqual(parseProgress('SROT|100|NA|2000.7|NA|NA'), { downloaded: 100, total: 2001, speed: 0, eta: null });
  assert.equal(parseProgress('[download] something else'), null);
});

test('downloads a video: title, final file and progress are picked up', async () => {
  const dir = tmp(); const t = mk('https://video.example/watch?v=1', dir, { quality: '720' });
  await t.start();
  assert.equal(t.status, 'completed', t.error);
  assert.equal(t.title, 'Test Lecture: Phase Diagrams');
  assert.equal(path.basename(t.path), 'Test Lecture_ Phase Diagrams [abc123].mp4');
  assert.ok(fs.existsSync(t.path));
  assert.equal(t.downloaded, 1000000);
  assert.equal(t.size, 1000000);
});

test('video support not installed: clear error instead of a crash', async () => {
  const t = mk('https://video.example/watch?v=1', tmp(), {}, { ytdlp: () => null });
  await t.start();
  assert.equal(t.status, 'error');
  assert.equal(t.errorCode, 'tool_missing');
});

test('site error is shown in plain words', async () => {
  const t = mk('https://video.example/unavailable', tmp());
  await t.start();
  assert.equal(t.status, 'error');
  assert.equal(t.errorCode, 'video_error');
  assert.equal(t.error, 'Video unavailable');
});

test('pause stops the helper process; resume continues from the partial file', async () => {
  const dir = tmp(); const t = mk('https://video.example/slow', dir);
  const run = t.start();
  await until(() => t.downloaded >= 300000);
  await t.pause(); await run;
  assert.equal(t.status, 'paused');
  const kept = t.downloaded;
  assert.ok(kept >= 300000 && kept < 1000000);
  const t2 = new VideoTask(JSON.parse(JSON.stringify(t.toJSON())), { ytdlp: () => FAKE, ffmpeg: () => null });
  assert.equal(t2.downloaded, kept, 'progress shown after reload');
  await t2.start();
  assert.equal(t2.status, 'completed', t2.error);
  const args = JSON.parse(fs.readFileSync(path.join(dir, 'fake-args.json'), 'utf8'));
  assert.ok(args.includes('--continue'));
});

test('discard removes leftover partial files of that video only', async () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'other.mp4.part'), 'keep');
  const t = mk('https://video.example/slow', dir);
  const run = t.start();
  await until(() => t.downloaded >= 200000);
  await t.discard(); await run;
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n !== 'fake-args.json'), ['other.mp4.part']);
});

test('probeVideo: title and available heights, highest first', async () => {
  const info = await tools.probeVideo(FAKE, 'https://video.example/watch?v=1');
  assert.equal(info.title, 'Test Lecture: Phase Diagrams');
  assert.deepEqual(info.heights, [1080, 720, 360]);
  assert.equal(info.duration, 600);
});
test('probeVideo: failure carries the site message', async () => {
  await assert.rejects(tools.probeVideo(FAKE, 'https://video.example/unavailable'), /Video unavailable/);
});

test('findTool: prefers the copy in the app data folder, null when absent', () => {
  const dataDir = tmp();
  assert.equal(tools.findTool('yt-dlp', dataDir, []), null);
  fs.mkdirSync(path.join(dataDir, 'bin'));
  const p = path.join(dataDir, 'bin', 'yt-dlp'); fs.writeFileSync(p, '#!/bin/sh\n'); fs.chmodSync(p, 0o755);
  assert.equal(tools.findTool('yt-dlp', dataDir, []), p);
});

test('installTool: downloads, unpacks .gz when needed and marks the file executable', async () => {
  const body = Buffer.from('#!/bin/sh\necho hi\n');
  const srv = await createServer({ 'yt-dlp_test': body, 'ffmpeg.gz': zlib.gzipSync(body) });
  try {
    const dataDir = tmp();
    const a = await tools.installTool('yt-dlp', dataDir, { url: srv.url('ok', 'yt-dlp_test') });
    const b = await tools.installTool('ffmpeg', dataDir, { url: srv.url('ok', 'ffmpeg.gz') });
    for (const p of [a, b]) {
      assert.deepEqual(fs.readFileSync(p), body);
      assert.ok(fs.statSync(p).mode & 0o100, 'executable');
    }
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'bin')).sort(), ['ffmpeg', 'yt-dlp']);
  } finally { await srv.close(); }
});

test('stopping the helper on Windows also stops the processes it started; elsewhere a plain signal is used', () => {
  assert.deepEqual(killCommand('win32', 4321), ['taskkill', ['/pid', '4321', '/T', '/F']]);
  assert.equal(killCommand('darwin', 4321), null);
  assert.equal(killCommand('linux', 4321), null);
});
