import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DataSource } from 'typeorm';
import type { UploadResponse } from '../contract.js';
import { ADMIN_OPTIONS } from '../constants.js';
import { AdminBadRequestError, AdminForbiddenError, AdminNotFoundError, AdminPayloadTooLargeError, AdminUnsupportedMediaTypeError, AdminValidationError } from '../errors.js';
import type { AdminRequest } from '../http/http-io.js';
import type { ResolvedAdminOptions } from '../options.js';
import { AdminPolicy } from '../policy/admin-policy.service.js';
import { ResourceRegistry } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import { NmaFile } from './entities.js';
import { accepts, extensionOf, sniff } from './sniff.js';
import type { AdminStorage } from './storage.js';

/** Bytes read before the type is decided; enough for every magic number and the first entries of a zip. */
const HEAD_BYTES = 8192;

/** Types a foreign page can send without a CORS preflight: refused, so an upload cannot be forged cross-site. */
const SIMPLE_TYPES = new Set(['text/plain', 'multipart/form-data', 'application/x-www-form-urlencoded']);

/** Uploads to file and image fields (spec §8.2). Task-2 additions (tokens, attach, cleanup) build on `db` and `storage`. */
@Injectable()
export class FilesService implements OnApplicationBootstrap {
  private dataSource?: DataSource;

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

  onApplicationBootstrap(): void {
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
    if (config?.widget !== 'file' && config?.widget !== 'image') throw new AdminValidationError({ [field]: ['is not a file field'] });
    if (this.policy.levels(entry, ctx).get(field) !== 'edit') throw new AdminForbiddenError(`You may not change ${field}`);

    const limit = config.file?.maxBytes ?? files.maxBytes;
    const accept = config.file?.accept ?? (config.widget === 'image' ? ['image/*'] : ['*/*']);
    const visibility = config.file?.visibility ?? 'private';
    const declared = declaredLength(req);
    if (declared > limit) throw new AdminPayloadTooLargeError(`The file is larger than the ${limit} byte limit`);

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
        createdBy: ctx.user ? String(ctx.user.id).slice(0, 100) : null,
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
    const url = visibility === 'public' ? this.storage.publicUrl(key) : undefined;
    return { token: id, name, contentType: type, size: total, ...(url ? { url } : {}) };
  }
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
