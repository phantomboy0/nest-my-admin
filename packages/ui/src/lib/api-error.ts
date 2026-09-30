import type { AdminErrorBody } from '@nest-my-admin/core/contract';
import { translate as tr } from '@/i18n';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: AdminErrorBody,
  ) {
    super(body.code === 'INTERNAL' && body.correlationId ? tr('common.reference', { message: body.message, id: body.correlationId }) : body.message);
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
