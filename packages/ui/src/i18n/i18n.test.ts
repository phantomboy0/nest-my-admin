import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from './en';
import { fa } from './fa';
import { applyDisplay, formatNumber, formatRelative, isRtl, translate } from './index';

describe('message bundles', () => {
  test('Persian translates every English key and nothing else', () => {
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
    for (const [key, text] of Object.entries(fa)) expect(text.trim(), key).not.toBe('');
  });

  test('placeholders are the same in both languages', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(en) as Array<keyof typeof en>) expect(names(fa[key]), key).toEqual(names(en[key]));
  });

  test('translate fills placeholders and falls back to English', () => {
    expect(translate('list.total', { count: 3 }, 'en')).toBe('3 total');
    expect(translate('list.pageOf', { page: 2, pages: 5 }, 'fa')).toBe('صفحه 2 از 5');
    expect(translate('list.total', { count: 3 }, 'de')).toBe('3 total');
  });

  test('direction and numbers', () => {
    expect(isRtl('fa')).toBe(true);
    expect(isRtl('fa-IR')).toBe(true);
    expect(isRtl('en')).toBe(false);
    expect(formatNumber(12000, 'en')).toBe('12,000');
    expect(formatNumber(12000, 'fa')).toMatch(/^12.000$/); // Persian grouping separator, Latin digits
  });
});

describe('layout follows the direction', () => {
  test('components use logical utilities only (ms-/me-/ps-/pe-/start-/end-)', () => {
    const physical = /(?<![\w-])(-?(ml|mr|pl|pr|left|right)-[\w[\]./]+|text-(left|right)|rounded-[lr]-|border-[lr]-)/;
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.tsx')) files.push(path);
      }
    };
    walk(join(import.meta.dir, '..'));
    const offenders = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => /className|cn\(/.test(text) && physical.test(text)),
    );
    expect(offenders.map(({ file, line, text }) => `${file}:${line}: ${text.trim()}`)).toEqual([]);
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-10-12T12:00:00Z');
  const ago = (seconds: number, locale = 'en') => formatRelative(new Date(now.getTime() - seconds * 1000), now, locale);

  test('picks the largest unit that fits', () => {
    expect(ago(3)).toBe('now');
    expect(ago(40)).toBe('40 seconds ago');
    expect(ago(60)).toBe('1 minute ago');
    expect(ago(3 * 3600 + 59)).toBe('3 hours ago');
    expect(ago(86_400)).toBe('yesterday');
    expect(ago(40 * 86_400)).toBe('last month');
    expect(ago(800 * 86_400)).toBe('2 years ago');
  });

  test('an instant after `now` is "now", never "in 40 seconds"', () => {
    expect(ago(-40)).toBe('now');
    expect(ago(-3 * 3600)).toBe('now');
    expect(ago(-400 * 86_400)).toBe('now');
    expect(ago(-40, 'fa')).toBe('اکنون');
  });

  test('follows the language and the chosen digits', () => {
    expect(ago(3 * 3600, 'fa')).toBe('3 ساعت پیش');
    applyDisplay({ calendar: 'persian', digits: 'arabext' });
    expect(ago(3 * 3600, 'fa')).toBe('۳ ساعت پیش');
    applyDisplay({ calendar: 'gregorian', digits: 'latn' });
  });
});
