'use strict';
// Fault-injecting HTTP server used by the engine tests.
const http = require('node:http');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

function makeData(size, seed = 1) {
  const out = Buffer.alloc(size);
  let block = crypto.createHash('sha256').update(String(seed)).digest();
  for (let off = 0; off < size; off += block.length) {
    block.copy(out, off);
    block = crypto.createHash('sha256').update(block).digest();
  }
  return out;
}
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function createServer(files) {
  const state = {
    files: { ...files },            // name -> Buffer
    etagSalt: 0,
    validKeys: new Set(),
    stats: { requests: 0, bytesSent: 0, active: 0, maxActive: 0, ranges: [], headers: [] },
    down: false,                    // /down route answers 503 while true
    stallBudget: 3,                 // how many responses the /stall route may hang
    sockets: new Set(),
  };

  const sendSlice = (res, buf, { bps = 0, dropAfter = -1, stallAfter = -1 }) => {
    let off = 0;
    const step = bps ? Math.max(1024, Math.floor(bps / 20)) : 256 * 1024;
    const tick = () => {
      if (res.destroyed) return;
      if (stallAfter >= 0 && off >= stallAfter) return;                 // hang forever
      if (dropAfter >= 0 && off >= dropAfter) { res.destroy(); return; }
      let end = Math.min(buf.length, off + step);
      if (dropAfter >= 0) end = Math.min(end, dropAfter);
      if (stallAfter >= 0) end = Math.min(end, stallAfter);
      const chunk = buf.subarray(off, end);
      off = end;
      state.stats.bytesSent += chunk.length;
      if (off >= buf.length) { res.end(chunk); return; }
      const more = res.write(chunk);
      if (bps) setTimeout(tick, 50);
      else if (more) setImmediate(tick);
      else res.once('drain', tick);
    };
    tick();
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const [, mode, ...rest] = url.pathname.split('/');
    const name = decodeURIComponent(rest.join('/'));
    const q = Object.fromEntries(url.searchParams);
    state.stats.requests++;
    state.stats.headers.push(req.headers);
    state.stats.active++;
    state.stats.maxActive = Math.max(state.stats.maxActive, state.stats.active);
    res.on('close', () => { state.stats.active--; });

    if (mode === 'status') { res.writeHead(Number(name)); res.end('x'); return; }
    if (mode === 'redirect') { res.writeHead(302, { Location: `/ok/${encodeURIComponent(name)}` }); res.end(); return; }
    if (mode === 'expire' && !state.validKeys.has(q.key)) { res.writeHead(403); res.end('expired'); return; }
    if (mode === 'down' && state.down) { res.writeHead(503); res.end('down'); return; }
    if (mode === 'cap' && state.stats.active > Number(q.max || 2)) { res.writeHead(503); res.end('busy'); return; }

    const body = state.files[name];
    if (!body) { res.writeHead(404); res.end('nope'); return; }
    // /flipetag imitates a server farm whose machines each report a different ETag for the same file
    const etag = mode === 'flipetag' ? `"node-${state.stats.requests}"` : `"${sha(body).slice(0, 16)}-${state.etagSalt}"`;
    const headers = { 'Content-Type': q.type || 'application/octet-stream' };
    if (q.cd) headers['Content-Disposition'] = q.cd;

    if (mode === 'gz') {
      const gz = zlib.gzipSync(body);
      res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
      res.end(gz); state.stats.bytesSent += gz.length; return;
    }
    if (mode === 'chunked') { res.writeHead(200, headers); sendSlice(res, body, {}); return; }
    if (mode === 'norange') {
      res.writeHead(200, { ...headers, 'Content-Length': body.length });
      sendSlice(res, body, { bps: Number(q.bps || 0) }); return;
    }

    // Everything else honours Range.
    headers.ETag = etag;
    headers['Accept-Ranges'] = 'bytes';
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    const ifRange = req.headers['if-range'];
    if (!range || (ifRange && ifRange !== etag)) {
      res.writeHead(200, { ...headers, 'Content-Length': body.length });
      sendSlice(res, body, { bps: Number(q.bps || 0) }); return;
    }
    const start = Number(range[1]);
    const end = range[2] === '' ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
    if (start >= body.length) { res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); res.end(); return; }
    state.stats.ranges.push([start, end]);
    const slice = body.subarray(start, end + 1);
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': slice.length });
    if (req.method === 'HEAD') { res.end(); return; }
    const opts = { bps: Number(q.bps || 0) };
    if (mode === 'flaky' && slice.length > 1) opts.dropAfter = Math.min(Number(q.drop || 50000), slice.length - 1);
    if (mode === 'slowhead' && start < Number(q.below || 0)) opts.bps = Number(q.slow || 50000);
    if (mode === 'stall' && slice.length > 1) {
      if (state.stallBudget > 0) { state.stallBudget--; opts.stallAfter = Math.min(1000, slice.length - 1); }
    }
    sendSlice(res, slice, opts);
  });
  server.on('connection', (s) => { state.sockets.add(s); s.on('close', () => state.sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, state, stats: state.stats,
    url: (mode, name, query = {}) => {
      const qs = new URLSearchParams(query).toString();
      return `${base}/${mode}/${encodeURIComponent(name)}${qs ? `?${qs}` : ''}`;
    },
    close: () => new Promise((r) => { for (const s of state.sockets) s.destroy(); server.close(r); }),
  };
}

module.exports = { createServer, makeData, sha };

if (require.main === module) {
  // Standalone mode for manual and crash tests: node test/server.js <sizeBytes> -> prints base URL.
  const size = Number(process.argv[2] || 5 * 1024 * 1024);
  createServer({ 'file.bin': makeData(size, 7) }).then((s) => { console.log(s.base); });
}
