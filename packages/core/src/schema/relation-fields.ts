import type { FieldSchema, RelationSchema } from '../contract.js';
import { columnToField, fieldTypeOf, isSupportedColumn, type ColumnLike } from './column-field.js';
import { humanize } from './humanize.js';

/** The subset of TypeORM's EntityMetadata that relation handling reads. */
export interface RelatedMetadataLike {
  name: string;
  target: Function | string;
  /** `entity-child` for a child of a single-table inheritance. */
  tableType?: string;
  discriminatorValue?: string;
  /** Children of a single-table inheritance root. */
  childEntityMetadatas?: Array<{ target: Function | string; discriminatorValue?: string }>;
  columns: ColumnLike[];
  primaryColumns: ColumnLike[];
  relations: RelationLike[];
}

/** The subset of TypeORM's RelationMetadata that relation handling reads. */
export interface RelationLike {
  propertyName: string;
  relationType: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  isOwning: boolean;
  isLazy: boolean;
  joinColumns: ColumnLike[];
  inverseEntityMetadata: RelatedMetadataLike;
}

export interface RelationField {
  field: FieldSchema;
  relation: RelationLike;
}

const ID_TYPES = { number: 'number', bigint: 'bigint', string: 'string', text: 'string', uuid: 'uuid' } as const;

function idTypeOf(target: RelatedMetadataLike): RelationSchema['idType'] | undefined {
  if (target.primaryColumns.length !== 1) return undefined;
  return ID_TYPES[fieldTypeOf(target.primaryColumns[0]!.type) as keyof typeof ID_TYPES];
}

export function isToOne(relation: RelationLike): boolean {
  return relation.relationType === 'many-to-one' || (relation.relationType === 'one-to-one' && relation.isOwning);
}

/**
 * Relations the admin edits: many-to-one and owning one-to-one with one join column, and owning many-to-many,
 * to an entity with one primary column (lazy relations included). Everything else is not a field (yet).
 */
export function isSupportedRelation(relation: RelationLike): boolean {
  if (idTypeOf(relation.inverseEntityMetadata) === undefined) return false;
  if (isToOne(relation)) return relation.joinColumns.length === 1;
  return relation.relationType === 'many-to-many' && relation.isOwning;
}

/**
 * The name of a relation's field: the property that holds the id (`customer`, or `customerId` when the entity
 * declares that column next to the relation) for to-one relations, the relation property for many-to-many.
 */
export function relationFieldName(relation: RelationLike): string {
  return isToOne(relation) ? relation.joinColumns[0]!.propertyName : relation.propertyName;
}

export function relationFields(metadata: RelatedMetadataLike): RelationField[] {
  return metadata.relations.filter(isSupportedRelation).map((relation) => {
    const target = relation.inverseEntityMetadata;
    const idField = columnToField(target.primaryColumns[0]!);
    const toOne = isToOne(relation);
    const field: FieldSchema = {
      name: relationFieldName(relation),
      label: humanize(relation.propertyName),
      type: 'relation',
      nullable: toOne ? relation.joinColumns[0]!.isNullable : true,
      primary: false,
      readonly: false,
      persisted: true,
      relation: { kind: toOne ? 'to-one' : 'to-many', idType: idTypeOf(target)! },
    };
    if (idField.integer) field.integer = true;
    return { field, relation };
  });
}

export interface ResolvedPath {
  /** The to-one relations the path walks through, in order. */
  relations: RelationLike[];
  /** The column at the end of the path. */
  column: ColumnLike;
}

export const MAX_PATH_SEGMENTS = 3;

/** Columns a path may end at: plain and embedded columns (not join columns). */
const isPathColumn = (column: ColumnLike) => column.isSelect && !column.relationMetadata;
const pathOf = (column: ColumnLike) => column.propertyPath ?? column.propertyName;

/**
 * Resolves `customer.company.name` or `address.city`: leading segments walk supported to-one relations, the rest
 * is a column of the entity reached, embedded columns included (`address.city`). Returns an explanation instead when
 * the path is not usable.
 */
export function resolvePath(metadata: RelatedMetadataLike, path: string): ResolvedPath | { error: string; candidates: string[] } {
  const segments = path.split('.');
  if (segments.length > MAX_PATH_SEGMENTS) return { error: `paths have at most ${MAX_PATH_SEGMENTS} segments`, candidates: [] };
  const relations: RelationLike[] = [];
  let current = metadata;
  let prefix = '';
  for (let index = 0; index < segments.length; index++) {
    const rest = segments.slice(index).join('.');
    const column = current.columns.find((candidate) => isPathColumn(candidate) && pathOf(candidate) === rest);
    if (column) return { relations, column };
    const segment = segments[index]!;
    const relation = current.relations.find((candidate) => candidate.propertyName === segment);
    const toOne = current.relations.filter((candidate) => isSupportedRelation(candidate) && isToOne(candidate));
    if (relation && !toOne.includes(relation) && index < segments.length - 1) {
      return { error: `"${prefix}${segment}" is not a many-to-one or owning one-to-one relation`, candidates: [] };
    }
    if (!relation || index === segments.length - 1) {
      const candidates = [
        ...current.columns.filter(isPathColumn).map((candidate) => `${prefix}${pathOf(candidate)}`),
        ...toOne.map((candidate) => `${prefix}${candidate.propertyName}.${firstColumn(candidate)}`),
      ];
      return { error: 'unknown path', candidates };
    }
    relations.push(relation);
    current = relation.inverseEntityMetadata;
    prefix += `${segment}.`;
  }
  return { error: 'unknown path', candidates: [] };
}

function firstColumn(relation: RelationLike): string {
  const columns = relation.inverseEntityMetadata.columns.filter(isSupportedColumn);
  return (columns.find((column) => !column.isPrimary) ?? columns[0])?.propertyName ?? 'id';
}

/** Schema of a read-only dotted path: the target column's type, labelled "Customer name". */
export function pathField(path: string, resolved: ResolvedPath): FieldSchema {
  const field = columnToField(resolved.column);
  return { ...field, name: path, label: humanize(path.replace(/\./g, ' ')), primary: false, readonly: true };
}
