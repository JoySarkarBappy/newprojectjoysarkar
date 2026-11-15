const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const f = require('../src/engine/filename');

test('content-disposition: quoted filename', () => {
  assert.equal(f.parseContentDisposition('attachment; filename="my file.zip"'), 'my file.zip');
});
test('content-disposition: unquoted filename', () => {
  assert.equal(f.parseContentDisposition('attachment; filename=setup.exe'), 'setup.exe');
});
test('content-disposition: filename* wins and is percent-decoded', () => {
  const h = "attachment; filename=\"fallback.pdf\"; filename*=UTF-8''%E0%A6%AC%E0%A6%BE%E0%A6%82%E0%A6%B2%E0%A6%BE.pdf";
  assert.equal(f.parseContentDisposition(h), 'বাংলা.pdf');
});
test('content-disposition: raw utf-8 bytes read as latin1 are repaired', () => {
  const latin1 = Buffer.from('বাংলা.pdf', 'utf8').toString('latin1');
  assert.equal(f.parseContentDisposition(`attachment; filename="${latin1}"`), 'বাংলা.pdf');
});
test('content-disposition: missing or inline without name gives null', () => {
  assert.equal(f.parseContentDisposition(undefined), null);
  assert.equal(f.parseContentDisposition('inline'), null);
});

test('sanitize: path traversal cannot escape', () => {
  assert.equal(f.sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(f.sanitizeFilename('..\\..\\windows\\evil.exe'), 'evil.exe');
  assert.equal(f.sanitizeFilename('/abs/path/file.txt'), 'file.txt');
});
test('sanitize: control and illegal characters replaced', () => {
  assert.equal(f.sanitizeFilename('a:b*c?d"e<f>g|h\u0000i\n.txt'), 'a_b_c_d_e_f_g_h_i_.txt');
});
test('sanitize: leading dots and trailing dots/spaces removed', () => {
  assert.equal(f.sanitizeFilename('...hidden.txt. . '), 'hidden.txt');
});
test('sanitize: empty or dot-only names fall back to "download"', () => {
  assert.equal(f.sanitizeFilename(''), 'download');
  assert.equal(f.sanitizeFilename('..'), 'download');
  assert.equal(f.sanitizeFilename('/'), 'download');
});
test('sanitize: very long names are cut to 200 bytes and keep the extension', () => {
  const out = f.sanitizeFilename('ক'.repeat(300) + '.mp4');
  assert.ok(Buffer.byteLength(out) <= 200, 'at most 200 bytes');
  assert.ok(out.endsWith('.mp4'));
  assert.ok(!out.includes('�'), 'no broken characters');
});

test('filenameFromUrl: decodes last path segment, ignores query', () => {
  assert.equal(f.filenameFromUrl('https://x.com/a/b/My%20File.zip?token=1#frag'), 'My File.zip');
  assert.equal(f.filenameFromUrl('https://x.com/'), 'download');
  assert.equal(f.filenameFromUrl('https://x.com/bad%ZZname.bin'), 'bad%ZZname.bin');
});

test('uniquePath: returns as-is when free, numbers when taken', () => {
  const taken = new Set([path.join('/d', 'a.zip'), path.join('/d', 'a (1).zip')]);
  const exists = (p) => taken.has(p);
  assert.equal(f.uniquePath('/d', 'b.zip', exists), path.join('/d', 'b.zip'));
  assert.equal(f.uniquePath('/d', 'a.zip', exists), path.join('/d', 'a (2).zip'));
});
test('uniquePath: multi-part extension handled', () => {
  const exists = (p) => p === path.join('/d', 'x.tar.gz');
  assert.equal(f.uniquePath('/d', 'x.tar.gz', exists), path.join('/d', 'x (1).tar.gz'));
});

test('categoryOf: by extension', () => {
  assert.equal(f.categoryOf('a.MP4'), 'video');
  assert.equal(f.categoryOf('a.mp3'), 'audio');
  assert.equal(f.categoryOf('a.pdf'), 'document');
  assert.equal(f.categoryOf('a.zip'), 'archive');
  assert.equal(f.categoryOf('a.dmg'), 'program');
  assert.equal(f.categoryOf('a.png'), 'image');
  assert.equal(f.categoryOf('noext'), 'other');
});

test('withMimeExtension: adds extension only when missing', () => {
  assert.equal(f.withMimeExtension('report', 'application/pdf; charset=x'), 'report.pdf');
  assert.equal(f.withMimeExtension('report.pdf', 'application/zip'), 'report.pdf');
  assert.equal(f.withMimeExtension('thing', 'application/octet-stream'), 'thing');
});

test('sanitize: names Windows reserves for devices are made safe, look-alikes are left alone', () => {
  assert.equal(f.sanitizeFilename('CON.txt'), '_CON.txt');
  assert.equal(f.sanitizeFilename('nul'), '_nul');
  assert.equal(f.sanitizeFilename('COM1.zip'), '_COM1.zip');
  assert.equal(f.sanitizeFilename('lpt9.tar.gz'), '_lpt9.tar.gz');
  assert.equal(f.sanitizeFilename('console.txt'), 'console.txt');
  assert.equal(f.sanitizeFilename('COM10.zip'), 'COM10.zip');
});
