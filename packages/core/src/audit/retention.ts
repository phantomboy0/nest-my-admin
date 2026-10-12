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
 * process deleted meanwhile is simply gone. On a single-connection driver each batch waits its turn among the
 * admin's writes, and so never lands inside someone's transaction.
 */
export async function deleteEntriesBefore(db: DataSource, cutoff: Date, batch = RETENTION_BATCH): Promise<number> {
  let deleted = 0;
  for (;;) {
    const count = await exclusive(db, async () => {
      const repo = db.getRepository(NmaAuditEntry);
      const rows = await repo.createQueryBuilder('entry').select('entry.id', 'id').where('entry.at < :cutoff', { cutoff }).orderBy('entry.at', 'ASC').limit(batch).getRawMany<{ id: number | string }>();
      if (rows.length === 0) return 0;
      await repo.createQueryBuilder().delete().whereInIds(rows.map((row) => Number(row.id))).execute();
      return rows.length;
    });
    deleted += count;
    if (count < batch) return deleted;
  }
}
