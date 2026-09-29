import type { IncomingMessage, ServerResponse } from 'node:http';
import { AdminBadRequestError } from '../errors.js';

/** A Node request, possibly with a body already parsed by the host's body parser. */
export type AdminRequest = IncomingMessage & { body?: unknown };

const MAX_BODY_BYTES = 1_048_576;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

/** Uses the host-parsed body when present (Nest registers express.json()); otherwise reads the stream. */
export async function readJsonBody(req: AdminRequest): Promise<unknown> {
  if (req.body !== undefined && !Buffer.isBuffer(req.body) && typeof req.body !== 'string') return req.body;
  if (typeof req.body === 'string') return parseJson(req.body);
  if (req.readableEnded) return undefined;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new AdminBadRequestError('Request body is too large');
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AdminBadRequestError('Request body is not valid JSON');
  }
}
