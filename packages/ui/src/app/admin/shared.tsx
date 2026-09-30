import type { ReactNode } from 'react';
import type { LocalizedTextJson } from '@nest-my-admin/core/contract';
import { runtimeConfig } from '@/lib/config';

/** Stored text in the current language (falling back to the default, then any). */
export function textIn(value: LocalizedTextJson | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return value[locale] ?? value[runtimeConfig.locale] ?? Object.values(value)[0] ?? '';
}

/** Per-language inputs' values → what the API stores (one language: a plain string). */
export function toLocalized(values: Record<string, string>): LocalizedTextJson | undefined {
  const filled = Object.fromEntries(Object.entries(values).filter(([, text]) => text.trim() !== '').map(([code, text]) => [code, text.trim()]));
  const codes = Object.keys(filled);
  if (codes.length === 0) return undefined;
  return runtimeConfig.locales.length === 1 ? filled[codes[0]!]! : filled;
}

export function fromLocalized(value: LocalizedTextJson | null | undefined): Record<string, string> {
  const out = Object.fromEntries(runtimeConfig.locales.map((code) => [code, '']));
  if (typeof value === 'string') out[runtimeConfig.locale] = value;
  else if (value) Object.assign(out, value);
  return out;
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold">{children}</h1>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'success' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={
        tone === 'error'
          ? 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
          : 'rounded-md border border-green-600/30 bg-green-500/10 px-3 py-2 text-sm'
      }
    >
      {children}
    </p>
  );
}
