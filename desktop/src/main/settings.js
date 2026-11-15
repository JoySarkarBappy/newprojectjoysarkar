'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJsonAtomic } = require('../engine/store');

const DEFAULTS = {
  downloadDir: '',
  maxConcurrent: 3,
  connections: 8,
  speedLimit: 0,                    // bytes/s currently applied, 0 = unlimited
  speedLimitPreset: 1024 * 1024,    // what the status-bar switch turns on
  window: { enabled: false, start: '23:00', end: '07:00' },
  autoRetry: 5,
  autoRetryDelayMs: 30000,
  port: 47821,
  token: '',
  videoQuality: 'best',
  notify: true,
  keepAwake: true,
  theme: 'system',                  // 'system' | 'light' | 'dark'
};

const clamp = (n, lo, hi, dflt) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt; };
const hhmm = (s, dflt) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s)) ? String(s) : dflt);

/** Keep only known keys and sane values; anything odd falls back to the default. */
function sanitize(input, base = DEFAULTS) {
  const s = { ...base, ...(input || {}) };
  const w = { ...base.window, ...((input && input.window) || {}) };
  return {
    downloadDir: typeof s.downloadDir === 'string' ? s.downloadDir : base.downloadDir,
    maxConcurrent: clamp(s.maxConcurrent, 1, 10, base.maxConcurrent),
    connections: clamp(s.connections, 1, 32, base.connections),
    speedLimit: clamp(s.speedLimit, 0, 1e10, 0),
    speedLimitPreset: clamp(s.speedLimitPreset, 16 * 1024, 1e10, base.speedLimitPreset),
    window: { enabled: !!w.enabled, start: hhmm(w.start, base.window.start), end: hhmm(w.end, base.window.end) },
    autoRetry: clamp(s.autoRetry, 0, 50, base.autoRetry),
    autoRetryDelayMs: clamp(s.autoRetryDelayMs, 1000, 3600000, base.autoRetryDelayMs),
    port: clamp(s.port, 1024, 65535, base.port),
    token: typeof s.token === 'string' && /^[a-f0-9]{32}$/.test(s.token) ? s.token : crypto.randomBytes(16).toString('hex'),
    videoQuality: ['best', '2160', '1440', '1080', '720', '480', '360', 'audio'].includes(String(s.videoQuality)) ? String(s.videoQuality) : 'best',
    notify: !!s.notify,
    keepAwake: !!s.keepAwake,
    theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
  };
}

class Settings {
  constructor(dataDir, defaults = {}) {
    this.file = path.join(dataDir, 'settings.json');
    this.value = sanitize(readJson(this.file, {}), { ...DEFAULTS, ...defaults });
  }
  get() { return this.value; }
  async set(patch) {
    this.value = sanitize({ ...this.value, ...patch, window: { ...this.value.window, ...((patch && patch.window) || {}) } }, this.value);
    await writeJsonAtomic(this.file, this.value);
    return this.value;
  }
  async save() { await writeJsonAtomic(this.file, this.value); }
}

module.exports = { Settings, sanitize, DEFAULTS };
