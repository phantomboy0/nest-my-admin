import { afterEach, describe, expect, test } from 'bun:test';
import { applyDisplay, applyLocale } from '@/i18n';
import { formatMoney, groupMoney, setGlobalCurrency, ungroupMoney, groupTyped } from './money';

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

describe('grouping while typing', () => {
  test('groups as digits arrive and keeps the caret after the same digit', () => {
    expect(groupTyped('1500', 4)).toEqual({ text: '1,500', caret: 5 });
    expect(groupTyped('1,5000', 6)).toEqual({ text: '15,000', caret: 6 });
    expect(groupTyped('1500000', 7)).toEqual({ text: '1,500,000', caret: 9 });
  });
  test('an edit in the middle leaves the caret where it was typed', () => {
    // "1,500" with a 9 typed after the 1.
    expect(groupTyped('19,500', 2)).toEqual({ text: '19,500', caret: 2 });
    // "1,500,000" with the 5 deleted.
    expect(groupTyped('1,00,000', 2)).toEqual({ text: '100,000', caret: 1 });
  });
  test('Persian and Arabic digits become Latin ones', () => {
    expect(groupTyped('۱۵۰۰', 4)).toEqual({ text: '1,500', caret: 5 });
  });
  test('a fraction, a sign and nothing at all stay as typed', () => {
    expect(groupTyped('1234.5', 6)).toEqual({ text: '1,234.5', caret: 7 });
    expect(groupTyped('1234.', 5)).toEqual({ text: '1,234.', caret: 6 });
    expect(groupTyped('-', 1)).toEqual({ text: '-', caret: 1 });
    expect(groupTyped('', 0)).toEqual({ text: '', caret: 0 });
  });
  test('what is not a number is left for the form to report', () => {
    expect(groupTyped('12a', 3)).toEqual({ text: '12a', caret: 3 });
  });
});
