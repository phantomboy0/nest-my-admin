import type { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { hostError } from '../http/error-response.js';
import type { ResolvedAdminOptions } from '../options.js';
import { AdminContext, runInAdminContext } from '../resource/admin-context.js';
import { keyOf, loadStored } from '../crud/stored-row.js';
import type { StoredRow, WriteChange, WriteParticipant } from './write-participant.js';
import { exclusive } from './write-queue.js';

/** A participant's part in one change of a write; `done` once its `after` finished. */
interface Step {
  participant: WriteParticipant;
  change: WriteChange;
  state: unknown;
  done: boolean;
}

/**
 * The admin's write transaction (`AdminApiService.write`) and the participants of every change made inside it.
 * A plain class built by `AdminApiService`.
 */
export class WriteRunner {
  /** The steps of the write a transactional context belongs to. Only `run()` opens one, so there is always one inside `work`. */
  private readonly open = new WeakMap<AdminContext, Step[]>();

  constructor(
    private readonly options: ResolvedAdminOptions,
    private readonly logger: Logger,
    private readonly participants: readonly WriteParticipant[],
  ) {}

  /**
   * Runs a write in one transaction on the target's DataSource (unless disabled) with ctx.manager set and AdminContext.current() pointing at it.
   * The participants' `onCommit` runs once the transaction has committed and never when it rolls back;
   * `onRollback` runs only when it fails. A failing one is logged, never thrown.
   */
  async run<T>(target: { dataSource: DataSource }, ctx: AdminContext, work: (ctx: AdminContext) => Promise<T>): Promise<T> {
    const committed = async (tx: AdminContext, run: () => Promise<T>): Promise<T> => {
      const steps: Step[] = [];
      this.open.set(tx, steps);
      let result: T;
      try {
        result = await run();
      } catch (error) {
        await this.settle(steps, 'onRollback', tx);
        // Everything the host does in a write (resource methods, hooks, actions, a page's save) fails through here.
        throw hostError(error);
      } finally {
        this.open.delete(tx);
      }
      await this.settle(steps.filter((step) => step.done), 'onCommit', tx);
      return result;
    };
    if (!this.options.transactions) {
      // Nothing to commit: the participants settle when the outermost write on this context is done.
      return this.open.has(ctx) ? work(ctx) : committed(ctx, () => work(ctx));
    }
    const { dataSource } = target;
    // Re-entrant write (host code inside a write calls the API again on the same DataSource): join the outer
    // transaction; queueing behind it would deadlock. There is no savepoint: if host code catches a failed nested
    // write and carries on, the nested rows commit with the outer transaction. `manager.connection` is deprecated
    // in TypeORM 1.x but is the only property that exists on both 0.3 and 1.x. The nested write's steps are
    // collected on the outer context, so they settle with the outer transaction.
    const outer = AdminContext.current();
    if (outer?.manager && outer.manager.connection === dataSource) return work(outer);
    // On a single-connection driver the admin's transactions never interleave: they queue (see `exclusive`).
    return exclusive(dataSource, () => {
      const transactional: AdminContext = { ...ctx };
      return committed(transactional, () =>
        dataSource.transaction(async (manager) => {
          transactional.manager = manager;
          return runInAdminContext(transactional, () => work(transactional));
        }),
      );
    });
  }

  /**
   * One change inside the write `tx`: every participant's `before`, then the host `method`, then every `after` with
   * what the method saved (`savedOf`; by default the method's answer when it is an object) and with what is stored
   * of the record now (`storedRow`): one read for all of them, made when the first one asks.
   */
  async change<T>(change: WriteChange, tx: AdminContext, method: () => Promise<T>, savedOf: (result: T) => object | null | undefined = asObject): Promise<T> {
    const steps = this.open.get(tx);
    if (!steps) throw new Error('nest-my-admin: a change was made outside a write');
    const mine: Step[] = [];
    for (const participant of this.participants) {
      const state = await participant.before(change, tx);
      if (state === undefined) continue;
      const step = { participant, change, state, done: false };
      steps.push(step);
      mine.push(step);
    }
    const result = await method();
    const saved = savedOf(result);
    let read: Promise<StoredRow> | undefined;
    const row = (): Promise<StoredRow> => (read ??= storedRow(change, saved, tx));
    for (const step of mine) {
      await step.participant.after(change, step.state, saved, tx, row);
      step.done = true;
    }
    return result;
  }

  private async settle(steps: Step[], hook: 'onCommit' | 'onRollback', tx: AdminContext): Promise<void> {
    const what = hook === 'onCommit' ? 'after-commit' : 'after-rollback';
    for (const { participant, change, state } of steps) {
      await participant[hook]?.(change, state, tx).catch((error: unknown) => this.logger.warn(`${what} work failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

/**
 * What the write's own manager reads of the change's record after the host method (see `StoredRow`). This is the
 * one place that decides whether a record is gone: the files participant releases a deleted record's files on it,
 * and the audit participant ends the record's history on it.
 *
 * Without a transaction (`transactions: false`) the read goes through `dataSource.manager`, which TypeORM
 * replication may send to a replica: one that has not received a row that was just created answers "gone", and
 * an archive-style delete or an action on that record then releases its files. The read is not forced to the
 * master (that takes a query runner of its own, opened and released around it, on every driver): a documented
 * limit, see the README.
 */
async function storedRow(change: WriteChange, saved: object | null | undefined, tx: AdminContext): Promise<StoredRow> {
  const { target } = change;
  if (!('schema' in target)) return { gone: false };
  const key = change.id ?? (change.existing ? keyOf(target, change.existing) : saved ? keyOf(target, saved) : undefined);
  if (key === undefined) return { gone: false };
  const stored = await loadStored(target, key, tx.manager ?? target.dataSource.manager);
  return { key, ...(stored ? { stored } : {}), gone: !stored };
}

const asObject = (result: unknown): object | undefined => (typeof result === 'object' && result !== null ? result : undefined);
