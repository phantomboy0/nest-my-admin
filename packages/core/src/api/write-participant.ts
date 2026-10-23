import type { RegisteredAction } from '../decorators/admin-action.js';
import type { RegisteredPage } from '../pages/page-registry.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { RecordId } from '../resource/admin-resource-base.js';

export type WriteKind = 'create' | 'update' | 'delete' | 'restore' | 'purge' | 'action' | 'page';

/** One change inside a write: what a host method is about to do to one record (or one settings page). */
export interface WriteChange {
  kind: WriteKind;
  /** The resource whose record changes, or the settings page being saved. */
  target: RegisteredResource | RegisteredPage;
  /** The record (or the page's stored values) before the host method runs; absent for a create and when it was not loaded. */
  existing?: object;
  /** The record's primary key as `findOne` takes it, when the request names one. */
  id?: RecordId;
  /** The validated payload of a create, an update or a page save; a participant may replace what the form sent (files). */
  dto?: object;
  /** An `@AdminAction` run (`kind: 'action'`): the action, and its input as validated, before any method saw it. */
  action?: { definition: RegisteredAction; input: object };
  /** A change to a child saved inline with its parent: the parent's resource and `_id` (the audit entry's `meta.parent`). */
  parent?: { resource: string; recordId: string };
}

/**
 * What is stored of a change's record once the host method has returned: read once per change, by the write's own
 * manager (`WriteRunner.change`), trash included, without scopes, `query()` or a `findOne` override. Every
 * participant is handed the same answer, so they cannot disagree on whether the record is still there.
 */
export interface StoredRow {
  /** The record's key: the one the request names, else the loaded record's, else that of what the method saved. */
  key?: RecordId;
  /** The row, in the trash or not. Absent when there is none, when no key is known, and for a settings page. */
  stored?: object;
  /**
   * The key is known and no row is left: the record is really gone. False whenever the write still reads a row,
   * so also for a host `delete()` that only flags the record, and for a delete a host service made on another
   * connection that this transaction cannot see (MySQL, REPEATABLE READ).
   *
   * "Gone" is about the key the request named, so two things read as gone while a row lives on: a record action
   * that changes its record's primary key, and one that moves a single-table-inheritance child to another type
   * (the repository of the child no longer finds it). The record's audit history ends there and its files are
   * released while the row still names them: actions on resources with file fields must not do either.
   */
  gone: boolean;
}

/**
 * Something that takes part in every change of a write (`WriteRunner.change`): files, the audit log.
 *
 * `before` runs ahead of the host method and answers this participant's state for the change, or `undefined` to
 * sit the change out. `after` runs once the host method has returned, still inside the write's transaction, with
 * what was saved (`null`: the record is gone; `undefined`: the method named none) and `row`, which reads what is
 * stored now (`StoredRow`; the read is made once, when the first participant asks). `onCommit` runs once the
 * write's transaction has committed, for changes whose `after` finished; `onRollback` when it failed, for every
 * change that got a state. Both are best effort: a failure is logged, never thrown.
 */
export interface WriteParticipant<S = unknown> {
  before(change: WriteChange, tx: AdminContext): Promise<S | undefined>;
  after(change: WriteChange, state: S, saved: object | null | undefined, tx: AdminContext, row: () => Promise<StoredRow>): Promise<void>;
  onCommit?(change: WriteChange, state: S, tx: AdminContext): Promise<void>;
  onRollback?(change: WriteChange, state: S, tx: AdminContext): Promise<void>;
}
