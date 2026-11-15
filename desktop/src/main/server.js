'use strict';
// Small HTTP API on 127.0.0.1 that the browser extension talks to. No Electron imports: testable with plain Node.
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_BODY = 1024 * 1024;
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\//;

function sameToken(given, real) {
  if (typeof given !== 'string' || !real) return false;
  const a = Buffer.from(given); const b = Buffer.from(real);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isWebUrl(url) {
  try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.resume(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch {
        reject(Object.assign(new Error('Body is not valid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * @param {object} o
 * @param {() => string} o.getToken           current pairing code
 * @param {(item) => Promise<{id}>} o.onAdd   item: { url, name, source, headers }
 * @param {(item) => Promise<{id}>} o.onVideo item: { url }
 */
function createApi({ getToken, onAdd, onVideo, version }) {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const cors = origin && EXTENSION_ORIGIN.test(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    try {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (host !== '127.0.0.1' && host !== 'localhost') return send(403, { error: 'Wrong host' });
      if (origin && !EXTENSION_ORIGIN.test(origin)) return send(403, { error: 'Web pages may not use this API' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type, x-srot-token', 'Access-Control-Max-Age': '600' });
        return res.end();
      }
      const path = new URL(req.url, 'http://127.0.0.1').pathname;
      const paired = sameToken(req.headers['x-srot-token'], getToken());
      if (req.method === 'GET' && path === '/ping') return send(200, { app: 'srot', version, paired });
      if (req.method !== 'POST' || (path !== '/add' && path !== '/video')) return send(404, { error: 'Not found' });
      if (!paired) return send(401, { error: 'Pairing code missing or wrong' });
      const body = await readBody(req);
      if (!isWebUrl(body.url)) return send(400, { error: 'Only http and https links are accepted' });
      if (path === '/video') {
        const out = await onVideo({ url: body.url });
        return send(200, { ok: true, id: out && out.id });
      }
      const headers = {};
      if (isWebUrl(body.referrer)) headers.Referer = body.referrer;
      if (typeof body.cookies === 'string' && body.cookies) headers.Cookie = body.cookies;
      if (typeof body.userAgent === 'string' && body.userAgent) headers['User-Agent'] = body.userAgent;
      const out = await onAdd({
        url: body.url,
        name: typeof body.filename === 'string' && body.filename ? body.filename : undefined,
        source: isWebUrl(body.referrer) ? body.referrer : undefined,
        headers,
      });
      return send(200, { ok: true, id: out && out.id });
    } catch (e) {
      if (!res.headersSent) send(e.status || 500, { error: e.message });
    }
  });
}

module.exports = { createApi };
