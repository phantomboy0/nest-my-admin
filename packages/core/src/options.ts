import type { AdminError } from './errors.js';

/**
 * Translates your own exceptions into admin errors. Return undefined to leave an error alone.
 * Runs for every error that is not already an AdminError, after the request's context has ended
 * (AdminContext.current() is undefined); use the error itself.
 */
export type ErrorMapper = (error: unknown) => AdminError | undefined;

export interface AdminModuleOptions {
  /** Mount path of the admin UI and API. Default `/admin`. */
  path?: string;
  /** Title shown in the UI. Default `Admin`. */
  title?: string;
  /** Give every entity of the default DataSource without an @AdminResource a default resource. Default `false`. */
  autoRegister?: boolean;
  /** Run every create/update/delete in one database transaction (ctx.manager). Default `true`. */
  transactions?: boolean;
  /** Translate your own exceptions into admin errors (see ErrorMapper). Default: none. */
  errorMapper?: ErrorMapper;
  /** Advanced: serve the UI from this directory instead of @nest-my-admin/ui (tests, UI development). */
  uiDistPath?: string;
}

export interface ResolvedAdminOptions {
  path: string;
  title: string;
  autoRegister: boolean;
  transactions: boolean;
  errorMapper?: ErrorMapper;
  uiDistPath?: string;
}

export function resolveAdminOptions(options: AdminModuleOptions = {}): ResolvedAdminOptions {
  const raw = (options.path ?? '/admin').trim();
  const path = '/' + raw.replace(/^\/+|\/+$/g, '');
  if (path === '/') {
    throw new Error('nest-my-admin: `path` must not be "/"; mount the admin under its own path such as "/admin"');
  }
  if (!/^\/[A-Za-z0-9\-._~/]+$/.test(path)) throw new Error(`nest-my-admin: invalid path "${options.path}"`);
  return {
    path,
    title: options.title ?? 'Admin',
    uiDistPath: options.uiDistPath,
    autoRegister: options.autoRegister ?? false,
    transactions: options.transactions ?? true,
    errorMapper: options.errorMapper,
  };
}
