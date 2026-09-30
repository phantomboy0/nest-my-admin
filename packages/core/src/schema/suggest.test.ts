import { describe, expect, test } from 'bun:test';
import { didYouMean, suggest } from './suggest.js';

describe('suggest', () => {
  test('finds the closest candidate within a small edit distance', () => {
    expect(suggest('nmae', ['name', 'price'])).toBe('name');
    expect(suggest('NAME', ['name'])).toBe('name');
    expect(suggest('createdat', ['createdAt', 'updatedAt'])).toBe('createdAt');
  });

  test('returns nothing when nothing is close', () => {
    expect(suggest('zzz', ['name'])).toBeUndefined();
    expect(suggest('name', [])).toBeUndefined();
  });

  test('didYouMean formats the hint', () => {
    expect(didYouMean('nmae', ['name'])).toBe(' (did you mean "name"?)');
    expect(didYouMean('zzz', ['name'])).toBe('');
  });
});
