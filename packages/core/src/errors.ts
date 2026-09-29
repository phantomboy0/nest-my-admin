import type { AdminErrorCode } from './contract.js';

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AdminValidationError extends AdminError {
  constructor(fields: Record<string, string[]>, message = 'Validation failed') {
    super('VALIDATION', 422, message, fields);
  }
}

export class AdminNotFoundError extends AdminError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', 404, message);
  }
}

export class AdminBadRequestError extends AdminError {
  constructor(message: string) {
    super('BAD_REQUEST', 400, message);
  }
}

/** Throw from host code (e.g. a service called by a resource) to attach messages to form fields. */
export class AdminFieldError extends AdminValidationError {
  constructor(fields: Record<string, string | string[]>, message = 'Validation failed') {
    super(
      Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, Array.isArray(value) ? value : [value]])),
      message,
    );
  }
}
