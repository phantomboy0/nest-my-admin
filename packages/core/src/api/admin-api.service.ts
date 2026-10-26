import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import type { ActionResult, AdminRecord, BulkResult, FieldSchema, ListResponse, MetaPageSummary, MetaResourceSummary, MetaResponse, OptionsResponse, PageResponse, RecordLink, ResourceSchema, SearchResponse } from '../contract.js';
import { applyFieldConfig, localizeLayout } from '../schema/field-config.js';
import { inlineOf, toLayoutInline } from '../inlines/inline-config.js';
import { InlineReader } from '../inlines/inline-reader.js';
import { InlineWriter, type InlinePlan } from '../inlines/inline-writer.js';
import { persianLike } from '../i18n/persian.js';
import { toErrorResponse } from '../http/error-response.js';
import { toActionSchema } from '../decorators/admin-action.js';
import { ADMIN_OPTIONS, MAX_BULK } from '../constants.js';
import { parseListQuery } from '../crud/list-query.js';
import { encodeRecordId, parseRecordId, recordIdOf } from '../crud/record-id.js';
import { likePattern } from '../crud/list-query-builder.js';
import { parseId } from '../crud/list-query.js';
import { isLoadedField, loadReferences, relationRef } from '../crud/references.js';
import { relationIdsOf, type RelationId } from '../crud/relation-writes.js';
import { serializeRecord } from '../crud/serialize.js';
import { validateWrite } from '../crud/validate-write.js';
import { auditParticipant } from '../audit/audit-participant.js';
import { AdminAudit } from '../audit/audit.service.js';
import { filesParticipant } from '../files/files-participant.js';
import { FilesService } from '../files/files.service.js';
import { AdminBadRequestError, AdminConflictError, AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { AdminPolicy, type ResourceView } from '../policy/admin-policy.service.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import { AdminResourceBase, type ListParams, type RecordId, type RecordLinkConfig } from '../resource/admin-resource-base.js';
import { PageRegistry } from '../pages/page-registry.js';
import { PageService } from '../pages/page.service.js';
import { ActionService } from './action.service.js';
import type { WriteChange } from './write-participant.js';
import { SINGLE_CONNECTION_DRIVERS } from './write-queue.js';
import { WriteRunner } from './write-runner.js';

@Injectable()
export class AdminApiService {
  private readonly logger = new Logger('NestMyAdmin');
  /** The write transaction and what takes part in every change made inside it: files, then the audit log. */
  private readonly writes: WriteRunner;

  constructor(
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
    private readonly policy: AdminPolicy,
    private readonly files: FilesService,
    pages: PageRegistry,
    audit: AdminAudit,
  ) {
    // Without `audit` nothing is recorded: the audit log is not even a participant.
    this.writes = new WriteRunner(options, this.logger, [filesParticipant(files), ...(audit.enabled ? [auditParticipant(audit)] : [])]);
    this.pages = new PageService({ pages, policy, options, files, writes: this.writes });
    this.actions = new ActionService({ policy, options, logger: this.logger, writes: this.writes, record: (entry, entity, ctx) => this.record(entry, entity, ctx) });
    this.inlines = new InlineReader({ policy, serialize: (entry, entities, ctx) => this.fullRecords(entry, entities, ctx) });
    this.inlineWriter = new InlineWriter({
      policy,
      view: (entry, ctx) => this.view(entry, ctx),
      sanitizeHtml: (html) => files.sanitizeHtml(html),
      change: (change, tx, method) => this.change(change, tx, method),
      checkRelationsExist: (entry, ids, ctx, values) => this.checkRelationsExist(entry, ids, ctx, values),
      checkVersion: (entry, id, expected, ctx) => this.checkVersion(entry, id, expected, ctx),
      lockedFields: (entry, entity) => this.lockedFields(entry, entity),
      values: async (entry, entity, ctx) => toValues(await this.record(entry, entity, ctx)),
      reloadIfEmpty: (entry, result, id, ctx) => this.reloadIfEmpty(entry, result, id, ctx),
      errorMapper: options.errorMapper,
    });
  }

  /** `_inlines` of a POST or PATCH: the children's changes, saved inside the parent's write. */
  private readonly inlineWriter: InlineWriter;

  /** `_inlines` of a record: its children through each child resource's read path. */
  private readonly inlines: InlineReader;

  /** Runs `@AdminAction`s; it writes and serializes through this service. */
  private readonly actions: ActionService;

  /** Settings pages; they save through this service's write transaction. */
  private readonly pages: PageService;

  /** The resource as this request's user sees it (cached per request). */
  private readonly views = new WeakMap<AdminContext, Map<string, ResourceView>>();
  private view(entry: RegisteredResource, ctx: AdminContext): ResourceView {
    let byName = this.views.get(ctx);
    if (!byName) this.views.set(ctx, (byName = new Map()));
    let view = byName.get(entry.schema.name);
    if (!view) byName.set(entry.schema.name, (view = this.policy.view(entry, entry.schema, ctx)));
    return view;
  }

  /** Sidebar data with labels in `locale` (the default locale when omitted). */
  meta(locale = this.options.locale, ctx?: AdminContext): MetaResponse {
    const text = (label: LocalizedText) => resolveText(label, locale, this.options.locale);
    // Only resources the user may view (spec §6.5: meta is filtered per user).
    // `nav: false` resources have no entry of their own (spec §5): reachable by URL, not listed.
    const resources = this.registry.list().filter((entry) => entry.nav && (!ctx || this.policy.permissionsOf(ctx).canOn(entry.schema.name, 'view')));
    const pages = this.pages.summaries(locale, ctx);
    // Inside a group: `order` first (lower first), then the label in the request's language.
    const byOrder = (a: { order: number; summary: { label: string } }, b: { order: number; summary: { label: string } }) =>
      a.order - b.order || a.summary.label.localeCompare(b.summary.label, locale);
    const groups = this.registry
      .groupList()
      .map((group) => ({
        group,
        label: text(group.label),
        resources: resources
          .filter((entry) => entry.schema.group === group.key)
          .map((entry) => {
            const { schema, label } = entry;
            const seen = ctx ? this.view(entry, ctx).schema : schema;
            const summary: MetaResourceSummary = { name: schema.name, label: text(label), ...(schema.icon ? { icon: schema.icon } : {}), creatable: seen.creatable, searchable: seen.list.search.length > 0 };
            return { order: entry.order, summary };
          })
          .sort(byOrder)
          .map(({ summary }) => summary),
        pages: pages
          .filter((page) => page.group === group.key)
          .map(({ group: _group, order, ...summary }) => ({ order, summary: summary as MetaPageSummary }))
          .sort(byOrder)
          .map(({ summary }) => summary),
      }))
      // A group may hold only settings pages.
      .filter((entry) => entry.resources.length > 0 || entry.pages.length > 0)
      .sort((a, b) => a.group.order - b.group.order || a.label.localeCompare(b.label, locale))
      .map(({ group, label, resources: items, pages: groupPages }) => ({
        key: group.key,
        label,
        ...(group.icon ? { icon: group.icon } : {}),
        resources: items,
        pages: groupPages,
      }));
    return { schemaVersion: 1, title: text(this.options.title), locale, locales: this.options.locales, groups };
  }

  /** A resource's schema with its labels in `locale`. */
  schema(name: string, locale = this.options.locale, ctx?: AdminContext): ResourceSchema {
    const entry = this.registry.get(name);
    if (ctx) this.policy.requireReach(entry, ctx);
    const text = (label: LocalizedText) => resolveText(label, locale, this.options.locale);
    const related = entry.schema.related.map((item, index) => {
      const base = text(this.registry.get(item.resource).label);
      const fieldLabel = entry.relatedFieldLabels[index];
      return { ...item, label: fieldLabel ? `${base} (${fieldLabel})` : base };
    });
    const fields = entry.schema.fields.map((field) => applyFieldConfig(field, entry.fieldConfig.get(field.name), locale, this.options.locale, this.options.files?.maxBytes, this.files.enabled));
    const layout = entry.resource.form?.layout;
    const inline = (node: Parameters<typeof inlineOf>[1], label: string | undefined) => toLayoutInline(inlineOf(entry, node), label, locale, this.options.locale);
    const form = layout ? { ...entry.schema.form, layout: localizeLayout(layout, locale, this.options.locale, inline) } : entry.schema.form;
    const actions = [...entry.actions.values()].map((action) => toActionSchema(action, locale, this.options.locale));
    const localized = { ...entry.schema, label: text(entry.label), related, fields, form, actions };
    const schema = ctx ? this.policy.view(entry, localized, ctx).schema : localized;
    // The child schema of every inline left in the layout (the policy removed those the user may not view).
    const children = (schema.form.layout ?? []).flatMap((node) => ('tab' in node ? node.sections : [node])).flatMap((node) => ('inline' in node ? [node.inline] : []));
    return children.length > 0 ? { ...schema, inlines: Object.fromEntries(children.map((child) => [child, this.schema(child, locale, ctx)])) } : schema;
  }

  async list(name: string, query: URLSearchParams, ctx: AdminContext): Promise<ListResponse> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'view', ctx);
    const { resource } = entry;
    // Anti-oracle (spec §6.5): filters, sort and search accept only fields this user can see.
    const schema = this.view(entry, ctx).schema;
    const params = parseListQuery(query, schema);
    // A relation sorted by its target's title column (`sort=customer` → `customer.name`).
    const sortPath = entry.sortPaths.get(params.sort.field);
    if (sortPath) params.sort = { ...params.sort, field: sortPath };
    const found = await resource.findMany(params, ctx);
    const { total, estimated, hasMore, nextCursor } = found;
    let items = found.items;
    // A findMany override may ignore the scopes; rows outside them never leave (spec §6.4).
    if (resource.findMany !== AdminResourceBase.prototype.findMany && this.policy.scoped(entry, 'view', ctx)) {
      const allowed = await this.policy.allowedIds(entry, items.map((item) => this.idOf(entry, item)), 'view', ctx);
      items = items.filter((item) => allowed.has(recordIdOf(item, schema.primaryKeys)));
    }
    const mobile = schema.list.mobile;
    const shown = new Set([...schema.list.columns, ...(mobile ? [mobile.title, mobile.subtitle, mobile.badge, ...mobile.meta] : [])]);
    const loaded = schema.fields.filter((field) => isLoadedField(field) && shown.has(field.name));
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

  /**
   * Records matching `q` in every resource with `list.search`, through each resource's `findMany` (so `query()`
   * restrictions apply): up to `limit` (default 5) per resource, uncounted. A resource whose search fails is left out.
   */
  async search(query: URLSearchParams, ctx: AdminContext): Promise<SearchResponse> {
    const q = (query.get('q') ?? '').trim();
    if (q.length === 0 || q.length > 200) throw new AdminValidationError({ q: ['must be 1 to 200 characters'] });
    const rawLimit = query.get('limit');
    const limit = rawLimit === null ? 5 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new AdminValidationError({ limit: ['must be an integer from 1 to 20'] });
    const locale = ctx.locale ?? this.options.locale;
    const perms = this.policy.permissionsOf(ctx);
    const searchable = this.registry.list().filter((entry) => entry.nav && perms.canOn(entry.schema.name, 'view') && this.view(entry, ctx).schema.list.search.length > 0);
    const results = await Promise.all(
      searchable.map(async (entry) => {
        const schema = this.view(entry, ctx).schema;
        const sortPath = entry.sortPaths.get(schema.list.defaultSort.field);
        const params: ListParams = {
          page: 1,
          pageSize: limit,
          sort: sortPath ? { ...schema.list.defaultSort, field: sortPath } : schema.list.defaultSort,
          filters: [],
          search: { term: q, fields: schema.list.search },
          count: 'none',
          pagination: 'offset',
        };
        try {
          const { items, hasMore } = await entry.resource.findMany(params, ctx);
          if (items.length === 0) return undefined;
          return {
            resource: schema.name,
            label: resolveText(entry.label, locale, this.options.locale),
            items: items.map((entity) => {
              const id = recordIdOf(entity, schema.primaryKeys);
              return { _id: id, _title: this.policy.titleVisible(entry, ctx) ? entry.title(entity) : `#${id}` };
            }),
            hasMore: hasMore ?? items.length >= limit,
          };
        } catch (error) {
          this.warnOnce(`search: ${entry.className} failed (${error instanceof Error ? error.message : String(error)}); it is left out of the results`);
          return undefined;
        }
      }),
    );
    return { groups: results.filter((group) => group !== undefined) };
  }

  async get(name: string, rawId: string, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'view', ctx);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    const entity = await resource.findOne(id, ctx);
    if (!entity) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    await this.policy.requireInScope(entry, id, rawId, 'view', ctx); // a findOne override may ignore scopes
    const record = await this.record(entry, entity, ctx);
    if (entry.inlines.length > 0) await this.inlines.readInto(record, entry, entity, ctx);
    return record;
  }

  /** Serializes entities with their relation values and paths (`fields`) loaded and their titles. */
  private async records(entry: RegisteredResource, entities: object[], fields: FieldSchema[], ctx: AdminContext): Promise<AdminRecord[]> {
    // Only what this user may see is serialized (spec §6.5).
    const schema = this.view(entry, ctx).schema;
    const visible = new Set(schema.fields.map((field) => field.name));
    fields = fields.filter((field) => visible.has(field.name));
    const perms = await this.policy.recordPermissions(entry, entities, ctx);
    const titled = this.policy.titleVisible(entry, ctx);
    const manager: EntityManager = ctx.manager ?? entry.dataSource.manager;
    const loaded = fields.length > 0 ? await loadReferences(entry, entities, fields, { registry: this.registry, manager }) : undefined;
    const discriminator = entry.metadata.discriminatorColumn?.propertyName;
    const kindOf = (entity: object) =>
      entry.metadata.childEntityMetadatas.find((child) => child.target === entity.constructor)?.discriminatorValue ?? entry.metadata.discriminatorValue;
    const locale = ctx.locale ?? this.options.locale;
    const fileFields = this.files.enabled ? schema.fields.filter((field) => field.file).map((field) => field.name) : [];
    const files = fileFields.length > 0 ? await this.files.refs(this.files.ownerOf(entry), entities, fileFields, ctx) : undefined;
    const out = entities.map((entity, index) => {
      const id = recordIdOf(entity, schema.primaryKeys);
      const locked = this.lockedFields(entry, entity);
      const links = this.recordLinks(entry, entity, locale);
      // TypeORM does not load the discriminator into entities; each row's class says which kind it is.
      const values = discriminator && schema.fields.some((field) => field.name === discriminator) ? { ...loaded?.get(id), [discriminator]: kindOf(entity) } : loaded?.get(id);
      const record = serializeRecord(entity, schema.fields, values, { id, title: titled ? entry.title(entity) : `#${id}` });
      this.policy.maskReferences(entry, record, fields, ctx);
      const perm = perms?.get(id);
      if (perm) record._perm = perm;
      if (locked.length > 0) record._readonly = locked;
      if (links.length > 0) record._links = links;
      if (files) record._files = files[index];
      return record;
    });
    await this.policy.maskOutOfScope(entry, out, fields, ctx);
    return out;
  }

  /** One record with every relation field loaded (detail and write responses). */
  private async record(entry: RegisteredResource, entity: object, ctx: AdminContext): Promise<AdminRecord> {
    return (await this.fullRecords(entry, [entity], ctx))[0]!;
  }

  /** Records as the detail endpoint answers them, every relation field loaded (in one lookup per field, not per record). */
  private fullRecords(entry: RegisteredResource, entities: object[], ctx: AdminContext): Promise<AdminRecord[]> {
    const relations = this.view(entry, ctx).schema.fields.filter((field) => field.type === 'relation');
    return this.records(entry, entities, relations, ctx);
  }

  /** One transaction on the target's DataSource with `ctx.manager` set (see `WriteRunner.run`). */
  private write<T>(target: { dataSource: DataSource }, ctx: AdminContext, work: (ctx: AdminContext) => Promise<T>): Promise<T> {
    return this.writes.run(target, ctx, work);
  }

  /** One change inside a write, with every participant around the host `method` (see `WriteRunner.change`). */
  private change<T>(change: WriteChange, tx: AdminContext, method: () => Promise<T>): Promise<T> {
    return this.writes.change(change, tx, method);
  }

  async create(name: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { resource } = entry;
    // A read-only resource answers 403 (it refuses writes), not the 400 of a resource that cannot be created.
    if (entry.schema.creatable || entry.schema.readonly) this.policy.require(entry, 'create', ctx);
    else this.policy.requireReach(entry, ctx);
    const schema = this.view(entry, ctx).schema;
    if (!entry.schema.creatable) {
      const children = this.registry
        .list()
        .filter((candidate) => entry.metadata.childEntityMetadatas.some((child) => child.target === candidate.entity))
        .map((candidate) => candidate.schema.label);
      throw new AdminBadRequestError(
        `${schema.label} records are created as one of their kinds${children.length > 0 ? `: ${children.join(', ')}` : ''}`,
      );
    }
    const { own, inlines } = splitInlines(entry, body);
    this.policy.checkWriteFields(entry, own, entry.schema.form.create, ctx);
    const [dto, plan] = await this.withInlines(entry, inlines, ctx, true, () =>
      validateWrite(own, { allowed: schema.form.create, dto: resource.form?.create, fields: schema.fields, sanitizeHtml: (html) => this.files.sanitizeHtml(html) }),
    );
    const relationIds = relationIdsOf(dto, schema);
    return this.write(entry, ctx, async (tx) => {
      // Every refusal the children can cause is decided before the parent is written.
      const checked = plan ? await this.inlineWriter.check(plan, undefined, tx) : undefined;
      const created = await this.change({ kind: 'create', target: entry, dto }, tx, async () => {
        await this.checkRelationsExist(entry, relationIds, tx, dto as Record<string, unknown>);
        const result: unknown = await resource.create(dto, tx);
        if (typeof result !== 'object' || result === null) {
          throw new Error(`${entry.className}.create() must return the created entity`);
        }
        return result;
      });
      if (plan) await this.inlineWriter.apply(plan, checked!, created, tx);
      return this.withInlineRows(entry, created, tx);
    });
  }

  async update(name: string, rawId: string, body: unknown, ctx: AdminContext, version?: number): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'update', ctx);
    const { resource } = entry;
    const schema = this.view(entry, ctx).schema;
    const id = parseRecordId(rawId, schema);
    const { own, inlines } = splitInlines(entry, body);
    this.policy.checkWriteFields(entry, own, entry.schema.form.update, ctx);
    const updateDto = resource.form?.update;
    const [dto, plan] = await this.withInlines(entry, inlines, ctx, false, () =>
      validateWrite(own, {
        allowed: schema.form.update,
        dto: updateDto ?? resource.form?.create,
        partial: true, // PATCH validates only the keys that were sent, dedicated update DTO or not
        fields: schema.fields,
        sanitizeHtml: (html) => this.files.sanitizeHtml(html),
      }),
    );
    const relationIds = relationIdsOf(dto, schema);
    // Only children change: the parent is not saved (no version bump, no entry of its own), its If-Match still holds.
    const inlineOnly = plan !== undefined && typeof own === 'object' && own !== null && Object.keys(own).length === 0;
    return this.write(entry, ctx, async (tx) => {
      // Out of scope is "not found", before anything could reveal the record (a 409 carries it).
      await this.policy.requireInScope(entry, id, rawId, 'view', tx);
      await this.policy.requireInScope(entry, id, rawId, 'update', tx);
      await this.checkVersion(entry, id, version, tx);
      const existing = await resource.findOne(id, tx);
      if (!existing) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
      this.policy.requireRecordRule(entry, 'update', existing, tx);
      const locked = this.lockedFields(entry, existing).filter((name) => Object.hasOwn(dto, name));
      if (locked.length > 0) throw new AdminValidationError(Object.fromEntries(locked.map((name) => [name, ['is read-only']])), 'Some fields are read-only');
      const checked = plan ? await this.inlineWriter.check(plan, existing, tx) : undefined;
      const updated = inlineOnly
        ? existing
        : await this.change({ kind: 'update', target: entry, existing, id, dto }, tx, async () => {
            if ([...relationIds.values()].some((ids) => ids.length > 0)) {
              // relationOptions() sees the record as it will be: what is stored, with the request's changes on top.
              const values = { ...toValues(await this.record(entry, existing, tx)), ...(dto as Record<string, unknown>) };
              await this.checkRelationsExist(entry, relationIds, tx, values);
            }
            return this.reloadIfEmpty(entry, await resource.update(id, dto, tx), id, tx);
          });
      if (plan) await this.inlineWriter.apply(plan, checked!, updated, tx);
      return this.withInlineRows(entry, updated, tx);
    });
  }

  /**
   * The parent's own validation and the preparation of its `_inlines` (`InlineWriter.prepare`), with the 422s of both
   * in one answer. A resource without inlines validates as before. On update, only a body with `_inlines` gets a plan.
   */
  private async withInlines(entry: RegisteredResource, inlines: unknown, ctx: AdminContext, creating: boolean, validate: () => Promise<object>): Promise<[object, InlinePlan | undefined]> {
    if (entry.inlines.length === 0 || (!creating && inlines === undefined)) return [await validate(), undefined];
    let dto: object | undefined;
    let invalid: AdminValidationError | undefined;
    try {
      dto = await validate();
    } catch (error) {
      if (!(error instanceof AdminValidationError)) throw error;
      invalid = error;
    }
    let plan: InlinePlan;
    try {
      plan = await this.inlineWriter.prepare(entry, inlines, ctx, creating);
    } catch (error) {
      if (invalid && error instanceof AdminValidationError) throw new AdminValidationError({ ...invalid.fields, ...error.fields }, invalid.message);
      throw error;
    }
    if (invalid) throw invalid;
    return [dto!, plan];
  }

  /** The answer of a write: the record, and for a parent with inlines its `_inlines` as they are after the save. */
  private async withInlineRows(entry: RegisteredResource, entity: object, tx: AdminContext): Promise<AdminRecord> {
    const record = await this.record(entry, entity, tx);
    if (entry.inlines.length > 0) await this.inlines.readInto(record, entry, entity, tx);
    return record;
  }

  async remove(name: string, rawId: string, ctx: AdminContext, version?: number): Promise<void> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'delete', ctx);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    await this.write(entry, ctx, async (tx) => {
      await this.policy.requireInScope(entry, id, rawId, 'view', tx);
      await this.policy.requireInScope(entry, id, rawId, 'delete', tx);
      await this.checkVersion(entry, id, version, tx);
      const existing = await resource.findOne(id, tx);
      if (!existing) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
      this.policy.requireRecordRule(entry, 'delete', existing, tx);
      await this.change({ kind: 'delete', target: entry, existing, id }, tx, () => resource.delete(id, tx));
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
    // The target resource's query() and the user's view scopes there restrict what may be picked (spec §6.4).
    const restricted = targetEntry ? this.policy.applyScopes(targetEntry.resource.query(qb, ctx), targetEntry, 'view', ctx) : qb;
    return entry.resource.relationOptions(field, restricted, ctx, values);
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
    this.policy.requireReach(entry, ctx);
    const field = this.view(entry, ctx).schema.fields.find((candidate) => candidate.name === fieldName);
    if (!field) throw new AdminNotFoundError(`Unknown field "${fieldName}"`);
    if (field.type !== 'relation') throw new AdminBadRequestError(`"${fieldName}" is not a relation field`);
    const known = new Set(['search', 'ids', 'values', 'parent']);
    for (const key of new Set(query.keys())) {
      if (!known.has(key) || query.getAll(key).length > 1) {
        throw new AdminValidationError({ [key]: [known.has(key) ? 'must be given once' : 'is not a supported parameter'] });
      }
    }
    const values = this.parentValues(entry, parseValues(query.get('values')), query.get('parent'), ctx);
    const relation = entry.relations.get(fieldName)!;
    const target = relation.inverseEntityMetadata;
    const key = target.primaryColumns[0]!.propertyName;
    const title = this.registry.titleFor(target, entry.dataSource);
    const targetEntry = this.registry.forEntity(target.target, entry.dataSource);
    // Picking a record means seeing it: the user must be able to view the target resource.
    if (targetEntry && !this.policy.permissionsOf(ctx).canOn(targetEntry.schema.name, 'view')) {
      throw new AdminForbiddenError(`You may not view ${targetEntry.schema.label} records`);
    }
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
        const fields = targetEntry ? this.view(targetEntry, ctx).schema.list.search.filter((name) => !name.includes('.')) : title.column ? [title.column] : [];
        if (fields.length === 0) throw new AdminValidationError({ search: [`${field.label} options cannot be searched`] });
        const clauses = fields.map((name) => persianLike(`option.${name}`, search, 'nmaSearch', (text) => likePattern(text, 'anywhere')));
        qb.andWhere(`(${clauses.map((clause) => clause.sql).join(' OR ')})`, clauses[0]!.params);
      }
      qb.take(20);
    }
    if (title.column) qb.orderBy(`option.${title.column}`, 'ASC').addOrderBy(`option.${key}`, 'ASC');
    else qb.orderBy(`option.${key}`, 'ASC');
    const rows = await qb.getMany();
    const titled = !targetEntry || this.policy.titleVisible(targetEntry, ctx);
    const refs = rows.map((row) => relationRef(field, relation, row, title));
    return { items: titled ? refs : refs.map((ref) => ({ ...ref, title: `#${String(ref.id)}` })) };
  }

  /**
   * A child's picker inside a parent's form: `?parent=<parent resource>` and `values._parent` (the parent form's values)
   * come together. `parent` must inline this resource and be one the user may view; `_parent` reaches relationOptions()
   * with `_resource` set to it (and keys starting with `_` dropped), as on save. Like the rest of `values`, it can only
   * narrow the options: the target's query() and scopes are applied before.
   */
  private parentValues(entry: RegisteredResource, values: Record<string, unknown>, parentName: string | null, ctx: AdminContext): Record<string, unknown> {
    // Without `parent`, `_parent` is any other key of `values` (as before 0.3.0).
    if (parentName === null) return values;
    const parent = parentName === null ? undefined : this.registry.find(parentName);
    if (!parent || !parent.inlines.some((inline) => inline.child === entry && this.policy.canSeeInline(entry, inline.link, ctx)) || !this.policy.permissionsOf(ctx).canOn(parent.schema.name, 'view')) {
      throw new AdminValidationError({ parent: [`must name a resource that ${entry.schema.label} is inlined in, with values._parent`] });
    }
    const sent = values._parent;
    if (typeof sent !== 'object' || sent === null || Array.isArray(sent)) throw new AdminValidationError({ values: ['_parent must be an object of the parent form\'s values'] });
    const own = Object.fromEntries(Object.entries(sent).filter(([key]) => !key.startsWith('_')));
    return { ...values, _parent: { ...own, _resource: parent.schema.name } };
  }

  /**
   * Deletes each record on its own (its own transaction, hooks, `query()` and trash), so one failure never undoes the
   * others. Answers `{ ok, failed }` in request order; failures carry the code and message the single DELETE would.
   */
  async bulkDelete(name: string, body: unknown, ctx: AdminContext): Promise<BulkResult> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'delete', ctx);
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

  /**
   * `POST /resources/:name/actions/:action` with `{ ids?, input? }`: runs an `@AdminAction` (see `ActionService`).
   * One record answers `{ message?, record }`, several `{ ok, failed, message? }`, a resource action `{ message? }`.
   */
  runAction(name: string, action: string, body: unknown, ctx: AdminContext): Promise<ActionResult> {
    return this.actions.run(this.registry.get(name), action, body, ctx);
  }

  /** Every settings page with its group, labelled in `locale` (the roles catalog). */
  pageSummaries(locale = this.options.locale): Array<MetaPageSummary & { group: string }> {
    return this.pages.summaries(locale);
  }

  /** `GET /pages/:name`: a settings page's form, its values without the secrets, and which secrets are set. */
  page(name: string, ctx: AdminContext): Promise<PageResponse> {
    return this.pages.get(name, ctx);
  }

  /** `PATCH /pages/:name`: saves the keys that were sent (see `PageService.save`) and answers like GET. */
  savePage(name: string, body: unknown, ctx: AdminContext): Promise<PageResponse> {
    return this.pages.save(name, body, ctx);
  }

  /** Takes a record out of the trash. */
  async restore(name: string, rawId: string, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    this.policy.require(entry, 'delete', ctx); // restoring undoes a delete
    if (!schema.softDelete) throw new AdminBadRequestError(`${schema.label} records have no trash`);
    const id = parseRecordId(rawId, schema);
    return this.write(entry, ctx, async (tx) => {
      await this.policy.requireInScope(entry, id, rawId, 'view', tx, true);
      await this.policy.requireInScope(entry, id, rawId, 'delete', tx, true);
      return this.record(entry, await this.change({ kind: 'restore', target: entry, id }, tx, () => resource.restore(id, tx)), tx);
    });
  }

  /** Removes a record for good (trashed or not). */
  async purge(name: string, rawId: string, ctx: AdminContext, version?: number): Promise<void> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'purge', ctx);
    const id = parseRecordId(rawId, entry.schema);
    await this.write(entry, ctx, async (tx) => {
      await this.policy.requireInScope(entry, id, rawId, 'view', tx, true);
      await this.policy.requireInScope(entry, id, rawId, 'delete', tx, true);
      await this.checkVersion(entry, id, version, tx, true);
      await this.change({ kind: 'purge', target: entry, id }, tx, () => entry.resource.purge(id, tx));
    });
  }

  /** Fields `readonlyIf` locks on this record. A function that throws locks its field (and is logged once). */
  private lockedFields(entry: RegisteredResource, entity: object): string[] {
    const locked: string[] = [];
    for (const [name, options] of entry.fieldConfig) {
      if (!options.readonlyIf) continue;
      try {
        if (options.readonlyIf(entity)) locked.push(name);
      } catch (error) {
        locked.push(name);
        this.warnOnce(`${entry.className}.fields.${name}.readonlyIf threw (${error instanceof Error ? error.message : String(error)}); the field stays read-only`);
      }
    }
    return locked;
  }

  /** `links()` of the resource with labels in the locale; only http(s) and relative URLs get through. */
  private recordLinks(entry: RegisteredResource, entity: object, locale: string): RecordLink[] {
    let links: RecordLinkConfig[];
    try {
      links = entry.resource.links(entity);
    } catch (error) {
      this.warnOnce(`${entry.className}.links() threw: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
    return (Array.isArray(links) ? links : [])
      .filter((link) => typeof link?.href === 'string' && (/^https?:\/\//i.test(link.href) || !/^[a-z][a-z0-9+.-]*:/i.test(link.href.trim())))
      .map((link) => ({ label: resolveText(link.label, locale, this.options.locale), href: link.href }));
  }

  private readonly warned = new Set<string>();
  private warnOnce(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    this.logger.warn(message);
  }

  /** An entity's primary key as `findOne` takes it (a scalar, or `{ key: value }` for composite keys). */
  private idOf(entry: RegisteredResource, entity: object): RecordId {
    const keys = entry.schema.primaryKeys;
    const values = entity as Record<string, unknown>;
    return (keys.length === 1 ? values[keys[0]!] : Object.fromEntries(keys.map((key) => [key, values[key]]))) as RecordId;
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

/**
 * The body of a POST or PATCH split into the parent's own fields and its `_inlines`. A resource without inlines keeps
 * the body as it is, so `_inlines` there is an unknown field as before.
 */
function splitInlines(entry: RegisteredResource, body: unknown): { own: unknown; inlines: unknown } {
  if (entry.inlines.length === 0 || typeof body !== 'object' || body === null || Array.isArray(body) || !Object.hasOwn(body, '_inlines')) return { own: body, inlines: undefined };
  const { _inlines: inlines, ...own } = body as Record<string, unknown>;
  return { own, inlines };
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
