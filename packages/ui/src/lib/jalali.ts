import { toLatinDigits } from '@/lib/digits';

/**
 * Jalali (Solar Hijri) ⇄ Gregorian conversion: the jalaali algorithm (Borkowski's 2820-year breaks), no dependency.
 * Dates are ISO `YYYY-MM-DD` strings on the Gregorian side, so nothing depends on a time zone.
 */

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

/** Leap status (0 = leap), the Gregorian year it starts in, and the March day of its Nowruz. */
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]!) throw new RangeError(`Jalali year ${jy} is out of range`);
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Gregorian date → Julian day number. */
function g2d(gy: number, gm: number, gd: number): number {
  const d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}

/** Julian day number → Gregorian date. */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number): number {
  const { gy, march } = jalCal(jy);
  return g2d(gy, 3, march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number): JalaliDate {
  const { gy } = d2g(jdn);
  let jy = gy - 621;
  const cal = jalCal(jy);
  let k = jdn - g2d(gy, 3, cal.march);
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (cal.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isJalaliLeapYear(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeapYear(jy) ? 30 : 29;
}

/** `2024-04-03` → `{ jy: 1403, jm: 1, jd: 15 }`. */
export function toJalali(iso: string): JalaliDate {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new RangeError(`not an ISO date: ${iso}`);
  return d2j(g2d(Number(match[1]), Number(match[2]), Number(match[3])));
}

/** `(1403, 1, 15)` → `2024-04-03`. */
export function fromJalali(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = d2g(j2d(jy, jm, jd));
  return `${pad(gy, 4)}-${pad(gm)}-${pad(gd)}`;
}

export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  return Number.isInteger(jy) && jy >= 1 && jy < 3178 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaliMonthLength(jy, jm);
}

/** `2024-04-03` → `1403/01/15`. */
export function formatJalali(iso: string): string {
  const { jy, jm, jd } = toJalali(iso);
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}

/**
 * A typed Jalali date (`1403/1/15`, `۱۴۰۳-۰۱-۱۵`, `1403.01.15`) → ISO, or undefined when it is not a real Jalali day.
 * Digits of every set are accepted.
 */
export function parseJalali(text: string): string | undefined {
  const match = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(toLatinDigits(text.trim()));
  if (!match) return undefined;
  const [jy, jm, jd] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isValidJalali(jy, jm, jd) ? fromJalali(jy, jm, jd) : undefined;
}

/** A Jalali month moved by `months`, with the day kept (or clamped to the month's length). */
export function addJalaliMonths(iso: string, months: number): string {
  const { jy, jm, jd } = toJalali(iso);
  const index = jy * 12 + (jm - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return fromJalali(year, month, Math.min(jd, jalaliMonthLength(year, month)));
}

/** ISO date plus `days` (UTC arithmetic, so no daylight-saving surprises). */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today in the browser's time zone, as an ISO date. */
export function todayIso(): string {
  const now = new Date();
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
