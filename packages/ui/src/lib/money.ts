import type { CurrencyDisplay, LocalizedLabel } from '@nest-my-admin/core/contract';
import { activeLocale, formatNumberText } from '@/i18n';
import { toLatinNumber } from '@/lib/digits';

const PLAIN = /^(-?)(\d+)(?:\.(\d*))?$/;
const GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d*)?$/;

/**
 * "1234567.5" → "1,234,567.50": thousands commas, and the fraction padded to `scale`. Works on the digits as text
 * (decimals are strings on the wire), so nothing is rounded; anything that is not a plain number comes back as it is.
 */
export function groupMoney(text: string, scale?: number): string {
  const trimmed = toLatinNumber(text).trim();
  const match = PLAIN.exec(GROUPED.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed);
  if (!match) return text;
  const [, sign, whole, fraction] = match;
  const grouped = whole!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+$)/g, ',');
  const digits = scale === undefined ? (fraction ?? '') : (fraction ?? '').padEnd(scale, '0');
  return `${sign}${grouped}${digits ? `.${digits}` : ''}`;
}

/** "1,234.5" → "1234.5" when the commas group thousands correctly; otherwise the text as it is (the form reports it). */
export function ungroupMoney(text: string): string {
  const trimmed = toLatinNumber(text).trim();
  return GROUPED.test(trimmed) ? trimmed.replace(/,/g, '') : trimmed;
}

/** The host's global unit (`currency` option), in every language it was given; set once from the runtime config. */
let globalCurrency: { unit: LocalizedLabel; position: 'after' | 'before' } | undefined;

export function setGlobalCurrency(currency: typeof globalCurrency): void {
  globalCurrency = currency;
}

function globalUnit(): CurrencyDisplay | undefined {
  if (!globalCurrency) return undefined;
  const { unit, position } = globalCurrency;
  const locale = activeLocale();
  const text = typeof unit === 'string' ? unit : (unit[locale] ?? unit[locale.split('-')[0]!] ?? Object.values(unit)[0]);
  return text ? { unit: text, position } : undefined;
}

export interface Money {
  /** The amount in the chosen digits and separators: `۳٬۲۵۰٬۰۰۰`. */
  main: string;
  unit?: string;
  position?: 'after' | 'before';
  /** An earlier price (a sale's struck-through original), formatted the same way. */
  previous?: string;
}

/** A money value for display: the field's unit, else the host's global one, else none (spec §4). Never rounded. */
export function formatMoney(value: string, opts: { previous?: string; currency?: CurrencyDisplay; scale?: number } = {}): Money {
  const currency = opts.currency ?? globalUnit();
  const amount = (text: string) => formatNumberText(groupMoney(text, opts.scale));
  return {
    main: amount(value),
    ...(currency ? { unit: currency.unit, position: currency.position } : {}),
    ...(opts.previous !== undefined ? { previous: amount(opts.previous) } : {}),
  };
}

/** "۳٬۲۵۰٬۰۰۰ تومان" / "$ 12.50" as one string (cells, chips, exports). */
export function moneyText(money: Money): string {
  if (!money.unit) return money.main;
  return money.position === 'before' ? `${money.unit} ${money.main}` : `${money.main} ${money.unit}`;
}
