import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { activeLocale, applyLocale } from '@/i18n';
import { ApiError } from './api-error';

const fieldsOf = (messages: string[]) => new ApiError(422, { code: 'VALIDATION', message: 'Validation failed', fields: { x: messages }, correlationId: 'c' }).fields.x;

describe('server texts in Persian', () => {
  const before = activeLocale();
  beforeAll(() => applyLocale('fa'));
  afterAll(() => applyLocale(before));

  test.each([
    ['rating must not be greater than 5', 'نباید بیشتر از ۵ باشد'],
    ['rating must not be less than 1', 'نباید کمتر از ۱ باشد'],
    ['mobile must be longer than or equal to 10 characters', 'دست‌کم ۱۰ نویسه لازم است'],
    ['title must be shorter than or equal to 200 characters', 'حداکثر ۲۰۰ نویسه مجاز است'],
    ['title must be longer than or equal to 1 characters', 'الزامی است'],
    ['type must be one of the following values: text, number', 'یکی از گزینه‌ها را انتخاب کنید'],
    ['categoryId must be an integer number', 'باید عدد صحیح باشد'],
    ['each value in tags must be a string', 'باید متن باشد'],
    ['is taken', 'قبلاً گرفته شده است'],
    ['You may not delete this محصول record', 'اجازه‌ی این کار را ندارید'],
    ['محصول was changed by someone else since you opened it', 'این رکورد را کس دیگری تغییر داده است؛ صفحه را دوباره باز کنید'],
  ])('%s', (text, expected) => {
    expect(fieldsOf([text])).toEqual([expected]);
  });

  test('two texts that say the same thing are one message; a host’s own words pass through', () => {
    expect(fieldsOf(['title must be longer than or equal to 1 characters', 'is required'])).toEqual(['الزامی است']);
    expect(fieldsOf(['کد ملی ۱۰ رقم است'])).toEqual(['کد ملی ۱۰ رقم است']);
  });
});

describe('server texts in English', () => {
  test('stay exactly as sent, name included', () => {
    expect(activeLocale().startsWith('en')).toBe(true);
    expect(fieldsOf(['rating must not be greater than 5'])).toEqual(['rating must not be greater than 5']);
    expect(fieldsOf(['type must be one of the following values: a, b'])).toEqual(['type must be one of the following values: a, b']);
  });
});
