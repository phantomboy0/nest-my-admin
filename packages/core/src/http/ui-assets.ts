import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import type { AdminRuntimeConfig } from '../contract.js';
import type { AdminRequest } from './http-io.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const MISSING_UI_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Admin</title></head>' +
  '<body style="font-family:system-ui;padding:2rem"><h1>Admin UI assets not found</h1>' +
  '<p>Build <code>@nest-my-admin/ui</code> (<code>bun run build</code>) or reinstall your dependencies.</p></body></html>';

/** Directory of the installed @nest-my-admin/ui build. Resolved from this file so bundlers and monorepos work. */
export function resolveUiDist(): string {
  const require = createRequire(import.meta.url);
  try {
    return join(dirname(require.resolve('@nest-my-admin/ui/package.json')), 'dist');
  } catch {
    throw new Error('nest-my-admin: @nest-my-admin/ui is not installed. It is a dependency of @nest-my-admin/core; reinstall your dependencies.');
  }
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inserts `<base href>` (so relative assets load from deep links) and the runtime config as an inert JSON block (an executable inline script would be blocked by helmet's default CSP). */
export function injectRuntime(html: string, runtime: AdminRuntimeConfig): string {
  const headOpen = /<head(\s[^>]*)?>/i;
  if (!headOpen.test(html)) throw new Error('nest-my-admin: UI index.html has no <head> element');
  const baseHref = runtime.basePath.endsWith('/') ? runtime.basePath : `${runtime.basePath}/`;
  const json = JSON.stringify(runtime)
    .replace(/</g, '\\u003c')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
  const tags = `<base href="${escapeAttribute(baseHref)}"><script type="application/json" id="nma-config">${json}</script>`;
  return html.replace(headOpen, (match) => match + tags);
}

/** Absolute path of a regular file inside `root`, or undefined (traversal, directories, index.html). */
export function resolveStaticFile(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const base = resolve(root);
  const candidate = resolve(base, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (!candidate.startsWith(base + sep)) return undefined;
  if (candidate === join(base, 'index.html')) return undefined;
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export class UiAssets {
  private readonly root: string;
  private readonly indexHtml: string;

  constructor(distDir: string, runtime: AdminRuntimeConfig) {
    this.root = resolve(distDir);
    const indexPath = join(this.root, 'index.html');
    this.indexHtml = injectRuntime(existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : MISSING_UI_HTML, runtime);
  }

  /** Serves a file, 404s a missing /assets/* file, and falls back to index.html for client-side routes. */
  serve(pathname: string, req: AdminRequest, res: ServerResponse): void {
    const file = resolveStaticFile(this.root, pathname);
    if (file) {
      this.sendFile(file, pathname, req, res);
      return;
    }
    if (pathname.startsWith('/assets/')) {
      this.send(req, res, 404, 'text/plain; charset=utf-8', 'Not found', 'no-store');
      return;
    }
    this.send(req, res, 200, 'text/html; charset=utf-8', this.indexHtml, 'no-cache');
  }

  private sendFile(file: string, pathname: string, req: AdminRequest, res: ServerResponse): void {
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      this.send(req, res, 404, 'text/plain; charset=utf-8', 'Not found', 'no-store');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', size);
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file);
    pipeline(stream, res, (error) => {
      if (error) res.destroy();
    });
  }

  private send(req: AdminRequest, res: ServerResponse, status: number, contentType: string, body: string, cacheControl: string): void {
    res.statusCode = status;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : body);
  }
}
