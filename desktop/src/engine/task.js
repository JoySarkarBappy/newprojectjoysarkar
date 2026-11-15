'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { request, HttpError, isFatal, makeAgents, destroyAgents } = require('./http');
const { probe, isEncoded } = require('./probe');
const { planSegments, claim, remaining, downloaded } = require('./segments');
const { sanitizeFilename, uniquePath, categoryOf, withMimeExtension } = require('./filename');
const { TokenBucket } = require('./limiter');
const { renameWithRetry } = require('./fsutil');

const PART = '.srotpart';
const MAX_CONNECTIONS = 32;
const WRITE_HIGH = 32 * 1024 * 1024;   // pause the network when this much is waiting for the disk
const WRITE_LOW = 8 * 1024 * 1024;

const DEFAULTS = {
  minSegment: 1024 * 1024,   // never split a piece smaller than twice this
  retryBaseMs: 500,
  retryMaxMs: 15000,
  maxRetries: 10,            // consecutive failures without any progress, per connection
  stallMs: 30000,            // no bytes for this long => reconnect
  globalBucket: null,
};

/** Internal signal: throw everything away and begin again (mode 'fresh' re-plans, 'stream' uses one connection). */
class Restart extends Error {}

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); if (signal) signal.removeEventListener('abort', done); resolve(); }
  if (signal) signal.addEventListener('abort', done, { once: true });
});

class DownloadTask extends EventEmitter {
  constructor(spec, opts = {}) {
    super();
    this.opts = { ...DEFAULTS, ...opts };
    this.kind = 'http';
    this.id = spec.id;
    this.url = spec.url;
    this.headers = spec.headers || {};
    this.source = spec.source || null;          // page the link came from
    this.dir = spec.dir;
    this.name = spec.name || null;
    this.path = spec.path || null;
    this.tempPath = spec.tempPath || null;
    this.size = spec.size == null ? -1 : spec.size;
    this.resumable = spec.resumable == null ? null : spec.resumable;
    this.etag = spec.etag || null;
    this.lastModified = spec.lastModified || null;
    this.mime = spec.mime || '';
    this.category = spec.category || (this.name ? categoryOf(this.name) : 'other');
    this.segments = (spec.segments || []).map((g) => ({ start: g.start, end: g.end, pos: g.pos, owner: null }));
    this.streamPos = 0;
    this.probed = !!spec.probed;
    this.forceStream = !!spec.forceStream;
    this.looseEtag = !!spec.looseEtag;        // ETag proved unreliable on this server: validate by size and date instead
    this.status = spec.status || 'queued';
    this.error = spec.error || null;
    this.errorCode = spec.errorCode || null;
    this.connections = Math.max(1, Math.min(MAX_CONNECTIONS, spec.connections || 8));
    this.speedLimit = spec.speedLimit || 0;
    this.addedAt = spec.addedAt || Date.now();
    this.completedAt = spec.completedAt || null;
    this.scheduleAt = spec.scheduleAt || null;
    this.attempts = spec.attempts || 0;        // automatic retries used by the manager

    this.bucket = new TokenBucket(this.speedLimit);
    this.workers = new Set();
    this.fh = null;
    this._pending = new Set();
    this._pendingBytes = 0;
    this._blocked = false;
    this._writeError = null;
    this._running = null;
    this._abort = null;
    this._stopReason = null;
    this._samples = [];
    this.lastError = null;
  }

  // ---- public surface ------------------------------------------------------------------------

  get downloaded() {
    if (this.status === 'completed') return this.size > 0 ? this.size : this.streamPos;
    return this.segments.length ? downloaded(this.segments) : this.streamPos;
  }

  get speed() {
    if (this.status !== 'downloading') return 0;
    const now = Date.now();
    while (this._samples.length && now - this._samples[0][0] > 4000) this._samples.shift();
    if (!this._samples.length) return 0;
    const bytes = this._samples.reduce((a, s) => a + s[1], 0);
    const span = Math.max(1000, now - this._samples[0][0]);
    return Math.round((bytes / span) * 1000);
  }

