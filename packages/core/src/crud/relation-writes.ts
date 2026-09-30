import type { FieldSchema, ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import { isToOne, relationFields, type RelatedMetadataLike } from '../schema/relation-fields.js';
import { parseId } from './list-query.js';

export type RelationId = string | number;

/** Most ids one many-to-many value may hold. */
export const MAX_RELATION_IDS = 1000;

function checkId(value: unknown, field: FieldSchema): { value: RelationId } | { error: string } {
  const idType = field.relation!.idType;
  const allowed = idType === 'number' ? typeof value === 'number' : idType === 'bigint' ? typeof value === 'number' || typeof value === 'string' : typeof value === 'string';
  if (!allowed) return { error: idType === 'uuid' ? 'must be an id (a UUID)' : idType === 'string' ? 'must be an id (a string)' : 'must be an id (an integer)' };
  const parsed = parseId(field, String(value));
  if ('error' in parsed) return parsed;
  return { value: idType === 'uuid' ? String(parsed.value).toLowerCase() : parsed.value };
}

/**
 * Checks the relation values of a validated write body (ids of the target key's type, `null` only when the field is
 * nullable, arrays of at most MAX_RELATION_IDS ids for many-to-many) and returns the ids sent per relation field,
 * duplicates removed, for the existence check. Throws AdminValidationError naming the fields.
 */
export function relationIdsOf(body: object, schema: ResourceSchema): Map<string, RelationId[]> {
  const input = body as Record<string, unknown>;
  const errors: Record<string, string[]> = {};
  const ids = new Map<string, RelationId[]>();
  for (const field of schema.fields) {
    if (field.type !== 'relation' || !Object.hasOwn(input, field.name)) continue;
    const value = input[field.name];
    if (field.relation!.kind === 'to-one') {
      if (value === null) {
        if (!field.nullable) errors[field.name] = ['is required'];
        continue;
      }
      const checked = checkId(value, field);
      if ('error' in checked) errors[field.name] = [checked.error];
      else ids.set(field.name, [checked.value]);
      continue;
    }
    if (!Array.isArray(value)) {
      errors[field.name] = ['must be a list of ids'];
      continue;
    }
    if (value.length > MAX_RELATION_IDS) {
      errors[field.name] = [`must hold at most ${MAX_RELATION_IDS} ids`];
      continue;
    }
    const unique = new Map<string, RelationId>();
    for (const item of value) {
      const checked = checkId(item, field);
      if ('error' in checked) {
        errors[field.name] = [checked.error.replace('must be an id', 'must contain only ids')];
        break;
      }
      unique.set(String(checked.value), checked.value);
    }
    if (!errors[field.name]) ids.set(field.name, [...unique.values()]);
  }
  if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
  return ids;
}

/**
 * Turns relation ids in a DTO into what TypeORM saves: `{ customer: 3 }` → `{ customer: { id: 3 } }` and
 * `{ tags: ['a'] }` → `{ tags: [{ id: 'a' }] }`. An explicit id column (`sellerId`) is a column and stays as it is.
 * Used by the default create/update; host services get the ids as validated.
 */
export function toRelationReferences(dto: object, metadata: RelatedMetadataLike): object {
  const out: Record<string, unknown> = { ...dto };
  for (const { field, relation } of relationFields(metadata)) {
    if (!Object.hasOwn(out, field.name) || field.name !== relation.propertyName) continue;
    const key = relation.inverseEntityMetadata.primaryColumns[0]!.propertyName;
    const value = out[field.name];
    if (isToOne(relation)) out[field.name] = value === null || value === undefined ? value : { [key]: value };
    else if (Array.isArray(value)) out[field.name] = value.map((id) => ({ [key]: id }));
  }
  return out;
}
