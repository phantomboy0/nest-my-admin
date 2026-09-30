import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ADMIN_OPTIONS } from '../constants.js';
import type { AuthCapabilities } from '../contract.js';
import { AdminForbiddenError, AdminUnauthenticatedError } from '../errors.js';
import type { ResolvedAdminOptions } from '../options.js';
import { OPEN_ADMIN_USER, type AdminAuthAdapter, type AdminPrincipal } from './auth-adapter.js';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Resolves the configured auth adapter at boot and authenticates each admin API request (spec §4: auth first). */
@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger('NestMyAdmin');
  private adapterValue?: AdminAuthAdapter;
  private open = false;
  private ready?: Promise<void>;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  onModuleInit(): Promise<void> {
    this.ready ??= this.resolve();
    return this.ready;
  }

  private async resolve(): Promise<void> {
    const auth = this.options.auth;
    if (!auth || auth.kind === 'none') {
      this.open = true;
      if (!auth) {
        this.logger.warn(
          `No \`auth\` is configured: everyone who can reach ${this.options.path} is a superuser. ` +
            'Set auth: builtinAuth() (from @nest-my-admin/auth) or AdminAuth.custom(YourAdapter); AdminAuth.none() silences this.',
        );
      }
      return;
    }
    const adapter = await auth.resolve(this.moduleRef);
    if (!adapter || typeof adapter.authenticate !== 'function') {
      throw new Error('nest-my-admin: the auth adapter must have an authenticate(req) method');
    }
    this.adapterValue = adapter;
  }

  /** The adapter; undefined for an open admin. */
  get adapter(): AdminAuthAdapter | undefined {
    return this.adapterValue;
  }

  get capabilities(): AuthCapabilities {
    const adapter = this.adapterValue;
    return {
      login: typeof adapter?.login === 'function',
      logout: typeof adapter?.logout === 'function',
      sessions: typeof adapter?.listSessions === 'function' && typeof adapter?.revokeSession === 'function',
      revokeOthers: typeof adapter?.revokeOtherSessions === 'function',
      password: typeof adapter?.changePassword === 'function',
      twoFactor: ['twoFactorStatus', 'beginTwoFactor', 'confirmTwoFactor', 'disableTwoFactor'].every((name) => typeof (adapter as unknown as Record<string, unknown> | undefined)?.[name] === 'function'),
    };
  }

  /** Who sent the request, or null. An open admin answers with its superuser. */
  async principal(req: IncomingMessage): Promise<AdminPrincipal | null> {
    await (this.ready ??= this.resolve());
    if (this.open) return { user: OPEN_ADMIN_USER };
    return (await this.adapterValue!.authenticate(req)) ?? null;
  }

  /** The principal, or 401; mutating requests of cookie sessions must also carry the session's CSRF token (403). */
  async require(req: IncomingMessage): Promise<AdminPrincipal> {
    const principal = await this.principal(req);
    if (!principal) throw new AdminUnauthenticatedError();
    this.checkCsrf(req, principal);
    return principal;
  }

  checkCsrf(req: IncomingMessage, principal: AdminPrincipal): void {
    if (!principal.csrfToken || !MUTATING.has(req.method ?? 'GET')) return;
    const header = req.headers['x-csrf-token'];
    const sent = Buffer.from(typeof header === 'string' ? header : '');
    const expected = Buffer.from(principal.csrfToken);
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) {
      throw new AdminForbiddenError('Missing or wrong X-CSRF-Token header; reload the page and try again');
    }
  }
}
