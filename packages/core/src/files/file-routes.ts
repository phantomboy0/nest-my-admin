import type { ServerResponse } from 'node:http';
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
    if (!resource || !field) throw new AdminBadRequestError('resource and field are required');
    sendJson(res, 201, await files.upload(req, resource, field, ctx));
  });
}
