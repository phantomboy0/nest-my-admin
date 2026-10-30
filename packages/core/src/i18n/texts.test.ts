import { describe, expect, test } from 'bun:test';
import { resolveText } from './localized-text.js';
import { createTexts, type AdminTranslate } from './texts.js';

const logger = () => {
  const warnings: string[] = [];
  return { warnings, warn: (message: string) => void warnings.push(message) };
};

describe('createTexts', () => {
  test('uses the translation when given', () => {
    const texts = createTexts({ locale: 'fa', translate: ({ key }) => (key === 'resource.product.fields.name.label' ? 'Name' : undefined) }, logger());
    expect(texts('نام', 'en', 'resource.product.fields.name.label')).toBe('Name');
  });

  test('falls back on undefined, empty string or a non-string', () => {
    for (const answer of [undefined, '', 42 as unknown as string]) {
      const texts = createTexts({ locale: 'fa', translate: () => answer }, logger());
      expect(texts({ fa: 'نام', en: 'Name' }, 'en', 'k')).toBe(resolveText({ fa: 'نام', en: 'Name' }, 'en', 'fa'));
    }
  });

  test('a throw falls back and is logged once per key', () => {
    const log = logger();
    const texts = createTexts({ locale: 'fa', translate: () => { throw new Error('broken'); } }, log);
    expect(texts('نام', 'en', 'k')).toBe('نام');
    expect(texts('نام', 'en', 'k')).toBe('نام');
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain('k');
  });

  test('keyless texts that throw are warned about once in all, not once per text', () => {
    const log = logger();
    const texts = createTexts({ locale: 'fa', translate: () => { throw new Error('broken'); } }, log);
    for (const order of ['#1', '#2', '#3']) expect(texts(`Order ${order} shipped`, 'en')).toBe(`Order ${order} shipped`);
    expect(log.warnings).toHaveLength(1);
  });

  test('keyless texts reach translate with text only', () => {
    const seen: Parameters<AdminTranslate>[0][] = [];
    const texts = createTexts({ locale: 'fa', translate: (request) => void seen.push(request) as undefined }, logger());
    texts('سلام', 'en');
    expect(seen).toHaveLength(1);
    expect(Object.hasOwn(seen[0]!, 'key')).toBe(false);
    expect(seen[0]).toEqual({ text: 'سلام', locale: 'en' });
  });

  test('no option is resolveText', () => {
    const texts = createTexts({ locale: 'fa' }, logger());
    expect(texts('Orders', 'en', 'k')).toBe('Orders');
    expect(texts({ en: 'Orders', fa: 'سفارش‌ها' }, 'de', 'k')).toBe('سفارش‌ها');
  });
});
