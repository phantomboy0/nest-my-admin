import { describe, expect, test } from 'bun:test';
import { base32Decode, base32Encode, hotp, otpauthUrl, totp, verifyTotp } from './totp.js';

// RFC 6238 appendix B (SHA-1 seed), 8 digits.
const SEED = Buffer.from('12345678901234567890');
const VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totp', () => {
  test('RFC 6238 vectors', () => {
    for (const [seconds, code] of VECTORS) expect(totp(SEED, seconds * 1000, 8)).toBe(code);
  });

  test('RFC 4226 HOTP vectors', () => {
    expect([0, 1, 2, 9].map((counter) => hotp(SEED, counter))).toEqual(['755224', '287082', '359152', '520489']);
  });

  test('base32 round trips and reads what people type', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb oi======').toString()).toBe('foobar');
    for (let n = 0; n < 40; n++) {
      const bytes = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
      expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    }
    expect(() => base32Decode('M1')).toThrow('not base32');
  });

  test('accepts one step either side, never an older or reused step', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    const code = (offset: number) => hotp(SEED, step + offset);
    expect(verifyTotp(SEED, code(0), now)).toBe(step);
    expect(verifyTotp(SEED, code(-1), now)).toBe(step - 1);
    expect(verifyTotp(SEED, code(1), now)).toBe(step + 1);
    expect(verifyTotp(SEED, code(2), now)).toBeNull();
    expect(verifyTotp(SEED, code(0), now, { after: step })).toBeNull(); // replay
    expect(verifyTotp(SEED, code(1), now, { after: step })).toBe(step + 1);
    expect(verifyTotp(SEED, `${code(0).slice(0, 3)} ${code(0).slice(3)}`, now)).toBe(step);
    expect(verifyTotp(SEED, 'abcdef', now)).toBeNull();
  });

  test('otpauth URLs', () => {
    expect(otpauthUrl('My Admin', 'ada@x', Buffer.from('foobar'))).toBe('otpauth://totp/My%20Admin:ada%40x?secret=MZXW6YTBOI&issuer=My+Admin&algorithm=SHA1&digits=6&period=30');
  });
});
