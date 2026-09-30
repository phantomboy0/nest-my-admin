import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PREFIX = 'v1:';

/**
 * Seals small secrets (TOTP keys) at rest with AES-256-GCM. Without a key, values are stored as they are; values
 * stored before a key was set are still read, and sealed on their next write.
 */
export class SecretBox {
  private readonly key?: Buffer;

  /** `key`: 32 bytes, base64 (`openssl rand -base64 32`). */
  constructor(key?: string) {
    if (key === undefined) return;
    const bytes = Buffer.from(key, 'base64');
    if (bytes.length !== 32) throw new Error('@nest-my-admin/auth: secretKey must be 32 bytes, base64 encoded (openssl rand -base64 32)');
    this.key = bytes;
  }

  get encrypts(): boolean {
    return this.key !== undefined;
  }

  seal(plain: string): string {
    if (!this.key) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  open(stored: string): string {
    if (!stored.startsWith(PREFIX)) return stored;
    if (!this.key) throw new Error('@nest-my-admin/auth: a two-factor secret is encrypted, but no secretKey is configured');
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
