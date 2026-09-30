import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { dependencyValues, toFormValues, toPayload } from './form-values';

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

describe('relation values', () => {
  const customer = field('customer', 'relation', { relation: { kind: 'to-one', idType: 'number' } });
  const seller = field('seller', 'relation', { nullable: true, relation: { kind: 'to-one', idType: 'number' } });
  const tags = field('tags', 'relation', { nullable: true, relation: { kind: 'to-many', idType: 'uuid' } });
  const relationFields = [customer, seller, tags];
  const ada = { id: 1, title: 'Ada' };
  const bob = { id: 2, title: 'Bob' };
  const red = { id: 'r', title: 'red' };
  const blue = { id: 'b', title: 'blue' };

  test('records become refs; missing values become null and []', () => {
    expect(toFormValues(relationFields, { customer: ada, seller: null, tags: [red] })).toEqual({ customer: ada, seller: null, tags: [red] });
    expect(toFormValues(relationFields)).toEqual({ customer: null, seller: null, tags: [] });
  });

  test('create sends ids; an empty non-nullable relation is left out so the server says it is required', () => {
    expect(toPayload(relationFields, { customer: ada, seller: bob, tags: [red, blue] }).payload).toEqual({ customer: 1, seller: 2, tags: ['r', 'b'] });
    expect(toPayload(relationFields, { customer: null, seller: null, tags: [] }).payload).toEqual({ seller: null });
  });

  test('edit sends only changed relations, comparing ids (many-to-many in any order)', () => {
    const initial = { customer: ada, seller: bob, tags: [red, blue] };
    expect(toPayload(relationFields, { customer: { ...ada }, seller: bob, tags: [blue, red] }, initial).payload).toEqual({});
    expect(toPayload(relationFields, { customer: bob, seller: null, tags: [red] }, initial).payload).toEqual({ customer: 2, seller: null, tags: ['r'] });
    expect(toPayload(relationFields, { customer: ada, seller: bob, tags: [] }, initial).payload).toEqual({ tags: [] });
  });
});

describe('object fields', () => {
  const address = field('address', 'object', { fields: [field('city', 'string'), field('zip', 'string', { nullable: true })] });
  const hours = field('hours', 'object', { many: true, nullable: true, fields: [field('day', 'string'), field('opens', 'string')] });

  test('records become nested values', () => {
    expect(toFormValues([address, hours], { address: { city: 'Yazd', zip: null }, hours: [{ day: 'mon', opens: '09:00' }] })).toEqual({
      address: { city: 'Yazd', zip: '' },
      hours: [{ day: 'mon', opens: '09:00' }],
    });
    expect(toFormValues([address, hours])).toEqual({ address: { city: '', zip: '' }, hours: [] });
  });

  test('create sends the whole group; edit sends only changed children; lists are sent whole when changed', () => {
    const values = { address: { city: 'Yazd', zip: '' }, hours: [{ day: 'mon', opens: '09:00' }] };
    expect(toPayload([address, hours], values).payload).toEqual({ address: { city: 'Yazd', zip: null }, hours: [{ day: 'mon', opens: '09:00' }] });
    const initial = toFormValues([address, hours], { address: { city: 'Yazd', zip: null }, hours: [{ day: 'mon', opens: '09:00' }] });
    expect(toPayload([address, hours], { ...initial, address: { city: 'Yazd', zip: '12345' } }, initial).payload).toEqual({ address: { zip: '12345' } });
    expect(toPayload([address, hours], { ...initial, hours: [...(initial.hours as never[]), { day: 'tue', opens: '10:00' }] }, initial).payload).toEqual({
      hours: [{ day: 'mon', opens: '09:00' }, { day: 'tue', opens: '10:00' }],
    });
    expect(toPayload([address, hours], initial, initial).payload).toEqual({});
  });

  test('conversion errors inside groups use dotted paths', () => {
    const geo = field('geo', 'object', { fields: [field('lat', 'decimal')] });
    const lines = field('lines', 'object', { many: true, fields: [field('qty', 'number')] });
    expect(toPayload([geo, lines], { geo: { lat: 'x' }, lines: [{ qty: '1' }, { qty: 'many' }] }).errors).toEqual({
      'geo.lat': ['must be a number'],
      'lines.1.qty': ['must be a number'],
    });
  });
});

describe('dependencyValues', () => {
  test('sends what a save would, without long text or groups', () => {
    const fields = [
      field('customer', 'relation', { relation: { kind: 'to-one', idType: 'number' } }),
      field('name', 'string'),
      field('notes', 'text', { nullable: true }),
      field('address', 'object', { fields: [field('city', 'string')] }),
    ];
    const json = dependencyValues(fields, { customer: { id: 3, title: 'Ada' }, name: 'Lamp', notes: 'x'.repeat(200), address: { city: 'Yazd' } });
    expect(JSON.parse(json!)).toEqual({ customer: 3, name: 'Lamp' });
  });
});
