import { describe, expect, test } from 'bun:test';
import type { FieldType, ResourceSchema } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import { parseRecordId } from './record-id.js';

const schemaWithKey = (type: FieldType): ResourceSchema => ({
  name: 'thing',
  label: 'Thing',
  group: 'g',
  primaryKey: 'id',
  fields: [{ name: 'id', label: 'Id', type, nullable: false, primary: true, readonly: true, persisted: true }],
  list: { columns: ['id'], sortable: ['id'], defaultSort: { field: 'id', direction: 'desc' }, pageSize: 25, filters: [], search: [] },
  form: { create: [], update: [], requiredOnCreate: [], constraints: { create: {}, update: {} } },
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
