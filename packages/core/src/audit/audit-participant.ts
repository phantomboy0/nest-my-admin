import type { EntityManager } from 'typeorm';
import type { FieldSchema } from '../contract.js';
import type { WriteChange, WriteParticipant } from '../api/write-participant.js';
import { recordIdOf } from '../crud/record-id.js';
import { serializeFull, storedFields } from '../crud/serialize-full.js';
import type { RegisteredAction } from '../decorators/admin-action.js';
import type { RegisteredPage } from '../pages/page-registry.js';
import { pick } from '../pages/page.service.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { RecordId } from '../resource/admin-resource-base.js';
import { sensitiveFields } from '../schema/field-config.js';
import type { AdminAudit, AuditInput } from './audit.service.js';
import { diffRecords } from './diff.js';

/** What the audit log keeps of one change between the host method's start and the entry. */
interface AuditState {
  /** The record (or the page's values) as stored before the host method ran. */
  before?: Record<string, unknown>;
  recordId?: string;
  title?: string;
  /** The entry, when it cannot share the change's transaction: written once that has committed. */
  pending?: AuditInput;
}

const EVENTS = { create: 'created', update: 'updated', delete: 'deleted', restore: 'restored', purge: 'purged' } as const;

/**
 * The audit log as a participant of every write (after files). "Before" is read and serialized ahead of the host
 * method, which may change the entity it is handed; "after" is read back from the database once it has returned,
 * so what the host computed on its own is recorded too. Both are the full stored record (`serializeFull`),
 * whatever the actor may see, and the payload that was sent is never looked at.
 *
 * The entry is written in the change's transaction when the audit table is on the same DataSource, so the two
 * commit or roll back together; on another DataSource it is written once the change has committed; without
 * transactions, once the host method has returned. A change that fails writes none.
 */
export function auditParticipant(audit: AdminAudit): WriteParticipant<AuditState> {
  return {
    async before(change, tx) {
      const { target } = change;
      if (!('schema' in target)) return { before: pageValues(target, change.existing) };
      const manager = tx.manager ?? target.dataSource.manager;
      // The stored row, read here: like "after", so the two compare column for column whatever the resource's
      // `findOne` selected, and the entity the host method is handed (and may change) is never the one serialized.
      // A purge is not handed its record at all: this reads it, from the trash if need be.
      const key = change.id ?? (change.existing ? keyOf(target, change.existing) : undefined);
      const reads = change.existing !== undefined || change.kind === 'purge';
      const existing = reads && key !== undefined ? ((await load(target, key, manager)) ?? change.existing) : change.existing;
      if (!existing) return {};
      return { before: await serializeFull(target, existing, manager), recordId: recordIdOf(existing, target.schema.primaryKeys), title: titleOf(target, existing) };
    },

    async after(change, state, saved, tx) {
      const { target } = change;
      const input = 'schema' in target ? await recordEntry(target, change, state, saved, tx.manager ?? target.dataSource.manager) : pageEntry(target, state, saved);
      if (!input) return;
      if (audit.joins(tx)) await audit.record(input, tx);
      else if (tx.manager) state.pending = input;
      else await audit.recordAfter(input, tx);
    },

    async onCommit(_change, state, tx) {
      if (state.pending) await audit.recordAfter(state.pending, tx);
    },
  };
}

const whereOf = (entry: RegisteredResource, id: RecordId): Record<string, unknown> => (typeof id === 'object' ? id : { [entry.schema.primaryKeys[0]!]: id });

const keyOf = (entry: RegisteredResource, entity: object): RecordId => Object.fromEntries(entry.schema.primaryKeys.map((key) => [key, (entity as Record<string, unknown>)[key]])) as RecordId;

/**
 * The record's real title, unless it may hold a sensitive value, which is never stored, here either: the title is a
 * sensitive field, or it is a function (which may put any field into it) on a resource that has sensitive fields.
 */
function titleOf(entry: RegisteredResource, entity: object): string | undefined {
  const sensitive = sensitiveFields(entry.fieldConfig);
  const column = entry.title.column;
  return (column === undefined ? sensitive.size > 0 : sensitive.has(column)) ? undefined : entry.title(entity);
}

/**
 * The stored image with the columns of an entity the host method answered (or was handed) on top. For when the
 * image read back equals "before" although the host changed the record: a host service that ignores `ctx.manager`
 * writes on another connection, and under MySQL's REPEATABLE READ the admin's transaction keeps reading the
 * snapshot of its first read (the "before" image), so it never sees that commit. No locking read is used; the
 * entity is the only witness. Only the columns it carries are taken (it may be partial), and relations stay as
 * read from the database.
 */
async function withReturned(entry: RegisteredResource, entity: object, image: Record<string, unknown>, fields: FieldSchema[], manager: EntityManager): Promise<Record<string, unknown>> {
  const returned = await serializeFull(entry, entity, manager);
  const merged = { ...image };
  for (const field of fields) {
    if (field.type !== 'relation' && (entity as Record<string, unknown>)[field.name] !== undefined) merged[field.name] = returned[field.name];
  }
  return merged;
}

