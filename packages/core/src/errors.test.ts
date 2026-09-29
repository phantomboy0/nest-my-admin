import { describe, expect, test } from 'bun:test';
import { AdminBadRequestError, AdminError, AdminFieldError, AdminNotFoundError, AdminValidationError } from './errors.js';

describe('admin errors', () => {
  test('AdminValidationError carries 422 and per-field messages', () => {
    const error = new AdminValidationError({ name: ['is required'] });
    expect(error).toBeInstanceOf(AdminError);
    expect(error.code).toBe('VALIDATION');
    expect(error.status).toBe(422);
    expect(error.fields).toEqual({ name: ['is required'] });
    expect(error.message).toBe('Validation failed');
    expect(error.name).toBe('AdminValidationError');
  });

  test('AdminFieldError accepts single messages and normalises them to arrays', () => {
    const error = new AdminFieldError({ total: 'Exceeds credit limit', sku: ['taken', 'reserved'] });
    expect(error).toBeInstanceOf(AdminValidationError);
    expect(error.fields).toEqual({ total: ['Exceeds credit limit'], sku: ['taken', 'reserved'] });
  });

  test('AdminNotFoundError and AdminBadRequestError have their codes', () => {
    expect(new AdminNotFoundError()).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'Not found' });
    expect(new AdminBadRequestError('Nope')).toMatchObject({ code: 'BAD_REQUEST', status: 400, message: 'Nope' });
  });
});
