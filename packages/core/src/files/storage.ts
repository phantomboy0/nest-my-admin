import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Where uploaded files live. Implement it for any other store; keys are `<resource>/<field>/<yyyy>/<mm>/<uuid><ext>`. */
export interface AdminStorage {
  put(key: string, body: Readable, info: { contentType: string; size: number }): Promise<void>;
  get(key: string): Promise<{ body: Readable; contentType: string; size: number } | null>;
  delete(key: string): Promise<void>;
  /** A URL a browser can fetch directly, or undefined when downloads must go through the admin. */
  publicUrl(key: string): string | undefined;
}

/** Keys are relative paths of plain segments: no `..`, `.`, empty segments, backslashes or control characters. */
export function assertStorageKey(key: string): void {
  // eslint-disable-next-line no-control-regex
  if (key === '' || key.length > 1024 || /[\u0000-\u001f\\]/.test(key) || key.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`invalid storage key "${key.replace(/[^\x20-\x7e]/g, '?')}"`);
  }
}

export const encodeKey = (key: string): string => key.split('/').map(encodeURIComponent).join('/');

export interface LocalStorageOptions {
  /** Directory the files are written under. */
  dir: string;
  /** Set when the host serves `dir` itself (static files): public files then link there instead of through the admin. */
  publicBaseUrl?: string;
}

/** Files on disk. The content type is kept next to each file in a small `.meta` sidecar. */
export function localStorage(options: LocalStorageOptions): AdminStorage {
  const root = resolve(options.dir);
  const base = options.publicBaseUrl?.replace(/\/+$/, '');
  const pathOf = (key: string): string => {
    assertStorageKey(key);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error(`invalid storage key "${key}"`);
    return path;
  };
  return {
    async put(key, body, info) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await pipeline(body, createWriteStream(temp));
        await writeFile(`${path}.meta`, JSON.stringify({ contentType: info.contentType }));
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true });
        await rm(`${path}.meta`, { force: true });
        throw error;
      }
    },
    async get(key) {
      const path = pathOf(key);
      let size: number;
      try {
        size = (await stat(path)).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      let contentType = 'application/octet-stream';
      try {
        contentType = (JSON.parse(await readFile(`${path}.meta`, 'utf8')) as { contentType?: string }).contentType ?? contentType;
      } catch {
        // no sidecar: serve as opaque bytes
      }
      return { body: createReadStream(path), contentType, size };
    },
    async delete(key) {
      const path = pathOf(key);
      await rm(path, { force: true });
      await rm(`${path}.meta`, { force: true });
    },
    publicUrl: (key) => (base ? `${base}/${encodeKey(key)}` : undefined),
  };
}
