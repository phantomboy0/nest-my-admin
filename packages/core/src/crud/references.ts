import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import type { FieldSchema, RelationRef } from '../contract.js';
import type { RegisteredResource, RelationMetadataLike, ResourceRegistry } from '../registry/resource-registry.js';
import { resolvePath, type RelationLike } from '../schema/relation-fields.js';
import { recordIdOf } from './record-id.js';
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


/**
 * Loads relation values (`RelationRef`s) and dotted path values of `fields` for `entities`, whatever the finder
 * that returned them loaded: one query joining every to-one relation needed, plus one query per many-to-many
 * field. Returns the values by `_id` (`recordIdOf`).
 */
export async function loadReferences(
  entry: RegisteredResource,
  entities: object[],
  fields: FieldSchema[],
  { registry, manager }: ReferenceSource,
): Promise<Map<string, Record<string, unknown>>> {
  const { metadata, schema } = entry;
  const keys = schema.primaryKeys;
  const keyOf = (entity: object) => (keys.length === 1 ? read(entity, keys[0]!) : Object.fromEntries(keys.map((key) => [key, read(entity, key)])));
  const byId = new Map<string, unknown>();
  for (const entity of entities) {
    if (keys.every((key) => read(entity, key) !== null && read(entity, key) !== undefined)) byId.set(recordIdOf(entity, keys), keyOf(entity));
  }
  const ids = [...byId.values()];
  const out = new Map([...byId.keys()].map((id) => [id, {} as Record<string, unknown>]));
  if (ids.length === 0) return out;

  const toRef = (field: FieldSchema, relation: RelationLike, target: object): RelationRef =>
    relationRef(field, relation, target, registry.titleFor((relation as RelationMetadataLike).inverseEntityMetadata, entry.dataSource));
  const query = (): SelectQueryBuilder<any> => manager.getRepository(metadata.target).createQueryBuilder('ref').whereInIds(ids);

  const toOne: Array<{ field: FieldSchema; relation: RelationLike }> = [];
  const paths: Array<{ field: FieldSchema; relations: RelationLike[]; column: string[] }> = [];
  for (const field of fields) {
    const relation = entry.relations.get(field.name);
    if (relation && field.relation?.kind === 'to-one') toOne.push({ field, relation });
    if (field.name.includes('.')) {
      const resolved = resolvePath(metadata, field.name);
      if (!('error' in resolved)) {
        paths.push({ field, relations: resolved.relations, column: (resolved.column.propertyPath ?? resolved.column.propertyName).split('.') });
      }
    }
  }

  if (toOne.length > 0 || paths.length > 0) {
    const qb = query();
    for (const relations of [...toOne.map(({ relation }) => [relation]), ...paths.map(({ relations }) => relations)]) {
      joinAndSelect(qb, relations);
    }
    for (const row of await qb.getMany()) {
      const values = out.get(recordIdOf(row, keys));
      if (!values) continue;
      for (const { field, relation } of toOne) {
        const target = read(row, relation.propertyName);
        values[field.name] = isObject(target) ? toRef(field, relation, target) : null;
      }
      for (const { field, relations, column } of paths) {
        let current: unknown = row;
        for (const property of [...relations.map((relation) => relation.propertyName), ...column]) {
          current = isObject(current) ? read(current, property) : undefined;
        }
        values[field.name] = serializeValue(current ?? null, field);
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
      const values = out.get(recordIdOf(row, keys));
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

/** A related record as `{ id, title }`. */
export function relationRef(field: FieldSchema, relation: RelationLike, target: object, title: (entity: object) => string): RelationRef {
  const id = read(target, relation.inverseEntityMetadata.primaryColumns[0]!.propertyName);
  return { id: idValue(id, field), title: title(target) };
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
