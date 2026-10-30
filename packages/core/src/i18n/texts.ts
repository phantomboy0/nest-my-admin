import { resolveText, type LocalizedText } from './localized-text.js';

/**
 * Resolves a host text for a request (the `translate` option). `key` names the text when it has a stable identity
 * (`resource.order.fields.total.label`); texts without one come with `text` only. Answer undefined to keep the
 * declared text. Runs per request: keep it cheap. For `ui.` keys it runs once per locale at boot and must be pure.
 */
export type AdminTranslate = (request: { key?: string; text: LocalizedText; locale: string }) => string | undefined;

/** A text in a locale: the host's translation, else the declared text (`resolveText`). */
export type TextResolver = (text: LocalizedText, locale: string, key?: string) => string;

/** The one place host texts are resolved. A `translate` that throws falls back to the declared text, logged once per key. */
export function createTexts(options: { translate?: AdminTranslate; locale: string }, logger: { warn(message: string): void }): TextResolver {
  const { translate, locale: defaultLocale } = options;
  if (!translate) return (text, locale) => resolveText(text, locale, defaultLocale);
  const warned = new Set<string>();
  return (text, locale, key) => {
    try {
      const answer = translate(key === undefined ? { text, locale } : { key, text, locale });
      if (typeof answer === 'string' && answer !== '') return answer;
    } catch (error) {
      const name = key ?? resolveText(text, defaultLocale, defaultLocale);
      if (!warned.has(name)) {
        warned.add(name);
        logger.warn(`translate threw for "${name}" (${error instanceof Error ? error.message : String(error)}); the declared text is shown`);
      }
    }
    return resolveText(text, locale, defaultLocale);
  };
}

/** A text of one owner (a resource, a page) in the request's locale; `path` is its key under the owner's prefix. */
export type ScopedText = (value: LocalizedText, path?: string) => string;

/** `texts` for one owner: `scopedText(texts, 'en', 'resource.order')` asks `resource.order.<path>`, or keyless without a path. */
export function scopedText(texts: TextResolver, locale: string, prefix: string): ScopedText {
  return (value, path) => texts(value, locale, path === undefined ? undefined : path === '' ? prefix : `${prefix}.${path}`);
}

/** Texts resolved at boot, for the stored schema: the default locale's, or the first one given. */
export const bootText: ScopedText = (value) => resolveText(value, '', '');
