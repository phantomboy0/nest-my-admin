import { createHash, createHmac } from 'node:crypto';

/** AWS Signature Version 4 with node:crypto only (no SDK, so core keeps zero runtime dependencies). */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  /** Signing time; default now. */
  date?: Date;
}

export interface SignInput extends SigV4Credentials {
  method: string;
  url: string | URL;
  headers?: Record<string, string>;
  /** Lower-case hex SHA-256 of the body, or `UNSIGNED-PAYLOAD`. */
  payloadHash: string;
  /** Send `x-amz-content-sha256` (S3 requires it). */
  includeContentSha256?: boolean;
}

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Uint8Array, data: string): Buffer => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as SigV4 wants it: everything but `A-Za-z0-9-_.~` is percent-encoded. */
const encode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const stamp = (date: Date): { amzDate: string; day: string } => {
  const amzDate = date.toISOString().replace(/[-:]|\.\d{3}/g, '');
  return { amzDate, day: amzDate.slice(0, 8) };
};

/** The path with every segment encoded once (S3 style: no normalisation, no double encoding). */
function canonicalPath(url: URL): string {
  return url.pathname
    .split('/')
    .map((segment) => encode(decodeURIComponent(segment)))
    .join('/') || '/';
}

function canonicalQuery(url: URL, extra: Array<[string, string]> = []): string {
  const pairs: Array<[string, string]> = [...extra];
  for (const [key, value] of url.searchParams) pairs.push([key, value]);
  return pairs
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

const hostOf = (url: URL): string => url.host;

function signature(credentials: SigV4Credentials, day: string, amzDate: string, canonicalRequest: string): { signature: string; scope: string } {
  const scope = `${day}/${credentials.region}/${credentials.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), credentials.service), 'aws4_request');
  return { signature: createHmac('sha256', key).update(toSign).digest('hex'), scope };
}

/**
 * Headers to send with a request: the ones passed in plus `host`-independent `x-amz-date`, `authorization` and, for
 * S3, `x-amz-content-sha256` (and `x-amz-security-token`). `host` is signed but left to the HTTP client to send.
 */
export function signRequest(input: SignInput): Record<string, string> {
  const url = typeof input.url === 'string' ? new URL(input.url) : input.url;
  const { amzDate, day } = stamp(input.date ?? new Date());
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) headers[name.toLowerCase()] = value;
  headers['x-amz-date'] = amzDate;
  if (input.includeContentSha256) headers['x-amz-content-sha256'] = input.payloadHash;
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;
  const signed: Record<string, string> = { ...headers, host: hostOf(url) };
  const names = Object.keys(signed).sort();
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url),
    canonicalQuery(url),
    names.map((name) => `${name}:${signed[name]!.trim().replace(/\s+/g, ' ')}\n`).join(''),
    names.join(';'),
    input.payloadHash,
  ].join('\n');
  const { signature: sig, scope } = signature(input, day, amzDate, canonicalRequest);
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
  return headers;
}

export interface PresignInput extends SigV4Credentials {
  method: string;
  url: string | URL;
  /** Seconds the URL stays valid (at most 7 days). */
  expiresIn: number;
}

/** A URL carrying its own signature (query-string signing, unsigned payload), for browsers to fetch directly. */
export function presignUrl(input: PresignInput): string {
  const url = new URL(typeof input.url === 'string' ? input.url : input.url.href);
  const { amzDate, day } = stamp(input.date ?? new Date());
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const extra: Array<[string, string]> = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${input.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(input.expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  if (input.sessionToken) extra.push(['X-Amz-Security-Token', input.sessionToken]);
  const query = canonicalQuery(url, extra);
  const canonicalRequest = [input.method.toUpperCase(), canonicalPath(url), query, `host:${hostOf(url)}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const { signature: sig } = signature(input, day, amzDate, canonicalRequest);
  return `${url.origin}${url.pathname}?${query}&X-Amz-Signature=${sig}`;
}
