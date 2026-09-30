import { describe, expect, test } from 'bun:test';
import { ApiError, describeError } from './api-error';

describe('ApiError', () => {
  test('internal errors carry the correlation id so users can report it', () => {
    expect(new ApiError(500, { code: 'INTERNAL', message: 'Internal error', correlationId: 'abc-123' }).message).toBe(
      'Internal error (reference: abc-123)',
    );
    expect(new ApiError(404, { code: 'NOT_FOUND', message: 'Gone', correlationId: 'x' }).message).toBe('Gone');
  });

  test('describeError lists field messages after the main message', () => {
    const error = new ApiError(422, {
      code: 'VALIDATION', message: 'Invalid list query', fields: { 'filter[price][gte]': ['must be a number'] }, correlationId: 'x',
    });
    expect(describeError(error)).toBe('Invalid list query — filter[price][gte]: must be a number');
    expect(describeError(new Error('offline'))).toBe('offline');
  });
});
