import { describe, expect, test } from 'bun:test';
import { appendSetCookie, parseCookies, serializeCookie } from './cookies.js';

describe('cookies', () => {
  test('parse', () => {
    expect(parseCookies('a=1; b=hello%20world; a=2; c="q"; bad; =x')).toEqual({ a: '1', b: 'hello world', c: 'q' });
    expect(parseCookies('x=%E0%A4%A')).toEqual({ x: '%E0%A4%A' });
    expect(parseCookies(undefined)).toEqual({});
  });
  test('serialize', () => {
    expect(serializeCookie('nma_session', 'a b', { path: '/admin', httpOnly: true, secure: true, sameSite: 'Lax', maxAge: 60 })).toBe(
      'nma_session=a%20b; Path=/admin; Max-Age=60; HttpOnly; Secure; SameSite=Lax',
    );
    expect(serializeCookie('s', '', { path: '/', maxAge: 0 })).toBe('s=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(() => serializeCookie('bad name', 'x', { path: '/' })).toThrow();
    expect(() => serializeCookie('ok', 'x', { path: '/a;Domain=evil' })).toThrow();
  });
  test('append keeps earlier cookies', () => {
    const headers: Record<string, unknown> = {};
    const res = { getHeader: (name: string) => headers[name], setHeader: (name: string, value: unknown) => void (headers[name] = value) };
    appendSetCookie(res, 'a=1');
    appendSetCookie(res, 'b=2');
    expect(headers['Set-Cookie']).toEqual(['a=1', 'b=2']);
  });
});
