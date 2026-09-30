import { createContext, useContext, useState, type ReactNode } from 'react';
import { toPersianNumber } from '@/lib/digits';
import { readDisplayPrefs, saveDisplayPrefs, type CalendarChoice, type DigitsChoice, type DisplayPrefs } from '@/lib/display-prefs';
import { en, type MessageKey, type Messages } from './en';
import { fa } from './fa';

export type { MessageKey } from './en';

const BUNDLES: Record<string, Messages> = { en, fa };
const RTL = new Set(['fa', 'ar', 'he', 'ur']);
const STORAGE_KEY = 'nma.locale';

/** The locale in use outside React (formatters, validation messages). Set by LocaleProvider. */
let active = 'en';
/** Calendar and digits for formatters outside React. Set by LocaleProvider. */
let display: DisplayPrefs = { calendar: 'gregorian', digits: 'latn' };

export function activeDisplay(): DisplayPrefs {
  return display;
}

export function applyDisplay(prefs: DisplayPrefs): void {
  display = prefs;
}

export function activeLocale(): string {
  return active;
}

/** `{name}` placeholders filled from `params`. Unknown locales use English; a missing key would be a type error. */
export function translate(key: MessageKey, params: Record<string, string | number> = {}, locale = active): string {
  const template = (BUNDLES[locale] ?? en)[key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function isRtl(locale: string): boolean {
  return RTL.has(locale.split('-')[0]!);
}

const extensions = (prefs: DisplayPrefs) => `-u-ca-${prefs.calendar === 'persian' ? 'persian' : 'gregory'}-nu-${prefs.digits}`;

/** Numbers with the locale's separators, in the chosen digits. */
export function formatNumber(value: number, locale = active): string {
  return new Intl.NumberFormat(`${locale}-u-nu-${display.digits}`).format(value);
}

/** A number already written as text (`1,234.50`: decimals, bigints, money) in the chosen digits, never rounded. */
export function formatNumberText(text: string): string {
  return display.digits === 'arabext' ? toPersianNumber(text) : text;
}

/** Date and time in the browser's time zone, in the chosen calendar and digits. */
export function formatDateTime(value: Date, locale = active): string {
  return new Intl.DateTimeFormat(`${locale}${extensions(display)}`, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

/** A `date` value (`YYYY-MM-DD`) in the chosen calendar and digits; formatted in UTC, so it is never shifted a day. */
export function formatDate(iso: string, locale = active): string {
  const time = Date.parse(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(time)) return iso;
  return new Intl.DateTimeFormat(`${locale}${extensions(display)}`, { dateStyle: 'medium', timeZone: 'UTC' }).format(time);
}

/** Applies a locale to the page: `<html lang dir>`, and the module state used outside React. */
export function applyLocale(locale: string): void {
  active = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
}

/** The saved choice when it is still offered, else the admin's default. */
export function initialLocale(locales: string[], fallback: string): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && locales.includes(saved)) return saved;
  } catch {
    // storage blocked (private mode): the default it is
  }
  return fallback;
}

interface LocaleState {
  locale: string;
  locales: string[];
  setLocale: (locale: string) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  calendar: CalendarChoice;
  digits: DigitsChoice;
  setDisplay: (prefs: Partial<DisplayPrefs>) => void;
}

const LocaleContext = createContext<LocaleState | undefined>(undefined);

export function LocaleProvider({ locales, fallback, children }: { locales: string[]; fallback: string; children: ReactNode }) {
  const [locale, setState] = useState(() => {
    const initial = initialLocale(locales, fallback);
    applyLocale(initial);
    return initial;
  });
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => {
    const initial = readDisplayPrefs(locale);
    applyDisplay(initial);
    return initial;
  });
  const setLocale = (next: string) => {
    applyLocale(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered, still switched
    }
    // Defaults follow the language (Jalali for Persian) unless the user chose.
    const nextPrefs = readDisplayPrefs(next);
    applyDisplay(nextPrefs);
    setPrefs(nextPrefs);
    setState(next);
  };
  const setDisplay = (changes: Partial<DisplayPrefs>) => {
    saveDisplayPrefs(changes);
    const next = { ...prefs, ...changes };
    applyDisplay(next);
    setPrefs(next);
  };
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(key, params, locale);
  return (
    <LocaleContext.Provider value={{ locale, locales, setLocale, t, calendar: prefs.calendar, digits: prefs.digits, setDisplay }}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): LocaleState {
  const state = useContext(LocaleContext);
  if (!state) throw new Error('useLocale() outside LocaleProvider');
  return state;
}

/** `t('list.total', { count })` in the current locale. */
export function useT(): LocaleState['t'] {
  return useLocale().t;
}
