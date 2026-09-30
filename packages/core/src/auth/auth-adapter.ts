import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Type } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';

/** The person using the admin, as an auth adapter describes them (spec §5.5). */
export interface AdminUser {
  id: string | number;
  displayName: string;
  username?: string;
  email?: string;
  /** Bypasses every permission check. */
  isSuperuser: boolean;
  /** Anything your scopes need (`ctx.user.attrs.branchId`). */
  attrs?: Record<string, unknown>;
}

/** A signed-in request: the user, and for cookie sessions the session and its CSRF token. */
export interface AdminPrincipal {
  user: AdminUser;
  /**
   * Set for cookie-based sessions: mutating requests (POST, PATCH, DELETE) must send it as `X-CSRF-Token`.
   * Adapters that read a token from a header the browser never adds by itself (Authorization) leave it out.
   */
  csrfToken?: string;
  /** The session's id, for the account page ("this device"). */
  sessionId?: string;
}

export interface AuthIO {
  req: IncomingMessage;
  res: ServerResponse;
}

export interface LoginInput {
  username: string;
  password: string;
}

/** One signed-in device, for the account page. */
export interface AdminSessionInfo {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  userAgent?: string;
  ip?: string;
}

/**
 * Who uses the admin (spec §7, D3). Only `authenticate` is required; the admin's login page, logout and account page
 * use the optional methods when they exist. Errors thrown as AdminError (401, 422, 429…) reach the UI as they are.
 */
export interface AdminAuthAdapter {
  /** Who is making this request, or null when nobody is signed in. Runs for every admin API request. */
  authenticate(req: IncomingMessage): Promise<AdminPrincipal | null>;
  /** Username/password sign-in from the admin's login page; sets whatever cookie it needs on `io.res`. */
  login?(input: LoginInput, io: AuthIO): Promise<AdminPrincipal>;
  /** Ends this session (and clears its cookie). */
  logout?(principal: AdminPrincipal, io: AuthIO): Promise<void>;
  listSessions?(principal: AdminPrincipal): Promise<AdminSessionInfo[]>;
  /** Ends one of the user's own sessions. */
  revokeSession?(principal: AdminPrincipal, sessionId: string): Promise<void>;
  /** "Log out everywhere else": ends every session of the user except this one. */
  revokeOtherSessions?(principal: AdminPrincipal): Promise<void>;
  changePassword?(principal: AdminPrincipal, input: { current: string; next: string }, io: AuthIO): Promise<void>;
  /** Admin role names of this user (your own roles mapped to the admin's, spec §6.6). */
  resolveRoles?(user: AdminUser): string[] | Promise<string[]>;
}

/** How the admin authenticates (`AdminModuleOptions.auth`). */
export type AdminAuthConfig =
  | { kind: 'none' }
  | { kind: 'adapter'; resolve: (moduleRef: ModuleRef) => AdminAuthAdapter | Promise<AdminAuthAdapter> };

export const AdminAuth = {
  /** No sign-in: everyone who can reach the admin is a superuser. For local tools only. */
  none(): AdminAuthConfig {
    return { kind: 'none' };
  },
  /** Your own adapter: a provider of your app (it can inject your services), found through Nest's ModuleRef. */
  custom(adapter: Type<AdminAuthAdapter>): AdminAuthConfig {
    return { kind: 'adapter', resolve: (moduleRef) => moduleRef.get(adapter, { strict: false }) };
  },
  /** An adapter built at boot (what `builtinAuth()` from @nest-my-admin/auth returns). */
  factory(resolve: (moduleRef: ModuleRef) => AdminAuthAdapter | Promise<AdminAuthAdapter>): AdminAuthConfig {
    return { kind: 'adapter', resolve };
  },
};

/** The user of an admin without authentication (`AdminAuth.none()`, or no `auth` outside production). */
export const OPEN_ADMIN_USER: AdminUser = Object.freeze({ id: 'anonymous', displayName: 'Admin', isSuperuser: true });
