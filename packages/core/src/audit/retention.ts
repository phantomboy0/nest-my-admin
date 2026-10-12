import type { DataSource } from 'typeorm';
import { exclusive } from '../api/write-queue.js';
import { NmaAuditEntry } from './entities.js';

/** Entries deleted per statement: a short lock each, however much has piled up. */
export const RETENTION_BATCH = 1_000;

/**
 * Deletes the audit entries written before `cutoff`, oldest first, `batch` at a time, and answers how many.
 *
 * Each batch reads the ids to delete (along the index on `at`) and deletes those rows by key. That is the same
 * two statements on every driver: MySQL has no `LIMIT` in an `IN` subquery, and Postgres and SQLite no
 * `DELETE … LIMIT`. Entries are never updated, so the ids read are still the rows to delete; a batch another
 * process deleted meanwhile is simply gone, and a batch that deletes nothing ends the sweep (it cannot loop). On a
 * single-connection driver each batch waits its turn among the admin's writes, and so never lands inside someone's
 * transaction.
 */
export async function deleteEntriesBefore(db: DataSource, cutoff: Date, batch = RETENTION_BATCH): Promise<number> {
  let deleted = 0;
  let first: number | undefined;
  for (;;) {
    const batchOf = await exclusive(db, async () => {
      const repo = db.getRepository(NmaAuditEntry);
      const rows = await repo.createQueryBuilder('entry').select('entry.id', 'id').where('entry.at < :cutoff', { cutoff }).orderBy('entry.at', 'ASC').addOrderBy('entry.id', 'ASC').limit(batch).getRawMany<{ id: number | string }>();
      const ids = rows.map((row) => Number(row.id));
      // The row that was to go first is still first: the last batch deleted nothing.
      if (ids.length === 0 || ids[0] === first) return { ids, removed: 0 };
      const result = await repo.createQueryBuilder().delete().whereInIds(ids).execute();
      // Not every driver counts the rows it deleted.
      return { ids, removed: typeof result.affected === 'number' ? result.affected : ids.length };
    });
    deleted += batchOf.removed;
    // Done when there was less than a batch to delete, and never around again for a batch that deleted nothing.
    if (batchOf.removed === 0 || batchOf.ids.length < batch) return deleted;
    first = batchOf.ids[0];
  }
}
