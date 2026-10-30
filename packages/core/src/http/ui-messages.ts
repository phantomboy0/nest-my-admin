import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AdminTranslate } from '../i18n/texts.js';

/** The UI's own texts per locale (`messages.json` of the built UI: `{ en: { key: template }, fa: … }`); undefined when the build has none. */
export function readUiMessages(distDir: string): Record<string, Record<string, string>> | undefined {
  const file = join(distDir, 'messages.json');
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
}

const placeholders = (template: string) => [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!))].sort();

/**
 * The UI texts `translate` rewords, per locale: only answers that differ from the built-in text. Asked once per locale
 * and key at boot (`ui.<key>`, `text` the locale's built-in text, else the English one). An answer that changes the
 * `{name}` placeholders, or a throw, fails boot.
 */
export function uiOverrides(bundles: Record<string, Record<string, string>>, locales: readonly string[], translate: AdminTranslate | undefined): Record<string, Record<string, string>> {
  if (!translate) return {};
  const english = bundles.en ?? {};
  const out: Record<string, Record<string, string>> = {};
  for (const locale of locales) {
    const own = bundles[locale] ?? {};
    for (const [key, template] of Object.entries(english)) {
      const text = own[key] ?? template;
      let answer: string | undefined;
      try {
        answer = translate({ key: `ui.${key}`, text, locale });
      } catch (error) {
        throw new Error(`nest-my-admin: translate threw for ui.${key} (${locale}): ${error instanceof Error ? error.message : String(error)}`);
      }
      if (typeof answer !== 'string' || answer === '' || answer === text) continue;
      const wanted = placeholders(template);
      if (placeholders(answer).join() !== wanted.join()) {
        throw new Error(`nest-my-admin: translate: ui.${key} (${locale}) must keep the placeholders ${wanted.map((name) => `{${name}}`).join(' ') || '(none)'}`);
      }
      (out[locale] ??= {})[key] = answer;
    }
  }
  return out;
}
