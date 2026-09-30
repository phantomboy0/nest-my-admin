/** `Cookie` header → name/value map (first occurrence wins; values are URI-decoded when valid). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export interface CookieOptions {
  path: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  /** Seconds; 0 deletes the cookie. Omitted: a browser-session cookie. */
  maxAge?: number;
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** A `Set-Cookie` value. Names must be tokens; the value is URI-encoded and the path may not break the header. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!TOKEN.test(name)) throw new Error(`invalid cookie name "${name}"`);
  if (/[;\r\n,]/.test(options.path)) throw new Error(`invalid cookie path "${options.path}"`);
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    if (options.maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

/** Adds a `Set-Cookie` header without dropping those already set on the response. */
export function appendSetCookie(res: { getHeader(name: string): unknown; setHeader(name: string, value: string | string[]): unknown }, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  res.setHeader('Set-Cookie', [...list, cookie]);
}

/** Whether the request came over https (directly, or through a proxy that says so and that Express trusts). */
export function isSecureRequest(req: { socket?: { encrypted?: boolean }; secure?: boolean; protocol?: string }): boolean {
  return req.secure === true || req.protocol === 'https' || req.socket?.encrypted === true;
}
