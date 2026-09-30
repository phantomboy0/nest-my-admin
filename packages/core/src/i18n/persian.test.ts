import { describe, expect, test } from 'bun:test';
import { columnReplacements, normalizeSearch, persianLike, toLatinDigits, toLatinNumber } from './persian.js';

describe('Persian normalization', () => {
  test('digits of every set become Latin', () => {
    expect(toLatinDigits('۱۲۳ and ٤٥٦ and 789')).toBe('123 and 456 and 789');
    expect(toLatinNumber('۱٬۲۳۴٫۵')).toBe('1,234.5');
  });
  test('Arabic letters take their Persian forms; ZWNJ is a space', () => {
    expect(normalizeSearch('كتاب علي')).toBe('کتاب علی');
    expect(normalizeSearch('مصطفى')).toBe('مصطفی');
    expect(normalizeSearch('می‌شود')).toBe('می شود');
    expect(normalizeSearch('Lamp 12')).toBe('Lamp 12');
  });
  test('a column gets only the replacements the term needs', () => {
    expect(columnReplacements('lamp')).toEqual([]);
    expect(columnReplacements('کتاب')).toEqual([['ك', 'ک']]);
    expect(columnReplacements('12')).toEqual([['۱', '1'], ['١', '1'], ['۲', '2'], ['٢', '2']]);
    expect(columnReplacements('می شود')).toEqual([['ي', 'ی'], ['ى', 'ی'], [' ', ' ']].map(([a, b]) => (a === ' ' ? ['‌', ' '] : [a, b])) as Array<[string, string]>);
  });
  test('SQL: plain for Latin, REPLACE-wrapped otherwise', () => {
    const like = (text: string) => `%${text}%`;
    expect(persianLike('p.name', 'lamp', 's', like)).toEqual({ sql: "LOWER(p.name) LIKE LOWER(:s) ESCAPE '!'", params: { s: '%lamp%' } });
    const persian = persianLike('p.name', 'كتاب', 's', like);
    expect(persian.sql).toBe("LOWER(REPLACE(p.name, :sF0, :sT0)) LIKE LOWER(:s) ESCAPE '!'");
    expect(persian.params).toEqual({ s: '%کتاب%', sF0: 'ك', sT0: 'ک' });
  });
});
