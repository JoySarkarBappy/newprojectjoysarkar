'use strict';
// Finds, installs and queries the helper programs used for video sites: yt-dlp and ffmpeg.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { DownloadTask } = require('./task');
const { cleanError } = require('./video');

const YTDLP_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const FFMPEG_BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';

function defaultUrl(name, platform = process.platform, arch = process.arch) {
  if (name === 'yt-dlp') {
    return YTDLP_BASE + (platform === 'darwin' ? 'yt-dlp_macos' : platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp_linux');
  }
  if (name === 'ffmpeg') {
    const p = platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win32' : 'linux';
    return `${FFMPEG_BASE}ffmpeg-${p}-${arch === 'arm64' ? 'arm64' : 'x64'}.gz`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

const exeName = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

function isExecutable(p) {
  try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; }
}

/** Path of a usable copy of the tool, or null. Our own copy wins over one installed system-wide. */
function findTool(name, dataDir, dirs) {
  const own = path.join(dataDir, 'bin', exeName(name));
  if (isExecutable(own)) return own;
  const search = dirs || [
    '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), '/usr/bin',
    ...String(process.env.PATH || '').split(path.delimiter),
  ];
  for (const d of search) {
    if (!d) continue;
    const p = path.join(d, exeName(name));
    if (isExecutable(p)) return p;
  }
  return null;
}

/** Download a tool into <dataDir>/bin. Resolves with its path. */
async function installTool(name, dataDir, { url, onProgress } = {}) {
  const from = url || defaultUrl(name);
  const binDir = path.join(dataDir, 'bin');
  const work = path.join(binDir, `.fetch-${name}`);
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });
  const task = new DownloadTask({ id: `tool-${name}`, url: from, dir: work, name: 'tool.bin', connections: 4 });
  const timer = onProgress ? setInterval(() => onProgress(task.downloaded, task.size), 300) : null;
  try {
    await task.start();
  } finally { if (timer) clearInterval(timer); }
  if (task.status !== 'completed') {
    await fsp.rm(work, { recursive: true, force: true });
    throw new Error(task.error || 'Download failed');
  }
  const dest = path.join(binDir, exeName(name));
  const staged = `${dest}.new`;
  const head = Buffer.alloc(2);
  const fh = await fsp.open(task.path, 'r');
  try { await fh.read(head, 0, 2, 0); } finally { await fh.close(); }
  if (head[0] === 0x1f && head[1] === 0x8b) {
    await pipeline(fs.createReadStream(task.path), zlib.createGunzip(), fs.createWriteStream(staged));
  } else {
    await fsp.rename(task.path, staged);
  }
  await fsp.chmod(staged, 0o755);
  await fsp.rename(staged, dest);
  await fsp.rm(work, { recursive: true, force: true });
  return dest;
}

function run(bin, args, { timeoutMs = 90000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 128 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env },
      (err, stdout, stderr) => {
        if (!err) return resolve(String(stdout));
        const line = String(stderr || '').split('\n').reverse().find((l) => l.startsWith('ERROR:'));
        reject(new Error(line ? cleanError(line) : (err.killed ? 'Timed out' : err.message)));
      });
  });
}

async function toolVersion(bin, flag = '--version') {
  try { return (await run(bin, [flag], { timeoutMs: 30000 })).split('\n')[0].trim(); } catch { return null; }
}

async function updateYtDlp(bin) {
  const out = await run(bin, ['-U'], { timeoutMs: 180000 });
  return out.trim().split('\n').pop();
}

/** Ask yt-dlp what a page offers, without downloading. */
async function probeVideo(bin, url, { env, jsRuntime } = {}) {
  const args = ['-J', '--no-playlist', '--no-warnings'];
  for (const r of [].concat(jsRuntime || [])) args.push('--js-runtimes', r);
  args.push('--', url);
  const info = JSON.parse(await run(bin, args, { env }));
  const heights = [...new Set((info.formats || [])
    .filter((f) => f.vcodec && f.vcodec !== 'none' && Number(f.height) > 0)
    .map((f) => Number(f.height)))].sort((a, b) => b - a);
  return {
    id: info.id || null, title: info.title || 'Video', duration: info.duration || null,
    uploader: info.uploader || info.channel || null, thumbnail: info.thumbnail || null,
    heights, isLive: !!info.is_live, site: info.extractor_key || info.extractor || null,
  };
}

module.exports = { findTool, installTool, toolVersion, updateYtDlp, probeVideo, defaultUrl };
