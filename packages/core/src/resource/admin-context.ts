import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Passed to every resource method. Grows in later milestones (user, permissions, transaction manager). */
export interface AdminContext {
  /** Echoed in error responses and logs. */
  correlationId: string;
  /** The underlying Node request (an Express request in v1). */
  request: IncomingMessage;
}

export function createAdminContext(request: IncomingMessage): AdminContext {
  return { correlationId: randomUUID(), request };
}
