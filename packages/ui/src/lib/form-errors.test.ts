import { describe, expect, test } from 'bun:test';
import { ApiError } from './api-error';
import { shownErrors } from './form-errors';
import { applyLocale } from '@/i18n';

const failure = (status: number, code: 'VALIDATION' | 'CONFLICT' | 'BUSINESS_RULE', message: string, fields?: Record<string, string[]>) =>
  new ApiError(status, { code, message, correlationId: 'c1', ...(fields ? { fields } : {}) });

describe('where a failed write is shown', () => {
  test('field errors go next to their inputs, nested ones to their group', () => {
    expect(shownErrors(failure(422, 'VALIDATION', 'Validation failed', { tracking: ['is too short'], 'address.city': ['is required'] }), ['tracking', 'address'])).toEqual({
      fields: { tracking: ['is too short'], 'address.city': ['is required'] },
      form: null,
    });
  });
  test('what a field the form does not have says goes above the form', () => {
    expect(shownErrors(failure(422, 'VALIDATION', 'Validation failed', { tracking: ['is too short'], ids: ['must be a list'] }), ['tracking'])).toEqual({
      fields: { tracking: ['is too short'] },
      form: 'Validation failed — must be a list',
    });
  });
  test("a host's refusal (409 CONFLICT, 400 BUSINESS_RULE) is shown with its own message", () => {
    expect(shownErrors(failure(409, 'CONFLICT', 'This order is already shipped'), ['tracking'])).toEqual({ fields: {}, form: 'This order is already shipped' });
    expect(shownErrors(failure(400, 'BUSINESS_RULE', 'The courier refused the parcel'), [])).toEqual({ fields: {}, form: 'The courier refused the parcel' });
    expect(shownErrors(new Error('Failed to fetch'), ['tracking'])).toEqual({ fields: {}, form: 'Failed to fetch' });
  });
});

describe('server texts', () => {
  test('a field the form does not show says what is wrong, without its internal name', () => {
    expect(shownErrors(failure(422, 'VALIDATION', 'Validation failed', { variants: ['The two variants are the same'] }), ['name']).form).toBe('Validation failed — The two variants are the same');
  });
  test("the admin's own English texts are translated for the signed-in language", () => {
    applyLocale('fa');
    try {
      const error = failure(409, 'CONFLICT', 'A record with this value already exists', { sku: ['already exists'], name: ['A host text stays as it is'] });
      expect(error.fields.sku).toEqual(['این مقدار قبلاً ثبت شده است']);
      expect(error.fields.name).toEqual(['A host text stays as it is']);
      expect(error.message).toBe('رکوردی با همین مقدار از قبل وجود دارد');
    } finally {
      applyLocale('en');
    }
  });
});
