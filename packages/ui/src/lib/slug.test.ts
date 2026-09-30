import { describe, expect, test } from 'bun:test';
import { slugify } from './slug';

describe('slugify', () => {
  test('Latin text', () => {
    expect(slugify('Hello World — Tehran!')).toBe('hello-world-tehran');
    expect(slugify('  Café  crème ')).toBe('cafe-creme');
    expect(slugify('Model 3 (2024)')).toBe('model-3-2024');
  });
  test('Persian letters stay; the zero-width non-joiner separates', () => {
    expect(slugify('سلام دنیا')).toBe('سلام-دنیا');
    expect(slugify('پیش‌نویس')).toBe('پیش-نویس');
  });
  test('nothing usable gives an empty slug', () => {
    expect(slugify('!!!')).toBe('');
  });
});
