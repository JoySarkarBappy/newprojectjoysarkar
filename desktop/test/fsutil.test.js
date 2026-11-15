'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renameWithRetry } = require('../src/engine/fsutil');

const failing = (codes) => { let n = 0; const fn = async () => { const c = codes[n++]; if (c) throw Object.assign(new Error(c), { code: c }); }; fn.calls = () => n; return fn; };

test('rename: a file briefly locked by another program (antivirus, indexer) is retried until it works', async () => {
  const rename = failing(['EPERM', 'EBUSY', null]);
  await renameWithRetry('a', 'b', { delayMs: 1, rename });
  assert.equal(rename.calls(), 3);
});
test('rename: gives up after the allowed number of tries and reports the last error', async () => {
  const rename = failing(['EPERM', 'EPERM', 'EPERM', 'EPERM']);
  await assert.rejects(renameWithRetry('a', 'b', { tries: 3, delayMs: 1, rename }), { code: 'EPERM' });
  assert.equal(rename.calls(), 3);
});
test('rename: errors that waiting cannot fix fail at once', async () => {
  const rename = failing(['ENOENT', null]);
  await assert.rejects(renameWithRetry('a', 'b', { delayMs: 1, rename }), { code: 'ENOENT' });
  assert.equal(rename.calls(), 1);
});
