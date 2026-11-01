import type { FieldType } from '../contract.js';
import type { ColumnLike } from './column-field.js';
import { dtoConstraints } from './dto-constraints.js';
import { dtoOnlyField, dtoPropertyNames, type DtoClass } from './dto-fields.js';
import { didYouMean } from './suggest.js';
import type { EntityMetadataLike } from './build-resource-schema.js';

/** The column type a row property of each field type stands for (what `columnToField` reads back). */
const COLUMN_TYPES: Partial<Record<FieldType, string>> = {
  string: 'varchar',
  text: 'text',
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  json: 'simple-json',
  uuid: 'uuid',
};

/**
 * What a source row looks like to the schema builder: one column per property with a class-validator decorator, the
 * primary keys marked, and nothing TypeORM-only (relations, embeddeds, inheritance, uniques). The schema of a source is
 * then built like an entity's, so `list`, `form` and `fields` config are checked the same way.
 */
export function sourceMetadata(row: Function, primaryKeys: string[], fail: (message: string) => never): EntityMetadataLike & {
  tablePath: string;
  deleteDateColumn: undefined;
  discriminatorColumn: undefined;
  childEntityMetadatas: [];
  embeddeds: [];
  findColumnWithPropertyName(name: string): ColumnLike | undefined;
} {
  const dto = row as DtoClass;
  const names = dtoPropertyNames(dto);
  if (names.length === 0) fail(`row ${row.name}: no property has a class-validator decorator (@IsString(), @IsInt()...), so the source has no fields`);
  if (primaryKeys.length === 0) fail('primaryKey: name at least one row property');
  for (const key of primaryKeys) {
    if (!names.includes(key)) fail(`primaryKey: "${key}" is not a decorated property of ${row.name}${didYouMean(key, names)}`);
  }
  const constraints = dtoConstraints(dto);
  const columns: ColumnLike[] = names.map((name) => {
    const field = dtoOnlyField(dto, name);
    const designType: unknown = Reflect.getMetadata('design:type', dto.prototype, name);
    const type =
      field.type === 'enum'
        ? 'simple-enum'
        : field.type === 'number'
          ? constraints[name]?.integer
            ? 'int'
            : 'double'
          : designType === Object || designType === Array
            ? 'simple-json'
            : (COLUMN_TYPES[field.type] ?? 'varchar');
    const primary = primaryKeys.includes(name);
    return {
      propertyName: name,
      propertyPath: name,
      type,
      isNullable: field.nullable && !primary,
      isPrimary: primary,
      isGenerated: false,
      isCreateDate: false,
      isUpdateDate: false,
      isDeleteDate: false,
      isVersion: false,
      isSelect: true,
      ...(field.enumValues ? { enum: [...field.enumValues] } : {}),
      target: row,
    };
  });
  return {
    name: row.name,
    target: row,
    tablePath: `source:${row.name}`,
    columns,
    primaryColumns: columns.filter((column) => column.isPrimary),
    relations: [],
    childEntityMetadatas: [],
    embeddeds: [],
    uniques: [],
    indices: [],
    deleteDateColumn: undefined,
    discriminatorColumn: undefined,
    findColumnWithPropertyName: (name) => columns.find((column) => column.propertyName === name),
  };
}
