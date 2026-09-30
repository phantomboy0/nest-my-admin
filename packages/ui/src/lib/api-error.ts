import type { AdminErrorBody } from '@nest-my-admin/core/contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: AdminErrorBody,
  ) {
    super(body.code === 'INTERNAL' && body.correlationId ? `${body.message} (reference: ${body.correlationId})` : body.message);
    this.name = 'ApiError';
  }

  get fields(): Record<string, string[]> {
    return this.body.fields ?? {};
  }
}

/** One line for places that show a whole error at once (list page, banners). */
export function describeError(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  const details = Object.entries(error.fields).map(([name, messages]) => `${name}: ${messages.join(', ')}`);
  return [error.message, ...details].join(' — ');
}
