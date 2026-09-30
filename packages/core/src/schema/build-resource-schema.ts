import type { FieldSchema, ResourceSchema, SortDirection } from '../contract.js';
import type { AdminResourceDefinition } from '../decorators/admin-resource.js';
import type { AdminResourceBase } from '../resource/admin-resource-base.js';
import { columnToField, isSupportedColumn, type ColumnLike } from './column-field.js';
import { dtoOnlyField, dtoPropertyNames, isDtoPropertyOptional } from './dto-fields.js';
import { humanize, kebabCase } from './humanize.js';
import { didYouMean } from './suggest.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** The subset of TypeORM's EntityMetadata the builder reads. */
export interface EntityMetadataLike {
  columns: ColumnLike[];
  primaryColumns: ColumnLike[];
}

export interface BuildResourceSchemaInput {
  definition: AdminResourceDefinition;
  resource: AdminResourceBase<any>;
  metadata: EntityMetadataLike;
  /** Group key of the Nest module that provides the resource. */
  moduleGroup: string;
  /** Resource class name, used in configuration error messages. */
  className: string;
}

export function buildResourceSchema(input: BuildResourceSchemaInput): ResourceSchema {
  const { definition, resource, metadata, moduleGroup, className } = input;
  const entityName = definition.entity.name;
  const fail = (message: string): never => {
    throw new Error(`${className}: ${message}`);
  };

  if (metadata.primaryColumns.length !== 1) {
    fail(`entity ${entityName} has ${metadata.primaryColumns.length} primary columns; exactly one is supported`);
  }
  const primaryKey = metadata.primaryColumns[0]!.propertyName;

  const supportedColumns = metadata.columns.filter(isSupportedColumn);
  const entityFields = supportedColumns.map(columnToField);
  const byName = new Map(entityFields.map((field) => [field.name, field]));

  const createDto = resource.form?.create;
  const updateDto = resource.form?.update ?? createDto;
  const writable = entityFields.filter((field) => !field.readonly).map((field) => field.name);
  const create = createDto ? dtoPropertyNames(createDto) : writable;
  const update = (updateDto ? dtoPropertyNames(updateDto) : writable).filter((name) => name !== primaryKey);

  const dtoOnly: FieldSchema[] = [];
  for (const [dto, names] of [[createDto, create], [updateDto, update]] as const) {
    for (const name of names) {
      const field = byName.get(name);
      if (field?.readonly) fail(`DTO property "${name}" maps to read-only column ${entityName}.${name}`);
      if (!field && dto && !dtoOnly.some((extra) => extra.name === name)) dtoOnly.push(dtoOnlyField(dto, name));
    }
  }

  const requiredOnCreate = createDto
    ? create.filter((name) => !isDtoPropertyOptional(createDto, name))
    : supportedColumns
        .filter((c) => writable.includes(c.propertyName) && !c.isNullable && c.default === undefined)
        .map((c) => c.propertyName);

  const sortable = entityFields.filter((field) => field.type !== 'json').map((field) => field.name);
  const columns: string[] =
    resource.list?.columns ??
    entityFields.filter((field) => field.type !== 'json' && field.type !== 'text').map((field) => field.name);
  if (columns.length === 0) fail('list.columns must name at least one column');
  for (const column of columns) {
    if (!byName.has(column)) return fail(`list.columns: unknown column "${column}" on ${entityName}${didYouMean(column, [...byName.keys()])}`);
  }

  const rawSort: string = resource.list?.sort ?? `-${primaryKey}`;
  const direction: SortDirection = rawSort.startsWith('-') ? 'desc' : 'asc';
  const sortField = rawSort.replace(/^-/, '');
  if (!sortable.includes(sortField)) return fail(`list.sort: cannot sort by "${sortField}"${didYouMean(sortField, sortable)}`);

  const pageSize = resource.list?.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    fail(`list.pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }

  return {
    name: definition.name ?? kebabCase(entityName),
    label: definition.label ?? humanize(entityName),
    group: definition.group ?? moduleGroup,
    ...(definition.icon ? { icon: definition.icon } : {}),
    primaryKey,
    fields: [...entityFields, ...dtoOnly],
    list: { columns, sortable, defaultSort: { field: sortField, direction }, pageSize },
    form: { create, update, requiredOnCreate },
  };
}
