import { describe, expect, test } from 'bun:test';
import { ApiError } from './api-error';
import { shownErrors } from './form-errors';

const failure = (status: number, code: 'VALIDATION' | 'CONFLICT' | 'BUSINESS_RULE', message: string, fields?: Record<string, string[]>) =>
  new ApiError(status, { code, message, correlationId: 'c1', ...(fields ? { fields } : {}) });

describe('where a failed write is shown', () => {
  test('field errors go next to their inputs, nested ones to their group', () => {
    expect(shownErrors(failure(422, 'VALIDATION', 'Validation failed', { tracking: ['is too short'], 'address.city': ['is required'] }), ['tracking', 'address'])).toEqual({
      fields: { tracking: ['is too short'], 'address.city': ['is required'] },
      form: null,
    });
  });
  test('a field the form does not have is named above the form', () => {
    expect(shownErrors(failure(422, 'VALIDATION', 'Validation failed', { tracking: ['is too short'], ids: ['must be a list'] }), ['tracking'])).toEqual({
      fields: { tracking: ['is too short'] },
      form: 'Validation failed — ids: must be a list',
    });
  });
  test("a host's refusal (409 CONFLICT, 400 BUSINESS_RULE) is shown with its own message", () => {
    expect(shownErrors(failure(409, 'CONFLICT', 'This order is already shipped'), ['tracking'])).toEqual({ fields: {}, form: 'This order is already shipped' });
    expect(shownErrors(failure(400, 'BUSINESS_RULE', 'The courier refused the parcel'), [])).toEqual({ fields: {}, form: 'The courier refused the parcel' });
    expect(shownErrors(new Error('Failed to fetch'), ['tracking'])).toEqual({ fields: {}, form: 'Failed to fetch' });
  });
});
