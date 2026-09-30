import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { AdminErrorBody, AdminErrorCode } from '../contract.js';
import { AdminError } from '../errors.js';
import type { ErrorMapper } from '../options.js';
import type { DbNames } from '../registry/db-names.js';

export interface ErrorResponse {
  status: number;
  body: AdminErrorBody;
}

export interface ErrorLogger {
  error(message: string): void;
}

export interface ErrorContext {
  /** Database names of the resource the request was for, to put constraint errors on fields. */
  dbNames?: DbNames;
  errorMapper?: ErrorMapper;
  /** The request deletes a record. SQLite's foreign-key error does not say which side failed; this does. */
  deleting?: boolean;
}

/** Maps any thrown value to the admin error contract. Never leaks messages of 5xx/unknown errors. */
export function toErrorResponse(error: unknown, correlationId: string, logger: ErrorLogger, context: ErrorContext = {}): ErrorResponse {
  const { errorMapper } = context;
  if (errorMapper && !(error instanceof AdminError)) {
    try {
      const mapped = errorMapper(error);
      if (mapped instanceof AdminError) {
        if (mapped.status >= 500) {
          logger.error(`[${correlationId}] errorMapper answered ${mapped.status} for: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
        error = mapped;
      }
    } catch (mapperError) {
      logger.error(`[${correlationId}] errorMapper threw: ${mapperError instanceof Error ? (mapperError.stack ?? mapperError.message) : String(mapperError)}`);
    }
  }
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
    const mapped = constraintError(error, context);
    if (mapped) return { status: mapped.status, body: { ...mapped.body, correlationId } };
  }
  logger.error(`[${correlationId}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal error', correlationId } };
}

export function codeForStatus(status: number): AdminErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413 || status === 415) return 'BAD_REQUEST';
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

interface DriverError {
  code?: unknown;
  column?: unknown;
  constraint?: unknown;
  detail?: unknown;
}

const MYSQL_FK_MISSING_PARENT = new Set(['ER_NO_REFERENCED_ROW', 'ER_NO_REFERENCED_ROW_2']);
const MYSQL_FK_REFERENCED = new Set(['ER_ROW_IS_REFERENCED', 'ER_ROW_IS_REFERENCED_2']);
const MYSQL_NOT_NULL = new Set(['ER_BAD_NULL_ERROR', 'ER_NO_DEFAULT_FOR_FIELD']);
const MYSQL_INVALID_VALUE = new Set([
  'ER_WARN_DATA_OUT_OF_RANGE', 'ER_TRUNCATED_WRONG_VALUE', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', 'ER_DATA_TOO_LONG',
]);

function constraintError(error: QueryFailedError, context: ErrorContext): { status: number; body: Omit<AdminErrorBody, 'correlationId'> } | undefined {
  const driver = (error.driverError ?? {}) as unknown as DriverError;
  const code = String(driver.code ?? '');
  const detail = typeof driver.detail === 'string' ? driver.detail : '';
  const text = `${error.message} ${detail}`;
  const onFields = (message: string) => fieldErrors(driver, text, context.dbNames, message);

  const sqliteForeignKey = /FOREIGN KEY constraint failed/i.test(text);
  if (code === '23503' || MYSQL_FK_MISSING_PARENT.has(code) || MYSQL_FK_REFERENCED.has(code) || sqliteForeignKey) {
    // MySQL's code says which side failed. Postgres (one SQLSTATE for both, messages translated by lc_messages) and
    // SQLite do not: a request that is not a delete wrote the referencing row, so its parent is missing.
    const missingParent = MYSQL_FK_MISSING_PARENT.has(code) || (!MYSQL_FK_REFERENCED.has(code) && !context.deleting);
    if (missingParent) {
      return { status: 422, body: { code: 'VALIDATION', message: 'A related record does not exist', ...onFields('does not exist') } };
    }
    return { status: 409, body: { code: 'CONFLICT', message: 'The change conflicts with related records' } };
  }
  if (code === '23505' || code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(text)) {
    return { status: 409, body: { code: 'CONFLICT', message: 'A record with this value already exists', ...onFields('already exists') } };
  }
  if (code === '23502' || MYSQL_NOT_NULL.has(code) || /NOT NULL constraint failed/i.test(text)) {
    return { status: 422, body: { code: 'VALIDATION', message: 'A required value is missing', ...onFields('is required') } };
  }
  if (/^22/.test(code) || MYSQL_INVALID_VALUE.has(code)) {
    return { status: 422, body: { code: 'VALIDATION', message: 'A value is invalid for its column', ...onFields('is invalid') } };
  }
  return undefined;
}

/** `{ fields }` for the properties behind the constraint or column the driver names; `{}` when it names none. */
function fieldErrors(driver: DriverError, text: string, names: DbNames | undefined, message: string): { fields?: Record<string, string[]> } {
  const constraint = typeof driver.constraint === 'string' ? driver.constraint : constraintFromMessage(text);
  let properties = constraint ? names?.constraints.get(constraint) : undefined;
  if (!properties?.length) {
    const columns = typeof driver.column === 'string' ? [driver.column] : columnsFromMessage(text);
    if (columns.length === 0) return {};
    properties = columns.map((column) => names?.columns.get(column) ?? column);
  }
  return { fields: Object.fromEntries(properties.map((property) => [property, [message]])) };
}

function constraintFromMessage(text: string): string | undefined {
  return (
    /for key '(?:[^'.]+\.)?([^'.]+)'/.exec(text)?.[1] ?? // MySQL unique: Duplicate entry 'A' for key 'product.IDX_…'
    /CONSTRAINT `([^`]+)`/.exec(text)?.[1] // MySQL foreign key: … CONSTRAINT `FK_…` FOREIGN KEY (`widget_id`) …
  );
}

function columnsFromMessage(text: string): string[] {
  // SQLite: "UNIQUE constraint failed: gadget.batch, gadget.serial" / "NOT NULL constraint failed: widget.name"
  const sqlite = /constraint failed: ("?\w+"?\."?\w+"?(?:, "?\w+"?\."?\w+"?)*)/i.exec(text)?.[1];
  if (sqlite) return sqlite.split(', ').map((qualified) => qualified.replace(/"/g, '').split('.')[1]!);
  const column = columnFromMessage(text);
  return column ? [column] : [];
}

function columnFromMessage(text: string): string | undefined {
  return (
    /Key \("?(\w+)"?\)=/.exec(text)?.[1] ?? // Postgres: Key (sku)=(A1) already exists. / … is not present in table
    /FOREIGN KEY \(`(\w+)`\)/.exec(text)?.[1] ?? // MySQL foreign key (single column)
    /Column '(\w+)' cannot be null/.exec(text)?.[1] ?? // MySQL explicit null
    /Field '(\w+)' doesn't have a default value/.exec(text)?.[1] ?? // MySQL missing value
    /for column '(\w+)'/.exec(text)?.[1] ?? // MySQL: Data too long for column 'name' / Out of range value for column 'stock'
    /column "(\w+)"/.exec(text)?.[1] // Postgres not-null message
  );
}
