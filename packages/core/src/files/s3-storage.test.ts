import { describe, expect, test } from 'bun:test';
import { Readable } from 'node:stream';
import { s3Storage } from './s3-storage.js';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function fake(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetcher = (async (input: URL | string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    let body: string | undefined;
    if (init.body) {
      const chunks: Buffer[] = [];
      for await (const chunk of init.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
      body = Buffer.concat(chunks).toString();
    }
    const call = { url: String(input), method: init.method ?? 'GET', headers, body };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const config = { endpoint: 'https://s3.example.com', region: 'eu-1', bucket: 'shop', accessKeyId: 'AK', secretAccessKey: 'SK' };

describe('s3Storage (mocked fetch)', () => {
  test('put sends a signed PUT with the body and its length', async () => {
    const { calls, fetcher } = fake(() => new Response(null, { status: 200 }));
    const storage = s3Storage({ ...config, fetch: fetcher });
    await storage.put('product/image/a b.png', Readable.from([Buffer.from('abc')]), { contentType: 'image/png', size: 3 });
    const [call] = calls;
    expect(call!.method).toBe('PUT');
    expect(call!.url).toBe('https://shop.s3.example.com/product/image/a%20b.png');
    expect(call!.body).toBe('abc');
    expect(call!.headers['content-type']).toBe('image/png');
    expect(call!.headers['content-length']).toBe('3');
    expect(call!.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/eu-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });

  test('forcePathStyle puts the bucket in the path', async () => {
    const { calls, fetcher } = fake(() => new Response(null, { status: 204 }));
    await s3Storage({ ...config, forcePathStyle: true, fetch: fetcher }).delete('a/b.pdf');
    expect(calls[0]!.url).toBe('https://s3.example.com/shop/a/b.pdf');
    expect(calls[0]!.method).toBe('DELETE');
  });

  test('get returns the body, and null for a missing object', async () => {
    const { fetcher } = fake((call) =>
      call.url.endsWith('/there.png') ? new Response('bytes', { status: 200, headers: { 'content-type': 'image/png', 'content-length': '5' } }) : new Response('<Error/>', { status: 404 }),
    );
    const storage = s3Storage({ ...config, fetch: fetcher });
    const found = await storage.get('there.png');
    expect(found?.contentType).toBe('image/png');
    expect(found?.size).toBe(5);
    const chunks: Buffer[] = [];
    for await (const chunk of found!.body) chunks.push(Buffer.from(chunk as Uint8Array));
    expect(Buffer.concat(chunks).toString()).toBe('bytes');
    expect(await storage.get('gone.png')).toBeNull();
  });

  test('errors carry the status but not the response body', async () => {
    const { fetcher } = fake(() => new Response('<Error>SecretDetails</Error>', { status: 403 }));
    const storage = s3Storage({ ...config, fetch: fetcher });
    await expect(storage.delete('a.png')).rejects.toThrow('status 403');
    await expect(storage.get('a.png')).rejects.toThrow('status 403');
    await expect(storage.put('a.png', Readable.from([Buffer.from('x')]), { contentType: 'image/png', size: 1 })).rejects.toThrow('status 403');
  });

  test('keys that leave the prefix are refused and publicUrl follows publicBaseUrl', async () => {
    const { calls, fetcher } = fake(() => new Response(null));
    const storage = s3Storage({ ...config, publicBaseUrl: 'https://cdn.example.com/', fetch: fetcher });
    await expect(storage.get('../x')).rejects.toThrow(/invalid storage key/);
    expect(calls).toHaveLength(0);
    expect(storage.publicUrl('a/b c.png')).toBe('https://cdn.example.com/a/b%20c.png');
    expect(s3Storage({ ...config, fetch: fetcher }).publicUrl('a.png')).toBeUndefined();
  });
});
