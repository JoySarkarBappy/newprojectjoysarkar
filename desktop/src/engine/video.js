'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const PROGRESS = 'download:SROT|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s';
const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360', 'audio'];

const num = (s) => { const n = Number(s); return Number.isFinite(n) ? Math.round(n) : null; };

function parseProgress(line) {
  if (!line.startsWith('SROT|')) return null;
  const [, d, t, te, s, e] = line.split('|');
  return { downloaded: num(d) || 0, total: num(t) || num(te) || 0, speed: num(s) || 0, eta: num(e) };
}

/** Turn yt-dlp's "ERROR: [site] id: message" into just the message. */
function cleanError(line) {
  const m = /^ERROR:\s*(?:\[[^\]]+\]\s*[^:\s]+:\s*)?(.*)$/.exec(line.trim());
  return m ? m[1] : line.trim();
}

/** On Windows yt-dlp.exe runs its work in child processes, so the whole tree has to be stopped. */
function killCommand(platform, pid) {
  return platform === 'win32' ? ['taskkill', ['/pid', String(pid), '/T', '/F']] : null;
}

function formatFor(quality, hasFfmpeg) {
  if (quality === 'audio') return hasFfmpeg ? 'ba/b' : 'ba[ext=m4a]/ba/b';
  const h = /^\d+$/.test(String(quality)) ? `[height<=${quality}]` : '';
  if (!hasFfmpeg) return h ? `b${h}/b` : 'b';                    // only files that need no merging
  return h ? `bv*${h}+ba/b${h}/b` : 'bv*+ba/b';
}

/** Command line for yt-dlp. `task` needs url, dir, quality; optional playlist, speedLimit. */
function buildArgs(task, { ffmpeg = null, jsRuntime = null } = {}) {
  const args = [
    '--newline', '--no-colors', '--no-warnings', '--no-simulate', '--progress',
    '--progress-template', PROGRESS,
    '--print', 'before_dl:SROTMETA|%(id)s|%(title)s',
    '--print', 'after_move:SROTFILE|%(filepath)s',
    '--continue', '-N', '4',
    '-P', task.dir,
    '-o', '%(title).150B [%(id)s].%(ext)s',
    task.playlist ? '--yes-playlist' : '--no-playlist',
    '-f', formatFor(task.quality || 'best', !!ffmpeg),
  ];
  if (ffmpeg) {
    args.push('--ffmpeg-location', ffmpeg);
    if (task.quality === 'audio') args.push('-x', '--audio-format', 'mp3');
    else args.push('-S', 'res,vcodec:h264,acodec:m4a', '--merge-output-format', 'mp4');   // plays in QuickTime
  }
  for (const r of [].concat(jsRuntime || [])) args.push('--js-runtimes', r);   // e.g. "node:/path/to/node"
  if (task.speedLimit > 0) args.push('-r', String(Math.round(task.speedLimit)));
  args.push('--', task.url);
  return args;
}

class VideoTask extends EventEmitter {
  /**
   * @param {object} opts
   * @param {() => string|null} opts.ytdlp   path of the yt-dlp program, or null if not installed
   * @param {() => string|null} [opts.ffmpeg]
   * @param {() => {spec: string, env: object}|null} [opts.jsRuntime]  JS runtime for yt-dlp, spec like "node:/path"
   */
  constructor(spec, opts = {}) {
    super();
    this.opts = opts;
    this.kind = 'video';
    this.id = spec.id;
    this.url = spec.url;
    this.source = spec.source || null;
    this.dir = spec.dir;
    this.title = spec.title || null;
    this.name = spec.name || spec.title || null;
    this.path = spec.path || null;
    this.videoId = spec.videoId || null;
    this.quality = QUALITIES.includes(String(spec.quality)) ? String(spec.quality) : 'best';
    this.playlist = !!spec.playlist;
    this.size = spec.size == null ? -1 : spec.size;
    this.category = this.quality === 'audio' ? 'audio' : 'video';
    this.status = spec.status || 'queued';
    this.error = spec.error || null;
    this.errorCode = spec.errorCode || null;
    this.speedLimit = spec.speedLimit || 0;
    this.addedAt = spec.addedAt || Date.now();
    this.completedAt = spec.completedAt || null;
    this.scheduleAt = spec.scheduleAt || null;
    this.attempts = spec.attempts || 0;
    this.resumable = true;
    this.connections = 1;
    this.note = null;

    this._base = 0;                      // bytes of files already finished in this run (video, then audio)
    this._cur = spec.downloadedBytes || 0;
    this._curTotal = 0;
    this._speed = 0;
    this._running = null;
    this._child = null;
    this._stopReason = null;
  }

  get downloaded() { return this.status === 'completed' && this.size > 0 ? this.size : this._base + this._cur; }
  get speed() { return this.status === 'downloading' ? this._speed : 0; }
  get activeConnections() { return this._child ? 1 : 0; }

