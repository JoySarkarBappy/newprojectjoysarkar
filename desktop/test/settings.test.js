'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, sanitize } = require('../src/main/settings');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'srot-set-'));

test('first run: defaults plus a random 32-character pairing code that then stays the same', async () => {
  const dir = tmp();
  const a = new Settings(dir, { downloadDir: '/Users/x/Downloads' });
  assert.match(a.get().token, /^[a-f0-9]{32}$/);
  assert.equal(a.get().downloadDir, '/Users/x/Downloads');
  await a.save();
  assert.equal(new Settings(dir).get().token, a.get().token);
});
test('out-of-range and nonsense values are pulled back to safe ones', () => {
  const s = sanitize({ connections: 500, maxConcurrent: 0, port: 80, speedLimit: -5, window: { enabled: 'yes', start: '25:99', end: '7:05' }, videoQuality: 'huge' });
  assert.equal(s.connections, 32);
  assert.equal(s.maxConcurrent, 1);
  assert.equal(s.port, 1024);
  assert.equal(s.speedLimit, 0);
  assert.deepEqual(s.window, { enabled: true, start: '23:00', end: '7:05' });
  assert.equal(s.videoQuality, 'best');
});
test('set merges a partial change, keeps the rest, and persists', async () => {
  const dir = tmp(); const a = new Settings(dir);
  await a.set({ connections: 16, window: { enabled: true } });
  const b = new Settings(dir).get();
  assert.equal(b.connections, 16);
  assert.deepEqual(b.window, { enabled: true, start: '23:00', end: '07:00' });
  assert.equal(b.maxConcurrent, 3);
});

test('theme: follows the system until chosen, keeps a valid choice, ignores nonsense', async () => {
  const dir = tmp(); const a = new Settings(dir);
  assert.equal(a.get().theme, 'system');
  await a.set({ theme: 'dark' });
  assert.equal(new Settings(dir).get().theme, 'dark');
  await a.set({ theme: 'light' });
  assert.equal(new Settings(dir).get().theme, 'light');
  assert.equal(sanitize({ theme: 'purple' }).theme, 'system');
});
