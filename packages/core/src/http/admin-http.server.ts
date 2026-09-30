import { HttpException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { AdminErrorCode, AdminRuntimeConfig, SessionResponse, TwoFactorSetupResponse, TwoFactorStatusResponse } from '../contract.js';
import { toSessionUser } from './session-user.js';
import { pickLocale, resolveText } from '../i18n/localized-text.js';
import {
  AdminBadRequestError,
  AdminError,
  AdminForbiddenError,
  AdminNotFoundError,
  AdminRateLimitError,
  AdminUnauthenticatedError,
  AdminUnsupportedMediaTypeError,
  AdminValidationError,
} from '../errors.js';
import type { AdminAuthAdapter, AdminPrincipal } from '../auth/auth-adapter.js';
import { AdminAuthService } from '../auth/auth.service.js';
import { AdminPolicy } from '../policy/admin-policy.service.js';
import { addRbacRoutes } from '../rbac/rbac-routes.js';
import { AdminRbac } from '../rbac/rbac.service.js';
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
  private readonly viewAsLogged = new Map<string, number>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly api: AdminApiService,
    private readonly registry: ResourceRegistry,
    private readonly auth: AdminAuthService,
    private readonly policy: AdminPolicy,
    private readonly rbac: AdminRbac,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {
    this.router
      .add('GET', '/api/session', async ({ res, principal, ctx }) => {
        if (!principal) throw new AdminUnauthenticatedError();
        sendJson(res, 200, await this.sessionResponse(principal, ctx.viewAs));
      })
      .add('POST', '/api/session', async ({ req, res }) => {
        const login = this.auth.adapter?.login;
        if (!login) throw new AdminNotFoundError('This admin has no username/password sign-in');
        const body = await readJsonBody(req);
        const { username, password, otp } = (body ?? {}) as { username?: unknown; password?: unknown; otp?: unknown };
        const fields: Record<string, string[]> = {};
        if (typeof username !== 'string' || username.trim() === '' || username.length > 200) fields.username = ['is required'];
        if (typeof password !== 'string' || password === '' || password.length > 1000) fields.password = ['is required'];
        if (otp !== undefined && (typeof otp !== 'string' || otp.length > 40)) fields.otp = ['must be a code'];
        if (Object.keys(fields).length > 0) throw new AdminValidationError(fields);
        const input = { username: (username as string).trim(), password: password as string, ...(typeof otp === 'string' && otp.trim() !== '' ? { otp: otp.trim() } : {}) };
        const principal = await login.call(this.auth.adapter, input, { req, res });
        sendJson(res, 200, await this.sessionResponse(principal));
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
      .add('GET', '/api/account/2fa', async ({ res, principal }) => {
        const status: TwoFactorStatusResponse = await this.twoFactor('twoFactorStatus').call(this.auth.adapter, principal!);
        sendJson(res, 200, { enabled: status.enabled, recoveryCodesLeft: status.recoveryCodesLeft });
      })
      .add('POST', '/api/account/2fa/setup', async ({ res, principal }) => {
        const setup: TwoFactorSetupResponse = await this.twoFactor('beginTwoFactor').call(this.auth.adapter, principal!);
        sendJson(res, 200, { secret: setup.secret, otpauthUrl: setup.otpauthUrl });
      })
      .add('POST', '/api/account/2fa/confirm', async ({ req, res, principal }) => {
        const { code } = ((await readJsonBody(req)) ?? {}) as { code?: unknown };
        if (typeof code !== 'string' || code.trim() === '' || code.length > 40) throw new AdminValidationError({ code: ['is required'] });
        const { recoveryCodes } = await this.twoFactor('confirmTwoFactor').call(this.auth.adapter, principal!, code.trim(), { req, res });
        sendJson(res, 200, { recoveryCodes });
      })
      .add('POST', '/api/account/2fa/disable', async ({ req, res, principal }) => {
        await this.twoFactor('disableTwoFactor').call(this.auth.adapter, principal!, await passwordOf(req));
        res.statusCode = 204;
        res.end();
      })
      .add('POST', '/api/account/2fa/recovery-codes', async ({ req, res, principal }) => {
        const adapter = this.auth.adapter;
        if (!adapter?.newRecoveryCodes) throw new AdminNotFoundError('This admin cannot issue recovery codes');
        const { recoveryCodes } = await adapter.newRecoveryCodes(principal!, await passwordOf(req));
        sendJson(res, 200, { recoveryCodes });
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
    addRbacRoutes(this.router, { rbac: this.rbac, auth: this.auth, api: this.api, policy: this.policy, registry: this.registry });
  }

  /** An adapter's two-factor method, or 404 when it has none. */
  private twoFactor<K extends 'twoFactorStatus' | 'beginTwoFactor' | 'confirmTwoFactor' | 'disableTwoFactor'>(name: K): NonNullable<AdminAuthAdapter[K]> {
    const method = this.auth.adapter?.[name];
    if (!this.auth.capabilities.twoFactor || !method) throw new AdminNotFoundError('This admin has no two-factor sign-in');
    return method as NonNullable<AdminAuthAdapter[K]>;
  }

  /**
   * `X-View-As: <user id>` (spec §6.5): a superuser sees the admin exactly as that user does. Nothing can be changed
   * (only signing out works), and the account pages, which belong to the superuser, are closed.
   */
  private async viewAs(principal: AdminPrincipal, header: string | string[], route: string, ctx: AdminContext): Promise<AdminPrincipal> {
    if (route === 'DELETE /api/session') return principal;
    if (!principal.user.isSuperuser) throw new AdminForbiddenError('Only superusers may view the admin as another user');
    if (route.split(' ')[1]!.startsWith('/api/account')) throw new AdminForbiddenError('Your account is not available while viewing as another user');
    if (!route.startsWith('GET ')) throw new AdminForbiddenError('Viewing as another user is read-only');
    const id = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
    const getUser = this.auth.adapter?.getUser;
    if (!getUser) throw new AdminNotFoundError('This admin cannot look up users');
    const target = id === '' || id.length > 200 ? null : await getUser.call(this.auth.adapter, id);
    if (!target) throw new AdminNotFoundError(`User "${id}" not found`);
    const key = `${String(principal.user.id)}>${String(target.id)}`;
    const now = Date.now();
    if ((this.viewAsLogged.get(key) ?? 0) < now - 3_600_000) {
      this.viewAsLogged.set(key, now);
      this.logger.log(`User ${String(principal.user.id)} is viewing the admin as user ${String(target.id)}`);
    }
    ctx.viewAs = { by: principal.user };
    return { user: target, ...(principal.csrfToken ? { csrfToken: principal.csrfToken } : {}) };
  }

  private async sessionResponse(principal: AdminPrincipal, viewAs?: AdminContext['viewAs']): Promise<SessionResponse> {
    const permissions = await this.policy.forUser(principal.user);
    const enabled = this.rbac.enabled;
    return {
      user: toSessionUser(principal.user),
      ...(principal.csrfToken ? { csrfToken: principal.csrfToken } : {}),
      open: this.auth.adapter === undefined,
      auth: this.auth.capabilities,
      rbac: { enabled, view: enabled && (permissions.can('rbac.view') || permissions.can('rbac.manage')), manage: enabled && permissions.can('rbac.manage') },
      permissionsVersion: this.rbac.permissionsVersion,
      ...(viewAs ? { viewAs: { by: toSessionUser(viewAs.by) } } : {}),
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
        if (principal && req.headers['x-view-as'] !== undefined) principal = await this.viewAs(principal, req.headers['x-view-as'], route, ctx);
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

/** `{ password }` of a request that must confirm the user's password. */
async function passwordOf(req: AdminRequest): Promise<string> {
  const { password } = ((await readJsonBody(req)) ?? {}) as { password?: unknown };
  if (typeof password !== 'string' || password === '' || password.length > 1000) throw new AdminValidationError({ password: ['is required'] });
  return password;
}

/** The version in `If-Match: "3"` (or `3`, or a weak `W/"3"`); undefined without the header. */
function ifMatch(req: AdminRequest): number | undefined {
  const header = req.headers['if-match'];
  if (header === undefined) return undefined;
  const match = /^\s*(?:W\/)?"?(\d{1,15})"?\s*$/.exec(Array.isArray(header) ? header.join(',') : header);
  if (!match) throw new AdminBadRequestError('If-Match must be a record version, like "3"');
  return Number(match[1]);
}
