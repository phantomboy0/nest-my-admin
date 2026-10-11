import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { dependencyValues, toFormValues, toPayload, withoutImages } from './form-values';

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

describe('any digit set', () => {
  test('numbers, decimals and dates typed with Persian digits are sent with Latin ones', () => {
    const typed = [field('stock', 'number'), field('price', 'decimal', { scale: 2 }), field('on', 'date', { nullable: true })];
    expect(toPayload(typed, { stock: '۱۲', price: '۱٬۲۳۴٫۵', on: '۲۰۲۴-۰۴-۰۳' })).toEqual({ payload: { stock: 12, price: '1234.5', on: '2024-04-03' }, errors: {} });
  });
  test('a malformed date is an error, not a 422 from the server', () => {
    expect(toPayload([field('on', 'date', { nullable: true })], { on: '2024-02-30' }).errors).toEqual({ on: ['must be a valid date'] });
  });
});

describe('file fields', () => {
  const file = { accept: ['image/*'], maxBytes: 1000, many: false };
  const fileFields = [
    field('image', 'string', { nullable: true, widget: 'image', file }),
    field('manual', 'string', { widget: 'file', file }),
    field('gallery', 'json', { nullable: true, widget: 'image', file: { ...file, many: true } }),
  ];
  const ref = (key: string) => ({ key, name: `${key}.png`, contentType: 'image/png', size: 3, url: `/admin/api/files/${key}` });
  const record = { image: 'a', manual: 'm', gallery: ['g1', 'g2'], _files: { image: ref('a'), manual: ref('m'), gallery: [ref('g1'), ref('g2')] } };

  test('form values come from _files', () => {
    expect(toFormValues(fileFields, record)).toEqual({ image: ref('a'), manual: ref('m'), gallery: [ref('g1'), ref('g2')] });
    expect(toFormValues(fileFields)).toEqual({ image: null, manual: null, gallery: [] });
  });

  test('a copy of a record (no _files) starts without files', () => {
    expect(toFormValues(fileFields, { image: 'a', manual: 'm', gallery: ['g1'] })).toEqual({ image: null, manual: null, gallery: [] });
  });

  test('create sends tokens, and leaves out what is empty', () => {
    const upload = { token: 't1', name: 'new.png', contentType: 'image/png', size: 9 };
    expect(toPayload(fileFields, { image: upload, manual: null, gallery: [upload] })).toEqual({
      payload: { image: { token: 't1' }, gallery: [{ token: 't1' }] },
      errors: {},
    });
    // Nullable and empty: null; required and empty: left out so the server says "required"; an empty list: left out.
    expect(toPayload(fileFields, { image: null, manual: null, gallery: [] }).payload).toEqual({ image: null });
  });

  test('edit sends nothing for untouched files', () => {
    const initial = toFormValues(fileFields, record);
    expect(toPayload(fileFields, toFormValues(fileFields, record), initial).payload).toEqual({});
  });

  test('edit sends a replaced file as its token and a cleared one as null', () => {
    const initial = toFormValues(fileFields, record);
    const upload = { token: 't2', name: 'new.png', contentType: 'image/png', size: 9 };
    expect(toPayload(fileFields, { ...initial, image: upload, manual: null }, initial).payload).toEqual({ image: { token: 't2' }, manual: null });
  });

  test('edit sends a changed list whole, in order: kept files by key, uploads by token', () => {
    const initial = toFormValues(fileFields, record);
    const upload = { token: 't3', name: 'new.png', contentType: 'image/png', size: 9 };
    expect(toPayload(fileFields, { ...initial, gallery: [ref('g2'), upload, ref('g1')] }, initial).payload).toEqual({
      gallery: [{ key: 'g2' }, { token: 't3' }, { key: 'g1' }],
    });
    expect(toPayload(fileFields, { ...initial, gallery: [ref('g2'), ref('g1')] }, initial).payload).toEqual({ gallery: [{ key: 'g2' }, { key: 'g1' }] });
    expect(toPayload(fileFields, { ...initial, gallery: [] }, initial).payload).toEqual({ gallery: [] });
  });

  test('files are never part of the relation-option values', () => {
    expect(dependencyValues(fileFields, toFormValues(fileFields, record))).toBe('{}');
  });
});

describe('withoutImages (Duplicate)', () => {
  test('drops every <img> of rich-text HTML and keeps the rest as it is', () => {
    const html = '<h2>Title</h2><p>before</p><img src="/admin/api/files/post/body/2026/10/a.png" alt="A cat"><p>after <strong>bold</strong></p><img src="https://cdn.example.com/f/post/body/b.png">';
    expect(withoutImages(html)).toBe('<h2>Title</h2><p>before</p><p>after <strong>bold</strong></p>');
  });
  test('quoted attributes may hold ">" and other quotes; case and self-closing forms do not matter', () => {
    expect(withoutImages('<p>a<IMG alt="1 > 0" src=\'x.png\' />b</p>')).toBe('<p>ab</p>');
    expect(withoutImages(`<p><img alt='say "hi" >' src="x.png">c</p>`)).toBe('<p>c</p>');
    expect(withoutImages('<img src="a.png"><img src="b.png">')).toBe('');
  });
  test('text that only looks like a tag, and other tags, stay', () => {
    expect(withoutImages('<p>&lt;img src="x"&gt; <imgx> <picture></picture></p>')).toBe('<p>&lt;img src="x"&gt; <imgx> <picture></picture></p>');
    expect(withoutImages('')).toBe('');
  });
});
