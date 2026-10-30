import type { EntityManager } from 'typeorm';
import type { FieldSchema } from '../contract.js';
import type { StoredRow, WriteChange, WriteParticipant } from '../api/write-participant.js';
import { SINGLE_CONNECTION_DRIVERS } from '../api/write-queue.js';
import { recordIdOf } from '../crud/record-id.js';
import { serializeFull, storedFields } from '../crud/serialize-full.js';
import { keyOf, loadStored, whereOf } from '../crud/stored-row.js';
import type { RegisteredAction } from '../decorators/admin-action.js';
import type { RegisteredPage } from '../pages/page-registry.js';
import { pick } from '../pages/page.service.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { RecordId } from '../resource/admin-resource-base.js';
import { sensitiveFields } from '../schema/field-config.js';
import type { AdminAudit, AuditInput } from './audit.service.js';
import { diffRecords } from './diff.js';
import { inAdminTransaction } from '../resource/admin-context.js';

/** What the audit log keeps of one change between the host method's start and the entry. */
interface AuditState {
  /** The record (or the page's values) as stored before the host method ran. */
  before?: Record<string, unknown>;
  recordId?: string;
  title?: string;
  /** The entry, when it cannot share the change's transaction: written once that has committed. */
  pending?: AuditInput;
  /** The id of the entry written in the change's transaction. */
  entryId?: number;
  /** A delete whose row the transaction still reads, untrashed: the key to read again once it has committed (`unsure`). */
  recheck?: RecordId;
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
 *
 * After commit, and only then (the write's connection is back in the pool, so a pool of one is enough), a delete
 * that seemed to leave its row is checked once more (`unsure`, `onCommit`). That check never fails the write.
 *
 * Whether the record is gone after the host method is read once per change by the write itself
 * (`WriteRunner.change`, `StoredRow`): the files participant releases the record's files on the same answer.
 *
 * What these reads cannot know:
 *
 * - the check after commit reads a moment later than the commit: a key that was deleted on another connection and
 *   given again in between is read as "still there", and the delete's entry stays unstamped;
 * - a crash between the commit and that check, or a read or an update that fails in it, leaves the entry
 *   unstamped (the failures are logged);
 * - reads that are not in a transaction go through `dataSource.manager`: the check after commit, and with
 *   `transactions: false` the "before" and "after" images too. With TypeORM replication those may be answered by
 *   a replica: one that lags still shows a row that was deleted (no stamp), or shows an update's "after" equal to
 *   its "before" (diffed as unchanged: fewer changes, or no entry at all).
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
      const existing = reads && key !== undefined ? ((await loadStored(target, key, manager)) ?? change.existing) : change.existing;
      if (!existing) return {};
      return { before: await serializeFull(target, existing, manager), recordId: recordIdOf(existing, target.schema.primaryKeys), title: titleOf(target, existing) };
    },

    async after(change, state, saved, tx, row) {
      const { target } = change;
      // A resource action names no record: there is no row to read.
      const named = 'schema' in target && !(change.kind === 'action' && state.recordId === undefined);
      const entry = 'schema' in target ? await recordEntry(target, change, state, saved, named ? await row() : { gone: false }, tx.manager ?? target.dataSource.manager) : pageEntry(target, state, saved);
      if (!entry) return;
      // A child saved inline with its parent says which parent (the parent's History can list it later).
      const input = change.parent ? { ...entry, meta: { ...entry.meta, parent: change.parent } } : entry;
      if (audit.joins(tx)) state.entryId = await audit.record(input, tx);
      else if (inAdminTransaction(tx)) state.pending = input;
      else await audit.recordAfter(input, tx);
    },

    async onCommit(change, state, tx) {
      const { target } = change;
      const { pending, entryId, recheck } = state;
      // What is committed now, on the DataSource's own manager. A read that fails is logged and stamps nothing.
      const event = 'schema' in target ? `${target.schema.name}.deleted` : '';
      const ended = 'schema' in target && recheck !== undefined && (pending !== undefined || entryId !== undefined) && (await audit.leftNoRow(event, tx, () => loadStored(target, recheck, target.dataSource.manager)));
      // The entry is in the table, but the insert answered no id to find it by: nothing to stamp, and that is said.
      if ('schema' in target && recheck !== undefined && pending === undefined && entryId === undefined) audit.unstamped(event, tx);
      // An entry that waited for the commit is written with the stamp; one that is in the table already gets it now.
      if (pending) await audit.recordAfter(ended ? { ...pending, meta: { ...pending.meta, deleted: true } } : pending, tx);
      else if (ended && entryId !== undefined) await audit.stampDeleted(entryId, event, tx);
    },
  };
}

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

