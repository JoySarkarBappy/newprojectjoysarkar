'use strict';
const http = require('node:http');
const https = require('node:https');

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TLS_ERRORS = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);

class HttpError extends Error {
  constructor(status) {
    super(`Server answered ${status}${http.STATUS_CODES[status] ? ` (${http.STATUS_CODES[status]})` : ''}`);
    this.status = status;
    this.code = `http_${status}`;
  }
}

/** Errors that will not get better by trying again. */
function isFatal(err) {
  if (!err) return false;
  if (err instanceof HttpError) return err.status >= 400 && err.status < 500 && ![408, 425, 429].includes(err.status);
  return TLS_ERRORS.has(err.code) || err.code === 'ERR_INVALID_URL' || err.code === 'bad_url' || err.code === 'disk_full';
}

function mergeHeaders(custom) {
  const map = new Map([
    ['user-agent', ['User-Agent', DEFAULT_UA]],
    ['accept', ['Accept', '*/*']],
    ['accept-encoding', ['Accept-Encoding', 'identity']],   // byte offsets must mean the same thing on every request
  ]);
  for (const [k, v] of Object.entries(custom || {})) {
    if (v == null || v === '') continue;
    map.set(k.toLowerCase(), [k, String(v)]);
  }
  return map;
}

function parseUrl(url) {
  let u;
  try { u = new URL(url); } catch { u = null; }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
    const e = new Error('Only http and https links can be downloaded'); e.code = 'bad_url'; throw e;
  }
  return u;
}

/**
 * Send a request, following redirects. Resolves with { res, finalUrl } as soon as headers arrive;
 * the caller owns the response stream.
 */
async function request(url, { method = 'GET', headers, signal, agents, maxRedirects = 10, timeout = 30000 } = {}) {
  let u = parseUrl(url);
  const map = mergeHeaders(headers);
  for (let hop = 0; ; hop++) {
    const res = await new Promise((resolve, reject) => {
      const mod = u.protocol === 'https:' ? https : http;
      const agent = agents ? agents[u.protocol] : undefined;
      const req = mod.request(u, { method, headers: Object.fromEntries(map.values()), agent, signal }, (r) => {
        req.setTimeout(0);          // from here on the caller watches for stalls
        resolve(r);
      });
      req.setTimeout(timeout, () => req.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })));
      req.on('error', reject);
      req.end();
    });
    if (!REDIRECTS.has(res.statusCode) || !res.headers.location) return { res, finalUrl: u.href };
    res.resume();
    if (hop >= maxRedirects) throw Object.assign(new Error('Too many redirects'), { code: 'bad_url' });
    const next = parseUrl(new URL(res.headers.location, u).href);
    if (next.host !== u.host) { map.delete('cookie'); map.delete('authorization'); }
    if (res.statusCode === 303) method = 'GET';
    u = next;
  }
}

function makeAgents() {
  return {
    'http:': new http.Agent({ keepAlive: true, maxSockets: Infinity }),
    'https:': new https.Agent({ keepAlive: true, maxSockets: Infinity }),
  };
}
function destroyAgents(agents) { if (agents) for (const a of Object.values(agents)) a.destroy(); }

module.exports = { request, HttpError, isFatal, makeAgents, destroyAgents, DEFAULT_UA };
