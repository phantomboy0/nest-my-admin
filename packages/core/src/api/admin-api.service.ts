import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { AdminRecord, FieldSchema, ListResponse, MetaResponse, OptionsResponse, ResourceSchema } from '../contract.js';
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
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import { AdminContext, runInAdminContext } from '../resource/admin-context.js';
import type { RecordId } from '../resource/admin-resource-base.js';

/** TypeORM drivers that share ONE query runner (and one transaction depth counter) across all callers. */
const SINGLE_CONNECTION_DRIVERS = new Set(['sqljs', 'sqlite', 'better-sqlite3', 'capacitor', 'cordova', 'expo', 'react-native', 'nativescript']);

@Injectable()
export class AdminApiService {
  /**
   * Tail of the write queue per single-connection DataSource, so admin transactions never interleave.
   * A write whose host code never settles blocks every later admin write on that SQLite DataSource.
   */
  private readonly writeQueues = new WeakMap<DataSource, Promise<unknown>>();

  constructor(
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  meta(): MetaResponse {
    const resources = this.registry.list();
    const groups = this.registry
      .groupList()
      .map((group) => ({
        group,
        resources: resources
          .filter((entry) => entry.schema.group === group.key)
          .map(({ schema }) => ({ name: schema.name, label: schema.label, ...(schema.icon ? { icon: schema.icon } : {}) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .filter((entry) => entry.resources.length > 0)
      .sort((a, b) => a.group.order - b.group.order || a.group.label.localeCompare(b.group.label))
      .map(({ group, resources: items }) => ({
        key: group.key,
        label: group.label,
        ...(group.icon ? { icon: group.icon } : {}),
        resources: items,
      }));
    return { schemaVersion: 1, title: this.options.title, groups };
  }

  schema(name: string): ResourceSchema {
    return this.registry.get(name).schema;
  }

  async list(name: string, query: URLSearchParams, ctx: AdminContext): Promise<ListResponse> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const params = parseListQuery(query, schema);
    const { items, total } = await resource.findMany(params, ctx);
    const loaded = schema.fields.filter((field) => isLoadedField(field) && schema.list.columns.includes(field.name));
    return { items: await this.records(entry, items, loaded, ctx), total, page: params.page, pageSize: params.pageSize };
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
      await this.checkRelationsExist(entry, relationIds, tx);
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
      if (!(await resource.findOne(id, tx))) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
      await this.checkRelationsExist(entry, relationIds, tx);
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
  private async checkVersion(entry: RegisteredResource, id: RecordId, expected: number | undefined, ctx: AdminContext): Promise<void> {
    const version = entry.schema.version;
    if (expected === undefined || !version) return;
    const manager = ctx.manager ?? entry.dataSource.manager;
    const lock = ctx.manager && !SINGLE_CONNECTION_DRIVERS.has(entry.dataSource.options.type) ? ({ mode: 'pessimistic_write' } as const) : undefined;
    const where = typeof id === 'object' ? id : { [entry.schema.primaryKeys[0]!]: id };
    const current = await manager.getRepository(entry.metadata.target).findOne({ where, ...(lock ? { lock } : {}) });
    if (!current) return; // the resource's own findOne answers 404
    if (Number((current as Record<string, unknown>)[version]) === expected) return;
    throw new AdminConflictError(`${entry.schema.label} was changed by someone else since you opened it`, await this.record(entry, current, ctx));
  }

  /** A query for the records a relation field may point to (`option`), restricted by the resource's relationOptions(). */
  private optionsQuery(entry: RegisteredResource, field: string, ctx: AdminContext) {
    const target = entry.relations.get(field)!.inverseEntityMetadata;
    const manager = ctx.manager ?? entry.dataSource.manager;
    return entry.resource.relationOptions(field, manager.getRepository(target.target).createQueryBuilder('option'), ctx);
  }

  /**
   * Every id sent for a relation must name a record the field may point to (relationOptions()), else the write is a
   * 422 on that field before the resource method runs. Missing and not-allowed records get the same message.
   */
  private async checkRelationsExist(entry: RegisteredResource, idsByField: Map<string, RelationId[]>, ctx: AdminContext): Promise<void> {
    const errors: Record<string, string[]> = {};
    for (const [field, ids] of idsByField) {
      if (ids.length === 0) continue;
      const target = entry.relations.get(field)!.inverseEntityMetadata;
      const key = target.primaryColumns[0]!.propertyName;
      const rows: Array<{ id: unknown }> = await this.optionsQuery(entry, field, ctx)
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
    for (const key of new Set(query.keys())) {
      if ((key !== 'search' && key !== 'ids') || query.getAll(key).length > 1) {
        throw new AdminValidationError({ [key]: [key === 'search' || key === 'ids' ? 'must be given once' : 'is not a supported parameter'] });
      }
    }
    const relation = entry.relations.get(fieldName)!;
    const target = relation.inverseEntityMetadata;
    const key = target.primaryColumns[0]!.propertyName;
    const title = this.registry.titleFor(target, entry.dataSource);
    const qb = this.optionsQuery(entry, fieldName, ctx);

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

  /** Host services often return nothing from update(); fall back to reading the record. */
  private async reloadIfEmpty(entry: RegisteredResource, result: unknown, id: RecordId, ctx: AdminContext): Promise<object> {
    if (typeof result === 'object' && result !== null) return result;
    const reloaded = await entry.resource.findOne(id, ctx);
    if (!reloaded) throw new AdminNotFoundError(`${entry.schema.label} "${typeof id === 'object' ? encodeRecordId(Object.values(id)) : id}" not found`);
    return reloaded;
  }
}
