import type { FieldConstraints, FieldSchema, FilterSchema, ResourceSchema, SortDirection } from '../contract.js';
import type { AdminResourceDefinition } from '../decorators/admin-resource.js';
import type { AdminResourceBase } from '../resource/admin-resource-base.js';
import { columnToField, isSupportedColumn, type ColumnLike } from './column-field.js';
import { dtoObjectField, embeddedField, nestedTypeOf, topEmbedded, type EmbeddedLike } from './nested-fields.js';
import { isToOne, pathField as toPathField, relationFields, resolvePath, type RelatedMetadataLike } from './relation-fields.js';
import { dtoConstraints, hasDtoInitializer, isConditionalProperty } from './dto-constraints.js';
import { dtoOnlyField, dtoPropertyNames, isDtoPropertyOptional, type DtoClass } from './dto-fields.js';
import { humanize, kebabCase } from './humanize.js';
import { didYouMean } from './suggest.js';
import { SEARCHABLE_TYPES, operatorsFor } from './filter-operators.js';

export const DEFAULT_PAGE_SIZE = 25;

/** Field types a list cell can edit in place. */
const INLINE_EDITABLE: readonly string[] = ['string', 'number', 'decimal', 'bigint', 'boolean', 'enum', 'date'];
export const MAX_PAGE_SIZE = 100;

