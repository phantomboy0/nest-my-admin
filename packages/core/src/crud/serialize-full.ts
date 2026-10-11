import type { EntityManager } from 'typeorm';
import type { FieldSchema } from '../contract.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import { recordIdOf } from './record-id.js';
import { loadReferences } from './references.js';
import { serializeRecord } from './serialize.js';

/**
 * The fields of a record as they are stored, whoever asks: every persisted field of the resource's schema but
 * dotted paths, the discriminator (it is the record's class, and never changes) and the columns TypeORM maintains
 * on every save (update date, version).
 */
export function storedFields(entry: RegisteredResource): FieldSchema[] {
  const { metadata, schema } = entry;
  const skipped = new Set(metadata.columns.filter((column) => column.isUpdateDate || column.isVersion || column.isDiscriminator).map((column) => column.propertyName));
  return schema.fields.filter((field) => field.persisted && !field.name.includes('.') && !skipped.has(field.name));
}

/**
 * Everything stored about one record, with no permission applied (no field rule, no scope, no masked title): the
 * `storedFields` serialized like any record (`serializeRecord`: decimals and bigints as strings, dates as ISO
 * text), a related record as its id and a many-to-many as its ids (read from the database, also when the record or
 * its target is in the trash), a file field as the keys its column holds. What `AdminApiService.records` answers
 * is the same serialization, cut to the user's view and decorated; this one is for the audit log, never for a
 * response.
 */
export async function serializeFull(entry: RegisteredResource, entity: object, manager: EntityManager): Promise<Record<string, unknown>> {
  const fields = storedFields(entry);
  const relations = fields.filter((field) => field.type === 'relation');
  const refs = relations.length > 0 ? (await loadReferences(entry, [entity], relations, { manager, withDeleted: true })).get(recordIdOf(entity, entry.schema.primaryKeys)) : undefined;
  const id = (ref: unknown): unknown => (typeof ref === 'object' && ref !== null && 'id' in ref ? ref.id : ref);
  const ids = Object.fromEntries(Object.entries(refs ?? {}).map(([name, value]) => [name, Array.isArray(value) ? value.map(id) : id(value)]));
  // A relation the database no longer answers for (the row is gone) is null, not missing.
  for (const field of relations) if (!Object.hasOwn(ids, field.name)) ids[field.name] = field.relation?.kind === 'to-many' ? [] : null;
  return serializeRecord(entity, fields, ids);
}
