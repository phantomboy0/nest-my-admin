import type { EntityManager } from 'typeorm';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { RecordId } from '../resource/admin-resource-base.js';

/** A record id as a `where` on the primary key columns. */
export const whereOf = (entry: RegisteredResource, id: RecordId): Record<string, unknown> => (typeof id === 'object' ? id : { [entry.schema.primaryKeys[0]!]: id });

/** The primary key of an entity. */
export const keyOf = (entry: RegisteredResource, entity: object): RecordId => Object.fromEntries(entry.schema.primaryKeys.map((key) => [key, (entity as Record<string, unknown>)[key]])) as RecordId;

/** The stored row, in the trash or not, whoever asks: no scope, no `query()`, no `findOne` override. */
export async function loadStored(entry: RegisteredResource, id: RecordId, manager: EntityManager): Promise<object | undefined> {
  const where = whereOf(entry, id);
  if (Object.values(where).some((value) => value === undefined || value === null)) return undefined;
  return ((await manager.getRepository(entry.metadata.target).findOne({ where, withDeleted: true })) as object | null) ?? undefined;
}
