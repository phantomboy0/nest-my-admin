import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AdminRecord, BulkResult, FieldSchema, ListResponse, MetaResponse, OptionsResponse, ResourceSchema } from '../contract.js';
import { toErrorResponse } from '../http/error-response.js';
import { ADMIN_OPTIONS } from '../constants.js';
import { parseListQuery } from '../crud/list-query.js';
import { encodeRecordId, parseRecordId, recordIdOf } from '../crud/record-id.js';
import { likePattern } from '../crud/list-query-builder.js';
import { parseId } from '../crud/list-query.js';
import { isLoadedField, loadReferences, relationRef } from '../crud/references.js';
import { relationIdsOf, type RelationId } from '../crud/relation-writes.js';
import { serializeRecord } from '../crud/serialize.js';
import { validateWrite } from '../crud/validate-write.js';
import { AdminBadRequestError, AdminConflictError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import { AdminContext, runInAdminContext } from '../resource/admin-context.js';
import type { RecordId } from '../resource/admin-resource-base.js';

/** TypeORM drivers that share ONE query runner (and one transaction depth counter) across all callers. */
const SINGLE_CONNECTION_DRIVERS = new Set(['sqljs', 'sqlite', 'better-sqlite3', 'capacitor', 'cordova', 'expo', 'react-native', 'nativescript']);

/** Most ids one bulk request may name (a list page). */
const MAX_BULK = 100;

@Injectable()
export class AdminApiService {
  private readonly logger = new Logger('NestMyAdmin');
  /**
   * Tail of the write queue per single-connection DataSource, so admin transactions never interleave.
   * A write whose host code never settles blocks every later admin write on that SQLite DataSource.
   */
  private readonly writeQueues = new WeakMap<DataSource, Promise<unknown>>();

  constructor(
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  /** Sidebar data with labels in `locale` (the default locale when omitted). */
  meta(locale = this.options.locale): MetaResponse {
    const text = (label: LocalizedText) => resolveText(label, locale, this.options.locale);
    const resources = this.registry.list();
    const groups = this.registry
      .groupList()
      .map((group) => ({
        group,
        label: text(group.label),
        resources: resources
          .filter((entry) => entry.schema.group === group.key)
          .map(({ schema, label }) => ({ name: schema.name, label: text(label), ...(schema.icon ? { icon: schema.icon } : {}) }))
          .sort((a, b) => a.label.localeCompare(b.label, locale)),
      }))
      .filter((entry) => entry.resources.length > 0)
      .sort((a, b) => a.group.order - b.group.order || a.label.localeCompare(b.label, locale))
      .map(({ group, label, resources: items }) => ({
        key: group.key,
        label,
        ...(group.icon ? { icon: group.icon } : {}),
        resources: items,
      }));
    return { schemaVersion: 1, title: text(this.options.title), locale, locales: this.options.locales, groups };
  }

  /** A resource's schema with its labels in `locale`. */
  schema(name: string, locale = this.options.locale): ResourceSchema {
    const entry = this.registry.get(name);
    const text = (label: LocalizedText) => resolveText(label, locale, this.options.locale);
    const related = entry.schema.related.map((item, index) => {
      const base = text(this.registry.get(item.resource).label);
      const fieldLabel = entry.relatedFieldLabels[index];
      return { ...item, label: fieldLabel ? `${base} (${fieldLabel})` : base };
    });
    return { ...entry.schema, label: text(entry.label), related };
  }

  async list(name: string, query: URLSearchParams, ctx: AdminContext): Promise<ListResponse> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const params = parseListQuery(query, schema);
    // A relation sorted by its target's title column (`sort=customer` → `customer.name`).
    const sortPath = entry.sortPaths.get(params.sort.field);
    if (sortPath) params.sort = { ...params.sort, field: sortPath };
    const { items, total, estimated, hasMore, nextCursor } = await resource.findMany(params, ctx);
    const loaded = schema.fields.filter((field) => isLoadedField(field) && schema.list.columns.includes(field.name));
    return {
      items: await this.records(entry, items, loaded, ctx),
      total: total ?? null,
      ...(estimated ? { estimated: true } : {}),
      ...(hasMore !== undefined ? { hasMore } : {}),
      ...(params.pagination === 'keyset' ? { nextCursor: nextCursor ?? null } : {}),
      page: params.page,
      pageSize: params.pageSize,
    };
  }

  async get(name: string, rawId: string, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const entity = await resource.findOne(parseRecordId(rawId, schema), ctx);
    if (!entity) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    return this.record(entry, entity, ctx);
  }

  /** Serializes entities with their relation values and paths (`fields`) loaded and their titles. */
  private async records(entry: RegisteredResource, entities: object[], fields: FieldSchema[], ctx: AdminContext): Promise<AdminRecord[]> {
    const { schema } = entry;
    const manager: EntityManager = ctx.manager ?? entry.dataSource.manager;
    const loaded = fields.length > 0 ? await loadReferences(entry, entities, fields, { registry: this.registry, manager }) : undefined;
    const discriminator = entry.metadata.discriminatorColumn?.propertyName;
    const kindOf = (entity: object) =>
      entry.metadata.childEntityMetadatas.find((child) => child.target === entity.constructor)?.discriminatorValue ?? entry.metadata.discriminatorValue;
    return entities.map((entity) => {
      const id = recordIdOf(entity, schema.primaryKeys);
      // TypeORM does not load the discriminator into entities; each row's class says which kind it is.
      const values = discriminator && schema.fields.some((field) => field.name === discriminator) ? { ...loaded?.get(id), [discriminator]: kindOf(entity) } : loaded?.get(id);
      return serializeRecord(entity, schema.fields, values, { id, title: entry.title(entity) });
    });
  }

  /** One record with every relation field loaded (detail and write responses). */
  private async record(entry: RegisteredResource, entity: object, ctx: AdminContext): Promise<AdminRecord> {
    const relations = entry.schema.fields.filter((field) => field.type === 'relation');
    return (await this.records(entry, [entity], relations, ctx))[0]!;
  }

  /** Runs a write in one transaction (unless disabled) with ctx.manager set and AdminContext.current() pointing at it. */
  private async write<T>(entry: RegisteredResource, ctx: AdminContext, work: (ctx: AdminContext) => Promise<T>): Promise<T> {
    if (!this.options.transactions) return work(ctx);
    const { dataSource } = entry;
    // Re-entrant write (host code inside a write calls the API again on the same DataSource): join the outer
    // transaction; queueing behind it would deadlock. There is no savepoint: if host code catches a failed nested
    // write and carries on, the nested rows commit with the outer transaction. `manager.connection` is deprecated
    // in TypeORM 1.x but is the only property that exists on both 0.3 and 1.x.
    const outer = AdminContext.current();
    if (outer?.manager && outer.manager.connection === dataSource) return work(outer);
    const run = () =>
      dataSource.transaction(async (manager) => {
        const transactional: AdminContext = { ...ctx, manager };
        return runInAdminContext(transactional, () => work(transactional));
      });
    if (!SINGLE_CONNECTION_DRIVERS.has(dataSource.options.type)) return run();
    // One shared query runner: a second BEGIN would nest into (and roll back with) the first, so queue writes.
    const previous = this.writeQueues.get(dataSource) ?? Promise.resolve();
    const result = previous.then(run);
    this.writeQueues.set(dataSource, result.catch(() => undefined));
    return result;
  }

  async create(name: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    if (!schema.creatable) {
      const children = this.registry
        .list()
        .filter((candidate) => entry.metadata.childEntityMetadatas.some((child) => child.target === candidate.entity))
        .map((candidate) => candidate.schema.label);
      throw new AdminBadRequestError(
        `${schema.label} records are created as one of their kinds${children.length > 0 ? `: ${children.join(', ')}` : ''}`,
      );
    }
    const dto = await validateWrite(body, { allowed: schema.form.create, dto: resource.form?.create, fields: schema.fields });
    const relationIds = relationIdsOf(dto, schema);
    return this.write(entry, ctx, async (tx) => {
      await this.checkRelationsExist(entry, relationIds, tx, dto as Record<string, unknown>);
      const created: unknown = await resource.create(dto, tx);
      if (typeof created !== 'object' || created === null) {
        throw new Error(`${entry.className}.create() must return the created entity`);
      }
      return this.record(entry, created, tx);
    });
  }

  async update(name: string, rawId: string, body: unknown, ctx: AdminContext, version?: number): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    const updateDto = resource.form?.update;
    const dto = await validateWrite(body, {
      allowed: schema.form.update,
      dto: updateDto ?? resource.form?.create,
      partial: true, // PATCH validates only the keys that were sent, dedicated update DTO or not
      fields: schema.fields,
    });
    const relationIds = relationIdsOf(dto, schema);
    return this.write(entry, ctx, async (tx) => {
      await this.checkVersion(entry, id, version, tx);
      const existing = await resource.findOne(id, tx);
      if (!existing) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
      if ([...relationIds.values()].some((ids) => ids.length > 0)) {
        // relationOptions() sees the record as it will be: what is stored, with the request's changes on top.
        const values = { ...toValues(await this.record(entry, existing, tx)), ...(dto as Record<string, unknown>) };
        await this.checkRelationsExist(entry, relationIds, tx, values);
      }
      const updated: unknown = await resource.update(id, dto, tx);
      return this.record(entry, await this.reloadIfEmpty(entry, updated, id, tx), tx);
    });
  }

  async remove(name: string, rawId: string, ctx: AdminContext, version?: number): Promise<void> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    await this.write(entry, ctx, async (tx) => {
      await this.checkVersion(entry, id, version, tx);
      if (!(await resource.findOne(id, tx))) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
      await resource.delete(id, tx);
    });
  }

  /**
   * Optimistic concurrency (`If-Match`): inside the write transaction, reads the row, locked on drivers that lock rows
   * (SQLite-family writes are already serialized), and answers 409 with the current record when its version is not
   * the one the client edited. Runs before the resource method, so host services are covered too.
   */
  private async checkVersion(entry: RegisteredResource, id: RecordId, expected: number | undefined, ctx: AdminContext, withDeleted = false): Promise<void> {
    const version = entry.schema.version;
    if (expected === undefined || !version) return;
    const manager = ctx.manager ?? entry.dataSource.manager;
    const lock = ctx.manager && !SINGLE_CONNECTION_DRIVERS.has(entry.dataSource.options.type) ? ({ mode: 'pessimistic_write' } as const) : undefined;
    const where = typeof id === 'object' ? id : { [entry.schema.primaryKeys[0]!]: id };
    const current = await manager.getRepository(entry.metadata.target).findOne({ where, withDeleted, ...(lock ? { lock } : {}) });
    if (!current) return; // the resource's own findOne answers 404
    if (Number((current as Record<string, unknown>)[version]) === expected) return;
    throw new AdminConflictError(`${entry.schema.label} was changed by someone else since you opened it`, await this.record(entry, current, ctx));
  }

  /**
   * A query for the records a relation field may point to (`option`), restricted by the target resource's query() and
   * this resource's relationOptions().
   */
  private optionsQuery(entry: RegisteredResource, field: string, ctx: AdminContext, values: Record<string, unknown>) {
    const target = entry.relations.get(field)!.inverseEntityMetadata;
    const manager = ctx.manager ?? entry.dataSource.manager;
    const qb = manager.getRepository(target.target).createQueryBuilder('option');
    // The target resource's query() restricts what may be picked, before this field's relationOptions().
    const targetEntry = this.registry.forEntity(target.target, entry.dataSource);
    return entry.resource.relationOptions(field, targetEntry ? targetEntry.resource.query(qb, ctx) : qb, ctx, values);
  }

  /**
   * Every id sent for a relation must name a record the field may point to (relationOptions()), else the write is a
   * 422 on that field before the resource method runs. Missing and not-allowed records get the same message.
   */
  private async checkRelationsExist(
    entry: RegisteredResource,
    idsByField: Map<string, RelationId[]>,
    ctx: AdminContext,
    values: Record<string, unknown>,
  ): Promise<void> {
    const errors: Record<string, string[]> = {};
    for (const [field, ids] of idsByField) {
      if (ids.length === 0) continue;
      const target = entry.relations.get(field)!.inverseEntityMetadata;
      const key = target.primaryColumns[0]!.propertyName;
      const rows: Array<{ id: unknown }> = await this.optionsQuery(entry, field, ctx, values)
        .andWhere(`option.${key} IN (:...nmaIds)`, { nmaIds: ids })
        .select(`option.${key}`, 'id')
        .getRawMany();
      const found = new Set(rows.map((row) => String(row.id).toLowerCase()));
      const missing = ids.filter((id) => !found.has(String(id).toLowerCase()));
      if (missing.length === 0) continue;
      const many = entry.schema.fields.find((candidate) => candidate.name === field)?.relation?.kind === 'to-many';
      errors[field] = [many ? `these records do not exist: ${missing.join(', ')}` : 'does not exist'];
    }
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors, 'A related record does not exist');
  }

  /**
   * Options of a relation field's picker: `?search=` (up to 20, matched against the target resource's plain
   * `list.search` fields, else its title column) or `?ids=` (up to 100, to show titles of known ids).
   */
  async fieldOptions(name: string, fieldName: string, query: URLSearchParams, ctx: AdminContext): Promise<OptionsResponse> {
    const entry = this.registry.get(name);
    const field = entry.schema.fields.find((candidate) => candidate.name === fieldName);
    if (!field) throw new AdminNotFoundError(`Unknown field "${fieldName}"`);
    if (field.type !== 'relation') throw new AdminBadRequestError(`"${fieldName}" is not a relation field`);
    const known = new Set(['search', 'ids', 'values']);
    for (const key of new Set(query.keys())) {
      if (!known.has(key) || query.getAll(key).length > 1) {
        throw new AdminValidationError({ [key]: [known.has(key) ? 'must be given once' : 'is not a supported parameter'] });
      }
    }
    const values = parseValues(query.get('values'));
    const relation = entry.relations.get(fieldName)!;
    const target = relation.inverseEntityMetadata;
    const key = target.primaryColumns[0]!.propertyName;
    const title = this.registry.titleFor(target, entry.dataSource);
    const qb = this.optionsQuery(entry, fieldName, ctx, values);

    const rawIds = query.get('ids');
    const search = query.get('search')?.trim() ?? '';
    if (rawIds !== null) {
      const parts = rawIds.split(',').map((part) => part.trim());
      const ids = parts.map((part) => parseId(field, part));
      if (parts.length > 100 || ids.some((id) => 'error' in id)) throw new AdminValidationError({ ids: ['must be 1 to 100 comma-separated ids'] });
      qb.andWhere(`option.${key} IN (:...nmaIds)`, { nmaIds: ids.map((id) => (id as { value: RelationId }).value) }).take(100);
    } else {
      if (search.length > 200) throw new AdminValidationError({ search: ['must be at most 200 characters'] });
      if (search) {
        const targetEntry = this.registry.forEntity(target.target, entry.dataSource);
        const fields = targetEntry ? targetEntry.schema.list.search.filter((name) => !name.includes('.')) : title.column ? [title.column] : [];
        if (fields.length === 0) throw new AdminValidationError({ search: [`${field.label} options cannot be searched`] });
        const clauses = fields.map((name) => `LOWER(option.${name}) LIKE LOWER(:nmaSearch) ESCAPE '!'`);
        qb.andWhere(`(${clauses.join(' OR ')})`, { nmaSearch: likePattern(search, 'anywhere') });
      }
      qb.take(20);
    }
    if (title.column) qb.orderBy(`option.${title.column}`, 'ASC').addOrderBy(`option.${key}`, 'ASC');
    else qb.orderBy(`option.${key}`, 'ASC');
    const rows = await qb.getMany();
    return { items: rows.map((row) => relationRef(field, relation, row, title)) };
  }

  /**
   * Deletes each record on its own (its own transaction, hooks, `query()` and trash), so one failure never undoes the
   * others. Answers `{ ok, failed }` in request order; failures carry the code and message the single DELETE would.
   */
  async bulkDelete(name: string, body: unknown, ctx: AdminContext): Promise<BulkResult> {
    const entry = this.registry.get(name);
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK || ids.some((id) => typeof id !== 'string' || id === '')) {
      throw new AdminValidationError({ ids: [`must be a list of 1 to ${MAX_BULK} record ids`] });
    }
    const result: BulkResult = { ok: [], failed: [] };
    for (const id of new Set(ids as string[])) {
      try {
        await this.remove(name, id, ctx);
        result.ok.push(id);
      } catch (error) {
        const { body: failure } = toErrorResponse(error, ctx.correlationId, this.logger, {
          dbNames: entry.dbNames,
          errorMapper: this.options.errorMapper,
          deleting: true,
        });
        result.failed.push({ id, code: failure.code, message: failure.message });
      }
    }
    return result;
  }

  /** Takes a record out of the trash. */
  async restore(name: string, rawId: string, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    if (!schema.softDelete) throw new AdminBadRequestError(`${schema.label} records have no trash`);
    const id = parseRecordId(rawId, schema);
    return this.write(entry, ctx, async (tx) => this.record(entry, await resource.restore(id, tx), tx));
  }

  /** Removes a record for good (trashed or not). */
  async purge(name: string, rawId: string, ctx: AdminContext, version?: number): Promise<void> {
    const entry = this.registry.get(name);
    const id = parseRecordId(rawId, entry.schema);
    await this.write(entry, ctx, async (tx) => {
      await this.checkVersion(entry, id, version, tx, true);
      await entry.resource.purge(id, tx);
    });
  }

  /** Host services often return nothing from update(); fall back to reading the record. */
  private async reloadIfEmpty(entry: RegisteredResource, result: unknown, id: RecordId, ctx: AdminContext): Promise<object> {
    if (typeof result === 'object' && result !== null) return result;
    const reloaded = await entry.resource.findOne(id, ctx);
    if (!reloaded) throw new AdminNotFoundError(`${entry.schema.label} "${typeof id === 'object' ? encodeRecordId(Object.values(id)) : id}" not found`);
    return reloaded;
  }
}

/** A serialized record as relationOptions() values: relation refs become ids. */
function toValues(record: AdminRecord): Record<string, unknown> {
  const isRef = (value: unknown): value is { id: unknown } => typeof value === 'object' && value !== null && 'id' in value && 'title' in value;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !key.startsWith('_'))
      .map(([key, value]) => [key, Array.isArray(value) ? value.map((item) => (isRef(item) ? item.id : item)) : isRef(value) ? value.id : value]),
  );
}

/** `?values=` of the options endpoint: the form's current values as a JSON object (at most 4 KB). */
function parseValues(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = raw.length <= 4096 ? JSON.parse(raw) : undefined;
  } catch {
    parsed = undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AdminValidationError({ values: ['must be a JSON object of at most 4096 characters'] });
  }
  return parsed as Record<string, unknown>;
}
