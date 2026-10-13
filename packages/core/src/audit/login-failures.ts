/** Failed sign-ins of one address and username recorded one by one within a window; the next one is recorded as `limited`. */
export const PAIR_LIMIT = 5;
/** The same for one address across every username (someone rotating usernames). */
export const IP_LIMIT = 50;
/**
 * Failed sign-ins recorded within a window by the whole process, whatever their addresses and usernames: the caps
 * above are per address, and a client with many addresses (a botnet, more than one IPv6 /64) has as many of them.
 * Beyond it failures are only counted, and one summary per window says how many.
 */
export const GLOBAL_LIMIT = 300;
/** Summaries of one closing that name their address (and username); the counts of the rest are summed into one that names nobody. */
export const SUMMARY_LIMIT = 100;
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
 * What the per-address caps count as one address: an IPv4 address itself, an IPv6 address's /64 (a single client is
 * usually handed a whole /64, and can use a new address of it for every request), and for an IPv4-mapped IPv6
 * address (`::ffff:203.0.113.7`) the IPv4 address. What is no IP address is kept as it is.
 */
export function addressBucket(ip: string | undefined): string {
  if (!ip) return '';
  let text = ip.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  const groups = ipv6Groups(text);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return `${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}

/** The eight 16-bit groups of an IPv6 address in any of its spellings, or nothing when `text` is not one. */
function ipv6Groups(text: string): number[] | undefined {
  if (!text.includes(':')) return undefined;
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (half: string): number[] | undefined => {
    if (half === '') return [];
    const out: number[] = [];
    const parts = half.split(':');
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1 && part.includes('.')) {
        // An IPv4 tail (`::ffff:203.0.113.7`) is the last two groups.
        const octets = part.split('.');
        if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet) || Number(octet) > 255)) return undefined;
        const [a, b, c, d] = octets.map(Number) as [number, number, number, number];
        out.push((a << 8) | b, (c << 8) | d);
      } else if (/^[0-9a-f]{1,4}$/.test(part)) out.push(parseInt(part, 16));
      else return undefined;
    }
    return out;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...Array.from({ length: missing }, () => 0), ...tail] : undefined;
}

/**
 * Keeps failed sign-ins from filling the audit table. Three caps, each per minute, in memory, per process:
 *
 * - per address and username: the first 5 failures are recorded, the 6th is recorded as `limited`, and the rest
 *   are counted;
 * - per address across usernames: the same with 50;
 * - the whole process: 300 recorded failures (`GLOBAL_LIMIT`), whatever their addresses; the rest are counted.
 *
 * "Address" is `addressBucket`: an IPv6 /64 is one address. Of a lockout's answers (429) only the first of the
 * window is recorded. When a window closes, `closed()` hands back how many failures it left out: one summary per
 * address (and username), at most 100 of them (`SUMMARY_LIMIT`), and one that names nobody for the ceiling and
 * everything else. So a minute writes at most 300 entries and 101 summaries, whoever is guessing. Successful
 * sign-ins never come here: they are always recorded.
 */
export class LoginFailures {
  private readonly pairs = new Map<string, Window>();
  private readonly ips = new Map<string, Window>();
  /** Failures left out because the maps were full. */
  private overflow = 0;
  /** The process's own window: what every address together had recorded in it, and what the ceiling left out. */
  private total?: { start: number; recorded: number; suppressed: number };

  note(ip: string | undefined, username: string, lockout: boolean, now: number): Verdict {
    const verdict = this.noteAddress(ip, username, lockout, now);
    if (!verdict.record) return verdict;
    // The ceiling counts what would be written, so what an address or a pair already left out takes none of it.
    const total = (this.total ??= { start: now, recorded: 0, suppressed: 0 });
    if (total.recorded >= GLOBAL_LIMIT) {
      total.suppressed += 1;
      return { record: false };
    }
    total.recorded += 1;
    return verdict;
  }

  private noteAddress(ip: string | undefined, username: string, lockout: boolean, now: number): Verdict {
    const address = addressBucket(ip);
    const who = address === '' ? {} : { ip: address };
    const byIp = this.window(this.ips, address, now, who);
    const pair = byIp && this.window(this.pairs, `${address}\n${username.toLowerCase()}`, now, { ...who, username });
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

  /**
   * The windows that have closed by `now` and left failures out; they are forgotten. At most `SUMMARY_LIMIT` of
   * them are named; the counts of the others, of the ceiling and of the overflow come as one that names nobody.
   */
  closed(now: number): Suppressed[] {
    const out: Suppressed[] = [];
    let unnamed = 0;
    for (const map of [this.ips, this.pairs]) {
      for (const [key, window] of map) {
        if (now - window.start < WINDOW_MS) continue;
        map.delete(key);
        if (window.suppressed === 0) continue;
        if (out.length >= SUMMARY_LIMIT) unnamed += window.suppressed;
        else out.push({ ...(window.ip ? { ip: window.ip } : {}), ...(window.username !== undefined ? { username: window.username } : {}), suppressed: window.suppressed });
      }
    }
    if (this.total && now - this.total.start >= WINDOW_MS) {
      unnamed += this.total.suppressed;
      this.total = undefined;
    }
    if (this.overflow > 0 && this.ips.size < MAX_WINDOWS) {
      unnamed += this.overflow;
      this.overflow = 0;
    }
    if (unnamed > 0) out.push({ suppressed: unnamed });
    return out;
  }

  /** Whether anything is being tracked (a timer is worth keeping). */
  get active(): boolean {
    return this.ips.size > 0 || this.pairs.size > 0 || this.overflow > 0 || this.total !== undefined;
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
