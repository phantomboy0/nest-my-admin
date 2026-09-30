import { HttpException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { AdminErrorCode } from '../contract.js';
import { AdminError, AdminNotFoundError, AdminUnsupportedMediaTypeError } from '../errors.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry } from '../registry/resource-registry.js';
import { createAdminContext, type AdminContext } from '../resource/admin-context.js';
import { codeForStatus, toErrorResponse } from './error-response.js';
import { readJsonBody, sendJson, type AdminRequest } from './http-io.js';
import { Router } from './router.js';
import { UiAssets, resolveUiDist } from './ui-assets.js';
import { AdminApiService } from '../api/admin-api.service.js';
import { ADMIN_OPTIONS } from '../constants.js';

interface RequestState {
  req: AdminRequest;
  res: ServerResponse;
  url: URL;
  ctx: AdminContext;
}

// Methods that carry a JSON body. DELETE is never a CORS "simple" request, so a foreign page cannot send one without a preflight.
const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT']);

function isJsonContentType(header: string | undefined): boolean {
  return header?.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

/** Maps an error passed to next() before this handler ran (body parser, host middleware) to the admin contract. */
function earlyError(error: unknown): { status: number; code: AdminErrorCode; message: string } | undefined {
  const { type, status } = (error ?? {}) as { type?: unknown; status?: unknown };
  if (type === 'entity.parse.failed') return { status: 400, code: 'BAD_REQUEST', message: 'Request body is not valid JSON' };
  if (type === 'entity.too.large') return { status: 413, code: 'BAD_REQUEST', message: 'Request body is too large' };
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, code: codeForStatus(status), message: error instanceof Error ? error.message : 'Bad request' };
  }
  return undefined;
}

/**
 * Mounts one handler on the host's HTTP adapter (spec D12). Registered during onModuleInit, which runs
 * after host middleware added in main.ts and before Nest's 404 handler. Host guards, interceptors,
 * pipes, filters and the global prefix do not apply.
 */
@Injectable()
export class AdminHttpServer implements OnModuleInit {
  private readonly logger = new Logger('NestMyAdmin');
  private readonly router = new Router<RequestState>();
  private ui?: UiAssets;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly api: AdminApiService,
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {
    this.router
      .add('GET', '/api/meta', ({ res }) => sendJson(res, 200, this.api.meta()))
      .add('GET', '/api/meta/resources/:resource', ({ res }, p) => sendJson(res, 200, this.api.schema(p.resource)))
      .add('GET', '/api/resources/:resource', async ({ res, url, ctx }, p) =>
        sendJson(res, 200, await this.api.list(p.resource, url.searchParams, ctx)),
      )
      .add('GET', '/api/resources/:resource/:id', async ({ res, ctx }, p) =>
        sendJson(res, 200, await this.api.get(p.resource, p.id, ctx)),
      )
      .add('POST', '/api/resources/:resource', async ({ req, res, ctx }, p) =>
        sendJson(res, 201, await this.api.create(p.resource, await readJsonBody(req), ctx)),
      )
      .add('PATCH', '/api/resources/:resource/:id', async ({ req, res, ctx }, p) =>
        sendJson(res, 200, await this.api.update(p.resource, p.id, await readJsonBody(req), ctx)),
      )
      .add('DELETE', '/api/resources/:resource/:id', async ({ res, ctx }, p) => {
        await this.api.remove(p.resource, p.id, ctx);
        res.statusCode = 204;
        res.end();
      });
  }

  onModuleInit(): void {
    const adapter = this.adapterHost.httpAdapter;
    if (!adapter) return; // standalone application context: nothing to mount
    const type = adapter.getType();
    if (type !== 'express') {
      throw new Error(`nest-my-admin: the "${type}" HTTP adapter is not supported yet; use @nestjs/platform-express`);
    }
    this.ui = new UiAssets(this.options.uiDistPath ?? resolveUiDist(), {
      basePath: this.options.path,
      apiBase: `${this.options.path}/api`,
      title: this.options.title,
    });
    adapter.use(this.options.path, (req: AdminRequest, res: ServerResponse, next: (error?: unknown) => void) => {
      this.handle(req, res, next).catch((error: unknown) => {
        const correlationId = randomUUID();
        this.logger.error(`[${correlationId}] unhandled admin error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        if (res.headersSent) {
          res.end();
          return;
        }
        sendJson(res, 500, { code: 'INTERNAL', message: 'Internal error', correlationId });
      });
    });
    adapter.use(this.options.path, (error: unknown, req: AdminRequest, res: ServerResponse, next: (error?: unknown) => void) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      const correlationId = createAdminContext(req).correlationId;
      if (error instanceof AdminError || error instanceof HttpException) {
        const { status, body } = toErrorResponse(error, correlationId, this.logger);
        sendJson(res, status, body);
        return;
      }
      const early = earlyError(error);
      if (early) {
        sendJson(res, early.status, { code: early.code, message: early.message, correlationId });
        return;
      }
      const { status, body } = toErrorResponse(error, correlationId, this.logger);
      sendJson(res, status, body);
    });
    this.logger.log(`Admin mounted at ${this.options.path}`);
  }

  private async handle(req: AdminRequest, res: ServerResponse, next: (error?: unknown) => void): Promise<void> {
    let ctx: AdminContext | undefined;
    let resourceName: string | undefined;
    try {
      ctx = createAdminContext(req);
      // Concatenate rather than resolve so a leading "//" is a path, not a protocol-relative authority.
      const url = new URL(`http://admin.local${req.url ?? '/'}`);
      const pathname = url.pathname.replace(/^\/{2,}/, '/');
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const match = this.router.match(req.method ?? 'GET', pathname);
        if (!match) throw new AdminNotFoundError(`No admin API route for ${req.method} ${pathname}`);
        // Only JSON can be sent by a script; forms and text/plain are CORS "simple" requests a foreign page could forge.
        if (BODY_METHODS.has(req.method ?? '') && !isJsonContentType(req.headers['content-type'])) {
          throw new AdminUnsupportedMediaTypeError('Content-Type must be application/json');
        }
        resourceName = match.params.resource;
        await match.handler({ req, res, url, ctx }, match.params);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      this.ui!.serve(pathname, req, res);
    } catch (error) {
      const correlationId = ctx?.correlationId ?? 'unknown';
      if (res.headersSent) {
        this.logger.error(`[${correlationId}] error after response started: ${String(error)}`);
        res.end();
        return;
      }
      const columns = resourceName ? this.registry.find(resourceName)?.columnProperties : undefined;
      const { status, body } = toErrorResponse(error, correlationId, this.logger, columns);
      sendJson(res, status, body);
    }
  }
}
