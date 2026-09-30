import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from './en';
import { fa } from './fa';
import { formatNumber, isRtl, translate } from './index';

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
