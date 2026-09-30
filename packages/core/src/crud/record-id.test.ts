import { describe, expect, test } from 'bun:test';
import type { FieldType, ResourceSchema } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import { encodeRecordId, parseRecordId } from './record-id.js';

const schemaWithKey = (type: FieldType): ResourceSchema => ({
  name: 'thing',
  label: 'Thing',
  group: 'g',
  primaryKeys: ['id'],
  creatable: true,
  related: [],
  softDelete: false,
  fields: [{ name: 'id', label: 'Id', type, nullable: false, primary: true, readonly: true, persisted: true }],
  list: { columns: ['id'], sortable: ['id'], defaultSort: { field: 'id', direction: 'desc' }, pageSize: 25, count: 'exact', pagination: 'offset', filters: [], search: [], editable: [] },
  form: { create: [], update: [], requiredOnCreate: [], readonly: [], constraints: { create: {}, update: {} } },
});

describe('parseRecordId', () => {
  test('numeric keys become numbers', () => {
    expect(parseRecordId('42', schemaWithKey('number'))).toBe(42);
  });

  test('ids that cannot exist are 404, not database errors', () => {
    for (const raw of ['abc', '1.5', '9007199254740993', '']) {
      expect(() => parseRecordId(raw, schemaWithKey('number'))).toThrow(AdminNotFoundError);
    }
    expect(() => parseRecordId('not-a-uuid', schemaWithKey('uuid'))).toThrow(AdminNotFoundError);
  });

  test('bigint keys must be integer strings', () => {
    expect(() => parseRecordId('abc', schemaWithKey('bigint'))).toThrow(AdminNotFoundError);
  });

  test('string, uuid and bigint keys stay strings', () => {
    expect(parseRecordId('SKU-1', schemaWithKey('string'))).toBe('SKU-1');
    expect(parseRecordId('0b6f3c52-8f1e-4c1a-9b7e-2d5c6a7e8f90', schemaWithKey('uuid'))).toBe('0b6f3c52-8f1e-4c1a-9b7e-2d5c6a7e8f90');
    expect(parseRecordId('9007199254740993', schemaWithKey('bigint'))).toBe('9007199254740993');
  });
});

describe('encoded record ids', () => {
  const composite: ResourceSchema = {
    ...schemaWithKey('number'),
    primaryKeys: ['orderId', 'sku'],
    fields: [
      { name: 'orderId', label: 'Order id', type: 'number', nullable: false, primary: true, readonly: false, persisted: true },
      { name: 'sku', label: 'Sku', type: 'string', nullable: false, primary: true, readonly: false, persisted: true },
    ],
  };

  test.each([
    [[1, 'a,b~c'], '1,a~1b~0c'],
    [[7, ''], '7,'],
    [[7, '~'], '7,~0'],
  ] as const)('%p ⇄ %s', (values, encoded) => {
    expect(encodeRecordId([...values])).toBe(encoded);
    expect(parseRecordId(encoded, composite)).toEqual({ orderId: values[0], sku: values[1] });
  });

  test('an id that reads "new" is escaped so the create page never shadows it', () => {
    expect(encodeRecordId(['new'])).toBe('~new');
    expect(parseRecordId('~new', schemaWithKey('string'))).toBe('new');
    expect(encodeRecordId(['new,'])).toBe('new~1');
  });

  test('single keys with separators round-trip', () => {
    expect(parseRecordId(encodeRecordId(['a,b']), schemaWithKey('string'))).toBe('a,b');
  });

  test('wrong arity, bad escapes and bad parts are 404', () => {
    for (const raw of ['1', '1,a,b', 'x,a', '1,a~2', '1,a~']) {
      expect(() => parseRecordId(raw, composite)).toThrow(AdminNotFoundError);
    }
    expect(() => parseRecordId('a,b', schemaWithKey('string'))).toThrow(AdminNotFoundError); // an unescaped comma is two parts
  });
});
