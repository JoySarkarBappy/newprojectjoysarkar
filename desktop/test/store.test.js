const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../src/engine/store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'srot-store-'));

test('write then read returns the same data and leaves no temp file', async () => {
  const dir = tmp(); const file = path.join(dir, 'a.json');
  await store.writeJsonAtomic(file, { a: 1, b: ['x'] });
  assert.deepEqual(store.readJson(file, null), { a: 1, b: ['x'] });
  assert.deepEqual(fs.readdirSync(dir), ['a.json']);
});
test('missing file gives the fallback', () => {
  assert.deepEqual(store.readJson(path.join(tmp(), 'nope.json'), { d: 1 }), { d: 1 });
});
test('corrupt file gives the fallback and is kept aside, not destroyed', () => {
  const dir = tmp(); const file = path.join(dir, 'a.json');
  fs.writeFileSync(file, '{"a": 1, "b"');
  assert.deepEqual(store.readJson(file, []), []);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('a.json.corrupt')));
});
test('concurrent writes do not interleave; last one wins', async () => {
  const dir = tmp(); const file = path.join(dir, 'a.json');
  await Promise.all([1, 2, 3, 4, 5].map((n) => store.writeJsonAtomic(file, { n })));
  assert.deepEqual(store.readJson(file, null), { n: 5 });
});
