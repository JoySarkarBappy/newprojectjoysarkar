'use strict';
const { request, HttpError } = require('./http');
const { parseContentDisposition, sanitizeFilename, filenameFromUrl, withMimeExtension } = require('./filename');

const RETRY_WITHOUT_RANGE = new Set([400, 403, 405, 406, 412, 416, 501]);

function isEncoded(res) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  return enc !== '' && enc !== 'identity';
}

/** Find out what a URL is: size, whether it can be resumed, a good file name. Does not download the body. */
async function probe(url, headers = {}, opts = {}) {
  let { res, finalUrl } = await request(url, { ...opts, headers: { ...headers, Range: 'bytes=0-0' } });
  let ranged = true;
  if (RETRY_WITHOUT_RANGE.has(res.statusCode)) {
    res.destroy();
    ({ res, finalUrl } = await request(url, { ...opts, headers }));
    ranged = false;
  }
  res.destroy();
  if (res.statusCode >= 400) throw new HttpError(res.statusCode);

  const encoded = isEncoded(res);
  let size = -1;
  let resumable = false;
  if (ranged && res.statusCode === 206) {
    const m = /bytes\s+\d+-\d+\/(\d+|\*)/i.exec(res.headers['content-range'] || '');
    if (m && m[1] !== '*' && !encoded) { size = Number(m[1]); resumable = true; }
  } else if (!encoded && res.headers['content-length'] != null) {
    const n = Number(res.headers['content-length']);
    if (Number.isFinite(n) && n >= 0) size = n;
  }

  const etag = res.headers.etag && !/^W\//.test(res.headers.etag) ? res.headers.etag : null;
  const mime = res.headers['content-type'] || '';
  const raw = parseContentDisposition(res.headers['content-disposition']);
  const filename = withMimeExtension(raw ? sanitizeFilename(raw) : filenameFromUrl(finalUrl), mime);
  return { finalUrl, size, resumable, etag, lastModified: res.headers['last-modified'] || null, filename, mime };
}

module.exports = { probe, isEncoded };
