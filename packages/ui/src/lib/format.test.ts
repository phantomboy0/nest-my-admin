import { afterAll, describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { formatCell, richTextExcerpt } from './format';
import { applyDisplay } from '@/i18n';

const field = (type: FieldType): FieldSchema => ({
  name: 'x', label: 'X', type, nullable: true, primary: false, readonly: false, persisted: true,
});

describe('formatCell', () => {
  test('renders values for display', () => {
    expect(formatCell(null, field('string'))).toBe('—');
    expect(formatCell(true, field('boolean'))).toBe('Yes');
    expect(formatCell(false, field('boolean'))).toBe('No');
    expect(formatCell({ a: 1 }, field('json'))).toBe('{"a":1}');
    expect(formatCell('19.90', field('decimal'))).toBe('19.90');
    expect(formatCell(7, field('number'))).toBe('7');
  });

  test('file fields show file names, rich text its text', () => {
    const file = { accept: ['*/*'], maxBytes: 1, many: false };
    expect(formatCell('product/pdf/ab12.pdf', { ...field('string'), widget: 'file', file })).toBe('ab12.pdf');
    expect(formatCell(['a/1.png', 'a/2.png'], { ...field('json'), widget: 'image', file: { ...file, many: true } })).toBe('1.png, 2.png');
    expect(formatCell([], { ...field('json'), widget: 'image', file: { ...file, many: true } })).toBe('—');
    expect(formatCell('<h2>Hi</h2><p>a <strong>b</strong> &amp; c</p>', { ...field('text'), widget: 'richtext' })).toBe('Hi a b & c');
    expect(formatCell('<p></p>', { ...field('text'), widget: 'richtext' })).toBe('—');
  });

  test('richTextExcerpt', () => {
    expect(richTextExcerpt('<p>one</p><p>two&nbsp;three</p><img src="x" alt="a">')).toBe('one two three');
    expect(richTextExcerpt('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe('<script>alert(1)</script>'); // text, shown as text
    expect(richTextExcerpt(`<p>${'x'.repeat(200)}</p>`, 10)).toBe(`${'x'.repeat(10)}…`);
  });
});

describe('formatCell for relations', () => {
  test('shows titles', () => {
    expect(formatCell({ id: 1, title: 'Ada' }, field('relation'))).toBe('Ada');
    expect(formatCell([{ id: 'a', title: 'red' }, { id: 'b', title: 'blue' }], field('relation'))).toBe('red, blue');
    expect(formatCell([], field('relation'))).toBe('—');
    expect(formatCell(null, field('relation'))).toBe('—');
  });
});

describe('calendar and digits (display preferences)', () => {
  test('date columns in either calendar, never shifted', () => {
    applyDisplay({ calendar: 'gregorian', digits: 'latn' });
    expect(formatCell('2024-04-03', field('date'))).toBe('Apr 3, 2024');
    applyDisplay({ calendar: 'persian', digits: 'latn' });
    expect(formatCell('2024-04-03', field('date'))).toContain('1403');
    expect(formatCell('2024-04-03', field('date'))).toContain('15');
    expect(formatCell('2024-04-03', field('date'))).toContain('Farvardin');
  });
  test('Persian digits for numbers, decimals and money', () => {
    applyDisplay({ calendar: 'gregorian', digits: 'arabext' });
    expect(formatCell('1234.50', field('decimal'))).toBe('۱۲۳۴٫۵۰');
    expect(formatCell(42, field('number'))).toBe('۴۲');
    expect(formatCell('1234.5', { ...field('decimal'), widget: 'money', scale: 2, currency: { unit: 'USD', position: 'after' } })).toBe('۱٬۲۳۴٫۵۰ USD');
  });
  afterAll(() => applyDisplay({ calendar: 'gregorian', digits: 'latn' }));
});
