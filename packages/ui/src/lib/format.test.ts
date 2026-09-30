import { afterAll, describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { formatCell } from './format';
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
    expect(formatCell('1234.5', { ...field('decimal'), widget: 'money', scale: 2, currency: 'USD' })).toBe('۱٬۲۳۴٫۵۰ USD');
  });
  afterAll(() => applyDisplay({ calendar: 'gregorian', digits: 'latn' }));
});
