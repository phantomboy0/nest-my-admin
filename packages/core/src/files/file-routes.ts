import type { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { AdminBadRequestError, AdminNotFoundError } from '../errors.js';
import { sendJson, type AdminRequest } from '../http/http-io.js';
import type { Router } from '../http/router.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { FilesService } from './files.service.js';

interface State {
  req: AdminRequest;
  res: ServerResponse;
  url: URL;
  ctx: AdminContext;
}

/** `POST /api/uploads` is the one write that takes a raw body instead of JSON (the server skips its JSON check for it). */
export const UPLOAD_ROUTE = 'POST /api/uploads';

export function addFileRoutes<S extends State>(router: Router<S>, services: { files: FilesService }): void {
  const { files } = services;
  router.add('POST', '/api/uploads', async ({ req, res, url, ctx }) => {
    const resource = url.searchParams.get('resource');
    const field = url.searchParams.get('field');
    if (!files.enabled) throw new AdminNotFoundError('File uploads are not enabled in this admin');
    try {
      if (!resource || !field) throw new AdminBadRequestError('resource and field are required');
      sendJson(res, 201, await files.upload(req, resource, field, ctx));
    } catch (error) {
      req.resume(); // discard an unread body so the client gets the JSON error, not a connection reset
      throw error;
    }
  });

  router.add('GET', '/api/files/*key', async ({ res, ctx }, params) => {
    const file = await files.download(params.key!, ctx);
    // Images and PDFs may be shown in place; everything else is saved. Nothing served here may run as a page.
    const inline = file.contentType.startsWith('image/') || file.contentType === 'application/pdf';
    res.statusCode = 200;
    res.setHeader('Content-Type', file.contentType === 'text/plain' ? 'text/plain; charset=utf-8' : file.contentType);
    res.setHeader('Content-Length', file.size);
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeRfc5987(file.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Cache-Control', 'private, no-store');
    // The headers are out once the body starts, so a storage error mid-way can only cut the response short.
    await pipeline(file.body, res).catch(() => res.destroy());
  });
}

/** RFC 5987 `ext-value`: percent-encoding of everything outside attr-char. */
const encodeRfc5987 = (name: string): string => encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
