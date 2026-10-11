import type { ServerResponse } from 'node:http';
import type { AdminApiService } from '../api/admin-api.service.js';
import { readJsonBody, sendJson, type AdminRequest } from '../http/http-io.js';
import type { Router } from '../http/router.js';
import type { AdminContext } from '../resource/admin-context.js';

interface State {
  req: AdminRequest;
  res: ServerResponse;
  ctx: AdminContext;
}

/**
 * `/api/pages/:name`: a settings page (`@AdminSettingsPage`). GET needs `page.<name>` (404 without it), PATCH
 * `page.<name>.update` (403). Both answer `PageResponse`.
 */
export function addPageRoutes<S extends State>(router: Router<S>, services: { api: AdminApiService }): void {
  const { api } = services;
  router
    .add('GET', '/api/pages/:name', async ({ res, ctx }, p) => sendJson(res, 200, await api.page(p.name!, ctx)))
    .add('PATCH', '/api/pages/:name', async ({ req, res, ctx }, p) => sendJson(res, 200, await api.savePage(p.name!, await readJsonBody(req), ctx)));
}