  mark(status) { if (!this._running) this._setStatus(status); }
  setSpeedLimit(bps) { this.speedLimit = Math.max(0, bps || 0); }        // applies from the next start
  setUrl(url) { this.url = url; this.error = null; this.errorCode = null; this.attempts = 0; }
  async checkpoint() { return this.toJSON(); }

  toJSON() {
    return {
      id: this.id, kind: this.kind, url: this.url, source: this.source, dir: this.dir, title: this.title,
      name: this.name, path: this.path, videoId: this.videoId, quality: this.quality, playlist: this.playlist,
      size: this.size, downloadedBytes: this.downloaded, status: this.status, error: this.error,
      errorCode: this.errorCode, speedLimit: this.speedLimit, addedAt: this.addedAt,
      completedAt: this.completedAt, scheduleAt: this.scheduleAt, attempts: this.attempts,
    };
  }

  start() {
    if (!this._running) this._running = this._run().finally(() => { this._running = null; });
    return this._running;
  }

  async pause() {
    if (this._running) {
      this._stopReason = 'pause';
      this._kill();
      await this._running;
    } else if (this.status !== 'completed' && this.status !== 'error') {
      this._setStatus('paused');
    }
  }

  async discard() {
    await this.pause();
    if (this.status === 'completed' || !this.videoId) return;
    const tag = `[${this.videoId}]`;
    const names = await fsp.readdir(this.dir).catch(() => []);
    await Promise.all(names
      .filter((n) => n.includes(tag) && /\.(part|ytdl)$|\.part-Frag\d+/.test(n))
      .map((n) => fsp.unlink(path.join(this.dir, n)).catch(() => {})));
    this._base = 0; this._cur = 0;
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this.emit('state', status);
  }

  _kill() {
    const child = this._child;
    if (!child) return;
    const tree = killCommand(process.platform, child.pid);
    if (tree) {
      try { spawn(tree[0], tree[1], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill()); } catch { child.kill(); }
      return;
    }
    child.kill('SIGINT');
    const hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 3000);
    child.once('exit', () => clearTimeout(hard));
  }

  async _run() {
    this._stopReason = null;
    this.error = null; this.errorCode = null;
    this._setStatus('downloading');
    const bin = this.opts.ytdlp ? this.opts.ytdlp() : null;
    if (!bin) {
      this.error = 'Video support is not installed yet. Open Settings and install it.';
      this.errorCode = 'tool_missing';
      this._setStatus('error');
      return;
    }
    const ffmpeg = this.opts.ffmpeg ? this.opts.ffmpeg() : null;
    const rt = this.opts.jsRuntime ? this.opts.jsRuntime() : null;
    const global = this.opts.globalBucket ? this.opts.globalBucket.rate : 0;
    const limit = [this.speedLimit, global].filter((x) => x > 0).sort((a, b) => a - b)[0] || 0;
    this.note = ffmpeg ? null : 'Without ffmpeg only ready-made files are available (usually up to 720p)';
    await fsp.mkdir(this.dir, { recursive: true }).catch(() => {});
    const args = buildArgs({ ...this, speedLimit: limit }, { ffmpeg, jsRuntime: rt ? rt.spec : null });

    let lastError = null;
    let first = true;
    this._base = 0;
    const code = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, ...(rt ? rt.env : {}) } });
      } catch (e) { lastError = e.message; resolve(-1); return; }
      this._child = child;
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.startsWith('SROTMETA|')) {
          const [, id, ...rest] = line.split('|');
          this.videoId = id; this.title = rest.join('|'); this.name = this.title;
          this.emit('state', this.status);
        } else if (line.startsWith('SROTFILE|')) {
          this.path = line.slice('SROTFILE|'.length);
          this.name = path.basename(this.path);
        } else {
          const p = parseProgress(line);
          if (!p) return;
          if (!first && p.downloaded + 65536 < this._cur) this._base += this._curTotal || this._cur;   // next file began
          first = false;
          this._cur = p.downloaded; this._curTotal = p.total; this._speed = p.speed;
          if (p.total > 0) this.size = this._base + p.total;
        }
      });
      readline.createInterface({ input: child.stderr }).on('line', (line) => {
        if (line.startsWith('ERROR:')) lastError = cleanError(line);
      });
      child.on('error', (e) => { lastError = e.message; this._child = null; resolve(-1); });
      child.on('exit', (c) => { this._child = null; resolve(c == null ? -1 : c); });
    });
    this._speed = 0;

    if (this._stopReason) { this._setStatus('paused'); return; }
    if (code === 0) {
      if (this.path) {
        const st = await fsp.stat(this.path).catch(() => null);
        if (st) this.size = st.size;
      }
      if (this.size <= 0) this.size = this.downloaded;
      this.completedAt = Date.now();
      this._setStatus('completed');
      return;
    }
    this.error = lastError || `The video helper stopped unexpectedly (code ${code})`;
    this.errorCode = 'video_error';
    this._setStatus('error');
  }
}

module.exports = { VideoTask, buildArgs, parseProgress, cleanError, killCommand, QUALITIES };
