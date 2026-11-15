'use strict';
// Token bucket. rate = bytes per second, 0 = unlimited. consume(n) returns how many ms the caller should pause.

class TokenBucket {
  constructor(rate = 0, now = Date.now) {
    this.now = now;
    this.rate = 0;
    this.tokens = 0;
    this.last = now();
    this.setRate(rate);
  }

  setRate(rate) {
    this.rate = Math.max(0, Number(rate) || 0);
    this.tokens = this.rate;
    this.last = this.now();
  }

  consume(n) {
    if (!this.rate) return 0;
    const t = this.now();
    this.tokens = Math.min(this.rate, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    this.tokens -= n;
    return this.tokens >= 0 ? 0 : Math.ceil((-this.tokens / this.rate) * 1000);
  }
}

module.exports = { TokenBucket };
