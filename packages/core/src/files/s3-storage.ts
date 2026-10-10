import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { signRequest } from './sigv4.js';
import { assertStorageKey, encodeKey, type AdminStorage } from './storage.js';

export interface S3StorageOptions {
  /** `https://s3.eu-central-1.amazonaws.com`, `https://storage.iran.liara.space`, a MinIO or R2 endpoint, ... */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Set when the bucket is public (or behind a CDN): public files then link there. */
  publicBaseUrl?: string;
  /** `endpoint/bucket/key` instead of `bucket.endpoint/key`. Needed by MinIO and many other S3-compatible stores. */
  forcePathStyle?: boolean;
  /** Advanced: a replacement for the global fetch (tests, proxies). */
  fetch?: typeof fetch;
}

const UNSIGNED = 'UNSIGNED-PAYLOAD';

/** S3 and S3-compatible stores (ArvanCloud, R2, MinIO) over plain HTTP with our own SigV4 signing; no SDK. */
export function s3Storage(options: S3StorageOptions): AdminStorage {
  const endpoint = new URL(options.endpoint);
  const base = options.publicBaseUrl?.replace(/\/+$/, '');
  const send = options.fetch ?? fetch;

  const urlOf = (key: string): URL => {
    assertStorageKey(key);
    const encoded = encodeKey(key);
    return options.forcePathStyle
      ? new URL(`${endpoint.protocol}//${endpoint.host}/${encodeURIComponent(options.bucket)}/${encoded}`)
      : new URL(`${endpoint.protocol}//${options.bucket}.${endpoint.host}/${encoded}`);
  };
  const signed = (method: string, url: URL, headers: Record<string, string> = {}): Record<string, string> =>
    signRequest({
      method,
      url,
      headers,
      payloadHash: UNSIGNED,
      includeContentSha256: true,
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      sessionToken: options.sessionToken,
      region: options.region,
      service: 's3',
    });
  const fail = (action: string, key: string, response: Response): never => {
    throw new Error(`S3 ${action} of "${key}" failed with status ${response.status}`);
  };

  return {
    async put(key, body, info) {
      const url = urlOf(key);
      const headers = signed('PUT', url, { 'content-type': info.contentType });
      const response = await send(url, {
        method: 'PUT',
        headers: { ...headers, 'content-length': String(info.size) },
        body: Readable.toWeb(body) as unknown as ReadableStream,
        // required by fetch when the body is a stream
        duplex: 'half',
      } as RequestInit);
      if (!response.ok) fail('upload', key, response);
    },
    async get(key) {
      const url = urlOf(key);
      const response = await send(url, { method: 'GET', headers: signed('GET', url) });
      if (response.status === 404) return null;
      if (!response.ok || !response.body) return fail('download', key, response);
      return {
        body: Readable.fromWeb(response.body as unknown as WebReadableStream),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        size: Number(response.headers.get('content-length') ?? 0),
      };
    },
    async delete(key) {
      const url = urlOf(key);
      const response = await send(url, { method: 'DELETE', headers: signed('DELETE', url) });
      if (!response.ok && response.status !== 404) fail('delete', key, response);
    },
    publicUrl: (key) => (base ? `${base}/${encodeKey(key)}` : undefined),
  };
}
