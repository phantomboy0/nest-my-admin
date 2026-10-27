import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType, FormLayoutInline, ResourceSchema } from '@nest-my-admin/core/contract';
import { inlineChangeSet, inlineErrorsOf, inlinePayload, inlineRowsOf, newInlineRow, type InlineRow } from './inline-changes';

const field = (name: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});

const child = {
  name: 'order-line',
  fields: [field('id', 'number', { primary: true }), field('product', 'string'), field('qty', 'number'), field('position', 'number'), field('orderId', 'number')],
  version: undefined,
  permissions: { create: true, update: true, delete: true, purge: false },
  form: {
    create: ['product', 'qty', 'position'],
    update: ['product', 'qty', 'position'],
    readonly: [],
    requiredOnCreate: ['product'],
    constraints: { create: { product: { required: true }, qty: { min: 1 } }, update: { qty: { min: 1 } } },
  },
} as unknown as ResourceSchema;

const inline: FormLayoutInline = { inline: 'order-line', label: 'Lines', display: 'table', fields: ['product', 'qty', 'position'], order: 'position', max: 100, link: 'orderId' };

const record = {
  _id: '1',
  _inlines: {
    'order-line': {
      rows: [
        { _id: '17', id: 17, product: 'Lamp', qty: 1, position: 0 },
        { _id: '18', id: 18, product: 'Desk', qty: 2, position: 1 },
      ],
      total: 2,
      truncated: false,
    },
  },
};

const start = (): InlineRow[] => inlineRowsOf(inline, child, record);

describe('inlineRowsOf', () => {
  test('rows of the record, keyed by _id, without the order field', () => {
    expect(start().map((row) => [row.key, row.values])).toEqual([
      ['17', { product: 'Lamp', qty: '1' }],
      ['18', { product: 'Desk', qty: '2' }],
    ]);
  });

  test('a new record or a copy starts without rows', () => {
    expect(inlineRowsOf(inline, child, undefined)).toEqual([]);
    expect(inlineRowsOf(inline, child, { _id: '1' })).toEqual([]);
  });
});

describe('inlineChangeSet', () => {
  test('nothing changed: no changes', () => {
    expect(inlineChangeSet(inline, child, start(), start())).toEqual({ changes: undefined, errors: {} });
  });

  test('only changed fields of changed rows; new rows with _key; removed rows; order when the sequence changed', () => {
    const rows = start();
    const added = { ...newInlineRow(inline, child, 'n1'), values: { product: 'Chair', qty: '4' } };
    const current = [added, { ...rows[0]!, values: { ...rows[0]!.values, qty: '3' } }];
    expect(inlineChangeSet(inline, child, rows, current)).toEqual({
      changes: {
        create: [{ _key: 'n1', product: 'Chair', qty: 4 }],
        update: [{ _id: '17', qty: 3 }],
        delete: ['18'],
        order: ['n1', '17'],
      },
      errors: {},
    });
  });

  test('a reorder alone sends only order', () => {
    const rows = start();
    expect(inlineChangeSet(inline, child, rows, [rows[1]!, rows[0]!]).changes).toEqual({ order: ['18', '17'] });
  });

  test('no order without an order field, or for a user who may not write it', () => {
    const rows = start();
    expect(inlineChangeSet({ ...inline, order: undefined }, child, rows, [rows[1]!, rows[0]!]).changes).toBeUndefined();
    const noOrder = { ...child, form: { ...child.form, update: ['product', 'qty'] } } as ResourceSchema;
    expect(inlineChangeSet(inline, noOrder, rows, [rows[1]!, rows[0]!]).changes).toBeUndefined();
  });

  test('a version column sends _version with an update', () => {
    const versioned = { ...child, version: 'version' } as ResourceSchema;
    const rows = inlineRowsOf(inline, versioned, { _inlines: { 'order-line': { rows: [{ _id: '17', product: 'Lamp', qty: 1, version: 4 }] } } });
    const changed = [{ ...rows[0]!, values: { ...rows[0]!.values, qty: '2' } }];
    expect(inlineChangeSet(inline, versioned, rows, changed).changes).toEqual({ update: [{ _id: '17', qty: 2, _version: 4 }] });
  });

  test('locked fields of a row are not sent', () => {
    const rows = inlineRowsOf(inline, child, { _inlines: { 'order-line': { rows: [{ _id: '17', product: 'Lamp', qty: 1, _readonly: ['qty'] }] } } });
    const changed = [{ ...rows[0]!, values: { product: 'Lamp', qty: '9' } }];
    expect(inlineChangeSet(inline, child, rows, changed).changes).toBeUndefined();
  });

  test('conversion and constraint errors by row key', () => {
    const rows = start();
    const current = [{ ...rows[0]!, values: { product: 'Lamp', qty: 'x' } }, rows[1]!, newInlineRow(inline, child, 'n1')];
    expect(inlineChangeSet(inline, child, rows, current).errors).toEqual({
      '17': { qty: ['must be a number'] },
      n1: { product: ['is required'] },
    });
  });
});

describe('inlinePayload', () => {
  test('only inlines that changed, and count errors only for those', () => {
    const rows = start();
    const message = (_: FormLayoutInline, count: number) => (count < 2 ? `at least 2 (${count})` : null);
    expect(inlinePayload([inline], { 'order-line': child }, { 'order-line': rows }, { 'order-line': rows }, message)).toEqual({ changes: undefined, errors: {} });
    expect(inlinePayload([inline], { 'order-line': child }, { 'order-line': rows }, { 'order-line': [rows[0]!] }, message)).toEqual({
      changes: { 'order-line': { delete: ['18'], order: ['17'] } },
      errors: { 'order-line': { rows: {}, inline: ['at least 2 (1)'] } },
    });
  });

  test('a read-only inline sends nothing, whatever its rows look like', () => {
    const rows = start();
    const readonly = { ...inline, readonly: true as const };
    expect(inlinePayload([readonly], { 'order-line': child }, { 'order-line': rows }, { 'order-line': [rows[0]!] }, () => null)).toEqual({ changes: undefined, errors: {} });
  });
});

describe('inlineErrorsOf', () => {
  test('maps dotted paths back to rows, the inline, and the parent', () => {
    const sent = { 'order-line': { create: [{ _key: 'n1' }, { _key: 'n2' }] } };
    expect(
      inlineErrorsOf(
        {
          number: ['taken'],
          '_inlines.order-line.create.1.qty': ['too small'],
          '_inlines.order-line.update.17.product.name': ['bad'],
          '_inlines.order-line.delete.18': ['not allowed'],
          '_inlines.order-line': ['at most 3'],
          '_inlines.order-line.create.7.qty': ['unknown row'],
        },
        sent,
      ),
    ).toEqual({
      parent: { number: ['taken'] },
      inlines: {
        'order-line': {
          rows: { n2: { qty: ['too small'] }, '17': { 'product.name': ['bad'] } },
          inline: ['not allowed', 'at most 3', 'unknown row'],
        },
      },
    });
  });
});
