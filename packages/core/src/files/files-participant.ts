import type { WriteChange, WriteParticipant } from '../api/write-participant.js';
import { recordIdOf } from '../crud/record-id.js';
import type { FileChanges, FilesService } from './files.service.js';

/** What a write does to files, once known: `resolve` fills it before the host method, `release` after a hard delete. */
interface FilesState {
  changes?: FileChanges;
}

/**
 * Files as a participant of every write: the uploads a payload names are resolved before the host method and
 * attached to the saved record after it; a record deleted for good takes its files with it (rows with the delete,
 * objects after the commit). The trash keeps the files: restore brings the record back with them.
 */
export function filesParticipant(files: FilesService): WriteParticipant<FilesState> {
  const releases = (change: WriteChange): boolean => change.kind === 'purge' || (change.kind === 'delete' && 'schema' in change.target && !change.target.schema.softDelete);
  return {
    async before(change, tx) {
      if (releases(change)) return {};
      if (!change.dto || (change.kind !== 'create' && change.kind !== 'update' && change.kind !== 'page')) return undefined;
      // Before anything else reads the payload, so relationOptions() sees AdminFiles in `values`, never what the client sent.
      const changes = await files.resolve(files.ownerOf(change.target), change.dto, change.existing, tx);
      return changes ? { changes } : undefined;
    },
    async after(change, state, saved, tx) {
      const owner = files.ownerOf(change.target);
      if (state.changes) {
        if (saved) await files.attach(owner, state.changes, saved, tx);
      } else if ('schema' in change.target && change.id !== undefined) {
        const keys = change.target.schema.primaryKeys;
        const { id } = change;
        state.changes = await files.release(owner, recordIdOf(typeof id === 'object' ? id : { [keys[0]!]: id }, keys), tx);
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
