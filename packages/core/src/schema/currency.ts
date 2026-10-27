import type { LocalizedText } from '../i18n/localized-text.js';

/** How money is labelled (spec §4): the unit, in one or several languages, before or after the number. */
export interface AdminCurrency {
  unit: LocalizedText;
  /** Default `after` (`۳٬۲۵۰٬۰۰۰ تومان`). */
  position?: 'after' | 'before';
}

/** A currency option (global, or a field's): a unit that is not blank, and `after` unless `before` is asked for. */
export function checkCurrency(currency: AdminCurrency, where: string): Required<AdminCurrency> {
  const units = typeof currency.unit === 'string' ? [currency.unit] : Object.values(currency.unit);
  if (units.length === 0 || units.some((unit) => typeof unit !== 'string' || unit.trim() === '')) throw new Error(`nest-my-admin: ${where}.unit must be a non-empty text`);
  const position = currency.position ?? 'after';
  if (position !== 'after' && position !== 'before') throw new Error(`nest-my-admin: ${where}.position must be 'after' or 'before', got "${String(position)}"`);
  return { unit: currency.unit, position };
}
