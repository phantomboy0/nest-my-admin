import { afterEach, describe, expect, test } from 'bun:test';
import { en } from './en';
import { applyMessageOverrides, translate } from './index';
import { messagesFile } from './messages-file';

afterEach(() => applyMessageOverrides(undefined));

describe('host overrides of the UI texts', () => {
  test('an override wins in its locale, other locales keep the bundle', () => {
    applyMessageOverrides({ fa: { 'form.save': 'ثبت' }, de: { 'form.save': 'Speichern' } });
    expect(translate('form.save', {}, 'fa')).toBe('ثبت');
    expect(translate('form.save', {}, 'de')).toBe('Speichern');
    expect(translate('form.save', {}, 'en')).toBe('Save');
  });

  test('a key without an override in a locale without a bundle is English', () => {
    applyMessageOverrides({ de: { 'form.save': 'Speichern' } });
    expect(translate('common.cancel', {}, 'de')).toBe('Cancel');
  });

  test('placeholders still fill', () => {
    applyMessageOverrides({ en: { 'form.add': 'New {name}' } });
    expect(translate('form.add', { name: 'line' }, 'en')).toBe('New line');
  });
});

describe('messages.json', () => {
  test('lists every English key', () => {
    const file = JSON.parse(messagesFile()) as Record<string, Record<string, string>>;
    expect(Object.keys(file.en!)).toEqual(Object.keys(en));
    expect(Object.keys(file.fa!)).toEqual(Object.keys(en));
  });
});
