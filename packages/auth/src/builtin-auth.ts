import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { LessThan, Not, type DataSource, type Repository } from 'typeorm';
import {
  AdminAuth,
  AdminRateLimitError,
  AdminUnauthenticatedError,
  AdminValidationError,
  appendSetCookie,
  isSecureRequest,
  parseCookies,
  serializeCookie,
  type AdminAuthAdapter,
  type AdminAuthConfig,
  type AdminPrincipal,
  type AdminSessionInfo,
  type AdminUser,
  type AuthIO,
  type LoginInput,
} from '@nest-my-admin/core';
import { NmaSession, NmaUser } from './entities.js';
import { SCRYPT, hashPassword, passwordProblems, verifyPassword, type PasswordPolicy } from './password.js';
import { RateLimiter } from './rate-limit.js';

export interface BuiltinAuthOptions {
  /** The TypeORM DataSource holding `ADMIN_AUTH_ENTITIES` (its name; default the default DataSource). */
  dataSource?: string;
  /** Default `nma_session`. */
  cookieName?: string;
  /** `auto` (default): Secure on https requests (Express's `trust proxy` decides for proxied ones). */
  secureCookie?: boolean | 'auto';
  /** A session ends after this many seconds without a request. Default 12 hours. */
  idleTimeout?: number;
  /** …and at the latest this many seconds after sign-in. Default 30 days. */
  absoluteTimeout?: number;
  /** Failed passwords before the account locks, and for how long. Default 5 attempts, 15 minutes. */
  lockout?: { attempts?: number; minutes?: number };
  /** Sign-in attempts per IP address per minute. Default 20. */
  loginAttemptsPerMinute?: number;
  password?: PasswordPolicy;
  /** Creates this superuser at boot when there are no admin users yet. */
  bootstrapSuperuser?: { username: string; password: string; displayName?: string; email?: string };
  /** @internal Tests: the clock and a cheaper hash. */
  now?: () => Date;
  /** @internal */
  scrypt?: typeof SCRYPT;
}

type Resolved = Required<Omit<BuiltinAuthOptions, 'dataSource' | 'bootstrapSuperuser' | 'lockout' | 'password' | 'now' | 'scrypt'>> & {
  lockoutAttempts: number;
  lockoutMs: number;
  password: PasswordPolicy;
  now: () => Date;
  scrypt: typeof SCRYPT;
};

const WRONG = 'Wrong username or password';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** The admin's mount path, from the request (Express sets `baseUrl` for the handler mounted at `path`). */
function cookiePath(req: IncomingMessage): string {
  const base = (req as IncomingMessage & { baseUrl?: string }).baseUrl;
  return base && base.startsWith('/') ? base : '/';
}

function clientIp(req: IncomingMessage): string {
  return (req as IncomingMessage & { ip?: string }).ip ?? req.socket?.remoteAddress ?? 'unknown';
}

/** The built-in adapter (spec §7): `nma_user` and `nma_session` on the host's DataSource. */
export class BuiltinAuthAdapter implements AdminAuthAdapter {
  private readonly users: Repository<NmaUser>;
  private readonly sessions: Repository<NmaSession>;
  private readonly options: Resolved;
  private readonly limiter: RateLimiter;
  /** Checked for unknown usernames, so they cost as much time as a wrong password. */
  private dummyHash?: Promise<string>;

  constructor(
    private readonly dataSource: DataSource,
    options: BuiltinAuthOptions = {},
  ) {
    for (const entity of [NmaUser, NmaSession]) {
      if (!dataSource.hasMetadata(entity)) {
        throw new Error(`@nest-my-admin/auth: add ADMIN_AUTH_ENTITIES to the entities of the DataSource "${options.dataSource ?? 'default'}" (${entity.name} is missing)`);
      }
    }
    this.users = dataSource.getRepository(NmaUser);
    this.sessions = dataSource.getRepository(NmaSession);
    this.options = {
      cookieName: options.cookieName ?? 'nma_session',
      secureCookie: options.secureCookie ?? 'auto',
      idleTimeout: options.idleTimeout ?? 12 * 3600,
      absoluteTimeout: options.absoluteTimeout ?? 30 * 24 * 3600,
      lockoutAttempts: options.lockout?.attempts ?? 5,
      lockoutMs: (options.lockout?.minutes ?? 15) * 60_000,
      loginAttemptsPerMinute: options.loginAttemptsPerMinute ?? 20,
      password: options.password ?? {},
      now: options.now ?? (() => new Date()),
      scrypt: options.scrypt ?? SCRYPT,
    };
    this.limiter = new RateLimiter(this.options.loginAttemptsPerMinute, 60_000);
  }

