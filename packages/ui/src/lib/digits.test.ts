import { describe, expect, test } from 'bun:test';
import { toLatinDigits, toLatinNumber, toPersianDigits, toPersianNumber } from './digits';

describe('digits', () => {
  test('every digit set reads as Latin', () => {
    expect(toLatinDigits('۱۴۰۳/۰۱/۱۵')).toBe('1403/01/15');
    expect(toLatinDigits('٢٠٢٤')).toBe('2024');
    expect(toLatinNumber('۱٬۲۳۴٫۵')).toBe('1,234.5');
    expect(toLatinNumber('abc')).toBe('abc');
  });
  test('Persian display', () => {
    expect(toPersianDigits('1403/01/15')).toBe('۱۴۰۳/۰۱/۱۵');
    expect(toPersianNumber('1,234.50')).toBe('۱٬۲۳۴٫۵۰');
    expect(toLatinNumber(toPersianNumber('-12,345.678'))).toBe('-12,345.678');
  });
});
