import { describe, expect, test } from 'bun:test';
import type { FieldSchema } from '../contract.js';
import { toCell } from './export-cells.js';

const field = (type: FieldSchema['type'], extra: Partial<FieldSchema> = {}) => ({ name: 'x', label: 'X', type, nullable: true, primary: false, readonly: false, persisted: true, ...extra }) as FieldSchema;

describe('toCell', () => {
  test('numbers, decimals and bigints that fit, else text', () => {
    expect(toCell(12, field('number'), 'en', 0)).toBe(12);
    expect(toCell('1250000', field('bigint'), 'en', 0)).toBe(1250000);
    expect(toCell('12.50', field('decimal'), 'en', 0)).toBe(12.5);
    expect(toCell('12345678901234567890', field('bigint'), 'en', 0)).toBe('12345678901234567890');
  });

  test('booleans, enums, relations, objects', () => {
    expect(toCell(true, field('boolean'), 'fa', 0)).toBe('بله');
    expect(toCell(false, field('boolean'), 'en', 0)).toBe('No');
    expect(toCell('paid', field('enum', { enumLabels: { paid: 'پرداخت‌شده' } }), 'fa', 0)).toBe('پرداخت‌شده');
    expect(toCell('other', field('enum'), 'fa', 0)).toBe('other');
    expect(toCell({ id: 1, title: 'سارا' }, field('relation'), 'fa', 0)).toBe('سارا');
    expect(toCell([{ id: 1, title: 'a' }, { id: 2, title: 'b' }], field('relation'), 'fa', 0)).toBe('a، b');
    expect(toCell({ a: 1 }, field('json'), 'en', 0)).toBe('{"a":1}');
    expect(toCell(null, field('string'), 'en', 0)).toBeNull();
  });

  test('dates as dates; date-times shifted to the exporter clock', () => {
    expect(toCell('2026-10-01', field('date'), 'en', 0)).toEqual({ date: new Date('2026-10-01T00:00:00Z'), time: false });
    expect(toCell('2026-10-01T20:30:00.000Z', field('datetime'), 'en', 210)).toEqual({ date: new Date('2026-10-02T00:00:00Z'), time: true });
  });
});