/** The stored row, in the trash or not, whoever asks: no scope, no `query()`, no `findOne` override. */
async function load(entry: RegisteredResource, id: RecordId, manager: EntityManager): Promise<object | undefined> {
  const where = whereOf(entry, id);
  if (Object.values(where).some((value) => value === undefined || value === null)) return undefined;
  return ((await manager.getRepository(entry.metadata.target).findOne({ where, withDeleted: true })) as object | null) ?? undefined;
}

/** The entry of a record change, or nothing when an update changed no field. */
async function recordEntry(entry: RegisteredResource, change: WriteChange, state: AuditState, saved: object | null | undefined, manager: EntityManager): Promise<AuditInput | undefined> {
  const name = entry.schema.name;
  const { action } = change;
  if (change.kind === 'action' && action && state.recordId === undefined) {
    // A resource action: no record, only that it ran and with what.
    return { event: `${name}.action.${action.definition.name}`, entry, meta: actionMeta(action.definition, action.input) };
  }
  const fields = storedFields(entry);
  const masked = sensitiveFields(entry.fieldConfig);
  const removes = change.kind === 'delete' || change.kind === 'purge';
  // What is stored now, read back: a host method may answer nothing, or an entity from before it finished.
  const known = change.id ?? (change.existing ? keyOf(entry, change.existing) : saved ? keyOf(entry, saved) : undefined);
  const stored = known !== undefined ? await load(entry, known, manager) : undefined;
  const current = removes ? undefined : (stored ?? saved ?? undefined);
  const after = current ? await serializeFull(entry, current, manager) : undefined;
  // The record is gone for good when no row is left, trash included: whatever the event's name and the resource's
  // trash say (a delete where there is no trash, a purge, a host `delete()` that does not use the trash). The entry
  // that says so ends the record's history: a later record with the same key is another record (`AuditReader`).
  const ended = removes && known !== undefined && !stored ? { deleted: true as const } : undefined;
  const recordId = current ? recordIdOf(current, entry.schema.primaryKeys) : (state.recordId ?? (change.id !== undefined ? recordIdOf(whereOf(entry, change.id), entry.schema.primaryKeys) : undefined));
  const title = current ? titleOf(entry, current) : state.title;
  const record = { entry, ...(recordId !== undefined ? { recordId } : {}), ...(title !== undefined ? { title } : {}) };

  /** What differs from "before"; when nothing does, what the entities the host answered say (see `withReturned`). */
  const changed = async (...witnesses: Array<object | null | undefined>) => {
    let changes = diffRecords(state.before, after, fields, masked);
    for (const witness of witnesses) {
      if (changes.length > 0 || !state.before || !after) break;
      if (witness) changes = diffRecords(state.before, await withReturned(entry, witness, after, fields, manager), fields, masked);
    }
    return changes;
  };

  if (change.kind === 'action' && action) {
    const changes = await changed(saved, change.existing);
    return { ...record, event: `${name}.action.${action.definition.name}`, changes, meta: { ...actionMeta(action.definition, action.input), ...(after ? {} : { deleted: true as const }) } };
  }
  if (change.kind === 'action' || change.kind === 'page') return undefined;
  const event = `${name}.${EVENTS[change.kind]}`;
  if (change.kind === 'restore') return { ...record, event, changes: [] };
  if (removes) return { ...record, event, changes: diffRecords(state.before, undefined, fields, masked), ...(ended ? { meta: ended } : {}) };
  if (!after) return undefined;
  const changes = change.kind === 'create' ? diffRecords(undefined, after, fields, masked) : await changed(saved);
  // A save that changed nothing is no entry.
  return change.kind === 'update' && changes.length === 0 ? undefined : { ...record, event, changes };
}

/** `meta` of an action's entry: its name, and the input that was validated, as plain JSON without its sensitive keys. */
function actionMeta(action: RegisteredAction, input: object): { action: string; input?: Record<string, unknown> } {
  if (!action.form) return { action: action.name };
  const hidden = sensitiveFields(action.form.config);
  const kept: Record<string, unknown> = {};
  for (const field of action.form.fields) {
    const value = (input as Record<string, unknown>)[field.name];
    if (!hidden.has(field.name) && value !== undefined) kept[field.name] = value;
  }
  return { action: action.name, input: JSON.parse(JSON.stringify(kept)) as Record<string, unknown> };
}

/**
 * The values of a page's own fields (whatever else `load()` answers is no field), copied so the host's `save()`
 * cannot change them afterwards. Secrets and sensitive fields are here only to be compared: `diffRecords` masks them.
 */
function pageValues(page: RegisteredPage, stored: object | undefined): Record<string, unknown> {
  const source = (stored ?? {}) as Record<string, unknown>;
  const masked = sensitiveFields(page.form.config);
  const values = Object.fromEntries(page.form.fields.map((field) => [field.name, masked.has(field.name) ? (source[field.name] ?? null) : pick(field, source[field.name])]));
  try {
    return structuredClone(values);
  } catch {
    return values;
  }
}

function pageEntry(page: RegisteredPage, state: AuditState, saved: object | null | undefined): AuditInput | undefined {
  if (!saved) return undefined;
  const changes = diffRecords(state.before ?? {}, pageValues(page, saved), page.form.fields, sensitiveFields(page.form.config));
  return changes.length === 0 ? undefined : { event: `page.${page.name}.updated`, changes, meta: { page: page.name } };
}
