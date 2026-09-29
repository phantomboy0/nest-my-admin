import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '../contract.js';
import { formatDecimal, serializeRecord, serializeValue } from './serialize.js';

const field = (name: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: true, primary: false, readonly: false, persisted: true, ...extra,
});

describe('formatDecimal', () => {
  test.each([
    [1.5, 2, '1.50'],
    ['1.5', 2, '1.50'],
    ['20', 2, '20.00'],
    ['-3.1', 2, '-3.10'],
    ['1.500', 2, '1.500'],
    [19.9, undefined, '19.9'],
    ['abc', 2, 'abc'],
  ] as const)('%p (scale %p) → %s', (value, scale, expected) => {
    expect(formatDecimal(value, scale)).toBe(expected);
  });
});

describe('serializeValue', () => {
  test('decimals from SQLite (numbers) become strings with the column scale', () => {
    expect(serializeValue(1.5, field('price', 'decimal', { scale: 2 }))).toBe('1.50');
  });

  test('bigints become strings', () => {
    expect(serializeValue(9007199254740993n, field('views', 'bigint'))).toBe('9007199254740993');
    expect(serializeValue(12, field('views', 'bigint'))).toBe('12');
  });

  test('dates and datetimes', () => {
    expect(serializeValue(new Date('2026-03-04T05:06:07.000Z'), field('at', 'datetime'))).toBe('2026-03-04T05:06:07.000Z');
    expect(serializeValue('2026-03-04', field('on', 'date'))).toBe('2026-03-04');
  });

  test('null and undefined become null', () => {
    expect(serializeValue(undefined, field('x', 'string'))).toBeNull();
    expect(serializeValue(null, field('x', 'json'))).toBeNull();
  });
});

describe('serializeRecord', () => {
  test('emits only persisted schema fields', () => {
    const record = serializeRecord(
      { id: 1, price: 2.5, passwordHash: 'secret', internal: { a: 1 } },
      [field('id', 'number'), field('price', 'decimal', { scale: 2 }), field('password', 'string', { persisted: false })],
    );
    expect(record).toEqual({ id: 1, price: '2.50' });
  });
});