  get activeConnections() { let n = 0; for (const w of this.workers) if (w.res) n++; return n; }

  /** Used by the queue to move a task that is not running between waiting states. */
  mark(status) { if (!this._running) this._setStatus(status); }

  setSpeedLimit(bps) { this.speedLimit = Math.max(0, bps || 0); this.bucket.setRate(this.speedLimit); }

  /** Point the task at a fresh link (for expired links). Progress is kept if the file turns out to be the same. */
  setUrl(url) { this.url = url; this.error = null; this.errorCode = null; this.attempts = 0; }

  /** Runs until the task completes, fails or is paused. Check `status` afterwards. */
  start() {
    if (!this._running) this._running = this._run().finally(() => { this._running = null; });
    return this._running;
  }

  async pause() {
    if (this._running) {
      this._stopReason = 'pause';
      this._abort.abort();
      await this._running;
    } else if (this.status !== 'completed' && this.status !== 'error') {
      this._setStatus('paused');
    }
  }

  /** Stop and delete the partial file. */
  async discard() {
    await this.pause();
    if (this.status !== 'completed' && this.tempPath) await fsp.unlink(this.tempPath).catch(() => {});
  }

  /** A snapshot that is safe to write to disk: everything it claims is already synced to the file. */
  async checkpoint() {
    const snap = this.toJSON();
    if (this.fh) {
      await Promise.allSettled([...this._pending]);
      if (this.fh) await this.fh.datasync().catch(() => {});
    }
    return snap;
  }

  toJSON() {
    return {
      id: this.id, kind: this.kind, url: this.url, headers: this.headers, source: this.source, dir: this.dir,
      name: this.name, path: this.path, tempPath: this.tempPath, size: this.size, resumable: this.resumable,
      etag: this.etag, lastModified: this.lastModified, mime: this.mime, category: this.category,
      segments: this.segments.map((g) => ({ start: g.start, end: g.end, pos: g.pos })),
      probed: this.probed, forceStream: this.forceStream, looseEtag: this.looseEtag, status: this.status, error: this.error,
      errorCode: this.errorCode, connections: this.connections, speedLimit: this.speedLimit,
      addedAt: this.addedAt, completedAt: this.completedAt, scheduleAt: this.scheduleAt, attempts: this.attempts,
    };
  }

