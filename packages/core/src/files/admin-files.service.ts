import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { NmaFile } from './entities.js';
import { FilesService } from './files.service.js';
import { assertStorageKey } from './storage.js';

/** What the admin knows about a public file. */
export interface AdminPublicFile {
  /** The storage key: what the record (or the settings page) holds. */
  key: string;
  /** The original file name, cleaned. */
  name: string;
  /** The type the admin found in the file's bytes at upload, never the one the uploader claimed. */
  contentType: string;
  /** Bytes, as uploaded. */
  size: number;
}

/** A public file's bytes, from the storage. */
export interface AdminPublicFileBody {
  body: Readable;
  /** The type the admin found in the file's bytes at upload. */
  contentType: string;
  /** The stored object's size in bytes, or the size recorded at upload when the storage does not report one. */
  size: number;
  name: string;
}

const NOT_CONFIGURED = 'nest-my-admin: AdminFiles needs `files` in AdminModule.forRoot() (a storage, and ADMIN_FILE_ENTITIES in the DataSource)';
const NOT_READY = 'nest-my-admin: AdminFiles answers once the application has started (after onApplicationBootstrap)';

/** The longest key a row can hold (`nma_file.key`). */
const MAX_KEY_LENGTH = 500;

/**
 * For a host that serves the admin's public files itself (a storefront's `/media/<key>` route): which keys are public
 * files, and their bytes. Inject it anywhere (`AdminModule` is global):
 *
 * ```ts
 * constructor(private readonly files: AdminFiles) {}
 * ```
 *
 * A key is a public file only while its `nma_file` row is `visibility: 'public'` (the field's `file.visibility`) and
 * `status: 'attached'` (a saved record or settings page holds it). Private files, uploads nobody saved yet, files a
 * record let go of and keys the admin never issued are all `null`: the methods never throw for what a key is, so a
 * key can come straight from a URL. No permission is checked: public means for everyone. The visibility is the one
 * recorded when the file was uploaded: a field made private later keeps its earlier files public, and a record in the
 * trash still holds its files.
 *
 * It is always injectable. In an admin without `files` both methods reject with an error that says so (`enabled`
 * tells beforehand); it works with `files.dataSource` set to any DataSource.
 */
@Injectable()
export class AdminFiles {
  constructor(private readonly files: FilesService) {}

  /** Whether `files` is configured in `AdminModule.forRoot()`. */
  get enabled(): boolean {
    return this.files.enabled;
  }

  /**
   * The file with this key when it is public and attached, else `null`. Reads the `nma_file` table only, never the
   * storage, so it is cheap enough for a `HEAD` or a conditional request.
   */
  async publicFile(key: string): Promise<AdminPublicFile | null> {
    const row = await this.publicRow(key);
    return row ? { key: row.key, name: row.name, contentType: row.contentType, size: row.size } : null;
  }

  /**
   * The bytes of the file with this key when it is public and attached; `null` otherwise, and when the storage no
   * longer has the object. The storage is read only after the row was found. Consume `body` or destroy it: an unread
   * body holds a file descriptor or a connection of the storage.
   */
  async openPublic(key: string): Promise<AdminPublicFileBody | null> {
    const row = await this.publicRow(key);
    if (!row) return null;
    const object = await this.files.storage.get(row.key);
    // A storage that cannot tell (s3Storage answers 0 for a response without Content-Length) gets the recorded size.
    return object ? { body: object.body, contentType: row.contentType, size: object.size > 0 ? object.size : row.size, name: row.name } : null;
  }

  private async publicRow(key: unknown): Promise<NmaFile | null> {
    if (!this.files.enabled) throw new Error(NOT_CONFIGURED);
    if (!this.files.ready) throw new Error(NOT_READY);
    if (!isStorageKey(key)) return null;
    return this.files.db.getRepository(NmaFile).findOneBy({ key, visibility: 'public', status: 'attached' });
  }
}

/** A key the admin could have issued: a relative path of plain segments, short enough for the column. */
function isStorageKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length > MAX_KEY_LENGTH) return false;
  try {
    assertStorageKey(key);
    return true;
  } catch {
    return false;
  }
}
