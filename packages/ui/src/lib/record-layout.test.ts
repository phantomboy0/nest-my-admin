import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType, ResourceSchema } from '@nest-my-admin/core/contract';
import { asideValues, fieldWarnings, layoutModel, shownBesideMain, summaryRows } from './record-layout';
import { setGlobalCurrency } from './money';
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

describe('summaries and warnings', () => {
  test('summary rows: labels with formatted values, money through its unit, computed columns from _computed', () => {
    setGlobalCurrency({ unit: 'Toman', position: 'after' });
    const money = { ...schema, fields: [...schema.fields, f('grand', 'decimal', { widget: 'money', scale: 0 })] } as ResourceSchema;
    const node = { summary: [{ label: 'Total', value: { field: 'grand' } }, { label: 'Items', value: { computed: 'lines' } }, { label: 'Gone', value: { field: 'nope' } }] };
    expect(summaryRows(node, money, { ...record, grand: '3668000' })).toEqual([
      { label: 'Total', text: '3,668,000 Toman' },
      { label: 'Items', text: '3' },
    ]);
    setGlobalCurrency(undefined);
  });

  test('a warnIf field warns while it is empty, and only then', () => {
    const fields = [f('caption', 'string', { warnIf: { empty: true, message: 'No alt text' } }), f('sort', 'number')];
    expect(fieldWarnings(fields, { caption: '', sort: '' })).toEqual({ caption: 'No alt text' });
    expect(fieldWarnings(fields, { caption: '  ' })).toEqual({ caption: 'No alt text' });
    expect(fieldWarnings(fields, { caption: 'A red shoe' })).toEqual({});
  });
});

describe('fields beside the main column', () => {
  test('read-only fields shown beside the main sections are not repeated; editable ones are', () => {
    const page = {
      ...schema,
      form: {
        ...schema.form,
        update: ['notes', 'status'],
        readonly: ['total', 'number', 'customerId', 'createdAt'],
        header: { badges: ['status'], subtitle: [{ field: 'createdAt' }, { computed: 'lines' }] },
        layout: [{ fields: ['notes'], columns: 1 }, { title: 'Totals', summary: [{ label: 'Total', value: { field: 'total' } }, { label: 'Items', value: { computed: 'lines' } }] }],
        aside: [{ title: 'Status', fields: ['status', 'number'] }, { title: 'Customer', fields: ['name'], relation: { field: 'customerId', resource: 'customer', link: true } }],
      },
    } as unknown as ResourceSchema;
    expect([...shownBesideMain(page)].sort()).toEqual(['createdAt', 'customerId', 'number', 'total']);
  });
});
