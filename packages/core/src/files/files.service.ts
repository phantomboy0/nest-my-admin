import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { In, LessThan, type DataSource, type EntityManager } from 'typeorm';
import type { AdminFileRef, UploadResponse } from '../contract.js';
import { parseRecordId, recordIdOf } from '../crud/record-id.js';
import { ADMIN_OPTIONS } from '../constants.js';
import { AdminBadRequestError, AdminForbiddenError, AdminNotFoundError, AdminPayloadTooLargeError, AdminUnsupportedMediaTypeError, AdminValidationError } from '../errors.js';
import type { AdminRequest } from '../http/http-io.js';
import type { ResolvedAdminOptions } from '../options.js';
import { AdminPolicy } from '../policy/admin-policy.service.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import { markAdminFile, type AdminFile } from './admin-file.js';
import { NmaFile } from './entities.js';
import { createSanitizer, imageKeysOf, resolveImages, type ImageUrls } from './rich-text.js';
import { accepts, extensionOf, sniff } from './sniff.js';
import { encodeKey, type AdminStorage } from './storage.js';

/** Bytes read before the type is decided; enough for every magic number and the first entries of a zip. */
const HEAD_BYTES = 8192;

/** Types a foreign page can send without a CORS preflight: refused, so an upload cannot be forged cross-site. */
const SIMPLE_TYPES = new Set(['text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded']);

/** How long an upload waits for a record: older tokens are refused, and the hourly sweep deletes them. */
const TEMP_TTL_MS = 24 * 3_600_000;
const SWEEP_EVERY_MS = 3_600_000;
const SWEEP_BATCH = 200;

/** What one write does to a record's files; `resolve` or `release` starts it, `attach`, `afterCommit` and `rollback` finish it. */
export interface FileChanges {
  /** Each resolved field with the keys the record held there before the write. */
  before: Map<string, string[]>;
  /** The `richtext` fields among them: their keys are the images of the HTML, not the column value. */
  richtext?: Set<string>;
  /** The uploads (`temp` rows) the write takes, by field. */
  fresh: Array<{ id: string; field: string }>;
  /** The record (set by `attach` or `release`). */
  recordId?: string;
  /** The keys the record let go of; `'all'` when the record itself is deleted for good. */
  removed: string[] | 'all';
  /** Keys whose rows are gone: their objects are deleted after commit. */
  objects: string[];
  /** `nma_file` lives on another DataSource than the record, so its rows cannot share the record's transaction. */
  deferred: boolean;
}

const INVALID_UPLOAD = 'is not a valid upload';
const NOT_FOUND = 'File not found';

