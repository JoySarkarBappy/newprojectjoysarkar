'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');

function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return fallback; }
  try { return JSON.parse(text); } catch {
    try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* best effort */ }
    return fallback;
  }
}

const chains = new Map();   // one write at a time per file, in call order

function writeJsonAtomic(file, data) {
  const text = JSON.stringify(data);
  const run = async () => {
    const tmp = `${file}.tmp`;
    const fh = await fsp.open(tmp, 'w');
    try { await fh.writeFile(text); await fh.sync(); } finally { await fh.close(); }
    await fsp.rename(tmp, file);
  };
  const next = (chains.get(file) || Promise.resolve()).then(run, run);
  chains.set(file, next.catch(() => {}));
  return next;
}

module.exports = { readJson, writeJsonAtomic };
