import { toLatinDigits } from '@/lib/digits';
import { addJalaliMonths, formatJalali, fromJalali, jalaliMonthLength, parseJalali, toJalali } from '@/lib/jalali';

/** A calendar the admin's date input and popup work in: Jalali or Gregorian, on ISO dates underneath. */
export interface CalendarSystem {
  /** The `Intl` calendar for month names (`persian`, `gregory`). */
  intl: 'persian' | 'gregory';
  parts(iso: string): { year: number; month: number; day: number };
  fromParts(year: number, month: number, day: number): string;
  monthLength(year: number, month: number): number;
  /** The same day `months` later (clamped to the month's length). */
  addMonths(iso: string, months: number): string;
  /** The date as people type it in this calendar. */
  format(iso: string): string;
  /** Typed text (any digits) → ISO, or undefined when it is not a real day. */
  parse(text: string): string | undefined;
  /** The weekday a week starts on (0 = Sunday … 6 = Saturday). */
  weekStart: number;
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0');
const gregorianLength = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const JALALI: CalendarSystem = {
  intl: 'persian',
  parts: (iso) => {
    const { jy, jm, jd } = toJalali(iso);
    return { year: jy, month: jm, day: jd };
  },
  fromParts: fromJalali,
  monthLength: jalaliMonthLength,
  addMonths: addJalaliMonths,
  format: formatJalali,
  parse: parseJalali,
  weekStart: 6,
};

export const GREGORIAN: CalendarSystem = {
  intl: 'gregory',
  parts: (iso) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) }),
  fromParts: (year, month, day) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`,
  monthLength: gregorianLength,
  addMonths: (iso, months) => {
    const { year, month, day } = GREGORIAN.parts(iso);
    const index = year * 12 + (month - 1) + months;
    const nextYear = Math.floor(index / 12);
    const nextMonth = (index % 12) + 1;
    return GREGORIAN.fromParts(nextYear, nextMonth, Math.min(day, gregorianLength(nextYear, nextMonth)));
  },
  // ISO, as the browser's own date input shows it.
  format: (iso) => iso,
  parse: (text) => {
    const match = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(toLatinDigits(text.trim()));
    if (!match) return undefined;
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= gregorianLength(year, month) ? GREGORIAN.fromParts(year, month, day) : undefined;
  },
  weekStart: 1,
};

export const calendarSystem = (calendar: string): CalendarSystem => (calendar === 'persian' ? JALALI : GREGORIAN);
