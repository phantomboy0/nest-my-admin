import type { ServerResponse } from 'node:http';
import { sendJson } from '../http/http-io.js';
import type { Router } from '../http/router.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { AuditReader } from './audit-reader.js';

interface State {
  res: ServerResponse;
  url: URL;
  ctx: AdminContext;
}

/**
 * Reading the audit log; both answer `AuditResponse` (`{ entries, next? }`, 50 a page, newest first) and 404 without
 * `forRoot({ audit })`:
 * - `GET /api/resources/:resource/:id/history?before=`: a record's entries, for whoever GET shows the record to;
 * - `GET /api/audit?actor=&event=&resource=&record=&from=&to=&before=`: every entry, with `audit.view` (403 without).
 *   `event` is an event's whole name, or a prefix when it ends with `.*` (`product.*`); `from` and `to` are a day
 *   (`2026-10-12`, all of it, in UTC) or a time (`2026-10-12T08:30:00Z`, both ends included); `record` goes with
 *   `resource`. A value nothing matches answers no entries; one that cannot be read is a 422.
 *
 * What each reader is shown is decided in `AuditReader`.
 */
export function addAuditRoutes<S extends State>(router: Router<S>, services: { reader: AuditReader }): void {
  const { reader } = services;
  router
    .add('GET', '/api/resources/:resource/:id/history', async ({ res, url, ctx }, p) => sendJson(res, 200, await reader.history(p.resource!, p.id!, url.searchParams, ctx)))
    .add('GET', '/api/audit', async ({ res, url, ctx }) => sendJson(res, 200, await reader.list(url.searchParams, ctx)));
}
