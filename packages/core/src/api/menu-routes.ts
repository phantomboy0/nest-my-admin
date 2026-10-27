import type { ServerResponse } from 'node:http';
import { sendJson } from '../http/http-io.js';
import type { Router } from '../http/router.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { AdminApiService } from './admin-api.service.js';

interface State {
  res: ServerResponse;
  ctx: AdminContext;
}

/**
 * `GET /api/menu/badges`: the menu's counts for this user (`MenuBadges`, `{}` without a menu). Kept out of meta so meta
 * stays a cheap, synchronous answer; the UI refetches it every minute and on focus.
 */
export function addMenuRoutes<S extends State>(router: Router<S>, services: { api: AdminApiService }): void {
  const { api } = services;
  router.add('GET', '/api/menu/badges', async ({ res, ctx }) => sendJson(res, 200, await api.badges(ctx)));
}
