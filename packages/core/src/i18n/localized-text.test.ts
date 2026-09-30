import { describe, expect, test } from 'bun:test';
import { pickLocale, resolveText } from './localized-text.js';

describe('resolveText', () => {
  test('plain strings are the same in every locale', () => {
    expect(resolveText('Orders', 'fa', 'en')).toBe('Orders');
  });

  test('falls back to the default locale, then to the first value', () => {
    const label = { en: 'Orders', fa: 'سفارش‌ها' };
    expect(resolveText(label, 'fa', 'en')).toBe('سفارش‌ها');
    expect(resolveText(label, 'de', 'en')).toBe('Orders');
    expect(resolveText({ fa: 'فقط فارسی' }, 'en', 'en')).toBe('فقط فارسی');
  });
});

describe('pickLocale', () => {
  test('exact tags, then primary subtags, by quality', () => {
    expect(pickLocale('fa-IR,fa;q=0.9,en;q=0.8', ['en', 'fa'], 'en')).toBe('fa');
    expect(pickLocale('en;q=0.5, fa;q=0.9', ['en', 'fa'], 'en')).toBe('fa');
    expect(pickLocale('EN-us', ['en', 'fa'], 'fa')).toBe('en');
  });

  test('falls back when nothing matches', () => {
    expect(pickLocale('de', ['en', 'fa'], 'en')).toBe('en');
    expect(pickLocale(undefined, ['en', 'fa'], 'fa')).toBe('fa');
    expect(pickLocale('fa;q=0', ['en', 'fa'], 'en')).toBe('en');
  });
});
