'use strict';
const fsp = require('node:fs/promises');

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Rename, waiting out short locks other programs take on a fresh file (common on Windows). */
async function renameWithRetry(from, to, { tries = 8, delayMs = 250, rename = fsp.rename } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await rename(from, to); } catch (e) {
      if (!TRANSIENT.has(e.code) || attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

module.exports = { renameWithRetry };
