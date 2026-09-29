import { describe, expect, test } from 'bun:test';
import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { AdminBadRequestError } from '../errors.js';
import { readJsonBody, sendJson, type AdminRequest } from './http-io.js';

function fakeRequest(chunks: string[], body?: unknown): AdminRequest {
  const stream = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  return Object.assign(stream, { body }) as unknown as AdminRequest;
}

describe('readJsonBody', () => {
  test('returns the body already parsed by the host', async () => {
    expect(await readJsonBody(fakeRequest([], { a: 1 }))).toEqual({ a: 1 });
  });

  test('reads and parses the stream when nothing parsed it', async () => {
    expect(await readJsonBody(fakeRequest(['{"a":', '1}']))).toEqual({ a: 1 });
  });

  test('empty body is undefined', async () => {
    expect(await readJsonBody(fakeRequest([]))).toBeUndefined();
  });

  test('invalid JSON and oversized bodies are bad requests', async () => {
    await expect(readJsonBody(fakeRequest(['{nope']))).rejects.toBeInstanceOf(AdminBadRequestError);
    await expect(readJsonBody(fakeRequest(['x'.repeat(1_048_577)]))).rejects.toThrow('Request body is too large');
  });
});

describe('sendJson', () => {
  test('writes status, headers and body', () => {
    const headers: Record<string, unknown> = {};
    let written = '';
    const res = {
      statusCode: 0,
      setHeader: (name: string, value: unknown) => { headers[name.toLowerCase()] = value; },
      end: (chunk: string) => { written = chunk; },
    } as unknown as ServerResponse;
    sendJson(res, 201, { ok: true });
    expect(res.statusCode).toBe(201);
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(headers['cache-control']).toBe('no-store');
    expect(JSON.parse(written)).toEqual({ ok: true });
  });
});
