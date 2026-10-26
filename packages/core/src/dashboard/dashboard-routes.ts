import type { ServerResponse } from 'node:http';
import { sendJson } from '../http/http-io.js';
import type { Router } from '../http/router.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { DashboardService } from './dashboard.service.js';

interface State {
  res: ServerResponse;
  url: URL;
  ctx: AdminContext;
}

/**
 * The dashboard (spec §5.8): `GET /api/dashboard` lists the widgets this user may see (`DashboardResponse`);
 * `GET /api/dashboard/:widget?period=&from=&to=&previousFrom=&previousTo=` answers one widget's `WidgetData` (404 for
 * one they may not see, 400 for a bad period). Each widget loads on its own: one that fails leaves the others.
 */
export function addDashboardRoutes<S extends State>(router: Router<S>, services: { dashboard: DashboardService }): void {
  const { dashboard } = services;
  router
    .add('GET', '/api/dashboard', ({ res, ctx }) => sendJson(res, 200, dashboard.layout(ctx)))
    .add('GET', '/api/dashboard/:widget', async ({ res, url, ctx }, p) => sendJson(res, 200, await dashboard.load(p.widget!, url.searchParams, ctx)));
}
