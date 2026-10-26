import { afterEach, describe, expect, test } from 'bun:test';
import { applyDisplay, applyLocale } from '@/i18n';
import { formatMoney, groupMoney, setGlobalCurrency, ungroupMoney } from './money';

describe('money', () => {
  test('groups thousands and pads the fraction to the scale', () => {
    expect(groupMoney('1234567.5', 2)).toBe('1,234,567.50');
    expect(groupMoney('12', 2)).toBe('12.00');
    expect(groupMoney('-1000')).toBe('-1,000');
    expect(groupMoney('999.999', 2)).toBe('999.999'); // never rounded: the server says it has too many digits
    expect(groupMoney('1,234.5', 2)).toBe('1,234.50');
    expect(groupMoney('0012.3', 2)).toBe('12.30');
  });
  test('leaves what is not a number alone', () => {
    expect(groupMoney('', 2)).toBe('');
    expect(groupMoney('12,5', 2)).toBe('12,5');
    expect(groupMoney('abc', 2)).toBe('abc');
  });
  test('parses grouped text back', () => {
    expect(ungroupMoney('1,234.5')).toBe('1234.5');
    expect(ungroupMoney(' 1,234,567.50 ')).toBe('1234567.50');
    expect(ungroupMoney('1,23')).toBe('1,23');
  });
});

describe('formatMoney', () => {
  afterEach(() => {
    applyLocale('en');
    applyDisplay({ calendar: 'gregorian', digits: 'latn' });
    setGlobalCurrency(undefined);
  });

  test('the global unit, in Persian digits and separators', () => {
    applyLocale('fa');
    applyDisplay({ calendar: 'persian', digits: 'arabext' });
    setGlobalCurrency({ unit: { fa: 'تومان', en: 'Toman' }, position: 'after' });
    expect(formatMoney('3250000')).toEqual({ main: '۳٬۲۵۰٬۰۰۰', unit: 'تومان', position: 'after' });
    applyLocale('en');
    applyDisplay({ calendar: 'gregorian', digits: 'latn' });
    expect(formatMoney('3250000')).toEqual({ main: '3,250,000', unit: 'Toman', position: 'after' });
  });

  test("a field's currency wins over the global one; without any there is no unit", () => {
    setGlobalCurrency({ unit: 'Toman', position: 'after' });
    expect(formatMoney('12.5', { currency: { unit: 'USD', position: 'before' }, scale: 2 })).toEqual({ main: '12.50', unit: 'USD', position: 'before' });
    setGlobalCurrency(undefined);
    expect(formatMoney('12.5')).toEqual({ main: '12.5' });
  });

  test('previous is formatted the same way', () => {
    applyDisplay({ calendar: 'persian', digits: 'arabext' });
    expect(formatMoney('2890000', { previous: '3250000' })).toEqual({ main: '۲٬۸۹۰٬۰۰۰', previous: '۳٬۲۵۰٬۰۰۰' });
  });
});
