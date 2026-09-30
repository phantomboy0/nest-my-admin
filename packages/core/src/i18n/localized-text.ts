/** A label in one language (`'Orders'`) or several (`{ en: 'Orders', fa: 'سفارش‌ها' }`). */
export type LocalizedText = string | Readonly<Record<string, string>>;

/** The text for `locale`: its own translation, else the default locale's, else the first one given. */
export function resolveText(text: LocalizedText, locale: string, defaultLocale: string): string {
  if (typeof text === 'string') return text;
  return text[locale] ?? text[defaultLocale] ?? Object.values(text)[0] ?? '';
}

/**
 * The best of `locales` for an `Accept-Language` header: exact tags first, then primary subtags (`fa-IR` → `fa`), in
 * order of quality; `fallback` when nothing matches.
 */
export function pickLocale(acceptLanguage: string | undefined, locales: readonly string[], fallback: string): string {
  if (!acceptLanguage) return fallback;
  const wanted = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(params.find((param) => param.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.tag !== '' && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  const byLower = new Map(locales.map((locale) => [locale.toLowerCase(), locale]));
  for (const { tag } of wanted) {
    const match = byLower.get(tag) ?? byLower.get(tag.split('-')[0]!);
    if (match) return match;
  }
  return fallback;
}
