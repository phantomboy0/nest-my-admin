import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { EntityManager } from 'typeorm';
import type { AdminUser } from '../auth/auth-adapter.js';

/** Passed to every resource method. Grows in later milestones (user, permissions, locale). */
export interface AdminContext {
  /** Echoed in error responses and logs. */
  correlationId: string;
  /** The underlying Node request (an Express request in v1). */
  request: IncomingMessage;
  /**
   * The transaction's EntityManager while a create/update/delete runs (undefined for reads).
   * Use it in your services to write inside the admin's transaction. A service that ignores it and uses its
   * own repository writes on a separate pooled connection on Postgres/MySQL: outside the transaction, and able
   * to block on the admin transaction's locks (writing the same row or the same unique key blocks until the admin
   * transaction ends; inserting a row with a foreign key to the just-created record blocks on MySQL and fails with a
   * foreign-key conflict on Postgres). On SQLite it silently joins the admin transaction.
   */
  manager?: EntityManager;
  /** The request's language (from `Accept-Language`, one of the admin's `locales`). */
  locale?: string;
  /** Who is signed in (set for every authenticated request; an open admin's user is a superuser). */
  user?: AdminUser;
}

/** The box is deactivated when the request ends, so timers and clients created inside it see no context. */
const storage = new AsyncLocalStorage<{ ctx: AdminContext; active: boolean }>();

/** @internal Runs `fn` with `ctx` as the current admin context. Not exported from the package: host code must not fabricate contexts. */
export function runInAdminContext<T>(ctx: AdminContext, fn: () => T): T {
  const box = { ctx, active: true };
  let result: T;
  try {
    result = storage.run(box, fn);
  } catch (error) {
    box.active = false;
    throw error;
  }
  if (typeof (result as { then?: unknown } | null | undefined)?.then === 'function') {
    return Promise.resolve(result).finally(() => {
      box.active = false;
    }) as T;
  }
  box.active = false;
  return result;
}

export const AdminContext = {
  /** The admin request being handled, or undefined outside one (for example in your own controllers). */
  current(): AdminContext | undefined {
    const box = storage.getStore();
    return box?.active ? box.ctx : undefined;
  },
};

export function createAdminContext(request: IncomingMessage): AdminContext {
  return { correlationId: randomUUID(), request };
}