  // ---- run loop ------------------------------------------------------------------------------

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('state', status);
  }

  async _run() {
    this._stopReason = null;
    this.error = null; this.errorCode = null; this.lastError = null;
    this._samples = [];
    this._setStatus('downloading');
    this._agents = makeAgents();
    const watchdog = setInterval(() => this._checkStalls(), Math.max(100, Math.floor(this.opts.stallMs / 4)));
    try {
      for (let restarts = 0; ; restarts++) {
        this._abort = new AbortController();
        this._writeError = null;
        try {
          await this._prepare();
          if (this.resumable && this.size > 0) await this._runSegmented(); else await this._runStream();
          break;
        } catch (e) {
          if (!(e instanceof Restart) || this._stopReason) throw e;
          if (restarts >= 2) throw new Error('The server keeps sending a different file than expected');
          await this._reset(restarts === 0 ? 'fresh' : 'stream');
        }
      }
      if (this._stopReason) { await this._stopped(); return; }
      await this._finish();
      this._setStatus('completed');
    } catch (e) {
      if (this._stopReason) { await this._stopped(); return; }
      await this._closeFile();
      if (!this.resumable && this.tempPath) { await fsp.unlink(this.tempPath).catch(() => {}); this.streamPos = 0; }
      const err = this._writeError || e;
      this.error = err.code === 'ENOSPC' ? 'The disk is full' : err.message;
      this.errorCode = err.code === 'ENOSPC' ? 'disk_full' : (err.code || 'failed');
      this._setStatus('error');
    } finally {
      clearInterval(watchdog);
      destroyAgents(this._agents);
    }
  }

  async _stopped() {
    await this._closeFile();
    if (!(this.resumable && this.size > 0) && this.tempPath) {   // nothing reusable from a one-shot stream
      await fsp.unlink(this.tempPath).catch(() => {});
      this.streamPos = 0;
    }
    this._setStatus('paused');
  }

  async _closeFile() {
    await Promise.allSettled([...this._pending]);
    const fh = this.fh; this.fh = null;
    if (fh) { await fh.datasync().catch(() => {}); await fh.close().catch(() => {}); }
  }

  async _reset(mode) {
    await this._closeFile();
    if (this.tempPath) await fsp.unlink(this.tempPath).catch(() => {});
    this.segments = []; this.streamPos = 0; this.probed = false;
    if (mode === 'stream') this.forceStream = true; else this.looseEtag = true;
  }

  async _retrying(fn) {
    for (let failures = 1; ; failures++) {
      try { return await fn(); } catch (e) {
        if (this._abort.signal.aborted || isFatal(e) || failures > Math.min(3, this.opts.maxRetries)) throw e;
        await sleep(this._backoff(failures), this._abort.signal);
      }
    }
  }

  _backoff(failures) {
    const base = Math.min(this.opts.retryMaxMs, this.opts.retryBaseMs * 2 ** (failures - 1));
    return Math.round(base * (0.5 + Math.random() * 0.5));
  }

  _requestOpts() { return { signal: this._abort.signal, agents: this._agents, timeout: this.opts.stallMs }; }

  async _prepare() {
    if (!this.probed) {
      const info = await this._retrying(() => probe(this.url, this.headers, this._requestOpts()));
      this.size = info.size;
      this.resumable = info.resumable && !this.forceStream;
      this.etag = this.looseEtag ? null : info.etag; this.lastModified = info.lastModified; this.mime = info.mime;
      if (!this.path) {
        const name = this.name ? withMimeExtension(sanitizeFilename(this.name), info.mime) : info.filename;
        fs.mkdirSync(this.dir, { recursive: true });
        this.path = uniquePath(this.dir, name, (p) => fs.existsSync(p) || fs.existsSync(p + PART));
        this.tempPath = this.path + PART;
        fs.closeSync(fs.openSync(this.tempPath, 'wx'));          // reserve the name right away
        this.name = path.basename(this.path);
        this.category = categoryOf(this.name);
      }
      this.segments = []; this.streamPos = 0; this.probed = true;
      this.emit('state', this.status);
    }
    const segmented = this.resumable && this.size > 0;
    let fresh = true;
    if (segmented && this.segments.length) {
      const st = await fsp.stat(this.tempPath).catch(() => null);
      fresh = !st || st.size !== this.size;
    }
    if (!fresh) { this.fh = await fsp.open(this.tempPath, 'r+'); return; }
    this.segments = segmented ? planSegments(this.size, this.connections, this.opts.minSegment) : [];
    this.streamPos = 0;
    await fsp.mkdir(this.dir, { recursive: true });
    if (this.size > 0) await this._checkSpace(this.size);
    this.fh = await fsp.open(this.tempPath, 'w+');
    if (segmented) await this.fh.truncate(this.size);
  }

  async _checkSpace(need) {
    let free = Infinity;
    try { const s = await fsp.statfs(this.dir); free = Number(s.bavail) * Number(s.bsize); } catch { /* cannot tell */ }
    if (free < need) throw Object.assign(new Error('Not enough free disk space for this file'), { code: 'disk_full' });
  }

  async _finish() {
    await Promise.allSettled([...this._pending]);
    if (this._writeError) throw this._writeError;
    if (this.fh) { await this.fh.datasync(); await this.fh.close(); this.fh = null; }
    if (this.size <= 0) this.size = this.streamPos;
    if (fs.existsSync(this.path)) {
      this.path = uniquePath(this.dir, path.basename(this.path), (p) => fs.existsSync(p) || fs.existsSync(p + PART));
      this.name = path.basename(this.path);
    }
    await renameWithRetry(this.tempPath, this.path);
    this.segments = [];
    this.completedAt = Date.now();
  }

  // ---- writing, pacing, stall detection ------------------------------------------------------

  _write(chunk, pos) {
    this._pendingBytes += chunk.length;
    const p = this.fh.write(chunk, 0, chunk.length, pos).then(() => {
      this._pendingBytes -= chunk.length;
      if (this._blocked && this._pendingBytes < WRITE_LOW) {
        this._blocked = false;
        for (const w of this.workers) if (w.stream && !w.throttled) w.stream.resume();
      }
    }, (e) => {
      this._pendingBytes -= chunk.length;
      if (!this._writeError) this._writeError = e;
      this._abort.abort();
    }).finally(() => this._pending.delete(p));
    this._pending.add(p);
    if (!this._blocked && this._pendingBytes > WRITE_HIGH) {
      this._blocked = true;
      for (const w of this.workers) if (w.stream) w.stream.pause();
    }
  }

  _account(w, n) {
    const now = Date.now();
    w.lastActivity = now;
    w.progressed = true;
    const last = this._samples[this._samples.length - 1];
    if (last && now - last[0] < 200) last[1] += n; else this._samples.push([now, n]);
    const g = this.opts.globalBucket;
    const wait = Math.max(this.bucket.consume(n), g ? g.consume(n) : 0);
    if (wait > 0 && w.stream) {
      w.throttled = true;
      w.stream.pause();
      w.timer = setTimeout(() => {
        w.throttled = false; w.lastActivity = Date.now();
        if (!this._blocked && w.stream) w.stream.resume();
      }, wait);
    }
  }

  _checkStalls() {
    if (this._blocked) return;
    const now = Date.now();
    for (const w of this.workers) {
      if (w.res && !w.throttled && now - w.lastActivity > this.opts.stallMs) {
        w.res.destroy(Object.assign(new Error('Connection stalled'), { code: 'ETIMEDOUT' }));
      }
    }
  }

  // ---- segmented download --------------------------------------------------------------------

  async _runSegmented() {
    let failure = null;
    const n = Math.min(this.connections, MAX_CONNECTIONS);
    const runs = [];
    for (let i = 0; i < n; i++) {
      const w = { id: i + 1, seg: null, res: null, stream: null, throttled: false, timer: null, lastActivity: Date.now() };
      this.workers.add(w);
      runs.push(this._worker(w)
        .catch((e) => { if (!failure) failure = e; this._abort.abort(); })
        .finally(() => { if (w.seg) w.seg.owner = null; clearTimeout(w.timer); this.workers.delete(w); }));
    }
    await Promise.all(runs);
    await Promise.allSettled([...this._pending]);
    if (this._writeError) throw this._writeError;
    if (failure) throw failure;
    if (this._stopReason) return;
    if (remaining(this.segments) > 0) throw this.lastError || new Error('Download failed');
  }

  async _worker(w) {
    let failures = 0;
    for (;;) {
      if (this._abort.signal.aborted) return;
      if (!w.seg || w.seg.pos >= w.seg.end) {
        if (w.seg) w.seg.owner = null;
        w.seg = claim(this.segments, this.opts.minSegment);
        if (!w.seg) return;
        w.seg.owner = w.id;
      }
      try {
        await this._fetchSegment(w);
        failures = 0;
      } catch (e) {
        if (this._abort.signal.aborted) return;
        if (e instanceof Restart) throw e;
        failures = w.progressed ? 1 : failures + 1;
        this.lastError = e;
        if (isFatal(e) || failures > this.opts.maxRetries) { w.seg.owner = null; w.seg = null; return; }
        await sleep(this._backoff(failures), this._abort.signal);
      }
    }
  }

  async _fetchSegment(w) {
    const seg = w.seg;
    w.progressed = false;
    const headers = { ...this.headers, Range: `bytes=${seg.pos}-${seg.end - 1}` };
    if (this.etag) headers['If-Range'] = this.etag;
    const { res } = await request(this.url, { ...this._requestOpts(), headers });
    const bail = (err) => { res.destroy(); throw err; };
    if (res.statusCode === 200) bail(new Restart('server sent the whole file'));
    if (res.statusCode !== 206) bail(new HttpError(res.statusCode));
    const cr = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(res.headers['content-range'] || '');
    if (!cr || Number(cr[1]) !== seg.pos || isEncoded(res)) bail(new Restart('unexpected range'));
    if (cr[3] !== '*' && Number(cr[3]) !== this.size) bail(new Restart('size changed'));
    if (!this.etag && this.lastModified && res.headers['last-modified'] && res.headers['last-modified'] !== this.lastModified) {
      bail(new Restart('file changed'));
    }
    w.res = res; w.stream = res; w.lastActivity = Date.now();
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(w.timer); w.throttled = false; w.res = null; w.stream = null;
        if (err) reject(err); else resolve();
      };
      res.on('data', (chunk) => {
        if (settled) return;
        const room = seg.end - seg.pos;                 // seg.end can shrink while we run (work stealing)
        const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
        if (part.length) { this._write(part, seg.pos); seg.pos += part.length; }
        if (seg.pos >= seg.end) { finish(); res.destroy(); return; }
        this._account(w, part.length);
      });
      res.on('error', finish);
      res.on('close', () => finish(seg.pos >= seg.end ? null : Object.assign(new Error('Connection closed early'), { code: 'ECONNRESET' })));
    });
  }

  // ---- single stream (no range support or unknown length) -----------------------------------

  async _runStream() {
    const w = { id: 1, seg: null, res: null, stream: null, throttled: false, timer: null, lastActivity: Date.now() };
    this.workers.add(w);
    try {
      for (let failures = 1; ; failures++) {
        try { await this._streamOnce(w); return; } catch (e) {
          if (this._abort.signal.aborted) return;
          this.lastError = e;
          if (isFatal(e) || failures > this.opts.maxRetries) throw e;
          await sleep(this._backoff(failures), this._abort.signal);
          if (this._abort.signal.aborted) return;
        }
      }
    } finally { clearTimeout(w.timer); this.workers.delete(w); }
  }

  async _streamOnce(w) {
    await Promise.allSettled([...this._pending]);
    this.streamPos = 0;
    await this.fh.truncate(0);
    const { res } = await request(this.url, { ...this._requestOpts(), headers: this.headers });
    if (res.statusCode >= 400) { res.destroy(); throw new HttpError(res.statusCode); }
    const enc = String(res.headers['content-encoding'] || '').toLowerCase();
    const decoder = enc === 'gzip' || enc === 'x-gzip' ? zlib.createGunzip()
      : enc === 'deflate' ? zlib.createInflate()
        : enc === 'br' ? zlib.createBrotliDecompress() : null;
    const expected = !decoder && res.headers['content-length'] != null ? Number(res.headers['content-length']) : -1;
    if (expected >= 0 && this.size !== expected) { this.size = expected; await this._checkSpace(expected); }
    const stream = decoder ? res.pipe(decoder) : res;
    w.res = res; w.stream = stream; w.lastActivity = Date.now(); w.progressed = false;
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(w.timer); w.throttled = false; w.res = null; w.stream = null;
        if (err) { res.destroy(); reject(err); } else resolve();
      };
      stream.on('data', (chunk) => {
        if (settled) return;
        this._write(chunk, this.streamPos);
        this.streamPos += chunk.length;
        this._account(w, chunk.length);
      });
      stream.on('end', () => {
        if (!res.complete) return finish(Object.assign(new Error('Connection closed early'), { code: 'ECONNRESET' }));
        if (expected >= 0 && this.streamPos !== expected) return finish(new Error('The server sent fewer bytes than promised'));
        finish();
      });
      stream.on('error', finish);
      res.on('error', finish);
      res.on('close', () => { if (!res.complete) finish(Object.assign(new Error('Connection closed early'), { code: 'ECONNRESET' })); });
    });
  }
}

module.exports = { DownloadTask, PART, MAX_CONNECTIONS };
