import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { localStorage } from './storage.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nma-storage-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const read = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
};

describe('localStorage', () => {
  test('put, get and delete round trip', async () => {
    const storage = localStorage({ dir });
    await storage.put('product/image/2026/10/a.png', Readable.from([Buffer.from('hello '), Buffer.from('world')]), { contentType: 'image/png', size: 11 });
    const found = await storage.get('product/image/2026/10/a.png');
    expect(found?.contentType).toBe('image/png');
    expect(found?.size).toBe(11);
    expect((await read(found!.body)).toString()).toBe('hello world');
    await storage.delete('product/image/2026/10/a.png');
    expect(await storage.get('product/image/2026/10/a.png')).toBeNull();
    await storage.delete('product/image/2026/10/a.png'); // already gone: fine
    expect(await readdir(join(dir, 'product/image/2026/10'))).toEqual([]);
  });

  test('a failing source leaves no file behind', async () => {
    const storage = localStorage({ dir });
    const broken = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    });
    await expect(storage.put('a/b.bin', broken, { contentType: 'application/pdf', size: 3 })).rejects.toThrow('boom');
    expect(await storage.get('a/b.bin')).toBeNull();
    expect(existsSync(join(dir, 'a'))).toBe(true);
    expect(await readdir(join(dir, 'a'))).toEqual([]);
  });

  test('keys that leave the directory are refused', async () => {
    const storage = localStorage({ dir });
    const body = () => Readable.from([Buffer.from('x')]);
    for (const key of ['../evil', 'a/../../evil', '/abs', 'a//b', 'a\\b', '', 'a/./b', 'a\0b']) {
      await expect(storage.put(key, body(), { contentType: 'text/plain', size: 1 })).rejects.toThrow(/invalid storage key/);
      await expect(storage.get(key)).rejects.toThrow(/invalid storage key/);
      await expect(storage.delete(key)).rejects.toThrow(/invalid storage key/);
    }
  });

  test('publicUrl follows publicBaseUrl, encoded per segment', () => {
    expect(localStorage({ dir }).publicUrl('a/b.png')).toBeUndefined();
    expect(localStorage({ dir, publicBaseUrl: 'https://cdn.example.com/files/' }).publicUrl('p/a b.png')).toBe('https://cdn.example.com/files/p/a%20b.png');
  });
});
