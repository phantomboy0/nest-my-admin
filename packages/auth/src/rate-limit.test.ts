import { describe, expect, test } from 'bun:test';
import { RateLimiter } from './rate-limit.js';

describe('rate limiter', () => {
  test('allows `limit` hits per window, then tells how long to wait', () => {
    const limiter = new RateLimiter(2, 60_000);
    expect(limiter.hit('ip', 0).allowed).toBe(true);
    expect(limiter.hit('ip', 1_000).allowed).toBe(true);
    expect(limiter.hit('ip', 2_000)).toEqual({ allowed: false, retryAfter: 58 });
    expect(limiter.hit('other', 2_000).allowed).toBe(true);
    expect(limiter.hit('ip', 60_000).allowed).toBe(true); // a new window
  });
});
