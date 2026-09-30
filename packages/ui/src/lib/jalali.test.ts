import { describe, expect, test } from 'bun:test';
import { addDays, addJalaliMonths, formatJalali, fromJalali, isJalaliLeapYear, isValidJalali, jalaliMonthLength, parseJalali, toJalali } from './jalali';

const persian = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });
const intlJalali = (date: Date) => {
  const parts = Object.fromEntries(persian.formatToParts(date).map((part) => [part.type, part.value]));
  return { jy: Number(parts.year), jm: Number(parts.month), jd: Number(parts.day) };
};

describe('Jalali', () => {
  test('known dates', () => {
    expect(toJalali('2024-03-20')).toEqual({ jy: 1403, jm: 1, jd: 1 });
    expect(toJalali('2024-04-03')).toEqual({ jy: 1403, jm: 1, jd: 15 });
    expect(toJalali('1970-01-01')).toEqual({ jy: 1348, jm: 10, jd: 11 });
    expect(toJalali('2021-03-20')).toEqual({ jy: 1399, jm: 12, jd: 30 });
    expect(fromJalali(1403, 1, 15)).toBe('2024-04-03');
    expect(fromJalali(1399, 12, 30)).toBe('2021-03-20');
  });

  test('leap years and month lengths', () => {
    expect(isJalaliLeapYear(1399)).toBe(true);
    expect(isJalaliLeapYear(1403)).toBe(true);
    expect(isJalaliLeapYear(1402)).toBe(false);
    expect(jalaliMonthLength(1402, 12)).toBe(29);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalaliMonthLength(1403, 6)).toBe(31);
    expect(jalaliMonthLength(1403, 7)).toBe(30);
    expect(isValidJalali(1402, 12, 30)).toBe(false);
    expect(isValidJalali(1403, 12, 30)).toBe(true);
  });

  test('agrees with Intl and round-trips for every day of 1900–2100 (Review Focus 1)', () => {
    const mismatches: string[] = [];
    for (let time = Date.UTC(1900, 0, 1); time <= Date.UTC(2100, 11, 31); time += 86_400_000) {
      const iso = new Date(time).toISOString().slice(0, 10);
      const jalali = toJalali(iso);
      const expected = intlJalali(new Date(time));
      if (jalali.jy !== expected.jy || jalali.jm !== expected.jm || jalali.jd !== expected.jd) mismatches.push(`${iso}: ${JSON.stringify(jalali)} vs ${JSON.stringify(expected)}`);
      if (fromJalali(jalali.jy, jalali.jm, jalali.jd) !== iso) mismatches.push(`${iso}: round trip`);
      if (mismatches.length > 5) break;
    }
    expect(mismatches).toEqual([]);
  });
});

describe('Jalali text', () => {
  test('format and parse, in any digits and separators', () => {
    expect(formatJalali('2024-04-03')).toBe('1403/01/15');
    expect(parseJalali('1403/01/15')).toBe('2024-04-03');
    expect(parseJalali('۱۴۰۳/۱/۱۵')).toBe('2024-04-03');
    expect(parseJalali(' 1403-1-15 ')).toBe('2024-04-03');
    expect(parseJalali('1402/12/30')).toBeUndefined(); // 1402 is not leap
    expect(parseJalali('1403/13/01')).toBeUndefined();
    expect(parseJalali('2024-04-03x')).toBeUndefined();
  });
  test('moving by months and days', () => {
    expect(formatJalali(addJalaliMonths('2024-04-03', 1))).toBe('1403/02/15');
    expect(formatJalali(addJalaliMonths(fromJalali(1403, 6, 31), 1))).toBe('1403/07/30'); // clamped
    expect(formatJalali(addJalaliMonths(fromJalali(1403, 1, 10), -1))).toBe('1402/12/10');
    expect(addDays('2024-03-31', 1)).toBe('2024-04-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
});
