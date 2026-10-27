import { describe, expect, test } from 'bun:test';
import { GREGORIAN, JALALI } from './calendar-system';

describe('calendar systems', () => {
  test('Gregorian: typed in any separator and digits, months and leap years', () => {
    expect(GREGORIAN.parse('2024-02-29')).toBe('2024-02-29');
    expect(GREGORIAN.parse('۲۰۲۴/۲/۹')).toBe('2024-02-09');
    expect(GREGORIAN.parse('2023-02-29')).toBeUndefined();
    expect(GREGORIAN.parse('2024-13-01')).toBeUndefined();
    expect(GREGORIAN.monthLength(2024, 2)).toBe(29);
    expect(GREGORIAN.monthLength(2026, 4)).toBe(30);
    expect(GREGORIAN.addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(GREGORIAN.addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(GREGORIAN.format('2026-10-26')).toBe('2026-10-26');
    expect(GREGORIAN.parts('2026-10-26')).toEqual({ year: 2026, month: 10, day: 26 });
  });

  test('Jalali goes through the same shape', () => {
    expect(JALALI.parts('2024-04-03')).toEqual({ year: 1403, month: 1, day: 15 });
    expect(JALALI.format('2024-04-03')).toBe('1403/01/15');
    expect(JALALI.parse('۱۴۰۳/۱/۱۵')).toBe('2024-04-03');
    expect(JALALI.weekStart).toBe(6);
    expect(GREGORIAN.weekStart).toBe(1);
  });
});
