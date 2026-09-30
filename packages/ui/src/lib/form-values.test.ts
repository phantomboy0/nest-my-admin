import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { toFormValues, toPayload } from './form-values';

process.env.TZ = 'UTC';

const field = (name: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});

const fields = [
  field('name', 'string'),
  field('stock', 'number'),
  field('price', 'decimal', { scale: 2 }),
  field('active', 'boolean'),
  field('notes', 'text', { nullable: true }),
  field('specs', 'json', { nullable: true }),
  field('at', 'datetime', { nullable: true }),
];

describe('toFormValues', () => {
  test('turns a record into editable strings and booleans', () => {
    expect(
      toFormValues(fields, { name: 'Lamp', stock: 3, price: '19.90', active: true, notes: null, specs: { w: 2 }, at: '2026-01-02T03:04:00.000Z' }),
    ).toEqual({ name: 'Lamp', stock: '3', price: '19.90', active: true, notes: '', specs: '{\n  "w": 2\n}', at: '2026-01-02T03:04' });
  });

  test('empty form for create', () => {
    expect(toFormValues(fields)).toMatchObject({ name: '', stock: '', active: false });
  });
});

describe('toPayload', () => {
  test('types values and omits empty required inputs on create', () => {
    const { payload, errors } = toPayload(fields, {
      name: 'Lamp', stock: '1,200', price: '1,234.50', active: true, notes: '', specs: '', at: '2026-01-02T03:04',
    });
    expect(errors).toEqual({});
    expect(payload).toEqual({ name: 'Lamp', stock: 1200, price: '1234.50', active: true, notes: null, specs: null, at: '2026-01-02T03:04:00.000Z' });
    expect(toPayload(fields, { name: '', stock: '' }).payload).not.toHaveProperty('stock');
  });

  test('reports values the browser cannot convert', () => {
    expect(toPayload(fields, { stock: 'abc', specs: '{oops', at: 'never' }).errors).toEqual({
      stock: ['must be a number'],
      specs: ['must be valid JSON'],
      at: ['must be a valid date and time'],
    });
  });

  test('on update sends only changed values, and a cleared field as null', () => {
    const initial = toFormValues(fields, { name: 'Lamp', stock: 3, price: '1.00', active: false });
    const { payload } = toPayload(fields, { ...initial, stock: '4', name: '' }, initial);
    expect(payload).toEqual({ stock: 4, name: null });
  });

  test('a decimal comma is an error, never a thousands separator', () => {
    const decimal = (price: string) => toPayload(fields, { price });
    expect(decimal('1,50').errors).toEqual({ price: ['must be a number'] });
    expect(decimal('1,234.50').payload.price).toBe('1234.50');
    expect(toPayload(fields, { stock: '0x10' }).errors).toEqual({ stock: ['must be a number'] });
    expect(toPayload(fields, { stock: '1e3' }).errors).toEqual({ stock: ['must be a number'] });
    expect(toPayload(fields, { stock: '12' }).payload.stock).toBe(12);
    const big = [field('n', 'bigint')];
    expect(toPayload(big, { n: '1.5' }).errors).toEqual({ n: ['must be a number'] });
    expect(toPayload(big, { n: '9,007,199,254,740,993' }).payload.n).toBe('9007199254740993');
  });
});
