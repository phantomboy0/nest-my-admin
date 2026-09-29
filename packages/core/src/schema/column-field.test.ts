import { describe, expect, test } from 'bun:test';
import { columnToField, fieldTypeOf, isSupportedColumn, type ColumnLike } from './column-field.js';

const column = (overrides: Partial<ColumnLike> = {}): ColumnLike => ({
  propertyName: 'title',
  type: String,
  isNullable: false,
  isPrimary: false,
  isGenerated: false,
  isCreateDate: false,
  isUpdateDate: false,
  isDeleteDate: false,
  isVersion: false,
  isSelect: true,
  ...overrides,
});

describe('fieldTypeOf', () => {
  test.each([
    [String, 'string'], [Number, 'number'], [Boolean, 'boolean'], [Date, 'datetime'], [Object, 'json'],
    ['varchar', 'string'], ['character varying', 'string'], ['text', 'text'], ['longtext', 'text'],
    ['int', 'number'], ['double precision', 'number'], ['bigint', 'bigint'], ['int8', 'bigint'],
    ['decimal', 'decimal'], ['numeric', 'decimal'], ['bool', 'boolean'], ['date', 'date'],
    ['timestamptz', 'datetime'], ['datetime', 'datetime'], ['jsonb', 'json'], ['simple-json', 'json'],
    ['uuid', 'uuid'], ['VARCHAR', 'string'], ['something-else', 'string'],
  ] as const)('%p → %s', (input, expected) => {
    expect(fieldTypeOf(input)).toBe(expected);
  });
});

describe('columnToField', () => {
  test('maps a plain column', () => {
    expect(columnToField(column({ propertyName: 'releasedOn', type: 'date', isNullable: true }))).toEqual({
      name: 'releasedOn', label: 'Released on', type: 'date', nullable: true, primary: false, readonly: false, persisted: true,
    });
  });

  test('generated primary keys and automatic dates are read-only', () => {
    expect(columnToField(column({ propertyName: 'id', type: Number, isPrimary: true, isGenerated: true }))).toMatchObject({ primary: true, readonly: true });
    expect(columnToField(column({ type: 'datetime', isCreateDate: true })).readonly).toBe(true);
    expect(columnToField(column({ type: 'datetime', isUpdateDate: true })).readonly).toBe(true);
    expect(columnToField(column({ type: Number, isVersion: true })).readonly).toBe(true);
  });

  test('enum columns expose their values as strings', () => {
    expect(columnToField(column({ type: 'simple-enum', enum: ['draft', 'live', 3] }))).toMatchObject({ type: 'enum', enumValues: ['draft', 'live', '3'] });
    expect(columnToField(column({ type: 'enum', enum: [] })).type).toBe('string');
  });

  test('decimal columns keep their scale', () => {
    expect(columnToField(column({ type: 'decimal', scale: 2 }))).toMatchObject({ type: 'decimal', scale: 2 });
    expect(columnToField(column({ type: 'decimal' })).scale).toBeUndefined();
  });
});

describe('isSupportedColumn', () => {
  test('skips relation, embedded and non-selectable columns', () => {
    expect(isSupportedColumn(column())).toBe(true);
    expect(isSupportedColumn(column({ relationMetadata: {} }))).toBe(false);
    expect(isSupportedColumn(column({ embeddedMetadata: {} }))).toBe(false);
    expect(isSupportedColumn(column({ isSelect: false }))).toBe(false);
  });
});
