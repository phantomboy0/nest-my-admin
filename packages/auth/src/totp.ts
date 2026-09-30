import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, without padding (what authenticator apps expect). */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Accepts lower case, spaces and padding; throws on other characters. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`"${char}" is not base32`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 4226 HOTP (HMAC-SHA1). */
export function hotp(secret: Uint8Array, counter: number, digits = 6): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', secret).update(message).digest();
  const offset = hash[hash.length - 1]! & 15;
  const code = (hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}

export const TOTP_PERIOD = 30;

/** The 30-second step of a moment. */
export function totpStep(now: number): number {
  return Math.floor(now / 1000 / TOTP_PERIOD);
}

/** RFC 6238 TOTP for a moment (ms). */
export function totp(secret: Uint8Array, now: number, digits = 6): string {
  return hotp(secret, totpStep(now), digits);
}

/**
 * The step a code matches within ±`window` steps of `now`, newer than `after` (a code is never accepted twice), or
 * null. Codes are compared in constant time.
 */
export function verifyTotp(secret: Uint8Array, code: string, now: number, options: { after?: number | null; window?: number } = {}): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = totpStep(now);
  const window = options.window ?? 1;
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(clean)) && (options.after === undefined || options.after === null || step > options.after)) matched = step;
  }
  return matched;
}

/** 20 random bytes, the size RFC 4226 recommends for SHA-1. */
export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

/** The `otpauth://` URL authenticator apps scan. */
export function otpauthUrl(issuer: string, account: string, secret: Uint8Array): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: '6', period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The current code for a base32 key (what the authenticator app shows): for tests and scripts of your own. */
export function totpCode(secret: string, at: Date = new Date()): string {
  return totp(base32Decode(secret), at.getTime());
}