  /** Creates the bootstrap superuser when the table is empty. */
  async init(bootstrap?: BuiltinAuthOptions['bootstrapSuperuser']): Promise<void> {
    if (bootstrap && (await this.users.count()) === 0) {
      await createAdminUser(this.dataSource, { ...bootstrap, isSuperuser: true }, { password: this.options.password, scrypt: this.options.scrypt });
    }
  }

  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const token = parseCookies(req.headers.cookie)[this.options.cookieName];
    if (!token || token.length > 200) return null;
    const session = await this.sessions.findOne({ where: { tokenHash: sha256(token) }, relations: { user: true } });
    if (!session) return null;
    const now = this.options.now();
    const idleLimit = session.lastSeenAt.getTime() + this.options.idleTimeout * 1000;
    if (now.getTime() >= session.expiresAt.getTime() || now.getTime() >= idleLimit || !session.user?.isActive) {
      await this.sessions.delete({ id: session.id });
      return null;
    }
    // Sliding expiry, written at most once a minute.
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) await this.sessions.update({ id: session.id }, { lastSeenAt: now });
    return { user: toAdminUser(session.user), csrfToken: session.csrfToken, sessionId: session.id };
  }

  async login(input: LoginInput, io: AuthIO): Promise<AdminPrincipal> {
    const now = this.options.now();
    const limit = this.limiter.hit(clientIp(io.req), now.getTime());
    if (!limit.allowed) throw new AdminRateLimitError('Too many sign-in attempts; wait a minute and try again', limit.retryAfter);

    const username = input.username.trim().toLowerCase();
    const user = await this.users.findOne({ where: { username } });
    // Unknown users are checked against a dummy hash: the same work, the same answer.
    this.dummyHash ??= hashPassword(randomBytes(16).toString('hex'), this.options.scrypt);
    const matches = await verifyPassword(input.password, user?.passwordHash ?? (await this.dummyHash));
    const locked = user?.lockedUntil !== null && user?.lockedUntil !== undefined && user.lockedUntil.getTime() > now.getTime();

    if (!user || !user.isActive || locked || !matches) {
      if (user && !locked && !matches) {
        user.failedLogins += 1;
        if (user.failedLogins >= this.options.lockoutAttempts) {
          user.failedLogins = 0;
          user.lockedUntil = new Date(now.getTime() + this.options.lockoutMs);
        }
        await this.users.update({ id: user.id }, { failedLogins: user.failedLogins, lockedUntil: user.lockedUntil });
      }
      throw new AdminUnauthenticatedError(WRONG);
    }

    await this.users.update({ id: user.id }, { failedLogins: 0, lockedUntil: null, lastLoginAt: now });
    // A sign-in clears the user's expired sessions.
    await this.sessions.delete({ userId: user.id, expiresAt: LessThan(now) });
    const token = randomBytes(32).toString('base64url');
    const session = this.sessions.create({
      id: randomBytes(16).toString('hex'),
      tokenHash: sha256(token),
      userId: user.id,
      csrfToken: randomBytes(24).toString('base64url'),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + this.options.absoluteTimeout * 1000),
      userAgent: String(io.req.headers['user-agent'] ?? '').slice(0, 300) || null,
      ip: clientIp(io.req).slice(0, 64),
    });
    await this.sessions.insert(session);
    this.setCookie(io, token, this.options.absoluteTimeout);
    return { user: toAdminUser(user), csrfToken: session.csrfToken, sessionId: session.id };
  }

  async logout(principal: AdminPrincipal, io: AuthIO): Promise<void> {
    if (principal.sessionId) await this.sessions.delete({ id: principal.sessionId });
    this.setCookie(io, '', 0);
  }

  async listSessions(principal: AdminPrincipal): Promise<AdminSessionInfo[]> {
    const now = this.options.now().getTime();
    const rows = await this.sessions.find({ where: { userId: Number(principal.user.id) }, order: { lastSeenAt: 'DESC' } });
    return rows
      .filter((row) => row.expiresAt.getTime() > now && row.lastSeenAt.getTime() + this.options.idleTimeout * 1000 > now)
      .map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: new Date(Math.min(row.expiresAt.getTime(), row.lastSeenAt.getTime() + this.options.idleTimeout * 1000)),
        ...(row.userAgent ? { userAgent: row.userAgent } : {}),
        ...(row.ip ? { ip: row.ip } : {}),
      }));
  }

  async revokeSession(principal: AdminPrincipal, sessionId: string): Promise<void> {
    await this.sessions.delete({ id: sessionId, userId: Number(principal.user.id) });
  }

  async revokeOtherSessions(principal: AdminPrincipal): Promise<void> {
    const userId = Number(principal.user.id);
    if (principal.sessionId) await this.sessions.delete({ userId, id: Not(principal.sessionId) });
    else await this.sessions.delete({ userId });
  }

  async changePassword(principal: AdminPrincipal, input: { current: string; next: string }): Promise<void> {
    const user = await this.users.findOne({ where: { id: Number(principal.user.id) } });
    if (!user) throw new AdminUnauthenticatedError();
    if (!(await verifyPassword(input.current, user.passwordHash))) throw new AdminValidationError({ current: ['is wrong'] }, 'The current password is wrong');
    const problems = passwordProblems(input.next, { username: user.username }, this.options.password);
    if (problems.length > 0) throw new AdminValidationError({ next: problems }, 'Choose another password');
    await this.users.update({ id: user.id }, { passwordHash: await hashPassword(input.next, this.options.scrypt) });
    // Someone who knew the old password is signed out everywhere else.
    await this.revokeOtherSessions(principal);
  }

  private setCookie(io: { req: IncomingMessage; res: ServerResponse }, value: string, maxAge: number): void {
    const secure = this.options.secureCookie === 'auto' ? isSecureRequest(io.req as Parameters<typeof isSecureRequest>[0]) : this.options.secureCookie;
    appendSetCookie(io.res, serializeCookie(this.options.cookieName, value, { path: cookiePath(io.req), httpOnly: true, secure, sameSite: 'Lax', maxAge }));
  }
}

