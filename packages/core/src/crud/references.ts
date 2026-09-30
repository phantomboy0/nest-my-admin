import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import type { FieldSchema, RelationRef } from '../contract.js';
import type { RegisteredResource, RelationMetadataLike, ResourceRegistry } from '../registry/resource-registry.js';
import { resolvePath, type RelationLike } from '../schema/relation-fields.js';
import { serializeValue } from './serialize.js';

export interface ReferenceSource {
  registry: ResourceRegistry;
  /** `ctx.manager` inside a write (so rows written by it are visible), the DataSource's manager otherwise. */
  manager: EntityManager;
}

/** Relation fields and dotted paths: the values `serializeRecord` takes from the reference loader. */
export function isLoadedField(field: FieldSchema): boolean {
  return field.type === 'relation' || field.name.includes('.');
}

/** Map key of a record: its primary key as text. */
export const recordKey = (id: unknown): string => String(id);

/**
 * Loads relation values (`RelationRef`s) and dotted path values of `fields` for `entities`, whatever the finder
 * that returned them loaded: one query joining every to-one relation needed, plus one query per many-to-many
 * field. Returns the values by `recordKey(primary key)`.
 */
export async function loadReferences(
  entry: RegisteredResource,
  entities: object[],
  fields: FieldSchema[],
  { registry, manager }: ReferenceSource,
): Promise<Map<string, Record<string, unknown>>> {
  const { metadata, schema } = entry;
  const ids = [...new Map(entities.map((entity) => [recordKey(read(entity, schema.primaryKey)), read(entity, schema.primaryKey)])).values()].filter(
    (id) => id !== null && id !== undefined,
  );
  const out = new Map(ids.map((id) => [recordKey(id), {} as Record<string, unknown>]));
  if (ids.length === 0) return out;

  const toRef = (field: FieldSchema, relation: RelationLike, target: object): RelationRef => {
    const targetMetadata = (relation as RelationMetadataLike).inverseEntityMetadata;
    const id = read(target, targetMetadata.primaryColumns[0]!.propertyName);
    return { id: idValue(id, field), title: registry.titleFor(targetMetadata, entry.dataSource)(target) };
  };
  const query = (): SelectQueryBuilder<any> => manager.getRepository(metadata.target).createQueryBuilder('ref').whereInIds(ids);

  const toOne: Array<{ field: FieldSchema; relation: RelationLike }> = [];
  const paths: Array<{ field: FieldSchema; relations: RelationLike[]; column: string }> = [];
  for (const field of fields) {
    const relation = entry.relations.get(field.name);
    if (relation && field.relation?.kind === 'to-one') toOne.push({ field, relation });
    if (field.name.includes('.')) {
      const resolved = resolvePath(metadata, field.name);
      if (!('error' in resolved)) paths.push({ field, relations: resolved.relations, column: resolved.column.propertyName });
    }
  }

  if (toOne.length > 0 || paths.length > 0) {
    const qb = query();
    for (const relations of [...toOne.map(({ relation }) => [relation]), ...paths.map(({ relations }) => relations)]) {
      joinAndSelect(qb, relations);
    }
    for (const row of await qb.getMany()) {
      const values = out.get(recordKey(read(row, schema.primaryKey)));
      if (!values) continue;
      for (const { field, relation } of toOne) {
        const target = read(row, relation.propertyName);
        values[field.name] = isObject(target) ? toRef(field, relation, target) : null;
      }
      for (const { field, relations, column } of paths) {
        let current: unknown = row;
        for (const relation of relations) current = isObject(current) ? read(current, relation.propertyName) : undefined;
        values[field.name] = serializeValue(isObject(current) ? read(current, column) : null, field);
      }
    }
  }

  for (const field of fields) {
    const relation = entry.relations.get(field.name);
    if (!relation || field.relation?.kind !== 'to-many') continue;
    const targetKey = relation.inverseEntityMetadata.primaryColumns[0]!.propertyName;
    const rows = await query()
      .leftJoinAndSelect(`ref.${relation.propertyName}`, 'ref_many')
      .orderBy(`ref_many.${targetKey}`, 'ASC')
      .getMany();
    for (const row of rows) {
      const values = out.get(recordKey(read(row, schema.primaryKey)));
      const targets = read(row, relation.propertyName);
      if (values) values[field.name] = Array.isArray(targets) ? targets.map((target: object) => toRef(field, relation, target)) : [];
    }
  }
  return out;
}

/** Like `ensureJoins`, selecting each joined entity (aliases `ref_<relation>`, `ref_<relation>_<relation>`, …). */
function joinAndSelect(qb: SelectQueryBuilder<any>, relations: RelationLike[]): void {
  let alias = qb.alias;
  for (const relation of relations) {
    const next = `${alias}_${relation.propertyName}`;
    if (!qb.expressionMap.aliases.some((existing) => existing.name === next)) qb.leftJoinAndSelect(`${alias}.${relation.propertyName}`, next);
    alias = next;
  }
}

/** Ids keep the target key's type; bigints are strings whatever the driver returned (like `serializeValue`). */
export function idValue(id: unknown, field: FieldSchema): string | number {
  if (field.relation?.idType === 'number') return Number(id);
  return String(id);
}

function read(entity: object, property: string): unknown {
  return (entity as Record<string, unknown>)[property];
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