/** The subset of TypeORM's EntityMetadata the builder reads. */
export type EntityMetadataLike = RelatedMetadataLike;

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

  if (metadata.primaryColumns.length === 0) fail(`entity ${entityName} has no primary column`);
  const primaryKeys = metadata.primaryColumns.map((column) => column.propertyName);

  // Columns in entity order; a join column becomes its relation's field; many-to-many fields come last.
  const relations = relationFields(metadata);
  const entityFields: FieldSchema[] = [];
  const columnByName = new Map<string, ColumnLike>();
  /** Columns of embeddeds by dotted path (`address.city`), for their constraints. */
  const columnByPath = new Map<string, ColumnLike>();
  // Single-table inheritance: a child's discriminator is fixed (hidden); the root shows it read-only, as an enum of
  // the stored values, and leaves out columns only its children declare.
  const children = metadata.childEntityMetadatas ?? [];
  const isChild = metadata.tableType === 'entity-child';
  const childTargets = new Set(children.map((child) => child.target));
  for (const column of metadata.columns) {
    if (column.isDiscriminator) {
      if (isChild || !column.isSelect) continue;
      const values = [...new Set([metadata.discriminatorValue, ...children.map((child) => child.discriminatorValue)])].filter(
        (value): value is string => typeof value === 'string',
      );
      const field: FieldSchema = { ...columnToField(column), type: 'enum', enumValues: values, readonly: true };
      entityFields.push(field);
      columnByName.set(field.name, column);
      continue;
    }
    if (column.target !== undefined && childTargets.has(column.target)) continue;
    if (column.embeddedMetadata) {
      // An embedded is one object field, placed where its first column is.
      const top = topEmbedded(column.embeddedMetadata as EmbeddedLike);
      if (column.isSelect && !column.relationMetadata && column.propertyPath) columnByPath.set(column.propertyPath, column);
      if (!entityFields.some((field) => field.name === top.propertyName)) entityFields.push(embeddedField(top));
      continue;
    }
    const relationField = relations.find(({ relation }) => isToOne(relation) && relation.joinColumns[0] === column);
    const field = relationField?.field ?? (isSupportedColumn(column) ? columnToField(column) : undefined);
    if (!field) continue;
    entityFields.push(field);
    columnByName.set(field.name, column);
  }
  for (const { field, relation } of relations) if (!isToOne(relation)) entityFields.push(field);
  const byName = new Map(entityFields.map((field) => [field.name, field]));
  const versionField = metadata.columns.find((column) => column.isVersion && byName.has(column.propertyName))?.propertyName;
  for (const name of byName.keys()) {
    if (name.startsWith('_')) fail(`${entityName}.${name}: field names starting with "_" are reserved for the admin`);
  }

  const createDto = resource.form?.create;
  const updateDto = resource.form?.update ?? createDto;
  const writable = entityFields.filter((field) => !field.readonly).map((field) => field.name);
  const create = createDto ? dtoPropertyNames(createDto) : writable;
  const update = (updateDto ? dtoPropertyNames(updateDto) : writable).filter((name) => !primaryKeys.includes(name));

  const dtoOnly: FieldSchema[] = [];
  for (const [dto, names] of [[createDto, create], [updateDto, update]] as const) {
    for (const name of names) {
      const field = byName.get(name);
      if (field?.readonly) fail(`DTO property "${name}" maps to read-only column ${entityName}.${name}`);
      const nested = dto ? nestedTypeOf(dto, name) : undefined;
      if (field?.type === 'json' && nested) {
        // A json column written through a nested DTO is edited as a sub-form (or a list of them).
        const objectField: FieldSchema = { ...dtoObjectField(dto!, name, nested), persisted: true, nullable: field.nullable, label: field.label };
        entityFields[entityFields.indexOf(field)] = objectField;
        byName.set(name, objectField);
      }
      if (!field && dto && !dtoOnly.some((extra) => extra.name === name)) dtoOnly.push(nested ? dtoObjectField(dto, name, nested) : dtoOnlyField(dto, name));
    }
  }
  for (const field of dtoOnly) if (field.name.startsWith('_')) fail(`DTO property "${field.name}": names starting with "_" are reserved for the admin`);

  const requiredOnCreate = createDto
    ? create.filter((name) => !isDtoPropertyOptional(createDto, name) && !hasDtoInitializer(createDto, name))
    : writable.filter((name) => {
        const field = byName.get(name)!;
        const column = columnByName.get(name);
        return field.type !== 'relation' || field.relation!.kind === 'to-one'
          ? column !== undefined && !column.isNullable && column.default === undefined
          : false;
      });

  // Dotted paths (`customer.name`) named anywhere in `list` become read-only fields.
  const paths = new Map<string, FieldSchema>();
  const lookup = (setting: string, name: string): FieldSchema => {
    const field = byName.get(name) ?? paths.get(name);
    if (field) return field;
    if (name.includes('.')) {
      const resolved = resolvePath(metadata, name);
      if ('error' in resolved) {
        return resolved.error === 'unknown path'
          ? fail(`${setting}: unknown path "${name}" on ${entityName}${didYouMean(name, resolved.candidates)}`)
          : fail(`${setting}: cannot use "${name}" on ${entityName}: ${resolved.error}`);
      }
      const pathField = toPathField(name, resolved);
      paths.set(name, pathField);
      return pathField;
    }
    const renamed = relations.find(({ relation, field: candidate }) => relation.propertyName === name && candidate.name !== name);
    if (renamed) return fail(`${setting}: "${name}" is the relation; its field is "${renamed.field.name}" (paths use "${name}.<column>")`);
    return fail(`${setting}: unknown column "${name}" on ${entityName}${didYouMean(name, [...byName.keys()])}`);
  };
  const isSortable = (field: FieldSchema) => field.type !== 'json' && field.type !== 'relation' && field.type !== 'object';

  const columns: string[] =
    resource.list?.columns ??
    entityFields
      .filter((field) => field.type !== 'json' && field.type !== 'text' && field.type !== 'object' && field.relation?.kind !== 'to-many')
      .map((field) => field.name);
  if (columns.length === 0) fail('list.columns must name at least one column');
  for (const column of columns) lookup('list.columns', column);

  const rawSort: string = resource.list?.sort ?? `-${primaryKeys[0]}`;
  const direction: SortDirection = rawSort.startsWith('-') ? 'desc' : 'asc';
  const sortField = rawSort.replace(/^-/, '');
  const plainSortable = entityFields.filter(isSortable).map((field) => field.name);
  const sortTarget = byName.get(sortField) ?? (sortField.includes('.') ? lookup('list.sort', sortField) : undefined);
  if (!sortTarget || !isSortable(sortTarget)) return fail(`list.sort: cannot sort by "${sortField}"${didYouMean(sortField, plainSortable)}`);

  const editable: string[] = resource.list?.editable ?? [];
  for (const name of editable) {
    const field = byName.get(name) ?? dtoOnly.find((extra) => extra.name === name);
    if (!update.includes(name)) fail(`list.editable: "${name}" is not in the update form${didYouMean(name, update)}`);
    if (!field || !INLINE_EDITABLE.includes(field.type)) fail(`list.editable: "${name}" (${field?.type}) cannot be edited in a cell; use text, number, decimal, bigint, boolean, enum or date fields`);
  }
  for (const [setting, names] of [['list.columns', columns], ['list.filters', resource.list?.filters ?? []], ['list.search', resource.list?.search ?? []], ['list.editable', editable]] as const) {
    const repeated = names.find((name, index) => names.indexOf(name) !== index);
    if (repeated) fail(`${setting}: "${repeated}" is listed twice`);
  }

  const pageSize = resource.list?.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    fail(`list.pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }

  const filterNames: string[] =
    resource.list?.filters ?? entityFields.filter((field) => field.type === 'enum' || field.type === 'boolean').map((field) => field.name);
  const filters: FilterSchema[] = [];
  for (const name of filterNames) {
    const field = lookup('list.filters', name);
    const operators = operatorsFor(field);
    if (operators.length === 0) return fail(`list.filters: column "${name}" (${field.type}) cannot be filtered`);
    filters.push({ field: name, operators });
  }

  const search: string[] = resource.list?.search ?? entityFields.filter((field) => field.type === 'string').map((field) => field.name);
  for (const name of search) {
    const field = lookup('list.search', name);
    if (!SEARCHABLE_TYPES.includes(field.type)) return fail(`list.search: column "${name}" (${field.type}) is not a text column`);
  }

  // Keyset pages compare (sort, keys…) with the cursor, which needs a sort column that is never NULL.
  const pagination = resource.list?.pagination ?? 'offset';
  const keysetSortable = (name: string) => {
    const field = byName.get(name);
    return field !== undefined && isSortable(field) && !field.nullable && field.type !== 'text';
  };
  let sortable = [...plainSortable, ...[...paths.values()].filter(isSortable).map((field) => field.name)];
  if (pagination === 'keyset') {
    if (!keysetSortable(sortField)) fail(`list.sort: keyset lists sort by a non-nullable column, not "${sortField}"`);
    sortable = sortable.filter(keysetSortable);
  }

  const entityConstraints = (name: string, field = byName.get(name), column = columnByName.get(name)): FieldConstraints => {
    if (!field) return {};
    const constraints: FieldConstraints = {};
    const length = Number(column?.length);
    if ((field.type === 'string' || field.type === 'text') && Number.isInteger(length) && length > 0) constraints.maxLength = length;
    if (field.enumValues) constraints.oneOf = field.enumValues;
    if (field.integer) constraints.integer = true;
    if (field.type === 'uuid') constraints.format = 'uuid';
    return constraints;
  };
  const compile = (
    names: string[],
    dto: DtoClass | undefined,
    isRequired: (name: string, fromDto?: FieldConstraints) => boolean,
    childrenRequired: boolean,
  ) => {
    const fromDto = dto ? dtoConstraints(dto) : {};
    const out: Record<string, FieldConstraints> = {};
    for (const name of names) {
      // @ValidateIf: the server may skip every rule, so the browser checks none (entity-derived ones included)
      const merged: FieldConstraints = dto && isConditionalProperty(dto, name) ? {} : { ...entityConstraints(name), ...fromDto[name] };
      delete merged.required;
      if (isRequired(name, fromDto[name])) merged.required = true;
      out[name] = merged;
      const field = byName.get(name) ?? dtoOnly.find((extra) => extra.name === name);
      if (field?.type === 'object' && !(dto && isConditionalProperty(dto, name))) {
        addObjectConstraints(out, field, name, dto ? nestedTypeOf(dto, name)?.type : undefined, childrenRequired);
      }
    }
    return out;
  };
  /**
   * Constraints of the fields inside an object, keyed `address.city` (`lines.*.qty` for lists). A child is
   * required when its nested DTO says so, or, without one, when its column is NOT NULL without a default; on update
   * only a dedicated update DTO makes anything required (as for top-level fields).
   */
  const addObjectConstraints = (
    out: Record<string, FieldConstraints>,
    field: FieldSchema,
    path: string,
    nestedDto: DtoClass | undefined,
    childrenRequired: boolean,
  ) => {
    const fromDto = nestedDto ? dtoConstraints(nestedDto) : {};
    for (const child of field.fields ?? []) {
      const childPath = `${path}.${field.many ? '*.' : ''}${child.name}`;
      const columnPath = childPath.replace(/\.\*\./g, '.');
      const column = columnByPath.get(columnPath);
      const conditional = nestedDto !== undefined && isConditionalProperty(nestedDto, child.name);
      const merged: FieldConstraints = conditional ? {} : { ...entityConstraints(child.name, child, column), ...fromDto[child.name] };
      delete merged.required;
      const required = nestedDto
        ? fromDto[child.name]?.required === true
        : column !== undefined && !child.readonly && !column.isNullable && column.default === undefined;
      if (required && childrenRequired) merged.required = true;
      out[childPath] = merged;
      if (child.type === 'object') addObjectConstraints(out, child, childPath, nestedDto ? nestedTypeOf(nestedDto, child.name)?.type : undefined, childrenRequired);
    }
  };
  const dedicatedUpdateDto = resource.form?.update;
  const constraints = {
    create: compile(create, createDto, (name) => requiredOnCreate.includes(name), true),
    update: compile(update, updateDto, (_name, fromDto) => dedicatedUpdateDto !== undefined && fromDto?.required === true, dedicatedUpdateDto !== undefined),
  };

  return {
    name: definition.name ?? kebabCase(entityName),
    // The registry localizes labels per request; the schema keeps the plain (or first) one.
    label: typeof definition.label === 'string' ? definition.label : (Object.values(definition.label ?? {})[0] ?? humanize(entityName)),
    group: definition.group ?? moduleGroup,
    ...(definition.icon ? { icon: definition.icon } : {}),
    primaryKeys,
    creatable: children.length === 0,
    related: [], // filled in by the registry once every resource is known
    softDelete: metadata.columns.some((column) => column.isDeleteDate),
    ...(versionField ? { version: versionField } : {}),
    fields: [...entityFields, ...dtoOnly, ...paths.values()],
    list: {
      columns,
      sortable,
      defaultSort: { field: sortField, direction },
      pageSize,
      count: resource.list?.count ?? (pagination === 'keyset' ? 'none' : 'exact'),
      pagination,
      filters,
      search,
      editable,
    },
    form: { create, update, requiredOnCreate, constraints },
  };
}
