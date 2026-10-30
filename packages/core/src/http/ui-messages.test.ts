import { describe, expect, test } from 'bun:test';
import type { AdminTranslate } from '../i18n/texts.js';
import { uiOverrides } from './ui-messages.js';

const BUNDLES = { en: { 'form.save': 'Save', 'form.add': 'Add {name}' }, fa: { 'form.save': 'ذخیره', 'form.add': 'افزودن {name}' } };

describe('uiOverrides', () => {
  test("asks once per locale and key with the locale's built-in text", () => {
    const asked: Parameters<AdminTranslate>[0][] = [];
    uiOverrides({ en: { 'form.save': 'Save' }, fa: { 'form.save': 'ذخیره' } }, ['fa', 'en'], (request) => void asked.push(request) as undefined);
    expect(asked).toEqual([
      { key: 'ui.form.save', text: 'ذخیره', locale: 'fa' },
      { key: 'ui.form.save', text: 'Save', locale: 'en' },
    ]);
  });

  test('keeps only answers that differ', () => {
    const overrides = uiOverrides(BUNDLES, ['fa', 'en'], ({ key, locale, text }) => (key === 'ui.form.save' ? (locale === 'fa' ? 'ثبت' : 'Save') : (text as string)));
    expect(overrides).toEqual({ fa: { 'form.save': 'ثبت' } });
  });

  test('a locale without a bundle starts from English', () => {
    const asked: Parameters<AdminTranslate>[0][] = [];
    const overrides = uiOverrides(BUNDLES, ['de'], (request) => {
      asked.push(request);
      return request.key === 'ui.form.save' ? 'Speichern' : undefined;
    });
    expect(asked.find((request) => request.key === 'ui.form.save')?.text).toBe('Save');
    expect(overrides).toEqual({ de: { 'form.save': 'Speichern' } });
  });

  test('a placeholder mismatch fails', () => {
    expect(() => uiOverrides(BUNDLES, ['de'], ({ key }) => (key === 'ui.form.add' ? 'Add' : undefined))).toThrow('translate: ui.form.add (de) must keep the placeholders {name}');
  });

  test('a throw fails', () => {
    expect(() => uiOverrides(BUNDLES, ['fa'], () => { throw new Error('broken'); })).toThrow('translate threw for ui.form.save (fa): broken');
  });

  test('no translate gives no overrides', () => {
    expect(uiOverrides(BUNDLES, ['fa', 'en'], undefined)).toEqual({});
  });
});
