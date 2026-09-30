import { describe, expect, test } from 'bun:test';
import { groupMoney, ungroupMoney } from './money';

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
