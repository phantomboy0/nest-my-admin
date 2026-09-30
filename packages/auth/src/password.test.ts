import { describe, expect, test } from 'bun:test';
import { hashPassword, passwordProblems, verifyPassword } from './password.js';

const FAST = { N: 1024, r: 8, p: 1, keylen: 64 };

describe('passwords', () => {
  test('hash and verify', async () => {
    const hash = await hashPassword('correct horse battery', FAST);
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterY', hash)).toBe(false);
    expect(await hashPassword('same', FAST)).not.toBe(await hashPassword('same', FAST)); // salted
  });
  test('the default cost is used and stored', async () => {
    expect(await hashPassword('x')).toStartWith('scrypt$32768$8$1$');
  });
  test('tampered or foreign hashes do not verify', async () => {
    const hash = await hashPassword('secret-pass', FAST);
    const parts = hash.split('$');
    const key = Buffer.from(parts[5]!, 'base64');
    key[0] = key[0]! ^ 1;
    expect(await verifyPassword('secret-pass', [...parts.slice(0, 5), key.toString('base64')].join('$'))).toBe(false);
    expect(await verifyPassword('secret-pass', '$2b$10$bcrypthashhere')).toBe(false);
    expect(await verifyPassword('secret-pass', 'scrypt$99999999$8$1$c2FsdA==$aGFzaA==')).toBe(false);
    expect(await verifyPassword('secret-pass', '')).toBe(false);
  });
  test('policy', () => {
    expect(passwordProblems('short', {})).toEqual(['must be at least 10 characters']);
    expect(passwordProblems('administrator', { username: 'Administrator' })).toEqual(['must not be the username']);
    expect(passwordProblems('long enough pass', { username: 'ada' })).toEqual([]);
    expect(passwordProblems('abcdef', {}, { minLength: 6 })).toEqual([]);
  });
});
