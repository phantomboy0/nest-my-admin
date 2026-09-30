import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { EntityManager } from 'typeorm';

/** Passed to every resource method. Grows in later milestones (user, permissions, locale). */
export interface AdminContext {
  /** Echoed in error responses and logs. */
  correlationId: string;
  /** The underlying Node request (an Express request in v1). */
  request: IncomingMessage;
  /**
   * The transaction's EntityManager while a create/update/delete runs (undefined for reads).
   * Use it in your services to write inside the admin's transaction.
   */
  manager?: EntityManager;
}

const storage = new AsyncLocalStorage<AdminContext>();

export const AdminContext = {
  /** The admin request being handled, or undefined outside one (for example in your own controllers). */
  current(): AdminContext | undefined {
    return storage.getStore();
  },
  /** @internal Runs `fn` with `ctx` as the current admin context. */
  run<T>(ctx: AdminContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
};

export function createAdminContext(request: IncomingMessage): AdminContext {
  return { correlationId: randomUUID(), request };
}
