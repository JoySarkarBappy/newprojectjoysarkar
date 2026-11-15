'use strict';
// A segment is { start, end, pos, owner }: bytes [start, end), `pos` is the next byte to fetch.

function planSegments(size, count, minSize) {
  const n = Math.max(1, Math.min(count, Math.floor(size / minSize) || 1));
  const each = Math.floor(size / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const start = i * each;
    const end = i === n - 1 ? size : start + each;
    out.push({ start, end, pos: start, owner: null });
  }
  return out;
}

/**
 * Give an idle connection something to do. Prefers a segment nobody owns; otherwise takes the
 * second half of whichever owned segment has the most left. Returns null if nothing is worth splitting.
 */
function claim(segments, minSize) {
  let free = null;
  for (const g of segments) {
    if (!g.owner && g.pos < g.end && (!free || g.end - g.pos > free.end - free.pos)) free = g;
  }
  if (free) return free;
  let victim = null;
  for (const g of segments) {
    if (g.owner && (!victim || g.end - g.pos > victim.end - victim.pos)) victim = g;
  }
  if (!victim || victim.end - victim.pos < 2 * minSize) return null;
  const mid = victim.pos + Math.ceil((victim.end - victim.pos) / 2);
  const fresh = { start: mid, end: victim.end, pos: mid, owner: null };
  victim.end = mid;
  segments.push(fresh);
  return fresh;
}

const remaining = (segments) => segments.reduce((a, g) => a + (g.end - g.pos), 0);
const downloaded = (segments) => segments.reduce((a, g) => a + (g.pos - g.start), 0);

module.exports = { planSegments, claim, remaining, downloaded };
