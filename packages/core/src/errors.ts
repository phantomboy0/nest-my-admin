import type { AdminErrorCode, AdminRecord } from './contract.js';

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

/** 409 CONFLICT; `current` is the record as it is now, when the conflict is a stale version. */
export class AdminConflictError extends AdminError {
  constructor(
    message: string,
    readonly current?: AdminRecord,
  ) {
    super('CONFLICT', 409, message);
  }
}

/** 401: not signed in (or the session ended). */
export class AdminUnauthenticatedError extends AdminError {
  constructor(message = 'Sign in to continue') {
    super('UNAUTHENTICATED', 401, message);
  }
}

/** 403: signed in, but not allowed (a missing CSRF token, a missing permission). */
export class AdminForbiddenError extends AdminError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', 403, message);
  }
}

/** 429: too many attempts; `retryAfter` seconds are sent as `Retry-After`. */
export class AdminRateLimitError extends AdminError {
  constructor(
    message: string,
    readonly retryAfter: number,
  ) {
    super('RATE_LIMITED', 429, message);
  }
}

export class AdminBadRequestError extends AdminError {
  constructor(message: string) {
    super('BAD_REQUEST', 400, message);
  }
}

export class AdminUnsupportedMediaTypeError extends AdminError {
  constructor(message: string) {
    super('BAD_REQUEST', 415, message);
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
