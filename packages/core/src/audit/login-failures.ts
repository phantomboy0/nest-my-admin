/** Failed sign-ins of one address and username recorded one by one within a window; the next one is recorded as `limited`. */
export const PAIR_LIMIT = 5;
/** The same for one address across every username (someone rotating usernames). */
export const IP_LIMIT = 50;
export const WINDOW_MS = 60_000;
/** Windows kept in memory; beyond it, failures of new addresses are only counted. */
const MAX_WINDOWS = 10_000;

interface Window {
  start: number;
  count: number;
  /** A lockout answer (429) was recorded in this window: its repeats are not. */
  lockedOut: boolean;
  suppressed: number;
  ip?: string;
  username?: string;
}

/** What to do with one failed sign-in. `limited`: it is the last one recorded for its window. */
export type Verdict = { record: false } | { record: true; limited?: true };

/** A closed window that left failures out: one summary entry says how many. */
export interface Suppressed {
  ip?: string;
  username?: string;
  suppressed: number;
}

/**
 * Keeps failed sign-ins from filling the audit table. Per address and username, a minute's first 5 failures are
 * recorded, the 6th is recorded as `limited`, and the rest are counted; the same per address across usernames with
 * 50. Of a lockout's answers (429) only the first of the window is recorded. When a window closes, `closed()` hands
 * back how many failures it left out. Memory only, bounded, per process.
 */
export class LoginFailures {
  private readonly pairs = new Map<string, Window>();
  private readonly ips = new Map<string, Window>();
  /** Failures left out because the maps were full. */
  private overflow = 0;

  note(ip: string | undefined, username: string, lockout: boolean, now: number): Verdict {
    const address = ip ?? '';
    const byIp = this.window(this.ips, address, now, { ip });
    const pair = byIp && this.window(this.pairs, `${address}\n${username.toLowerCase()}`, now, { ip, username });
    if (!byIp || !pair) {
      this.overflow += 1;
      return { record: false };
    }
    byIp.count += 1;
    if (byIp.count > IP_LIMIT + 1) {
      byIp.suppressed += 1;
      return { record: false };
    }
    if (byIp.count === IP_LIMIT + 1) return { record: true, limited: true };
    if (lockout) {
      if (pair.lockedOut) {
        pair.suppressed += 1;
        return { record: false };
      }
      pair.lockedOut = true;
      return { record: true };
    }
    pair.count += 1;
    if (pair.count > PAIR_LIMIT + 1) {
      pair.suppressed += 1;
      return { record: false };
    }
    return pair.count === PAIR_LIMIT + 1 ? { record: true, limited: true } : { record: true };
  }

  /** The windows that have closed by `now` and left failures out; they are forgotten. */
  closed(now: number): Suppressed[] {
    const out: Suppressed[] = [];
    for (const map of [this.ips, this.pairs]) {
      for (const [key, window] of map) {
        if (now - window.start < WINDOW_MS) continue;
        map.delete(key);
        if (window.suppressed > 0) out.push({ ...(window.ip ? { ip: window.ip } : {}), ...(window.username !== undefined ? { username: window.username } : {}), suppressed: window.suppressed });
      }
    }
    if (this.overflow > 0 && this.ips.size < MAX_WINDOWS) {
      out.push({ suppressed: this.overflow });
      this.overflow = 0;
    }
    return out;
  }

  /** Whether anything is being tracked (a timer is worth keeping). */
  get active(): boolean {
    return this.ips.size > 0 || this.pairs.size > 0 || this.overflow > 0;
  }

  private window(map: Map<string, Window>, key: string, now: number, who: { ip?: string; username?: string }): Window | undefined {
    const existing = map.get(key);
    // Callers close the windows that ran out (`closed()`) before they note a failure: one found here is open.
    if (existing) return existing;
    if (map.size >= MAX_WINDOWS) return undefined;
    const window: Window = { start: now, count: 0, lockedOut: false, suppressed: 0, ...who };
    map.set(key, window);
    return window;
  }
}
