/** Fixed-window counter per key (in memory, per process): `limit` hits per `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Counts one hit; `retryAfter` (seconds) is set when the key is over its limit. */
  hit(key: string, now = Date.now()): { allowed: boolean; retryAfter: number } {
    if (this.hits.size > 10_000) for (const [name, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(name);
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count > this.limit ? { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) } : { allowed: true, retryAfter: 0 };
  }
}
