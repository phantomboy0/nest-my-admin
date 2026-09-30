import { HttpException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { AdminErrorCode, AdminRuntimeConfig, SessionResponse, SessionUser } from '../contract.js';
import { pickLocale, resolveText } from '../i18n/localized-text.js';
import {
  AdminBadRequestError,
  AdminError,
  AdminNotFoundError,
  AdminRateLimitError,
  AdminUnauthenticatedError,
  AdminUnsupportedMediaTypeError,
  AdminValidationError,
} from '../errors.js';
import type { AdminPrincipal, AdminUser } from '../auth/auth-adapter.js';
import { AdminAuthService } from '../auth/auth.service.js';
import { AdminPolicy } from '../policy/admin-policy.service.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry } from '../registry/resource-registry.js';
import { createAdminContext, runInAdminContext, type AdminContext } from '../resource/admin-context.js';
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
  /** Undefined only on the public session routes (GET and POST /api/session) when nobody is signed in. */
  principal?: AdminPrincipal;
}

/** The only API routes that answer without a session: reading it (to learn you are signed out) and logging in. */
const PUBLIC_ROUTES = new Set(['GET /api/session', 'POST /api/session']);

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
    private readonly auth: AdminAuthService,
    private readonly policy: AdminPolicy,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {
    this.router
      .add('GET', '/api/session', ({ res, principal }) => {
        if (!principal) throw new AdminUnauthenticatedError();
        sendJson(res, 200, this.sessionResponse(principal));
      })
      .add('POST', '/api/session', async ({ req, res }) => {
        const login = this.auth.adapter?.login;
        if (!login) throw new AdminNotFoundError('This admin has no username/password sign-in');
        const body = await readJsonBody(req);
        const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
        const fields: Record<string, string[]> = {};
        if (typeof username !== 'string' || username.trim() === '' || username.length > 200) fields.username = ['is required'];
        if (typeof password !== 'string' || password === '' || password.length > 1000) fields.password = ['is required'];
        if (Object.keys(fields).length > 0) throw new AdminValidationError(fields);
        const principal = await login.call(this.auth.adapter, { username: (username as string).trim(), password: password as string }, { req, res });
        sendJson(res, 200, this.sessionResponse(principal));
      })
      .add('DELETE', '/api/session', async ({ req, res, principal }) => {
        const adapter = this.auth.adapter;
        if (!adapter?.logout) throw new AdminNotFoundError('This admin has no sign-out');
        await adapter.logout(principal!, { req, res });
        res.statusCode = 204;
        res.end();
      })
      .add('GET', '/api/account/sessions', async ({ res, principal }) => {
        const adapter = this.auth.adapter;
        if (!adapter?.listSessions) throw new AdminNotFoundError('This admin does not list sessions');
        const sessions = await adapter.listSessions(principal!);
        sendJson(res, 200, {
          items: sessions.map((session) => ({
            id: session.id,
            current: session.id === principal!.sessionId,
            createdAt: session.createdAt.toISOString(),
            lastSeenAt: session.lastSeenAt.toISOString(),
            expiresAt: session.expiresAt.toISOString(),
            ...(session.userAgent ? { userAgent: session.userAgent } : {}),
            ...(session.ip ? { ip: session.ip } : {}),
          })),
        });
      })
      .add('DELETE', '/api/account/sessions', async ({ res, principal }) => {
        const adapter = this.auth.adapter;
        if (!adapter?.revokeOtherSessions) throw new AdminNotFoundError('This admin cannot end other sessions');
        await adapter.revokeOtherSessions(principal!);
        res.statusCode = 204;
        res.end();
      })
      .add('DELETE', '/api/account/sessions/:id', async ({ res, principal }, p) => {
        const adapter = this.auth.adapter;
        if (!adapter?.revokeSession) throw new AdminNotFoundError('This admin cannot end sessions');
        await adapter.revokeSession(principal!, p.id);
        res.statusCode = 204;
        res.end();
      })
      .add('POST', '/api/account/password', async ({ req, res, principal }) => {
        const adapter = this.auth.adapter;
        if (!adapter?.changePassword) throw new AdminNotFoundError('This admin cannot change passwords');
        const { current, next } = ((await readJsonBody(req)) ?? {}) as { current?: unknown; next?: unknown };
        const fields: Record<string, string[]> = {};
        if (typeof current !== 'string' || current === '' || current.length > 1000) fields.current = ['is required'];
        if (typeof next !== 'string' || next === '' || next.length > 1000) fields.next = ['is required'];
        if (Object.keys(fields).length > 0) throw new AdminValidationError(fields);
        await adapter.changePassword(principal!, { current: current as string, next: next as string }, { req, res });
        res.statusCode = 204;
        res.end();
      })
      .add('GET', '/api/meta', ({ res, ctx }) => sendJson(res, 200, this.api.meta(ctx.locale, ctx)))
      .add('GET', '/api/meta/resources/:resource', ({ res, ctx }, p) => sendJson(res, 200, this.api.schema(p.resource, ctx.locale, ctx)))
      .add('GET', '/api/search', async ({ res, url, ctx }) => sendJson(res, 200, await this.api.search(url.searchParams, ctx)))
      .add('GET', '/api/resources/:resource', async ({ res, url, ctx }, p) =>
        sendJson(res, 200, await this.api.list(p.resource, url.searchParams, ctx)),
      )
      .add('GET', '/api/resources/:resource/fields/:field/options', async ({ res, url, ctx }, p) =>
        sendJson(res, 200, await this.api.fieldOptions(p.resource, p.field, url.searchParams, ctx)),
      )
      .add('GET', '/api/resources/:resource/:id', async ({ res, ctx }, p) =>
        sendJson(res, 200, await this.api.get(p.resource, p.id, ctx)),
      )
      .add('POST', '/api/resources/:resource', async ({ req, res, ctx }, p) =>
        sendJson(res, 201, await this.api.create(p.resource, await readJsonBody(req), ctx)),
      )
      .add('PATCH', '/api/resources/:resource/:id', async ({ req, res, ctx }, p) =>
        sendJson(res, 200, await this.api.update(p.resource, p.id, await readJsonBody(req), ctx, ifMatch(req))),
      )
      .add('POST', '/api/resources/:resource/bulk-delete', async ({ req, res, ctx }, p) =>
        sendJson(res, 200, await this.api.bulkDelete(p.resource, await readJsonBody(req), ctx)),
      )
      .add('POST', '/api/resources/:resource/:id/restore', async ({ res, ctx }, p) =>
        sendJson(res, 200, await this.api.restore(p.resource, p.id, ctx)),
      )
      .add('DELETE', '/api/resources/:resource/:id', async ({ req, res, url, ctx }, p) => {
        const purge = url.searchParams.get('purge');
        if (purge !== null && purge !== 'true') throw new AdminBadRequestError('purge must be true');
        if (purge === 'true') await this.api.purge(p.resource, p.id, ctx, ifMatch(req));
        else await this.api.remove(p.resource, p.id, ctx, ifMatch(req));
        res.statusCode = 204;
        res.end();
      });
  }

  private sessionResponse(principal: AdminPrincipal): SessionResponse {
    return {
      user: toSessionUser(principal.user),
      ...(principal.csrfToken ? { csrfToken: principal.csrfToken } : {}),
      open: this.auth.adapter === undefined,
      auth: this.auth.capabilities,
    };
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
      title: resolveText(this.options.title, this.options.locale, this.options.locale),
      locale: this.options.locale,
      locales: this.options.locales,
      branding: this.options.branding as AdminRuntimeConfig['branding'],
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
        const { status, body } = toErrorResponse(error, correlationId, this.logger, { errorMapper: this.options.errorMapper });
        sendJson(res, status, body);
        return;
      }
      const early = earlyError(error);
      if (early) {
        sendJson(res, early.status, { code: early.code, message: early.message, correlationId });
        return;
      }
      const { status, body } = toErrorResponse(error, correlationId, this.logger, { errorMapper: this.options.errorMapper });
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
        // Authentication before anything else (spec §4). Only the session routes answer without a session.
        const route = `${req.method} ${pathname.replace(/\/+$/, '')}`;
        let principal: AdminPrincipal | undefined;
        if (PUBLIC_ROUTES.has(route)) principal = (await this.auth.principal(req)) ?? undefined;
        else principal = await this.auth.require(req);
        ctx.user = principal?.user;
        if (principal) ctx.permissions = await this.policy.forUser(principal.user);
        // Labels follow Accept-Language; caches must keep the languages apart.
        ctx.locale = pickLocale(req.headers['accept-language'], this.options.locales, this.options.locale);
        res.setHeader('Content-Language', ctx.locale);
        res.setHeader('Vary', 'Accept-Language');
        const requestCtx = ctx; // narrows the `let` ctx for the closure below
        await runInAdminContext(requestCtx, () => match.handler({ req, res, url, ctx: requestCtx, principal }, match.params));
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
      if (error instanceof AdminRateLimitError) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfter))));
      const { status, body } = toErrorResponse(error, correlationId, this.logger, {
        dbNames: resourceName ? this.registry.find(resourceName)?.dbNames : undefined,
        errorMapper: this.options.errorMapper,
        deleting: req.method === 'DELETE',
      });
      sendJson(res, status, body);
    }
  }
}

/** @internal */
export function toSessionUser(user: AdminUser): SessionUser {
  return {
    id: String(user.id),
    displayName: user.displayName,
    ...(user.username ? { username: user.username } : {}),
    ...(user.email ? { email: user.email } : {}),
    isSuperuser: user.isSuperuser === true,
  };
}

/** The version in `If-Match: "3"` (or `3`, or a weak `W/"3"`); undefined without the header. */
function ifMatch(req: AdminRequest): number | undefined {
  const header = req.headers['if-match'];
  if (header === undefined) return undefined;
  const match = /^\s*(?:W\/)?"?(\d{1,15})"?\s*$/.exec(Array.isArray(header) ? header.join(',') : header);
  if (!match) throw new AdminBadRequestError('If-Match must be a record version, like "3"');
  return Number(match[1]);
}
