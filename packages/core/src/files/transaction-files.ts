import type { DataSource, EntityManager, EntitySubscriberInterface, QueryRunner, TransactionCommitEvent, TransactionRollbackEvent } from 'typeorm';

/** Work for after a transaction ends: `committed` once the outermost transaction commits, `rolledBack` when the level it was added in is rolled back. */
export interface TransactionWork {
  committed?: () => Promise<void>;
  rolledBack?: () => Promise<void>;
}

interface Pending extends TransactionWork {
  /** The transaction level (savepoint depth) the work belongs to; a released savepoint hands it to the level around it. */
  depth: number;
}

/**
 * Runs work when a host's transaction ends, for files registered inside it (`AdminFiles.register`/`release`): a
 * registered object is deleted when the level it was written in rolls back, and a released one only once everything
 * committed. TypeORM lowers `transactionDepth` before it announces a commit or a rollback, so the depth after the
 * event tells which levels ended.
 */
export class TransactionFiles {
  private readonly pending = new WeakMap<QueryRunner, Pending[]>();
  private readonly subscribed = new WeakSet<DataSource>();

  constructor(private readonly onError: (error: unknown) => void) {}

  /**
   * Adds work to the transaction `manager` runs in. Answers false when it runs in none (no query runner, or none
   * active): the caller then does the work itself, at once.
   */
  add(manager: EntityManager, work: TransactionWork): boolean {
    const runner = manager.queryRunner;
    if (!runner || !runner.isTransactionActive) return false;
    this.subscribe(runner.connection);
    const list = this.pending.get(runner) ?? [];
    list.push({ ...work, depth: depthOf(runner) });
    this.pending.set(runner, list);
    return true;
  }

  private subscribe(dataSource: DataSource): void {
    if (this.subscribed.has(dataSource)) return;
    this.subscribed.add(dataSource);
    const subscriber: EntitySubscriberInterface = {
      afterTransactionCommit: (event: TransactionCommitEvent) => this.ended(event.queryRunner, false),
      afterTransactionRollback: (event: TransactionRollbackEvent) => this.ended(event.queryRunner, true),
    };
    dataSource.subscribers.push(subscriber);
  }

  private async ended(runner: QueryRunner, rolledBack: boolean): Promise<void> {
    const list = this.pending.get(runner);
    if (!list) return;
    const depth = depthOf(runner);
    const ended = list.filter((work) => work.depth > depth);
    const kept = list.filter((work) => work.depth <= depth);
    if (rolledBack) {
      this.pending.set(runner, kept);
      for (const work of ended) await work.rolledBack?.().catch(this.onError);
      return;
    }
    if (depth > 0) {
      // A savepoint was released: its work now belongs to the level around it.
      this.pending.set(runner, [...kept, ...ended.map((work) => ({ ...work, depth }))]);
      return;
    }
    this.pending.delete(runner);
    for (const work of list) await work.committed?.().catch(this.onError);
  }
}

/** The savepoint depth TypeORM keeps on every query runner (not in its public type). */
const depthOf = (runner: QueryRunner): number => (runner as unknown as { transactionDepth: number }).transactionDepth;
