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
}

/**
 * Something that takes part in every change of a write (`WriteRunner.change`): files, the audit log.
 *
 * `before` runs ahead of the host method and answers this participant's state for the change, or `undefined` to
 * sit the change out. `after` runs once the host method has returned, still inside the write's transaction, with
 * what was saved (`null`: the record is gone; `undefined`: the method named none). `onCommit` runs once the
 * write's transaction has committed, for changes whose `after` finished; `onRollback` when it failed, for every
 * change that got a state. Both are best effort: a failure is logged, never thrown.
 */
export interface WriteParticipant<S = unknown> {
  before(change: WriteChange, tx: AdminContext): Promise<S | undefined>;
  after(change: WriteChange, state: S, saved: object | null | undefined, tx: AdminContext): Promise<void>;
  onCommit?(change: WriteChange, state: S, tx: AdminContext): Promise<void>;
  onRollback?(change: WriteChange, state: S, tx: AdminContext): Promise<void>;
}
