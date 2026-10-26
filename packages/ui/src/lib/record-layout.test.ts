import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType, ResourceSchema } from '@nest-my-admin/core/contract';
import { asideValues, layoutModel } from './record-layout';
import { readOnlySchema } from './view-as';

const f = (name: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({ name, label: name, type, nullable: true, primary: false, readonly: false, persisted: true, ...extra });
const schema = {
  name: 'order',
  fields: [f('number', 'string'), f('notes', 'string'), f('status', 'enum', { widget: 'badge' }), f('total', 'number'), f('customerId', 'relation')],
  list: { computed: { lines: { label: 'items', kind: 'count', sortable: false } } },
  form: {
    create: ['number', 'notes'],
    update: ['notes', 'total'],
    requiredOnCreate: [],
    readonly: [],
    constraints: { create: {}, update: {} },
    layout: [{ fields: ['number', 'notes'], columns: 1 }],
    aside: [{ title: 'Payment', fields: ['status', 'total'] }, { title: 'Customer', fields: ['name'], relation: { field: 'customerId', resource: 'customer', link: true } }],
    mode: 'view',
    header: { subtitle: [{ field: 'number' }, { computed: 'lines' }] },
  },
} as unknown as ResourceSchema;
const record = { _id: '1', number: '#1042', notes: '', status: 'paid', total: 3668, _computed: { lines: { value: 3 } }, _aside: { '1': { _id: '7', name: 'Sara' } } };

describe('record layout', () => {
  test('view mode: nothing is an input until «Edit»; then the update form within the layout', () => {
    expect(layoutModel(schema, record, false).editable).toEqual([]);
    expect(layoutModel(schema, record, true).editable).toEqual(['notes']); // `total` is on the aside, which is read-only
    expect(layoutModel(schema, undefined, false).editable).toEqual(['notes']); // a new record is a form
  });

  test('the header: badge fields, and the subtitle from fields and computed columns', () => {
    const { header } = layoutModel(schema, record, false);
    expect(header.badges.map((field) => field.name)).toEqual(['status']);
    expect(header.subtitle).toEqual(['#1042', '3 items']);
  });

  test('aside cards read the record, or the related record from _aside', () => {
    const [own, related] = layoutModel(schema, record, false).aside;
    expect(asideValues(own!, 0, record)).toBe(record);
    expect(asideValues(related!, 1, record)).toEqual({ _id: '7', name: 'Sara' });
    expect(asideValues(related!, 1, { _id: '2' })).toBeUndefined();
  });

  test('viewing as someone keeps the layout, its aside and view mode', () => {
    const readOnly = readOnlySchema(schema);
    expect(readOnly.form.aside).toEqual(schema.form.aside);
    expect(readOnly.form.mode).toBe('view');
    expect(layoutModel(readOnly, record, true).editable).toEqual([]);
  });
});
