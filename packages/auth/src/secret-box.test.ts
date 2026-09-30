import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box.js';

describe('SecretBox', () => {
  const key = randomBytes(32).toString('base64');

  test('seals and opens; every seal differs', () => {
    const box = new SecretBox(key);
    const a = box.seal('JBSWY3DPEHPK3PXP');
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.seal('JBSWY3DPEHPK3PXP')).not.toBe(a);
    expect(box.open(a)).toBe('JBSWY3DPEHPK3PXP');
  });

  test('tampering and the wrong key fail', () => {
    const sealed = new SecretBox(key).seal('secret');
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    raw[raw.length - 1]! ^= 1;
    expect(() => new SecretBox(key).open(`v1:${raw.toString('base64url')}`)).toThrow();
    expect(() => new SecretBox(randomBytes(32).toString('base64')).open(sealed)).toThrow();
  });

  test('without a key: stored as is; sealed values need the key', () => {
    const plain = new SecretBox();
    expect(plain.seal('abc')).toBe('abc');
    expect(new SecretBox(key).open('abc')).toBe('abc'); // stored before a key was set
    expect(() => plain.open(new SecretBox(key).seal('abc'))).toThrow('no secretKey');
    expect(() => new SecretBox('c2hvcnQ=')).toThrow('32 bytes');
  });
});