/** Uploads, the files of records, downloads and cleanup (spec §8.2). */
@Injectable()
export class FilesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NestMyAdmin');
  private dataSource?: DataSource;
  private timer?: ReturnType<typeof setInterval>;
  private sanitizer?: (html: string) => string;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly registry: ResourceRegistry,
    private readonly policy: AdminPolicy,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  /** Whether `files` is configured; without it `/api/uploads` answers 404. */
  get enabled(): boolean {
    return this.options.files !== undefined;
  }

  get storage(): AdminStorage {
    if (!this.options.files) throw new AdminNotFoundError('File uploads are not enabled in this admin');
    return this.options.files.storage;
  }

  /** The DataSource holding the `nma_file` table. */
  get db(): DataSource {
    if (!this.dataSource) throw new AdminNotFoundError('File uploads are not enabled in this admin');
    return this.dataSource;
  }

  /** Where this admin's editor images may live (none without `files`). */
  private imageUrls(): ImageUrls | undefined {
    const files = this.options.files;
    if (!files) return undefined;
    const probe = files.storage.publicUrl('k');
    return { adminPrefix: `${this.options.path}/api/files/`, ...(probe?.endsWith('k') ? { publicPrefix: probe.slice(0, -1) } : {}) };
  }

  /** `richtext` fields get the host's `files.sanitizeHtml`, else the built-in one, which needs the optional package `sanitize-html`. */
  async onApplicationBootstrap(): Promise<void> {
    if (richFieldsOf(...this.registry.list()).length > 0) this.sanitizer = this.options.files?.sanitizeHtml ?? (await createSanitizer(this.imageUrls()));
    if (!this.options.files) return;
    const name = this.options.files.dataSource;
    try {
      this.dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(name) as string, { strict: false });
    } catch {
      throw new Error(`nest-my-admin: files: no TypeORM DataSource "${name ?? 'default'}"`);
    }
    if (!this.dataSource.hasMetadata(NmaFile)) {
      throw new Error(`nest-my-admin: files: add ADMIN_FILE_ENTITIES to the entities of the DataSource "${name ?? 'default'}" (NmaFile is missing)`);
    }
    // Never keeps the process (or a test run) alive; tests call sweep() themselves.
    this.timer = setInterval(() => void this.sweep().catch((error: unknown) => this.logger.warn(`files: cleanup failed (${message(error)})`)), SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The HTML a `richtext` field may store. */
  sanitizeHtml(html: string): string {
    if (!this.sanitizer) throw new Error('nest-my-admin: no HTML sanitizer is loaded (no resource has a richtext field)');
    const clean = this.sanitizer(html);
    if (typeof clean !== 'string') throw new Error('nest-my-admin: files.sanitizeHtml must return a string');
    return clean;
  }

  /** The record's transaction when `nma_file` shares its DataSource, else the files' own connection. */
  private manager(entry: RegisteredResource, ctx: AdminContext): EntityManager {
    return ctx.manager && entry.dataSource === this.db ? ctx.manager : this.db.manager;
  }

  private url(row: Pick<NmaFile, 'key' | 'visibility'>): string {
    return (row.visibility === 'public' ? this.storage.publicUrl(row.key) : undefined) ?? `${this.options.path}/api/files/${encodeKey(row.key)}`;
  }

  /**
   * Replaces what the form sent for each file field of `dto` (`{ token }`, `{ key }`, null, or a list) by `AdminFile`s,
   * before the resource method runs. A token must be this user's own unsaved upload to this resource and field, less
   * than 24 hours old (or, for a retried write, the upload this user already attached to this record in this field,
   * which is then a keep); a key must be one the record already holds in that field. Anything else is a 422 on the field.
   */
  async resolve(entry: RegisteredResource, dto: object, existing: object | undefined, ctx: AdminContext): Promise<FileChanges | undefined> {
    const values = dto as Record<string, unknown>;
    const names = fileFieldsOf(entry).filter((name) => Object.hasOwn(values, name));
    const richNames = this.enabled ? richFieldsOf(entry).filter((name) => Object.hasOwn(values, name)) : [];
    if (names.length === 0 && richNames.length === 0) return undefined;
    if (!this.enabled) {
      const sent = names.filter((name) => values[name] !== null);
      if (sent.length > 0) throw new AdminValidationError(Object.fromEntries(sent.map((name) => [name, ['file uploads are not enabled in this admin']])));
      return undefined;
    }
    const items = (name: string) => (values[name] === null ? [] : Array.isArray(values[name]) ? values[name] : [values[name]]) as Array<{ token?: string; key?: string }>;
    const manager = this.manager(entry, ctx);
    const tokens = names.flatMap((name) => items(name).flatMap((item) => (item.token !== undefined ? [item.token] : [])));
    const keys = names.flatMap((name) => items(name).flatMap((item) => (item.key !== undefined ? [item.key] : [])));
    const repo = manager.getRepository(NmaFile);
    const byToken = new Map((tokens.length > 0 ? await repo.findBy({ id: In(tokens) }) : []).map((row) => [row.id, row]));
    const byKey = new Map((keys.length > 0 ? await repo.findBy({ key: In(keys), resource: entry.schema.name }) : []).map((row) => [row.key, row]));

    const changes: FileChanges = { before: new Map(), fresh: [], removed: [], objects: [], deferred: entry.dataSource !== this.db };
    const errors: Record<string, string[]> = {};
    const user = userIdOf(ctx);
    const oldest = Date.now() - TEMP_TTL_MS;
    const taken = new Set<string>();
    const recordId = existing ? recordIdOf(existing, entry.schema.primaryKeys) : undefined;
    if (richNames.length > 0) {
      const images = await resolveImages({
        repo,
        resource: entry.schema.name,
        fields: richNames,
        values,
        existing: existing as Record<string, unknown> | undefined,
        recordId,
        user,
        oldest,
        urls: this.imageUrls()!,
      });
      changes.richtext = new Set(richNames);
      changes.fresh.push(...images.fresh);
      for (const [name, held] of images.before) changes.before.set(name, held);
    }
    for (const name of names) {
      const held = keysOf((existing as Record<string, unknown> | undefined)?.[name]);
      changes.before.set(name, held);
      const files: AdminFile[] = [];
      for (const item of items(name)) {
        if (item.token !== undefined) {
          const row = byToken.get(item.token);
          // A retry of a write whose answer was lost sends the token again: the upload is already this record's file
          // in this field, attached by this user, so it is kept. For any other record, field, resource or user it is refused.
          const kept = row && row.status === 'attached' && existing !== undefined && row.recordId === recordId && row.createdBy === user && row.resource === entry.schema.name && row.field === name && held.includes(row.key);
          if (row && kept && !taken.has(row.id) && !taken.has(row.key)) {
            taken.add(row.id).add(row.key);
            files.push(markAdminFile({ key: row.key, name: row.name, contentType: row.contentType, size: row.size, url: this.url(row), isNew: false }));
            continue;
          }
          const valid = row && row.status === 'temp' && row.createdBy === user && row.resource === entry.schema.name && row.field === name && row.createdAt.getTime() > oldest && !taken.has(row.id);
          if (!valid) {
            errors[name] = [INVALID_UPLOAD];
            continue;
          }
          taken.add(row.id);
          changes.fresh.push({ id: row.id, field: name });
          files.push(markAdminFile({ key: row.key, name: row.name, contentType: row.contentType, size: row.size, url: this.url(row), isNew: true }));
        } else {
          const key = item.key!;
          if (!held.includes(key) || taken.has(key)) {
            errors[name] = ['is not a file of this record'];
            continue;
          }
          taken.add(key);
          files.push(markAdminFile({ ...this.ref(key, byKey.get(key), entry, name), isNew: false }));
        }
      }
      values[name] = values[name] === null ? null : Array.isArray(values[name]) ? files : (files[0] ?? null);
    }
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
    return changes;
  }

  /**
   * After the resource method, still inside the write: the uploads become `attached` to the record, and the rows of
   * keys the record no longer holds are deleted.
   *
   * When `nma_file` lives on another DataSource than the record there is no shared transaction. The uploads are then
   * attached on the files' own connection, still BEFORE the record commits (so an upload another write took fails
   * this write, and a committed record never points at a `temp` row the sweep would delete); `rollback` turns them
   * back into `temp` when the record's transaction fails. The removals wait for `afterCommit`. A crash in between
   * leaves an attached row without a record, never a record without its file.
   */
  async attach(entry: RegisteredResource, changes: FileChanges, entity: object, ctx: AdminContext): Promise<void> {
    const values = entity as Record<string, unknown>;
    changes.recordId = recordIdOf(entity, entry.schema.primaryKeys);
    const removed: string[] = [];
    for (const [name, held] of changes.before) {
      // A host method may answer an entity without the column: then nothing is known to be removed.
      if (values[name] === undefined) continue;
      const now = new Set(changes.richtext?.has(name) ? imageKeysOf(values[name], this.imageUrls()!) : keysOf(values[name]));
      removed.push(...held.filter((key) => !now.has(key)));
    }
    changes.removed = removed;
    const manager = this.manager(entry, ctx);
    await this.attachRows(manager, entry, changes);
    if (!changes.deferred) await this.removeRows(manager, entry, changes);
  }

  /**
   * A record deleted for good (a hard delete or a purge, never the trash) takes its files with it: the rows now
   * (after commit when `nma_file` is on another DataSource), the objects after commit.
   */
  async release(entry: RegisteredResource, recordId: string, ctx: AdminContext): Promise<FileChanges | undefined> {
    if (!this.enabled || (fileFieldsOf(entry).length === 0 && richFieldsOf(entry).length === 0)) return undefined;
    const changes: FileChanges = { before: new Map(), fresh: [], recordId, removed: 'all', objects: [], deferred: entry.dataSource !== this.db };
    if (!changes.deferred) await this.removeRows(this.manager(entry, ctx), entry, changes);
    return changes;
  }

  private async attachRows(manager: EntityManager, entry: RegisteredResource, changes: FileChanges): Promise<void> {
    const ids = changes.fresh.map((file) => file.id);
    if (ids.length === 0) return;
    const repo = manager.getRepository(NmaFile);
    const recordId = changes.recordId!;
    await repo.update({ id: In(ids), status: 'temp' }, { status: 'attached', recordId });
    // Another write (or the sweep) may have taken an upload since resolve() read it: all of them must be ours now.
    const mine = await repo.findBy({ id: In(ids), status: 'attached', recordId, resource: entry.schema.name });
    if (mine.length === ids.length) return;
    const got = new Set(mine.map((row) => row.id));
    const lost = changes.fresh.filter((file) => !got.has(file.id));
    changes.fresh = changes.fresh.filter((file) => got.has(file.id)); // rollback() gives back only what this write took
    throw new AdminValidationError(Object.fromEntries(lost.map((file) => [file.field, [INVALID_UPLOAD]])));
  }

  /** Only files the admin attached to this very record are deleted; a key a host wrote itself is left alone. */
  private async removeRows(manager: EntityManager, entry: RegisteredResource, changes: FileChanges): Promise<void> {
    if (changes.removed !== 'all' && changes.removed.length === 0) return;
    const repo = manager.getRepository(NmaFile);
    const rows = await repo.findBy({ ...(changes.removed === 'all' ? {} : { key: In(changes.removed) }), resource: entry.schema.name, recordId: changes.recordId!, status: 'attached' });
    if (rows.length > 0) await repo.delete({ id: In(rows.map((row) => row.id)) });
    changes.objects.push(...rows.map((row) => row.key));
  }

  /** After the write's transaction committed: deletes the objects of removed files. Failures are logged, never thrown. */
  async afterCommit(entry: RegisteredResource, changes: FileChanges): Promise<void> {
    if (changes.deferred) {
      try {
        await this.removeRows(this.db.manager, entry, changes);
      } catch (error) {
        this.logger.warn(`files: could not delete the removed files of ${entry.schema.name} "${changes.recordId}" after the write (${message(error)})`);
      }
    }
    for (const key of changes.objects) {
      await this.storage.delete(key).catch((error: unknown) => this.logger.warn(`files: could not delete "${key}" from storage (${message(error)})`));
    }
  }

  /**
   * The write's transaction failed. Rows attached inside it rolled back with it; rows attached on another DataSource
   * are turned back into `temp` here, so the upload can be used again (best effort: a row left `attached` only leaks).
   */
  async rollback(entry: RegisteredResource, changes: FileChanges): Promise<void> {
    const ids = changes.fresh.map((file) => file.id);
    if (!changes.deferred || ids.length === 0 || changes.recordId === undefined) return;
    await this.db.getRepository(NmaFile).update({ id: In(ids), status: 'attached', recordId: changes.recordId, resource: entry.schema.name }, { status: 'temp', recordId: null });
  }

  /** `_files` of each entity: a ref for every file the named fields hold (a list for `many` fields). */
  async refs(entry: RegisteredResource, entities: object[], fields: string[], ctx: AdminContext): Promise<Array<Record<string, AdminFileRef | AdminFileRef[]>>> {
    const valueOf = (entity: object, name: string) => (entity as Record<string, unknown>)[name];
    const keys = [...new Set(entities.flatMap((entity) => fields.flatMap((name) => keysOf(valueOf(entity, name)))))];
    const rows = new Map((keys.length > 0 ? await this.manager(entry, ctx).getRepository(NmaFile).findBy({ key: In(keys), resource: entry.schema.name }) : []).map((row) => [row.key, row]));
    return entities.map((entity) => {
      const out: Record<string, AdminFileRef | AdminFileRef[]> = {};
      for (const name of fields) {
        const value = valueOf(entity, name);
        const list = keysOf(value).map((key) => this.ref(key, rows.get(key), entry, name));
        if (Array.isArray(value)) out[name] = list;
        else if (list.length > 0) out[name] = list[0]!;
      }
      return out;
    });
  }

  /** A key the admin has no row for in this resource (written by the host itself) still gets a ref, named after the key. */
  private ref(key: string, row: NmaFile | undefined, entry: RegisteredResource, field: string): AdminFileRef {
    if (row) return { key, name: row.name, contentType: row.contentType, size: row.size, url: this.url(row) };
    const visibility = entry.fieldConfig.get(field)?.file?.visibility ?? 'private';
    return { key, name: key.split('/').pop()!, contentType: 'application/octet-stream', size: 0, url: this.url({ key, visibility }) };
  }

  /**
   * `GET /api/files/*key`: the bytes of a file attached to a record, for people who may view that record (scopes
   * included) and that field. Everything else is the same 404 as a key that does not exist.
   */
  async download(key: string, ctx: AdminContext): Promise<{ body: Readable; contentType: string; size: number; name: string }> {
    const gone = () => new AdminNotFoundError(NOT_FOUND);
    if (!this.enabled || key.length > 500) throw gone();
    const row = await this.db.getRepository(NmaFile).findOneBy({ key });
    if (!row) throw gone();
    const entry = this.registry.list().find((candidate) => candidate.schema.name === row.resource);
    if (!entry) throw gone();
    const permissions = this.policy.permissionsOf(ctx);
    const level = this.policy.levels(entry, ctx).get(row.field);
    if (row.status === 'temp') {
      // Not saved yet: only the person who uploaded it may preview it (the editor shows its images while composing).
      const user = userIdOf(ctx);
      const mayWrite = permissions.canOn(entry.schema.name, 'create') || permissions.canOn(entry.schema.name, 'update');
      if (user === null || row.createdBy !== user || row.createdAt.getTime() <= Date.now() - TEMP_TTL_MS || !mayWrite || level !== 'edit') throw gone();
      return this.open(key, row);
    }
    if (row.status !== 'attached' || row.recordId === null || !permissions.canOn(entry.schema.name, 'view')) throw gone();
    if (level === undefined || level === 'hidden') throw gone();
    let entity: object | null;
    try {
      const id = parseRecordId(row.recordId, entry.schema);
      entity = await entry.resource.findOne(id, ctx);
      if (entity) await this.policy.requireInScope(entry, id, row.recordId, 'view', ctx); // a findOne override may ignore scopes
    } catch (error) {
      if (error instanceof AdminNotFoundError || error instanceof AdminBadRequestError || error instanceof AdminValidationError) throw gone();
      throw error;
    }
    // The record must still hold the key: a row left behind by a host that changed the column itself opens nothing.
    // A richtext field holds its images in its HTML.
    const value = (entity as Record<string, unknown> | null)?.[row.field];
    const held = entry.fieldConfig.get(row.field)?.widget === 'richtext' ? imageKeysOf(value, this.imageUrls()!) : keysOf(value);
    if (!entity || !held.includes(key)) throw gone();
    return this.open(key, row);
  }

  private async open(key: string, row: NmaFile): Promise<{ body: Readable; contentType: string; size: number; name: string }> {
    const object = await this.storage.get(key);
    if (!object) throw new AdminNotFoundError(NOT_FOUND);
    return { body: object.body, contentType: row.contentType, size: object.size, name: row.name };
  }

  /**
   * Deletes uploads nobody saved a record for within 24 hours, rows first and then their objects; answers how many.
   * Runs hourly; a row is deleted only while it is still `temp`, so a write attaching it at that moment wins or fails
   * whole (`attach` re-reads the row).
   */
  async sweep(now = Date.now()): Promise<number> {
    if (!this.enabled) return 0;
    const repo = this.db.getRepository(NmaFile);
    let removed = 0;
    for (;;) {
      const rows = await repo.find({ where: { status: 'temp', createdAt: LessThan(new Date(now - TEMP_TTL_MS)) }, order: { createdAt: 'ASC' }, take: SWEEP_BATCH });
      let progressed = false;
      for (const row of rows) {
        await repo.delete({ id: row.id, status: 'temp' });
        if ((await repo.countBy({ id: row.id })) > 0) continue; // attached in the meantime
        progressed = true;
        removed += 1;
        await this.storage.delete(row.key).catch((error: unknown) => this.logger.warn(`files: could not delete "${row.key}" from storage (${message(error)})`));
      }
      if (rows.length < SWEEP_BATCH || !progressed) return removed;
    }
  }

  /**
   * `POST /api/uploads?resource=&field=`: the body is the raw file. The type is sniffed from its first bytes and checked
   * against the field's `accept` before anything is written; the object is streamed to storage under a byte limit.
   */
  async upload(req: AdminRequest, resource: string, field: string, ctx: AdminContext): Promise<UploadResponse> {
    const files = this.options.files;
    if (!files) throw new AdminNotFoundError('File uploads are not enabled in this admin');
    const declaredType = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (declaredType === '' || SIMPLE_TYPES.has(declaredType)) {
      throw new AdminUnsupportedMediaTypeError("Content-Type must be the file's own type; text/plain, multipart/form-data and application/x-www-form-urlencoded are refused");
    }

    const entry = this.registry.get(resource);
    this.policy.requireReach(entry, ctx);
    const permissions = this.policy.permissionsOf(ctx);
    if (!permissions.canOn(entry.schema.name, 'create') && !permissions.canOn(entry.schema.name, 'update')) {
      throw new AdminForbiddenError(`You may not create or change ${entry.schema.label} records`);
    }
    const config = entry.fieldConfig.get(field);
    if (!entry.schema.fields.some((candidate) => candidate.name === field && !field.includes('.'))) {
      throw new AdminNotFoundError(`Unknown field "${field}" of ${entry.schema.name}`);
    }
    // The images of a rich-text editor are uploaded to the field they will be saved in.
    if (config?.widget !== 'file' && config?.widget !== 'image' && config?.widget !== 'richtext') throw new AdminValidationError({ [field]: ['is not a file field'] });
    if (this.policy.levels(entry, ctx).get(field) !== 'edit') throw new AdminForbiddenError(`You may not change ${field}`);

    const limit = config.file?.maxBytes ?? files.maxBytes;
    const accept = config.widget === 'richtext' ? ['image/*'] : (config.file?.accept ?? (config.widget === 'image' ? ['image/*'] : ['*/*']));
    const visibility = config.file?.visibility ?? 'private';
    const declared = declaredLength(req);
    if (declared > limit) throw new AdminPayloadTooLargeError(`The file is larger than the ${limit} byte limit`);
    // A body parser of the host app (Nest's default JSON parser, for one) reads the bodies of the types it knows before
    // the admin handler runs. Nothing is left to store then, and an "empty file" answer would hide the reason.
    if (bodyAlreadyRead(req)) {
      throw new AdminBadRequestError(
        `The upload body was already read by a body parser of the host app (Content-Type: ${declaredType}) before the admin received it. Send the file as Content-Type: application/octet-stream`,
      );
    }

    // Decide the type from the first bytes before a single byte is stored.
    const iterator = req[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
    const head: Buffer[] = [];
    let total = 0;
    let ended = false;
    while (total < HEAD_BYTES && !ended) {
      const next = await iterator.next();
      if (next.done) ended = true;
      else {
        const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
        head.push(chunk);
        total += chunk.length;
        if (total > limit) throw new AdminPayloadTooLargeError(`The file is larger than the ${limit} byte limit`);
      }
    }
    const type = sniff(Buffer.concat(head).subarray(0, HEAD_BYTES));
    if (type === undefined || !accepts(type, accept)) throw new AdminValidationError({ [field]: ['is not an accepted file type'] });

    const now = new Date();
    const id = randomUUID();
    const key = `${entry.schema.name}/${field}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}${extensionOf(type)}`;
    let overflow: Error | undefined;
    async function* rest(): AsyncGenerator<Buffer> {
      yield* head;
      while (!ended) {
        const next = await iterator.next();
        if (next.done) return;
        const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
        total += chunk.length;
        if (total > limit) throw (overflow = new AdminPayloadTooLargeError(`The file is larger than the ${limit} byte limit`));
        if (total > declared) throw (overflow = new AdminBadRequestError('The body is longer than its Content-Length'));
        yield chunk;
      }
    }
    const name = cleanName(req.headers['x-file-name'], extensionOf(type));
    try {
      try {
        await this.storage.put(key, Readable.from(rest()), { contentType: type, size: declared });
      } catch (error) {
        throw overflow ?? error;
      }
      if (total !== declared) throw new AdminBadRequestError('The body is shorter than its Content-Length');
      await this.db.getRepository(NmaFile).insert({
        id,
        key,
        name,
        contentType: type,
        size: total,
        visibility,
        status: 'temp',
        resource: entry.schema.name,
        field,
        recordId: null,
        createdBy: userIdOf(ctx),
        // Set here rather than by the database's clock, so the 24-hour checks compare times written and read the same way.
        createdAt: now,
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    // An editor needs the URL to put in the HTML; a private file's is the admin's download route.
    const url = config.widget === 'richtext' ? this.url({ key, visibility }) : visibility === 'public' ? this.storage.publicUrl(key) : undefined;
    return { token: id, name, contentType: type, size: total, ...(url ? { url } : {}) };
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Who an upload belongs to, as `nma_file.createdBy` stores it. */
const userIdOf = (ctx: AdminContext): string | null => (ctx.user ? String(ctx.user.id).slice(0, 100) : null);

const fileFieldsOf = (entry: RegisteredResource): string[] =>
  [...entry.fieldConfig].filter(([, config]) => config.widget === 'file' || config.widget === 'image').map(([name]) => name);

const richFieldsOf = (...entries: RegisteredResource[]): string[] =>
  entries.flatMap((entry) => [...entry.fieldConfig].filter(([, config]) => config.widget === 'richtext').map(([name]) => name));

/** The keys a file column holds: one, a list, or none. */
function keysOf(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
}

/** Whether something before the admin consumed the request stream: it ended unread by us, or a parser left its result in `req.body`. */
function bodyAlreadyRead(req: AdminRequest): boolean {
  if (req.readableEnded) return true;
  const body = req.body;
  // body-parser 1.x sets `{}` on requests it skips, so only a body with content counts.
  if (Buffer.isBuffer(body) || typeof body === 'string') return true;
  return typeof body === 'object' && body !== null && Object.keys(body).length > 0;
}

function declaredLength(req: AdminRequest): number {
  const header = req.headers['content-length'];
  if (typeof header !== 'string' || !/^\d{1,15}$/.test(header)) throw new AdminBadRequestError('Content-Length is required');
  return Number(header);
}

/** `X-File-Name` (percent-encoded) as a plain name: no path, no control or reserved characters, at most 200 characters. */
export function cleanName(header: string | string[] | undefined, extension: string): string {
  let name = '';
  try {
    name = decodeURIComponent(Array.isArray(header) ? (header[0] ?? '') : (header ?? ''));
  } catch {
    name = '';
  }
  // eslint-disable-next-line no-control-regex
  name = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (name.length > 200) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 200 - ext.length) + ext;
  }
  return name === '' ? `file${extension}` : name;
}
