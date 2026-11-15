const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/engine/segments');

const covers = (segs, size) => {
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  let at = 0;
  for (const g of sorted) { assert.equal(g.start, at, 'no gap or overlap'); assert.ok(g.end > g.start); at = g.end; }
  assert.equal(at, size, 'covers whole file');
};

test('planSegments: splits evenly and covers the file exactly', () => {
  const segs = s.planSegments(1000, 4, 100);
  assert.equal(segs.length, 4);
  covers(segs, 1000);
  for (const g of segs) assert.equal(g.pos, g.start);
});
test('planSegments: fewer parts when file is small relative to minSize', () => {
  assert.equal(s.planSegments(250, 8, 100).length, 2);
  assert.equal(s.planSegments(50, 8, 100).length, 1);
  covers(s.planSegments(250, 8, 100), 250);
});
test('planSegments: size not divisible by count still covers exactly', () => {
  covers(s.planSegments(1003, 7, 10), 1003);
});

test('claim: takes an unowned unfinished segment first', () => {
  const segs = [
    { start: 0, end: 100, pos: 100, owner: null },
    { start: 100, end: 200, pos: 150, owner: null },
    { start: 200, end: 300, pos: 200, owner: 'x' },
  ];
  const got = s.claim(segs, 10);
  assert.equal(got, segs[1]);
});
test('claim: splits the busiest owned segment in half when nothing is free', () => {
  const segs = [
    { start: 0, end: 1000, pos: 200, owner: 'a' },
    { start: 1000, end: 1300, pos: 1100, owner: 'b' },
  ];
  const got = s.claim(segs, 100);
  assert.deepEqual({ start: got.start, end: got.end, pos: got.pos }, { start: 600, end: 1000, pos: 600 });
  assert.equal(segs[0].end, 600, 'victim shrinks');
  assert.equal(segs.length, 3);
  covers(segs, 1300);
});
test('claim: returns null when remaining pieces are too small to split', () => {
  const segs = [{ start: 0, end: 1000, pos: 850, owner: 'a' }];
  assert.equal(s.claim(segs, 100), null);
  assert.equal(segs.length, 1);
});
test('remaining/downloaded: totals', () => {
  const segs = [{ start: 0, end: 100, pos: 40 }, { start: 100, end: 300, pos: 300 }];
  assert.equal(s.remaining(segs), 60);
  assert.equal(s.downloaded(segs), 240);
});
