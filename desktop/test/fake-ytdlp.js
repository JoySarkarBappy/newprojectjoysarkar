#!/usr/bin/env node
'use strict';
// Stand-in for yt-dlp in tests: understands the handful of flags Srot passes and prints the same kind of lines.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const val = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const url = args[args.length - 1];

if (args.includes('--version')) { console.log('2026.01.01'); process.exit(0); }
if (url.includes('unavailable')) { console.error('ERROR: [fake] abc: Video unavailable'); process.exit(1); }
if (args.includes('-J')) {
  console.log(JSON.stringify({
    id: 'abc123', title: 'Test Lecture: Phase Diagrams', duration: 600, uploader: 'Prof', thumbnail: 'https://img/x.jpg',
    formats: [
      { format_id: '18', height: 360, vcodec: 'avc1', acodec: 'mp4a' },
      { format_id: '137', height: 1080, vcodec: 'avc1', acodec: 'none' },
      { format_id: '136', height: 720, vcodec: 'avc1', acodec: 'none' },
      { format_id: '140', height: null, vcodec: 'none', acodec: 'mp4a' },
    ],
  }));
  process.exit(0);
}
const dir = val('-P');
const out = path.join(dir, 'Test Lecture_ Phase Diagrams [abc123].mp4');
const part = `${out}.part`;
const total = 1000000;
let done = fs.existsSync(part) ? fs.statSync(part).size : 0;
if (!args.includes('--continue')) done = 0;
fs.writeFileSync(path.join(dir, 'fake-args.json'), JSON.stringify(args));
console.log('SROTMETA|abc123|Test Lecture: Phase Diagrams');
const step = () => {
  done = Math.min(total, done + 100000);
  fs.writeFileSync(part, Buffer.alloc(done));
  console.log(`SROT|${done}|${total}|NA|250000.5|${Math.ceil((total - done) / 250000)}`);
  if (done >= total) { fs.renameSync(part, out); console.log(`SROTFILE|${out}`); process.exit(0); }
  setTimeout(step, url.includes('slow') ? 60 : 5);
};
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));
step();
