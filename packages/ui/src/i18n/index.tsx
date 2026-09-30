import { createContext, useContext, useState, type ReactNode } from 'react';
import { en, type MessageKey, type Messages } from './en';
import { fa } from './fa';

export type { MessageKey } from './en';

const BUNDLES: Record<string, Messages> = { en, fa };
const RTL = new Set(['fa', 'ar', 'he', 'ur']);
const STORAGE_KEY = 'nma.locale';

/** The locale in use outside React (formatters, validation messages). Set by LocaleProvider. */
let active = 'en';

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

/** Numbers with the locale's separators and Latin digits (Persian digits are an M2-4 option). */
export function formatNumber(value: number, locale = active): string {
  return new Intl.NumberFormat(`${locale}-u-nu-latn`).format(value);
}

/** Date and time in the locale's calendar (Persian → Jalali) with Latin digits. */
export function formatDateTime(value: Date, locale = active): string {
  return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
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
}

const LocaleContext = createContext<LocaleState | undefined>(undefined);

export function LocaleProvider({ locales, fallback, children }: { locales: string[]; fallback: string; children: ReactNode }) {
  const [locale, setState] = useState(() => {
    const initial = initialLocale(locales, fallback);
    applyLocale(initial);
    return initial;
  });
  const setLocale = (next: string) => {
    applyLocale(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered, still switched
    }
    setState(next);
  };
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(key, params, locale);
  return <LocaleContext.Provider value={{ locale, locales, setLocale, t }}>{children}</LocaleContext.Provider>;
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
