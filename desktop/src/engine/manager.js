'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { DownloadTask } = require('./task');
const { TokenBucket } = require('./limiter');
const { readJson, writeJsonAtomic } = require('./store');
const { filenameFromUrl } = require('./filename');

const DEFAULT_SETTINGS = {
  downloadDir: '',
  maxConcurrent: 3,
  connections: 8,
  speedLimit: 0,                                    // bytes per second for everything together, 0 = off
  window: { enabled: false, start: '23:00', end: '07:00' },
  autoRetry: 5,
  autoRetryDelayMs: 30000,
};

const WAITING = new Set(['queued', 'scheduled', 'paused', 'error']);

function retryable(code) {
  if (!code) return true;
  if (code === 'disk_full' || code === 'bad_url' || code === 'tool_missing' || code === 'video_error') return false;
  const m = /^http_(\d+)$/.exec(code);
  if (m) { const s = Number(m[1]); return !(s >= 400 && s < 500) || [408, 425, 429].includes(s); }
  return true;
}

const minutesOf = (hhmm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

class Manager extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.dataDir   where downloads.json lives
   * @param {object} o.settings  see DEFAULT_SETTINGS
   * @param {object} [o.taskOpts] engine tuning passed to every task
   * @param {object} [o.kinds]   extra task classes by kind, e.g. { video: VideoTask }
   */
  constructor({ dataDir, settings = {}, taskOpts = {}, kinds = {}, now = Date.now, tickMs = 500, persistMs = 2000 }) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'downloads.json');
    this.settings = { ...DEFAULT_SETTINGS, ...settings, window: { ...DEFAULT_SETTINGS.window, ...(settings.window || {}) } };
    this.bucket = new TokenBucket(this.settings.speedLimit);
    this.taskOpts = { ...taskOpts, globalBucket: this.bucket };
    this.kinds = { http: DownloadTask, ...kinds };
    this.now = now;
    this.tickMs = tickMs;
    this.persistMs = persistMs;
    this.tasks = [];
    this.timer = null;
    this._dirty = false;
    this._persisting = null;
    this._lastPersist = 0;
  }

  // ---- lifecycle -----------------------------------------------------------------------------

  async load() {
    await fsp.mkdir(this.dataDir, { recursive: true });
    const saved = readJson(this.file, { tasks: [] });
    this.tasks = [];
    for (const spec of saved.tasks || []) {
      const Kind = this.kinds[spec.kind || 'http'];
      if (!Kind || !spec.id || !spec.url) continue;
      if (spec.status === 'downloading') spec.status = 'queued';     // we were interrupted: carry on
      this.tasks.push(this._wire(new Kind(spec, this.taskOpts)));
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), this.tickMs);
    this._tick();
  }

  async shutdown() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this._closing = true;
    await Promise.all(this.tasks.filter((t) => t.status === 'downloading').map(async (t) => {
      t.suspended = true;
      await t.pause();
      t.mark('queued');                                              // resumes by itself next launch
    }));
    while (this._persisting) await this._persisting;                 // let a save already under way finish...
    await this._persist();                                           // ...then write the final state
  }

  // ---- commands ------------------------------------------------------------------------------

  add(spec) {
    let u;
    try { u = new URL(String(spec.url || '').trim()); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) throw new Error('Please enter a valid http or https link');
    const kind = spec.kind || 'http';
    const Kind = this.kinds[kind];
    if (!Kind) throw new Error(`Unsupported download type: ${kind}`);
    const same = this.tasks.find((t) => t.kind === kind && t.url === u.href && t.status !== 'completed');
    if (same) return { ...this._view(same), duplicate: true };
    const task = this._wire(new Kind({
      ...spec,
      id: crypto.randomUUID(),
      url: u.href,
      dir: spec.dir || this.settings.downloadDir,
      connections: spec.connections || this.settings.connections,
      status: spec.paused ? 'paused' : spec.scheduleAt ? 'scheduled' : 'queued',
      addedAt: this.now(),
    }, this.taskOpts));
    this.tasks.push(task);
    this._changed();
    return this._view(task);
  }

  async pause(id) {
    const t = this._get(id);
    if (!t || t.status === 'completed') return;
    t.forced = false; t.retryAt = null;
    if (t.status === 'error') return;
    await t.pause();
    this._changed();
  }

  resume(id) {
    const t = this._get(id);
    if (!t || !['paused', 'error', 'scheduled'].includes(t.status)) return;
    t.retryAt = null; t.attempts = 0; t.scheduleAt = null;
    t.mark('queued');
    this._changed();
  }

  /** Start right away, ignoring the queue limit and the allowed hours. */
  startNow(id) {
    const t = this._get(id);
    if (!t || !WAITING.has(t.status)) return;
    t.retryAt = null; t.attempts = 0; t.scheduleAt = null; t.forced = true;
    this._launch(t);
    this._changed();
  }

  async remove(id, { deleteFile = false } = {}) {
    const t = this._get(id);
    if (!t) return;
    this.tasks = this.tasks.filter((x) => x !== t);
    await t.discard();
    if (deleteFile && t.status === 'completed' && t.path) await fsp.unlink(t.path).catch(() => {});
    this._changed();
  }

  move(id, delta) {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i < 0) return;
    const j = Math.max(0, Math.min(this.tasks.length - 1, i + delta));
    const [t] = this.tasks.splice(i, 1);
    this.tasks.splice(j, 0, t);
    this._changed();
  }

  async pauseAll() { await Promise.all(this.tasks.filter((t) => ['downloading', 'queued', 'scheduled'].includes(t.status)).map((t) => this.pause(t.id))); }
  resumeAll() { for (const t of this.tasks) if (t.status === 'paused' || t.status === 'error') this.resume(t.id); }

  setTaskLimit(id, bps) { const t = this._get(id); if (t && t.setSpeedLimit) { t.setSpeedLimit(bps); this._changed(); } }

  updateUrl(id, url) {
    const t = this._get(id);
    if (!t || t.status === 'completed' || t.status === 'downloading') return;
    const u = new URL(String(url).trim());
    if (!/^https?:$/.test(u.protocol)) throw new Error('Please enter a valid http or https link');
    t.setUrl(u.href);
    t.retryAt = null;
    t.mark('queued');
    this._changed();
  }

  schedule(id, when) {
    const t = this._get(id);
    if (!t || !WAITING.has(t.status)) return;
    t.scheduleAt = when; t.retryAt = null;
    t.mark(when ? 'scheduled' : 'queued');
    this._changed();
  }

  async clearCompleted() {
    this.tasks = this.tasks.filter((t) => t.status !== 'completed');
    this._changed();
  }

  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch, window: { ...this.settings.window, ...(patch.window || {}) } };
    this.bucket.setRate(this.settings.speedLimit);
    this._pump();
  }

  /** Extra facts about one download for the detail panel. */
  detail(id) {
    const t = this._get(id);
    if (!t) return null;
    return {
      ...this._view(t),
      tempPath: t.tempPath || null,
      segments: (t.segments || []).map((g) => ({ start: g.start, end: g.end, pos: g.pos, active: !!g.owner })),
    };
  }

  snapshot() {
    const tasks = this.tasks.map((t) => this._view(t));
    return {
      tasks,
      speed: tasks.reduce((a, t) => a + t.speed, 0),
      active: tasks.filter((t) => t.status === 'downloading').length,
      inWindow: this._inWindow(),
    };
  }

  // ---- internals -----------------------------------------------------------------------------

  _get(id) { return this.tasks.find((t) => t.id === id); }

  _wire(task) {
    task.retryAt = null; task.forced = false; task.suspended = false;
    task.on('state', () => { this._dirty = true; });
    return task;
  }

  _changed() {
    this._dirty = true;
    if (this.timer) { this._pump(); this.emit('update', this.snapshot()); }   // show the change right away
    this._persist();
  }

  _view(t) {
    const speed = t.speed;
    const done = t.downloaded;
    return {
      id: t.id, kind: t.kind, name: t.name || t.title || filenameFromUrl(t.url), url: t.url, source: t.source,
      path: t.path, dir: t.dir, size: t.size, downloaded: done, speed,
      eta: speed > 0 && t.size > 0 && t.status === 'downloading' ? Math.ceil((t.size - done) / speed) : null,
      status: t.status, error: t.error, errorCode: t.errorCode, resumable: t.resumable,
      connections: t.activeConnections || 0, maxConnections: t.connections, category: t.category,
      addedAt: t.addedAt, completedAt: t.completedAt, scheduleAt: t.scheduleAt, speedLimit: t.speedLimit || 0,
      retryAt: t.retryAt || null, quality: t.quality || null, note: t.note || null,
    };
  }

  _inWindow(now = this.now()) {
    const w = this.settings.window;
    if (!w || !w.enabled) return true;
    const d = new Date(now);
    const m = d.getHours() * 60 + d.getMinutes();
    const s = minutesOf(w.start); const e = minutesOf(w.end);
    if (s === e) return true;
    return s < e ? (m >= s && m < e) : (m >= s || m < e);
  }

  _tick() {
    this._pump();
    this.emit('update', this.snapshot());
    const busy = this.tasks.some((t) => t.status === 'downloading');
    if ((busy || this._dirty) && Date.now() - this._lastPersist >= this.persistMs) this._persist();
  }

  _pump() {
    if (this._closing) return;
    const now = this.now();
    for (const t of this.tasks) {
      if (t.status === 'scheduled' && t.scheduleAt && t.scheduleAt <= now) { t.scheduleAt = null; t.mark('queued'); }
      if (t.status === 'error' && t.retryAt && t.retryAt <= now) { t.retryAt = null; t.mark('queued'); }
    }
    const open = this._inWindow(now);
    if (!open) {
      for (const t of this.tasks) {
        if (t.status === 'downloading' && !t.forced && !t.suspended) { t.suspended = true; t.pause(); }
      }
    }
    let running = this.tasks.filter((t) => t.status === 'downloading').length;
    for (const t of this.tasks) {
      if (running >= this.settings.maxConcurrent) break;
      if (t.status === 'queued' && open) { this._launch(t); running++; }
    }
  }

  _launch(t) {
    t.suspended = false;
    t.start().then(() => this._settled(t), () => this._settled(t));
  }

  _settled(t) {
    if (!this.tasks.includes(t)) return;
    if (t.suspended) { t.suspended = false; t.forced = false; t.mark('queued'); }
    else if (t.status === 'completed') { t.forced = false; t.attempts = 0; this.emit('completed', this._view(t)); }
    else if (t.status === 'error') {
      t.forced = false;
      if (retryable(t.errorCode) && t.attempts < this.settings.autoRetry) {
        t.attempts++;
        t.retryAt = this.now() + this.settings.autoRetryDelayMs;
      } else {
        this.emit('failed', this._view(t));
      }
    }
    this._dirty = true;
    if (!this._closing) { this._pump(); this._persist(); if (this.timer) this.emit('update', this.snapshot()); }
  }

  _persist() {
    if (this._persisting) { this._dirty = true; return this._persisting; }
    this._dirty = false;
    this._lastPersist = Date.now();
    this._persisting = (async () => {
      const tasks = await Promise.all(this.tasks.map((t) => (t.status === 'downloading' ? t.checkpoint() : t.toJSON())));
      await writeJsonAtomic(this.file, { version: 1, tasks });
    })().catch((e) => { this.persistError = e; }).finally(() => {
      this._persisting = null;
      if (this._dirty && !this._closing) return this._persist();
    });
    return this._persisting;
  }
}

module.exports = { Manager, DEFAULT_SETTINGS, retryable };
