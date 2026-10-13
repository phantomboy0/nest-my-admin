import type { WriteChange, WriteParticipant } from '../api/write-participant.js';
import { recordIdOf } from '../crud/record-id.js';
import { whereOf } from '../crud/stored-row.js';
import type { FileChanges, FilesService } from './files.service.js';

/** What a write does to files, once known: `resolve` fills it before the host method, `release` once a record is gone. */
interface FilesState {
  changes?: FileChanges;
}

/**
 * Files as a participant of every write: the uploads a payload names are resolved before the host method and
 * attached to the saved record after it; a record that is gone for good takes its files with it (rows with the
 * write, objects after the commit).
 *
 * When a record's files are released:
 *
 * - a purge: always, it is for good by definition;
 * - a delete, or an action on a record: only when the write itself reads no row afterwards (`StoredRow.gone`, the
 *   same answer the audit log ends the record's history on). The trash keeps the files (restore brings the record
 *   back with them), and so does a host `delete()` that keeps the row (an archive flag, a refusal it swallowed):
 *   releasing there would destroy the files of a record that still names them, for good.
 *
 * The other side of that rule is orphans, which is the safe side: when a host service deletes the row on another
 * connection and the admin's transaction cannot see it (MySQL, REPEATABLE READ), or deletes it later (a queue),
 * the `nma_file` rows and the objects stay although the record is gone. Nothing releases them after the commit.
 */
export function filesParticipant(files: FilesService): WriteParticipant<FilesState> {
  /** A change that may end a record: its files are released in `after`, once it is known whether it did. */
  const mayEnd = (change: WriteChange): boolean => 'schema' in change.target && change.id !== undefined && (change.kind === 'purge' || change.kind === 'delete' || change.kind === 'action');
  return {
    async before(change, tx) {
      if (mayEnd(change)) return files.holdsFiles(files.ownerOf(change.target)) ? {} : undefined;
      if (!change.dto || (change.kind !== 'create' && change.kind !== 'update' && change.kind !== 'page')) return undefined;
      // Before anything else reads the payload, so relationOptions() sees AdminFiles in `values`, never what the client sent.
      const changes = await files.resolve(files.ownerOf(change.target), change.dto, change.existing, tx);
      return changes ? { changes } : undefined;
    },
    async after(change, state, saved, tx, row) {
      const { target } = change;
      const owner = files.ownerOf(target);
      if (state.changes) {
        if (saved) await files.attach(owner, state.changes, saved, tx);
      } else if ('schema' in target && change.id !== undefined && mayEnd(change)) {
        if (change.kind !== 'purge' && !(await row()).gone) return;
        state.changes = await files.release(owner, recordIdOf(whereOf(target, change.id), target.schema.primaryKeys), tx);
      }
    },
    async onCommit(change, state) {
      if (state.changes) await files.afterCommit(files.ownerOf(change.target), state.changes);
    },
    async onRollback(change, state) {
      if (state.changes) await files.rollback(files.ownerOf(change.target), state.changes);
    },
  };
}