/**
 * Whether a delete that still reads its row cannot tell yet that the record is there. `stored` is what the write's
 * own manager read back, and it is not in the trash: either the host kept the record (an archive flag, a refusal
 * it swallowed), or a host service deleted it on another connection, which the admin's transaction cannot see
 * under MySQL's REPEATABLE READ (its snapshot is of its first read). Only once the transaction has committed can
 * another read tell, on the DataSource's own manager (`onCommit`): never before, when it would take a second
 * connection from the pool while the write holds one. Not where one connection would read the same twice
 * (`SINGLE_CONNECTION_DRIVERS`), and not without a transaction (`transactions: false`): there is no snapshot, and
 * the read after the host method returned is already current.
 */
function unsure(entry: RegisteredResource, stored: object, manager: EntityManager): boolean {
  const trash = entry.metadata.deleteDateColumn;
  if (trash && trash.getEntityValue(stored) != null) return false;
  return manager !== entry.dataSource.manager && !SINGLE_CONNECTION_DRIVERS.has(entry.dataSource.options.type);
}

/**
 * The entry of a record change, or nothing when an update changed no field.
 *
 * An entry that ends its record is stamped `meta.deleted`, and `AuditReader` closes the record's history there (a
 * later record with the same key is another record). Which entries are stamped:
 *
 * - every purge: it is for good by definition, whatever is read back (the host may delete on another connection,
 *   or later). A host `purge()` that keeps the row cuts its history all the same: what was recorded before the
 *   purge is then read as a gone record's (and the record's files are released: see `filesParticipant`);
 * - a delete after which no row is left: where there is no trash, or by a host `delete()` that does not use it.
 *   When the transaction still reads the row, untrashed, the stamp is added right after commit if the row is gone
 *   by then (`unsure`). The trash is no end, and neither is a `delete()` that leaves the row where it was;
 * - an action after which the write's own manager finds no row. That read alone decides, never what the host's
 *   `findOne` answered afterwards (`saved`), which may come from a cache or from another connection.
 *
 * What gets no stamp, so that a key given again reopens the earlier entries: a delete (not a purge) that completes
 * after the host method returned (queued, fire and forget); rows a database cascade removes when another record is
 * deleted; a delete whose entry was lost (the insert after commit failed: the audit table on another DataSource,
 * or `transactions: false`); a delete on another connection whose check after commit did not happen (the process
 * died between the commit and the stamp, or the read or the update failed: that is logged); a record deleted
 * outside the admin or by a `target: 'resource'` action, which names no record; and an action that deletes on
 * another connection: an action that leaves its row is the normal case, and a second read would cost every run a
 * query.
 */
async function recordEntry(entry: RegisteredResource, change: WriteChange, state: AuditState, saved: object | null | undefined, row: StoredRow, manager: EntityManager): Promise<AuditInput | undefined> {
  const name = entry.schema.name;
  const { action } = change;
  if (change.kind === 'action' && action && state.recordId === undefined) {
    // A resource action: no record, only that it ran and with what.
    return { event: `${name}.action.${action.definition.name}`, entry, meta: actionMeta(action.definition, action.input) };
  }
  const fields = storedFields(entry);
  const masked = sensitiveFields(entry.fieldConfig);
  const removes = change.kind === 'delete' || change.kind === 'purge';
  // What is stored now, read back by the write (`WriteRunner.change`, the read the files participant decides on
  // too): a host method may answer nothing, or an entity from before it finished.
  const { key: known, stored } = row;
  // An action's "after" is the stored row or nothing: what the host's finder answered is only a witness (`changed`).
  const current = removes ? undefined : change.kind === 'action' ? stored : (stored ?? saved ?? undefined);
  const after = current ? await serializeFull(entry, current, manager) : undefined;
  const ended = change.kind === 'purge' || ((change.kind === 'delete' || change.kind === 'action') && row.gone);
  if (change.kind === 'delete' && known !== undefined && stored && unsure(entry, stored, manager)) state.recheck = known;
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
    return { ...record, event: `${name}.action.${action.definition.name}`, changes, meta: { ...actionMeta(action.definition, action.input), ...(ended ? { deleted: true as const } : {}) } };
  }
  if (change.kind === 'action' || change.kind === 'page') return undefined;
  const event = `${name}.${EVENTS[change.kind]}`;
  if (change.kind === 'restore') return { ...record, event, changes: [] };
  if (removes) return { ...record, event, changes: diffRecords(state.before, undefined, fields, masked), ...(ended ? { meta: { deleted: true as const } } : {}) };
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
