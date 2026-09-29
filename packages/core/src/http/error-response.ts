import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { AdminErrorBody, AdminErrorCode } from '../contract.js';
import { AdminError } from '../errors.js';

export interface ErrorResponse {
  status: number;
  body: AdminErrorBody;
}

export interface ErrorLogger {
  error(message: string): void;
}

/** Maps any thrown value to the admin error contract. Never leaks messages of 5xx/unknown errors. */
export function toErrorResponse(
  error: unknown,
  correlationId: string,
  logger: ErrorLogger,
  columnProperties?: ReadonlyMap<string, string>,
): ErrorResponse {
  if (error instanceof AdminError) {
    return {
      status: error.status,
      body: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}), correlationId },
    };
  }
  if (error instanceof HttpException && error.getStatus() < 500) {
    const status = error.getStatus();
    return { status, body: { code: codeForStatus(status), message: httpExceptionMessage(error), correlationId } };
  }
  if (error instanceof QueryFailedError) {
    const mapped = constraintError(error, columnProperties);
    if (mapped) return { status: mapped.status, body: { ...mapped.body, correlationId } };
  }
  logger.error(`[${correlationId}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal error', correlationId } };
}

function codeForStatus(status: number): AdminErrorCode {
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'VALIDATION';
  return 'BUSINESS_RULE';
}

function httpExceptionMessage(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  if (typeof message === 'string') return message;
  return error.message;
}

function constraintError(
  error: QueryFailedError,
  columnProperties?: ReadonlyMap<string, string>,
): { status: number; body: Omit<AdminErrorBody, 'correlationId'> } | undefined {
  const driver = (error.driverError ?? {}) as unknown as { code?: unknown; column?: unknown; detail?: unknown };
  const code = String(driver.code ?? '');
  const text = `${error.message} ${typeof driver.detail === 'string' ? driver.detail : ''}`;
  const column = typeof driver.column === 'string' ? driver.column : columnFromMessage(text);
  const field = column ? (columnProperties?.get(column) ?? column) : undefined;

  if (code === '23505' || code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(text)) {
    return {
      status: 409,
      body: { code: 'CONFLICT', message: 'A record with this value already exists', ...(field ? { fields: { [field]: ['already exists'] } } : {}) },
    };
  }
  if (code === '23502' || code === 'ER_BAD_NULL_ERROR' || /NOT NULL constraint failed/i.test(text)) {
    return {
      status: 422,
      body: { code: 'VALIDATION', message: 'A required value is missing', ...(field ? { fields: { [field]: ['is required'] } } : {}) },
    };
  }
  return undefined;
}

function columnFromMessage(text: string): string | undefined {
  return (
    /constraint failed: [\w"]+\."?(\w+)/i.exec(text)?.[1] ?? // SQLite: UNIQUE constraint failed: product.sku
    /Key \("?(\w+)"?\)=/.exec(text)?.[1] ?? // Postgres unique: Key (sku)=(A1) already exists.
    /Column '(\w+)' cannot be null/.exec(text)?.[1] ?? // MySQL not-null
    /column "(\w+)"/.exec(text)?.[1] // Postgres not-null message
  );
}
