import { describe, expect, test } from 'bun:test';
import { fromJalali } from './jalali';
import { changeModel, chartGeometry, periodRange } from './dashboard';

/** A local day's midnight as the instant the UI sends. */
const day = (iso: string) => new Date(`${iso}T00:00:00`).toISOString();
const noon = (iso: string) => new Date(`${iso}T12:00:00`);

describe('period ranges', () => {
  test('day and week end today; the previous window is the same length right before', () => {
    expect(periodRange('day', noon('2026-10-26'), 'gregory')).toEqual({ period: 'day', from: day('2026-10-26'), to: day('2026-10-27'), previousFrom: day('2026-10-25'), previousTo: day('2026-10-26') });
    expect(periodRange('week', noon('2026-10-26'), 'gregory')).toEqual({ period: 'week', from: day('2026-10-20'), to: day('2026-10-27'), previousFrom: day('2026-10-13'), previousTo: day('2026-10-20') });
  });

  test('a Gregorian month and the calendar month before it (31 → 30 days)', () => {
    expect(periodRange('month', noon('2026-10-26'), 'gregory')).toEqual({ period: 'month', from: day('2026-10-01'), to: day('2026-11-01'), previousFrom: day('2026-09-01'), previousTo: day('2026-10-01') });
  });

  test('a Jalali month: Esfand has 30 days in a leap year and 29 otherwise; before Farvardin comes Esfand', () => {
    // 1403 is a leap year, 1402 is not.
    const leap = periodRange('month', noon(fromJalali(1403, 12, 10)), 'persian');
    expect([leap.from, leap.to]).toEqual([day(fromJalali(1403, 12, 1)), day(fromJalali(1404, 1, 1))]);
    expect((Date.parse(leap.to) - Date.parse(leap.from)) / 86_400_000).toBeCloseTo(30, 0);
    const common = periodRange('month', noon(fromJalali(1402, 12, 10)), 'persian');
    expect((Date.parse(common.to) - Date.parse(common.from)) / 86_400_000).toBeCloseTo(29, 0);
    const farvardin = periodRange('month', noon(fromJalali(1404, 1, 5)), 'persian');
    expect([farvardin.previousFrom, farvardin.previousTo]).toEqual([day(fromJalali(1403, 12, 1)), day(fromJalali(1404, 1, 1))]);
  });

  test('years in both calendars, and a range with a previous window of equal length', () => {
    expect(periodRange('year', noon('2026-10-26'), 'gregory')).toMatchObject({ from: day('2026-01-01'), to: day('2027-01-01'), previousFrom: day('2025-01-01') });
    expect(periodRange('year', noon(fromJalali(1405, 8, 4)), 'persian')).toMatchObject({ from: day(fromJalali(1405, 1, 1)), to: day(fromJalali(1406, 1, 1)), previousFrom: day(fromJalali(1404, 1, 1)) });
    expect(periodRange('range', noon('2026-10-26'), 'gregory', '2026-10-10', '2026-10-19')).toEqual({ period: 'range', from: day('2026-10-10'), to: day('2026-10-20'), previousFrom: day('2026-09-30'), previousTo: day('2026-10-10') });
  });
});

describe('change and charts', () => {
  test('changeModel: the sign gives the tone and the arrow', () => {
    expect(changeModel(12.5)).toEqual({ tone: 'ok', arrow: 'up', text: '12.5%' });
    expect(changeModel(-3)).toEqual({ tone: 'bad', arrow: 'down', text: '3%' });
    expect(changeModel(0)).toEqual({ tone: 'neutral', arrow: null, text: '0%' });
    expect(changeModel(undefined)).toBeUndefined();
  });

  test('chartGeometry: bars and line points scaled to the box, with gridlines', () => {
    const geometry = chartGeometry({ kind: 'bar', labels: ['a', 'b'], series: [{ label: 'now', values: [5, 10] }] }, 200, 100);
    expect(geometry.max).toBe(10);
    expect(geometry.gridlines).toHaveLength(4);
    // Two slots of 100: each bar 60% of its slot, centred.
    expect(geometry.series[0]!.bars).toEqual([
      { x: 20, width: 60, y: 50, height: 50 },
      { x: 120, width: 60, y: 0, height: 100 },
    ]);
    const line = chartGeometry({ kind: 'line', labels: ['a', 'b', 'c'], series: [{ label: 'now', values: [0, 5, 10] }] }, 200, 100);
    expect(line.series[0]!.path).toBe('M0 100 L100 50 L200 0');
  });
});
