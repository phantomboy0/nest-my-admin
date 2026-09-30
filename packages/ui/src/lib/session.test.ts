import { describe, expect, test } from 'bun:test';
import { safeNext } from './session';

describe('safeNext', () => {
  test('keeps admin paths and refuses anything else', () => {
    expect(safeNext('/product/3?tab=x')).toBe('/product/3?tab=x');
    expect(safeNext(null)).toBe('/');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('/\\evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
    expect(safeNext('javascript:alert(1)')).toBe('/');
    expect(safeNext('/login?next=/x')).toBe('/');
  });
});
