import { describe, expect, test } from 'bun:test';
import { GLOBAL_LIMIT, IP_LIMIT, LoginFailures, SUMMARY_LIMIT, WINDOW_MS, addressBucket } from './login-failures.js';

const T0 = 1_000_000;
const v4 = (index: number) => `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`;

describe('addressBucket', () => {
  test('IPv4 addresses are their own bucket', () => {
    expect(addressBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('203.0.113.8')).toBe('203.0.113.8');
  });

  test('IPv6 addresses are bucketed by their /64, however they are written', () => {
    expect(addressBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('2001:db8:1:2::')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('[2001:db8:1:2::9]')).toBe('2001:db8:1:2::/64');
    expect(addressBucket('fe80::1%en0')).toBe('fe80:0:0:0::/64');
    expect(addressBucket('::1')).toBe('0:0:0:0::/64');
    expect(addressBucket('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
  });

  test('IPv4-mapped IPv6 is the IPv4 address', () => {
    expect(addressBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(addressBucket('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(addressBucket('0:0:0:0:0:ffff:cb00:7107')).toBe('203.0.113.7');
  });

  test('no address, and what is no address, are kept as they are', () => {
    expect(addressBucket(undefined)).toBe('');
    expect(addressBucket('unix:/run/app.sock')).toBe('unix:/run/app.sock');
    expect(addressBucket('1:2:3')).toBe('1:2:3');
    expect(addressBucket('::ffff:999.1.1.1')).toBe('::ffff:999.1.1.1');
  });
});

describe('LoginFailures: per address', () => {
  test('one /64 shares the per-address cap, and the per-pair cap for one username', () => {
    const failures = new LoginFailures();
    // One client walking through its /64: every attempt from another address, another username.
    const verdicts = Array.from({ length: IP_LIMIT + 5 }, (_, index) => failures.note(`2001:db8:1:2::${(index + 1).toString(16)}`, `user${index}`, false, T0));
    expect(verdicts.filter((verdict) => verdict.record)).toHaveLength(IP_LIMIT + 1);
    expect(verdicts[IP_LIMIT]).toEqual({ record: true, limited: true });
    expect(failures.closed(T0 + WINDOW_MS)).toEqual([{ ip: '2001:db8:1:2::/64', suppressed: 4 }]);

    // The same username from many addresses of one /64 is one pair.
    const pair = Array.from({ length: 9 }, (_, index) => failures.note(`2001:db8:9:9::${index + 1}`, 'ada', false, T0 + WINDOW_MS));
    expect(pair.filter((verdict) => verdict.record)).toHaveLength(6);
    expect(failures.closed(T0 + 2 * WINDOW_MS)).toEqual([{ ip: '2001:db8:9:9::/64', username: 'ada', suppressed: 3 }]);
  });

  test('another /64 and IPv4 addresses have caps of their own; a mapped address shares its IPv4 one', () => {
    const failures = new LoginFailures();
    for (let index = 0; index < IP_LIMIT + 1; index += 1) failures.note('2001:db8:1:2::1', `user${index}`, false, T0);
    expect(failures.note('2001:db8:1:2::2', 'next', false, T0)).toEqual({ record: false });
    expect(failures.note('2001:db8:1:3::2', 'next', false, T0)).toEqual({ record: true });
    for (let index = 0; index < IP_LIMIT + 1; index += 1) failures.note('192.0.2.1', `user${index}`, false, T0);
    expect(failures.note('::ffff:192.0.2.1', 'next', false, T0)).toEqual({ record: false });
    expect(failures.note('192.0.2.2', 'next', false, T0)).toEqual({ record: true });
  });
});

describe('LoginFailures: the ceiling of the whole process', () => {
  test(`a minute records ${GLOBAL_LIMIT} failures whatever their addresses, then counts; one summary says how many`, () => {
    const failures = new LoginFailures();
    const verdicts = Array.from({ length: GLOBAL_LIMIT + 125 }, (_, index) => failures.note(v4(index), `user${index}`, false, T0 + index));
    expect(verdicts.filter((verdict) => verdict.record)).toHaveLength(GLOBAL_LIMIT);
    expect(verdicts.slice(GLOBAL_LIMIT).every((verdict) => !verdict.record)).toBe(true);
    // Nothing while the minute is open.
    expect(failures.closed(T0 + WINDOW_MS - 1)).toEqual([]);
    expect(failures.active).toBe(true);
    // One summary, naming nobody; the addresses themselves left nothing out.
    expect(failures.closed(T0 + WINDOW_MS + GLOBAL_LIMIT + 200)).toEqual([{ suppressed: 125 }]);
    expect(failures.active).toBe(false);
    // The next minute records again.
    expect(failures.note(v4(1), 'user1', false, T0 + 3 * WINDOW_MS)).toEqual({ record: true });
  });

  test('what an address or a pair already left out does not count against the ceiling', () => {
    const failures = new LoginFailures();
    for (let attempt = 0; attempt < 40; attempt += 1) failures.note('192.0.2.1', 'ada', false, T0);
    // 6 were recorded; the ceiling has room for the rest.
    const others = Array.from({ length: GLOBAL_LIMIT - 6 + 3 }, (_, index) => failures.note(v4(index), 'x', false, T0));
    expect(others.filter((verdict) => verdict.record)).toHaveLength(GLOBAL_LIMIT - 6);
    const closed = failures.closed(T0 + WINDOW_MS);
    expect(closed).toContainEqual({ ip: '192.0.2.1', username: 'ada', suppressed: 34 });
    expect(closed).toContainEqual({ suppressed: 3 });
    expect(closed).toHaveLength(2);
  });

  test('the summaries of one closing are bounded too: beyond the limit their counts are summed into one', () => {
    const failures = new LoginFailures();
    // Many pairs, each over its own cap, spread over time so the ceiling is not what stops them.
    const pairs = SUMMARY_LIMIT + 20;
    for (let index = 0; index < pairs; index += 1) {
      for (let attempt = 0; attempt < 8; attempt += 1) failures.note(v4(index), 'ada', false, T0);
    }
    const closed = failures.closed(T0 + WINDOW_MS);
    expect(closed.length).toBe(SUMMARY_LIMIT + 1);
    expect(closed.filter((left) => left.ip === undefined)).toHaveLength(1);
    // Nothing is lost from the count: every failure is either recorded or in a summary.
    const recorded = Math.min(GLOBAL_LIMIT, pairs * 6);
    expect(closed.reduce((sum, left) => sum + left.suppressed, 0)).toBe(pairs * 8 - recorded);
  });
});
