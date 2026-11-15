'use strict';
const path = require('node:path');

const MAX_NAME_BYTES = 200;

const CATEGORIES = {
  video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp', 'ts'],
  audio: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus', 'wma'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'csv', 'odt', 'tex', 'md'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst', 'iso'],
  program: ['dmg', 'pkg', 'app', 'exe', 'msi', 'deb', 'rpm', 'apk', 'appimage', 'jar', 'bin', 'sh'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'tiff', 'ico'],
};

const MIME_EXT = {
  'application/pdf': 'pdf', 'application/zip': 'zip', 'application/x-7z-compressed': '7z',
  'application/x-rar-compressed': 'rar', 'application/vnd.rar': 'rar', 'application/gzip': 'gz',
  'application/x-tar': 'tar', 'application/x-apple-diskimage': 'dmg', 'application/json': 'json',
  'application/vnd.android.package-archive': 'apk', 'application/epub+zip': 'epub',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/wav': 'wav',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html',
};

/** Node hands us header bytes decoded as latin1; servers often send raw UTF-8. Undo that when it is clearly the case. */
function repairLatin1(s) {
  if (!/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const fixed = Buffer.from(s, 'latin1').toString('utf8');
  return fixed.includes('�') ? s : fixed;
}

function parseContentDisposition(header) {
  if (!header || typeof header !== 'string') return null;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const m = /^\s*(?:"?)([\w!#$%&+\-^`{}~.]*)'[^']*'([^";]*)/.exec(star[1]);
    if (m) {
      try {
        const bytes = Buffer.from(unescape(m[2]), 'latin1');
        const charset = (m[1] || 'utf-8').toLowerCase();
        const out = charset === 'iso-8859-1' ? bytes.toString('latin1') : bytes.toString('utf8');
        if (out && !out.includes('�')) return out;
      } catch { /* fall through to plain filename */ }
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return repairLatin1(quoted[1].replace(/\\(.)/g, '$1')) || null;
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  if (bare) return repairLatin1(bare[1].trim()) || null;
  return null;
}

/** Cut a string to at most `max` UTF-8 bytes without splitting a character. */
function truncateBytes(s, max) {
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = Buffer.byteLength(ch);
    if (used + n > max) break;
    out += ch; used += n;
  }
  return out;
}

function splitExt(name) {
  const m = /^(.+?)((?:\.tar)?\.[A-Za-z0-9]{1,10})$/.exec(name);
  return m ? [m[1], m[2]] : [name, ''];
}

function sanitizeFilename(input) {
  let name = String(input == null ? '' : input);
  name = name.split(/[\\/]/).pop();                       // never keep directories
  name = name.replace(/[\u0000-\u001f\u007f]/g, '_');     // control characters
  name = name.replace(/[:*?"<>|]/g, '_');                 // illegal on some filesystems
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!name) return 'download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = `_${name}`;   // device names on Windows
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) {
    const [base, ext] = splitExt(name);
    name = truncateBytes(base, MAX_NAME_BYTES - Buffer.byteLength(ext)).replace(/[.\s]+$/, '') + ext;
  }
  return name || 'download';
}

function filenameFromUrl(url) {
  let seg = '';
  try { seg = new URL(url).pathname.split('/').filter(Boolean).pop() || ''; } catch { return 'download'; }
  try { seg = decodeURIComponent(seg); } catch { /* keep the raw segment */ }
  return sanitizeFilename(seg);
}

function uniquePath(dir, name, exists) {
  const first = path.join(dir, name);
  if (!exists(first)) return first;
  const [base, ext] = splitExt(name);
  for (let i = 1; i < 100000; i++) {
    const p = path.join(dir, `${base} (${i})${ext}`);
    if (!exists(p)) return p;
  }
  return path.join(dir, `${base} (${Date.now()})${ext}`);
}

function categoryOf(name) {
  const ext = (/\.([A-Za-z0-9]+)$/.exec(name || '') || [])[1];
  if (!ext) return 'other';
  const e = ext.toLowerCase();
  for (const [cat, list] of Object.entries(CATEGORIES)) if (list.includes(e)) return cat;
  return 'other';
}

function withMimeExtension(name, contentType) {
  if (/\.[A-Za-z0-9]{1,10}$/.test(name)) return name;
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const ext = MIME_EXT[mime];
  return ext ? `${name}.${ext}` : name;
}

module.exports = {
  parseContentDisposition, sanitizeFilename, filenameFromUrl, uniquePath, categoryOf, withMimeExtension, CATEGORIES,
};