export function toAdminUser(user: NmaUser): AdminUser {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    ...(user.email ? { email: user.email } : {}),
    isSuperuser: user.isSuperuser,
  };
}

/** Creates an admin user (a seed script, a CLI of your own). The password must meet the policy. */
export async function createAdminUser(
  dataSource: DataSource,
  input: { username: string; password: string; displayName?: string; email?: string; isSuperuser?: boolean },
  options: { password?: PasswordPolicy; scrypt?: typeof SCRYPT } = {},
): Promise<NmaUser> {
  const username = input.username.trim().toLowerCase();
  if (!/^[\p{L}\p{N}._@+-]{1,150}$/u.test(username)) throw new Error(`@nest-my-admin/auth: "${input.username}" is not a valid username`);
  const problems = passwordProblems(input.password, { username }, options.password);
  if (problems.length > 0) throw new Error(`@nest-my-admin/auth: the password for "${username}" ${problems.join(', ')}`);
  const users = dataSource.getRepository(NmaUser);
  return users.save(
    users.create({
      username,
      displayName: input.displayName ?? input.username.trim(),
      email: input.email ?? null,
      passwordHash: await hashPassword(input.password, options.scrypt),
      isSuperuser: input.isSuperuser ?? false,
    }),
  );
}

/** `AdminModule.forRoot({ auth: builtinAuth({ … }) })`. */
export function builtinAuth(options: BuiltinAuthOptions = {}): AdminAuthConfig {
  return AdminAuth.factory(async (moduleRef: ModuleRef) => {
    let dataSource: DataSource;
    try {
      dataSource = moduleRef.get<DataSource>(getDataSourceToken(options.dataSource) as string, { strict: false });
    } catch {
      throw new Error(`@nest-my-admin/auth: no TypeORM DataSource "${options.dataSource ?? 'default'}"; import TypeOrmModule.forRoot() in the app`);
    }
    const adapter = new BuiltinAuthAdapter(dataSource, options);
    await adapter.init(options.bootstrapSuperuser);
    return adapter;
  });
}
