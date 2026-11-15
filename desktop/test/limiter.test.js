const test = require('node:test');
const assert = require('node:assert/strict');
const { TokenBucket } = require('../src/engine/limiter');

test('unlimited bucket never asks to wait', () => {
  const b = new TokenBucket(0, () => 0);
  assert.equal(b.consume(10_000_000), 0);
});
test('within burst there is no wait, beyond it the wait matches the deficit', () => {
  let now = 0;
  const b = new TokenBucket(1000, () => now);   // 1000 bytes/s, burst 1000
  assert.equal(b.consume(1000), 0);
  assert.equal(b.consume(500), 500);            // 500 bytes over => 0.5 s
});
test('tokens refill with time but never above one second of burst', () => {
  let now = 0;
  const b = new TokenBucket(1000, () => now);
  b.consume(1000);
  now = 10_000;
  assert.equal(b.consume(1000), 0);
  assert.equal(b.consume(1000), 1000);
});
test('setRate changes the pace; 0 turns limiting off', () => {
  let now = 0;
  const b = new TokenBucket(1000, () => now);
  b.setRate(0);
  assert.equal(b.consume(999999), 0);
  b.setRate(2000);
  b.consume(2000);
  assert.equal(b.consume(1000), 500);
});
