import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))));

/** scrypt cost: N = 2^15, r = 8, p = 1 (about 32 MB and tens of milliseconds per hash). */
export const SCRYPT = { N: 32_768, r: 8, p: 1, keylen: 64 };

function maxmem(N: number, r: number, p: number): number {
  return 128 * N * r * p + 16 * 1024 * 1024;
}

/** `scrypt$N$r$p$salt$hash` (base64): self-describing, so the cost can grow without breaking stored hashes. */
export async function hashPassword(password: string, cost = SCRYPT): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, cost.keylen, { N: cost.N, r: cost.r, p: cost.p, maxmem: maxmem(cost.N, cost.r, cost.p) });
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Constant-time check; a malformed or foreign hash is simply `false`. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0) || N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (salt.length < 8 || expected.length < 16) return false;
  const key = await scrypt(password.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: maxmem(N, r, p) });
  return timingSafeEqual(key, expected);
}

export interface PasswordPolicy {
  /** Default 10. */
  minLength?: number;
}

/** Problems with a new password (empty when it is acceptable). */
export function passwordProblems(password: string, context: { username?: string }, policy: PasswordPolicy = {}): string[] {
  const minLength = policy.minLength ?? 10;
  const problems: string[] = [];
  if ([...password].length < minLength) problems.push(`must be at least ${minLength} characters`);
  if ([...password].length > 256) problems.push('must be at most 256 characters');
  if (context.username && password.trim().toLowerCase() === context.username.trim().toLowerCase()) problems.push('must not be the username');
  return problems;
}
