import type { FieldSchema, FieldType } from '../contract.js';
import { humanize } from './humanize.js';

/** The subset of TypeORM's ColumnMetadata this package reads (TypeORM does not export ColumnMetadata from its root). */
export interface ColumnLike {
  propertyName: string;
  type: unknown;
  isNullable: boolean;
  isPrimary: boolean;
  isGenerated: boolean;
  isCreateDate: boolean;
  isUpdateDate: boolean;
  isDeleteDate: boolean;
  isVersion: boolean;
  isSelect: boolean;
  enum?: (string | number)[];
  scale?: number;
  default?: unknown;
  relationMetadata?: unknown;
  embeddedMetadata?: unknown;
}

const TYPE_BY_NAME: Record<string, FieldType> = {
  varchar: 'string', 'character varying': 'string', char: 'string', character: 'string',
  nvarchar: 'string', nchar: 'string', citext: 'string', varchar2: 'string',
  text: 'text', tinytext: 'text', mediumtext: 'text', longtext: 'text', ntext: 'text', clob: 'text',
  int: 'number', integer: 'number', int2: 'number', int4: 'number', smallint: 'number', tinyint: 'number',
  mediumint: 'number', float: 'number', float4: 'number', float8: 'number', double: 'number',
  'double precision': 'number', real: 'number',
  bigint: 'bigint', int8: 'bigint',
  decimal: 'decimal', numeric: 'decimal', dec: 'decimal', money: 'decimal',
  boolean: 'boolean', bool: 'boolean',
  date: 'date',
  datetime: 'datetime', datetime2: 'datetime', datetimeoffset: 'datetime', timestamp: 'datetime',
  timestamptz: 'datetime', 'timestamp with time zone': 'datetime', 'timestamp without time zone': 'datetime',
  json: 'json', jsonb: 'json', 'simple-json': 'json', 'simple-array': 'json',
  enum: 'enum', 'simple-enum': 'enum',
  uuid: 'uuid',
};

export function fieldTypeOf(type: unknown): FieldType {
  if (type === String) return 'string';
  if (type === Number) return 'number';
  if (type === Boolean) return 'boolean';
  if (type === Date) return 'datetime';
  if (type === Object || type === Array) return 'json';
  if (typeof type === 'string') return TYPE_BY_NAME[type.toLowerCase()] ?? 'string';
  return 'string';
}

/** Columns M0 renders: selectable, and not part of a relation or an embedded entity (both arrive in M1). */
export function isSupportedColumn(column: ColumnLike): boolean {
  return column.isSelect && !column.relationMetadata && !column.embeddedMetadata;
}

export function columnToField(column: ColumnLike): FieldSchema {
  let type = fieldTypeOf(column.type);
  if (column.enum && column.enum.length > 0) type = 'enum';
  else if (type === 'enum') type = 'string';

  const field: FieldSchema = {
    name: column.propertyName,
    label: humanize(column.propertyName),
    type,
    nullable: column.isNullable,
    primary: column.isPrimary,
    readonly: column.isGenerated || column.isCreateDate || column.isUpdateDate || column.isDeleteDate || column.isVersion,
    persisted: true,
  };
  if (type === 'enum') field.enumValues = column.enum!.map(String);
  if (type === 'decimal' && typeof column.scale === 'number') field.scale = column.scale;
  return field;
}
