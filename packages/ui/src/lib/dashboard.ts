import type { ChartWidgetData, Tone, WidgetParams } from '@nest-my-admin/core/contract';
import { addDays, addJalaliMonths, fromJalali, toJalali } from '@/lib/jalali';

const pad = (value: number, size = 2) => String(value).padStart(size, '0');
const localIso = (date: Date) => `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** A local day's midnight, as an instant (the browser's time zone). */
const startOf = (iso: string) => new Date(`${iso}T00:00:00`).toISOString();
const addGregorianMonths = (iso: string, months: number) => {
  const [year, month] = iso.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}-01`;
};

/**
 * The window a period covers, in the browser's time zone (spec §5.8): today; the last 7 days; the calendar month or
 * year containing today (Jalali with the Persian calendar); or a chosen range of days (both ends included). The
 * previous window is the one right before: the previous calendar month or year, else the same number of days.
 */
export function periodRange(period: WidgetParams['period'], now: Date, calendar: 'gregory' | 'persian', from?: string, to?: string): WidgetParams {
  const today = localIso(now);
  const window = (start: string, end: string, previousStart: string, previousEnd: string): WidgetParams => ({
    period,
    from: startOf(start),
    to: startOf(end),
    previousFrom: startOf(previousStart),
    previousTo: startOf(previousEnd),
  });
  const days = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  switch (period) {
    case 'day':
      return window(today, addDays(today, 1), addDays(today, -1), today);
    case 'week':
      return window(addDays(today, -6), addDays(today, 1), addDays(today, -13), addDays(today, -6));
    case 'month': {
      if (calendar === 'persian') {
        const { jy, jm } = toJalali(today);
        const start = fromJalali(jy, jm, 1);
        return window(start, addJalaliMonths(start, 1), addJalaliMonths(start, -1), start);
      }
      const start = `${today.slice(0, 7)}-01`;
      return window(start, addGregorianMonths(start, 1), addGregorianMonths(start, -1), start);
    }
    case 'year': {
      if (calendar === 'persian') {
        const { jy } = toJalali(today);
        return window(fromJalali(jy, 1, 1), fromJalali(jy + 1, 1, 1), fromJalali(jy - 1, 1, 1), fromJalali(jy, 1, 1));
      }
      const year = Number(today.slice(0, 4));
      return window(`${pad(year, 4)}-01-01`, `${pad(year + 1, 4)}-01-01`, `${pad(year - 1, 4)}-01-01`, `${pad(year, 4)}-01-01`);
    }
    case 'range': {
      const start = from ?? today;
      const end = addDays(to ?? today, 1);
      const length = days(start, end);
      return window(start, end, addDays(start, -length), start);
    }
  }
}

/** A stat's change against the previous period: up is good (ok), down is bad, zero is neutral; the text has no sign. */
export function changeModel(change: number | undefined): { tone: Tone; arrow: 'up' | 'down' | null; text: string } | undefined {
  if (change === undefined) return undefined;
  const text = `${Math.abs(change)}%`;
  if (change > 0) return { tone: 'ok', arrow: 'up', text };
  if (change < 0) return { tone: 'bad', arrow: 'down', text };
  return { tone: 'neutral', arrow: null, text };
}

export interface ChartGeometry {
  max: number;
  /** Heights (y) of the horizontal gridlines, top to bottom, with their values. */
  gridlines: Array<{ y: number; value: number }>;
  series: Array<{ label: string; dashed: boolean; path: string; bars: Array<{ x: number; y: number; width: number; height: number }> }>;
}

/** Where a chart's bars and lines go in a `width`×`height` box (y down): scaled to the largest value, with 4 gridlines. */
export function chartGeometry(data: Pick<ChartWidgetData, 'kind' | 'labels' | 'series'>, width: number, height: number): ChartGeometry {
  const max = Math.max(1, ...data.series.flatMap((series) => series.values));
  const count = Math.max(1, data.labels.length);
  const slot = width / count;
  const y = (value: number) => height - (value / max) * height;
  return {
    max,
    gridlines: [0.25, 0.5, 0.75, 1].map((share) => ({ y: height - share * height, value: max * share })),
    series: data.series.map((series) => {
      const points = series.values.map((value, index) => [count === 1 ? width / 2 : (index * width) / (count - 1), y(value)] as const);
      return {
        label: series.label,
        dashed: series.dashed === true,
        path: points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${round(px)} ${round(py)}`).join(' '),
        bars: series.values.map((value, index) => {
          const barWidth = slot * 0.6;
          return { x: index * slot + slot / 2 - barWidth / 2, y: y(value), width: barWidth, height: height - y(value) };
        }),
      };
    }),
  };
}

const round = (value: number) => Math.round(value * 10) / 10;
