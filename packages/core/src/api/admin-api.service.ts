import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import type { ActionResult, AdminRecord, BulkResult, FieldSchema, ListResponse, MenuBadges, TabCounts, AdminFileRef, ComputedValue, MetaPageSummary, MetaResourceSummary, MetaResponse, OptionsResponse, PageResponse, RecordLink, ResourceSchema, SearchResponse } from '../contract.js';
import { applyFieldConfig, localizeLayout, mainLayout } from '../schema/field-config.js';
import { inlineOf, toLayoutInline } from '../inlines/inline-config.js';
import { InlineReader } from '../inlines/inline-reader.js';
import { InlineWriter, type InlinePlan } from '../inlines/inline-writer.js';
import { persianLike } from '../i18n/persian.js';
import { hostError, toErrorResponse } from '../http/error-response.js';
import { toActionSchema } from '../decorators/admin-action.js';
import { printCode, toPrintSchema } from '../decorators/admin-print.js';
import { printPage } from '../print/print-page.js';
import { toCell } from '../export/export-cells.js';
import { workbook, type Cell } from '../export/xlsx.js';
import { isRtlLocale } from '../i18n/localized-text.js';

/** Rows read per query while exporting. */
const EXPORT_PAGE = 500;

/** Records one bulk print may hold. */
const PRINT_MAX = 100;
import { ADMIN_OPTIONS, MAX_BULK } from '../constants.js';
import { parseListQuery } from '../crud/list-query.js';
import { buildMenu, checkMenu } from './menu.js';
import { DashboardService } from '../dashboard/dashboard.service.js';
import { WidgetRegistry } from '../dashboard/widget-registry.js';
import { loadComputed, type CompiledComputed } from '../crud/computed-columns.js';
import { resourceFileOwner } from '../files/file-owner.js';
import { encodeRecordId, parseRecordId, recordIdOf } from '../crud/record-id.js';
import { likePattern } from '../crud/list-query-builder.js';
import { parseId } from '../crud/list-query.js';
import { isLoadedField, loadReferences, relationRef } from '../crud/references.js';
import { normalizeRelationValues, relationIdsOf, type RelationId } from '../crud/relation-writes.js';
import { serializeRecord } from '../crud/serialize.js';
import { validateWrite } from '../crud/validate-write.js';
import { auditParticipant } from '../audit/audit-participant.js';
import { AdminAudit } from '../audit/audit.service.js';
import { filesParticipant } from '../files/files-participant.js';
import { FilesService } from '../files/files.service.js';
import { AdminBadRequestError, AdminConflictError, AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { AdminPolicy, type ResourceView } from '../policy/admin-policy.service.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import { scopedText } from '../i18n/texts.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import { inAdminTransaction, type AdminContext, type AdminWriteContext } from '../resource/admin-context.js';
import { AdminResourceBase, type ListParams, type RecordId, type RecordLinkConfig } from '../resource/admin-resource-base.js';
import { PageRegistry } from '../pages/page-registry.js';
import { PageService } from '../pages/page.service.js';
import { ActionService } from './action.service.js';
import type { WriteChange } from './write-participant.js';
import { SINGLE_CONNECTION_DRIVERS } from './write-queue.js';
import { WriteRunner } from './write-runner.js';
import { getCanRules } from '../decorators/admin-scope.js';

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
    private readonly pageRegistry: PageRegistry,
    private readonly audit: AdminAudit,
    private readonly dashboard: DashboardService,
    private readonly widgets: WidgetRegistry,
  ) {
    const pages = pageRegistry;
    // Without `audit` nothing is recorded: the audit log is not even a participant.
    this.writes = new WriteRunner(options, this.logger, [filesParticipant(files), ...(audit.enabled ? [auditParticipant(audit)] : [])]);
    this.pages = new PageService({ pages, policy, options, files, writes: this.writes });
    this.actions = new ActionService({ policy, options, logger: this.logger, writes: this.writes, record: (entry, entity, ctx) => this.record(entry, entity, ctx) });
    this.inlines = new InlineReader({
      policy,
      serialize: (entry, entities, ctx) => this.fullRecords(entry, entities, ctx),
      computed: async (inline, entities, records, ctx) => {
        const child = inline.child;
        const visible = policy.computedVisible(child, ctx);
        const columns = inline.computed.filter((key) => visible.has(key)).map((key) => child.computed.get(key)!);
        if (columns.length === 0) return;
        const values = await this.computedValues(child, columns, entities, ctx);
        for (const record of records) record._computed = values.get(String(record._id)) ?? {};
      },
    });
    this.inlineWriter = new InlineWriter({
      policy,
      view: (entry, ctx) => this.view(entry, ctx),
      sanitizeHtml: (html) => files.sanitizeHtml(html),
      change: (change, tx, method) => this.change(change, tx, method),
      checkRelationsExist: (entry, ids, ctx, values) => this.checkRelationsExist(entry, ids, ctx, values),
      checkVersion: (entry, id, expected, ctx) => this.checkVersion(entry, id, expected, ctx),
      lockedFields: (entry, entity, ctx) => this.lockedFields(entry, entity, ctx),
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
    const text = (label: LocalizedText, key?: string) => this.options.texts(label, locale, key);
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
        label: text(group.label, `group.${group.key}`),
        resources: resources
          .filter((entry) => entry.schema.group === group.key)
          .map((entry) => {
            const { schema, label } = entry;
            const seen = ctx ? this.view(entry, ctx).schema : schema;
            const summary: MetaResourceSummary = { name: schema.name, label: text(label, `resource.${schema.name}`), ...(schema.icon ? { icon: schema.icon } : {}), creatable: seen.creatable, searchable: seen.list.search.length > 0 };
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
    const menu = this.options.menu && buildMenu(this.options.menu, text, groups.flatMap((group) => group.resources), groups.flatMap((group) => group.pages));
    // With widgets in the app, whether this user has a dashboard (it replaces the home page).
    const dashboard = this.widgets.list().length > 0 ? { dashboard: ctx ? this.dashboard.has(ctx) : true } : {};
    return { schemaVersion: 1, title: text(this.options.title, 'title'), locale, locales: this.options.locales, groups, ...dashboard, ...(menu ? { menu } : {}) };
  }

  /**
   * Image cells hold a file key; the page gets its URL (the storage's public one, or the admin's download route, which
   * checks the viewer again). A value that is already an http(s) or relative URL stays; anything else becomes null.
   */
  private async imageUrls(entry: RegisteredResource, computed: CompiledComputed[], values: Map<string, Record<string, ComputedValue>>, ctx: AdminContext): Promise<void> {
    for (const column of computed) {
      if (column.column.kind !== 'image') continue;
      const source = column.source;
      const holder = source.type === 'first' ? this.registry.forEntity(source.relation.inverseEntityMetadata.target as Function, entry.dataSource) : source.type === 'field' && !source.path.includes('.') ? entry : undefined;
      const field = source.type === 'first' ? source.field : source.type === 'field' ? source.path : undefined;
      const isFile = holder && field && ['file', 'image'].includes(holder.fieldConfig.get(field)?.widget ?? '');
      const cells = [...values.values()].map((row) => row[column.key]).filter((cell): cell is ComputedValue => cell !== undefined);
      const keys = cells.map((cell) => cell.value).filter((value): value is string => typeof value === 'string');
      const urls = isFile && keys.length > 0 ? await this.files.refs(resourceFileOwner(holder!, this.policy), keys.map((key) => ({ [field!]: key })), [field!], ctx) : [];
      const byKey = new Map(keys.map((key, index) => [key, (urls[index]?.[field!] as AdminFileRef | undefined)?.url]));
      for (const cell of cells) {
        const value = typeof cell.value === 'string' ? cell.value : undefined;
        cell.value = value === undefined ? null : (byKey.get(value) ?? (/^(https?:\/\/|\/)/i.test(value) ? value : null));
      }
    }
  }

  /**
   * A list's count for this user (menu badges, tab counts): through the resource's findMany, so `query()` and scopes
   * apply; an overridden findMany may ignore scopes, so for a scoped user it goes through the scoped base path.
   */
  private async count(entry: RegisteredResource, params: ListParams, ctx: AdminContext): Promise<{ count: number; estimate: boolean } | undefined> {
    const overridden = entry.resource.findMany !== AdminResourceBase.prototype.findMany;
    const found = overridden && this.policy.scoped(entry, 'view', ctx) ? await AdminResourceBase.prototype.findMany.call(entry.resource, params, ctx) : await entry.resource.findMany(params, ctx);
    return found.total === null || found.total === undefined ? undefined : { count: found.total, estimate: found.estimated === true };
  }

  /** `GET /api/resources/:resource/tab-counts`: each tab this user may use, counted in parallel (`null`: `count: 'none'`). */
  async tabCounts(name: string, ctx: AdminContext): Promise<TabCounts> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'view', ctx);
    const schema = this.view(entry, ctx).schema;
    const counts = await Promise.all(
      (schema.list.tabs ?? []).map(async (tab) => {
        if (tab.count === 'none') return [tab.key, null] as const;
        const params = parseListQuery(new URLSearchParams({ ...tab.filter, ...(tab.where ? { tab: tab.key } : {}), pageSize: '1' }), schema);
        params.count = tab.count;
        if (params.pagination === 'keyset') params.after = undefined;
        return [tab.key, (await this.count(entry, params, ctx)) ?? null] as const;
      }),
    );
    return Object.fromEntries(counts);
  }

  /** Computed columns of some rows of a resource, image cells as URLs. */
  private async computedValues(entry: RegisteredResource, columns: CompiledComputed[], entities: object[], ctx: AdminContext): Promise<Map<string, Record<string, ComputedValue>>> {
    const locale = ctx.locale ?? this.options.locale;
    const values = await loadComputed(columns, entities, entry.metadata, ctx, this.registry.childQuery, (alias) => entry.resource.readQuery(alias, ctx), (label) => this.options.texts(label, locale), (target, field) => this.registry.forEntity(target, entry.dataSource)?.schema.fields.find((candidate) => candidate.name === field));
    await this.imageUrls(entry, columns, values, ctx);
    return values;
  }

  /** The menu's references are checked once every resource and settings page is registered. */
  onApplicationBootstrap(): void {
    if (this.options.menu) checkMenu(this.options.menu, this.registry, this.pageRegistry);
  }

  /**
   * `GET /api/menu/badges`: each menu badge counted for this user through the list's own path (scopes and `query()`
   * apply). A badge whose filters name a field this user cannot see, or on a resource they cannot view, is left out.
   */
  async badges(ctx: AdminContext): Promise<MenuBadges> {
    const out: MenuBadges = {};
    const perms = this.policy.permissionsOf(ctx);
    for (const section of this.options.menu?.sections ?? []) {
      for (const item of section.items) {
        if (!('resource' in item) || !item.badge) continue;
        const entry = this.registry.get(item.resource);
        if (!perms.canOn(entry.schema.name, 'view')) continue;
        let params: ListParams;
        try {
          params = parseListQuery(new URLSearchParams({ ...item.badge, pageSize: '1' }), this.view(entry, ctx).schema);
        } catch {
          continue; // a filter on a field this user cannot see: no count, so nothing to compare
        }
        // `none` lists are not counted page by page, but a badge is a count: estimate it instead.
        params.count = params.count === 'none' ? 'estimate' : params.count;
        const counted = await this.count(entry, params, ctx);
        if (counted) out[`${section.key}.${item.resource}`] = counted;
      }
    }
    return out;
  }

  /** A resource's schema with its labels in `locale`. */
  schema(name: string, locale = this.options.locale, ctx?: AdminContext): ResourceSchema {
    const entry = this.registry.get(name);
    if (ctx) this.policy.requireReach(entry, ctx);
    const text = scopedText(this.options.texts, locale, `resource.${name}`);
    const related = entry.schema.related.map((item, index) => {
      const target = this.registry.get(item.resource);
      const base = this.options.texts(target.label, locale, `resource.${target.schema.name}`);
      const fieldLabel = entry.relatedFieldLabels[index];
      return { ...item, label: fieldLabel ? `${base} (${fieldLabel})` : base };
    });
    const fields = entry.schema.fields.map((field) => applyFieldConfig(field, entry.fieldConfig.get(field.name), (value, path) => text(value, `fields.${path}`), this.options.files?.maxBytes, this.files.enabled));
    const layout = mainLayout(entry.resource.form?.layout);
    const inline = (node: Parameters<typeof inlineOf>[1], label: string | undefined) => toLayoutInline(inlineOf(entry, node), label, text, this.options.texts(inlineOf(entry, node).child.label, locale, `resource.${inlineOf(entry, node).name}`));
    const form = layout ? { ...entry.schema.form, layout: localizeLayout(layout, (value, key) => text(value, key === undefined ? undefined : `form.${key}`), inline) } : entry.schema.form;
    const actions = [...entry.actions.values()].map((action) => toActionSchema(action, text));
    const prints = [...entry.prints.values()].map((print) => toPrintSchema(print, text));
    const computed = entry.schema.list.computed && Object.fromEntries(Object.entries(entry.schema.list.computed).map(([key, column]) => [key, { ...column, label: text(entry.computed.get(key)!.column.label, `list.computed.${key}.label`) }]));
    const tabs = entry.schema.list.tabs?.map((tab, index) => ({ ...tab, label: text(entry.resource.list!.tabs![index]!.label, `list.tabs.${tab.key}.label`) }));
    const list = { ...entry.schema.list, ...(computed ? { computed } : {}), ...(tabs ? { tabs } : {}) };
    const asideConfig = entry.resource.form?.layout && !Array.isArray(entry.resource.form.layout) ? entry.resource.form.layout.aside : undefined;
    const localizedForm = form.aside && asideConfig ? { ...form, aside: form.aside.map((card, index) => ({ ...card, title: text(asideConfig[index]!.title, asideConfig[index]!.key === undefined ? undefined : `form.${asideConfig[index]!.key}`) })) } : form;
    const localized = { ...entry.schema, label: text(entry.label, ''), related, fields, form: localizedForm, actions, prints, list };
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
    const records = await this.records(entry, items, loaded, ctx);
    // Computed columns the viewer sees (the schema kept only those) and the page shows: one batch for the page.
    const computed = [...entry.computed.values()].filter((column) => schema.list.computed?.[column.key] && shown.has(column.key));
    if (computed.length > 0) {
      const locale = ctx.locale ?? this.options.locale;
      const values = await loadComputed(computed, items, entry.metadata, ctx, this.registry.childQuery, (alias) => entry.resource.readQuery(alias, ctx), (label) => this.options.texts(label, locale), (entity, field) => this.registry.forEntity(entity, entry.dataSource)?.schema.fields.find((candidate) => candidate.name === field));
      await this.imageUrls(entry, computed, values, ctx);
      for (const record of records) record._computed = values.get(String(record._id)) ?? {};
    }
    return {
      items: records,
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
            label: this.options.texts(entry.label, locale, `resource.${schema.name}`),
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
    await this.recordPage(entry, entity, record, ctx);
    return record;
  }

  /**
   * What the record page shows beside the form (spec §5.6): each relation aside card's record (`_aside`, read through
   * the target's own GET, so its permissions and scopes apply; absent when this user may not see it) and the computed
   * columns its header names (`_computed`).
   */
  private async recordPage(entry: RegisteredResource, entity: object, record: AdminRecord, ctx: AdminContext): Promise<void> {
    const form = this.view(entry, ctx).schema.form;
    const aside: Record<string, AdminRecord> = {};
    for (const [index, card] of (form.aside ?? []).entries()) {
      if (!card.relation) continue;
      const value = record[card.relation.field];
      const id = value && typeof value === 'object' ? (value as { id: unknown }).id : value;
      if (id === null || id === undefined) continue;
      try {
        const related = await this.get(card.relation.resource, encodeRecordId([id]), ctx);
        aside[String(index)] = { _id: related._id, _title: related._title, ...Object.fromEntries(card.fields.filter((field) => field in related).map((field) => [field, related[field]])) };
      } catch (error) {
        if (!(error instanceof AdminNotFoundError) && !(error instanceof AdminForbiddenError)) throw error;
      }
    }
    if (Object.keys(aside).length > 0) record._aside = aside;
    // Stepper fields: when each step was last reached, from the history child (its read path: query() and scopes),
    // only when this user may see its value and time fields.
    for (const field of this.view(entry, ctx).schema.fields) {
      const history = field.steps?.history ? entry.steppers.get(field.name) : undefined;
      if (!history) continue;
      const { child } = history;
      const levels = this.policy.levels(child, ctx);
      if (!this.policy.permissionsOf(ctx).canOn(child.schema.name, 'view') || [history.value, history.at].some((name) => (levels.get(name) ?? 'hidden') === 'hidden')) continue;
      const qb = child.resource.readQuery('nma_h', ctx).select(`nma_h.${history.value}`, 'v').addSelect(`MAX(nma_h.${history.at})`, 't');
      qb.andWhere(`nma_h.${history.link} = :nmaParent`, { nmaParent: recordIdValue(entity, entry.schema.primaryKeys[0]!) });
      Object.entries(history.where).forEach(([name, value], index) => qb.andWhere(`nma_h.${name} = :nmaWhere${index}`, { [`nmaWhere${index}`]: value }));
      const rows = await qb.groupBy(`nma_h.${history.value}`).getRawMany<{ v: string; t: unknown }>();
      record._steps = { ...((record._steps as object | undefined) ?? {}), ...Object.fromEntries(rows.map((row) => [row.v, isoTime(row.t)])) };
    }
    const summaries = (form.layout ?? []).flatMap((node) => ('tab' in node ? node.sections : [node])).flatMap((node) => ('summary' in node ? node.summary : []));
    const keys = [...(form.header?.subtitle ?? []), ...summaries.map((row) => row.value)].flatMap((item) => ('computed' in item ? [item.computed] : []));
    const computed = keys.flatMap((key) => (entry.computed.has(key) ? [entry.computed.get(key)!] : []));
    if (computed.length > 0) record._computed = (await this.computedValues(entry, [...new Set(computed)], [entity], ctx)).get(String(record._id)) ?? {};
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
      const locked = this.lockedFields(entry, entity, ctx);
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
  private write<T>(target: { dataSource: DataSource }, ctx: AdminContext, work: (ctx: AdminWriteContext) => Promise<T>): Promise<T> {
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
      await this.checkParentRules(entry, dto as Record<string, unknown>, tx);
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

  /**
   * `@AdminCan('create')` of an inline child created through its own endpoint: each parent its link field names, as
   * the user may view it, must allow the new row (403). Without a link value, or a parent the user cannot see, the rule
   * has nothing to judge (the relation checks answer).
   */
  private async checkParentRules(entry: RegisteredResource, dto: Record<string, unknown>, ctx: AdminContext): Promise<void> {
    if (getCanRules(entry.resource.constructor, 'create').length === 0) return;
    for (const parent of this.registry.list()) {
      for (const inline of parent.inlines) {
        const value = inline.child === entry ? dto[inline.link] : undefined;
        if (value === undefined || value === null) continue;
        const found = await parent.resource.readQuery('nma_parent', ctx).andWhere(`nma_parent.${inline.referenced} = :nmaParent`, { nmaParent: value }).getOne();
        if (found && !this.policy.createRule(entry, found, ctx)) throw new AdminForbiddenError(`You may not add ${entry.schema.label} rows here`);
      }
    }
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
      const locked = this.lockedFields(entry, existing, tx).filter((name) => Object.hasOwn(dto, name));
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
    const lock = inAdminTransaction(ctx) && !SINGLE_CONNECTION_DRIVERS.has(entry.dataSource.options.type) ? ({ mode: 'pessimistic_write' } as const) : undefined;
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
  private async optionsQuery(entry: RegisteredResource, field: string, ctx: AdminContext, values: Record<string, unknown>): Promise<SelectQueryBuilder<any>> {
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
      const rows: Array<{ id: unknown }> = await (await this.optionsQuery(entry, field, ctx, values))
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
    const values = this.parentValues(entry, normalizeRelationValues(parseValues(query.get('values')), entry.schema), query.get('parent'), ctx);
    const relation = entry.relations.get(fieldName)!;
    const target = relation.inverseEntityMetadata;
    const key = target.primaryColumns[0]!.propertyName;
    const title = this.registry.titleFor(target, entry.dataSource);
    const targetEntry = this.registry.forEntity(target.target, entry.dataSource);
    // Picking a record means seeing it: the user must be able to view the target resource.
    if (targetEntry && !this.policy.permissionsOf(ctx).canOn(targetEntry.schema.name, 'view')) {
      throw new AdminForbiddenError(`You may not view ${targetEntry.schema.label} records`);
    }
    const qb = await this.optionsQuery(entry, fieldName, ctx, values);

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
    return { ...values, _parent: { ...normalizeRelationValues(own, parent.schema), _resource: parent.schema.name } };
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

  /**
   * `GET /resources/:name/print/:print?id=…`: an `@AdminPrint` template's page for one record (or up to 100 with
   * `bulk`). Each record is read like `GET /resources/:name/:id` (view permission, scopes) and its printing is audited.
   */
  async print(name: string, printName: string, rawIds: string[], ctx: AdminContext): Promise<{ html: string; csp: string }> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'view', ctx);
    const print = entry.prints.get(printName);
    if (!print) throw new AdminNotFoundError(`${entry.schema.label} has no print template "${printName}"`);
    if (!this.policy.canPrint(entry, printName, ctx)) throw new AdminForbiddenError(`You may not print "${this.options.texts(print.label, ctx.locale ?? this.options.locale, `resource.${entry.schema.name}.prints.${print.name}.label`)}"`);
    const ids = [...new Set(rawIds)];
    if (ids.length === 0) throw new AdminBadRequestError('id is required');
    if (ids.length > (print.bulk ? PRINT_MAX : 1)) throw new AdminBadRequestError(print.bulk ? `at most ${PRINT_MAX} records at once` : 'this template prints one record');
    const entities: object[] = [];
    for (const rawId of ids) {
      const id = parseRecordId(rawId, entry.schema);
      const entity = await entry.resource.findOne(id, ctx);
      if (!entity) throw new AdminNotFoundError(`${entry.schema.label} "${rawId}" not found`);
      await this.policy.requireInScope(entry, id, rawId, 'view', ctx);
      entities.push(entity);
    }
    const method = (entry.resource as unknown as Record<string, (records: object[], ctx: AdminContext) => unknown>)[printName]!;
    let body: unknown;
    try {
      body = await method.call(entry.resource, entities, ctx);
    } catch (error) {
      throw hostError(error);
    }
    const locale = ctx.locale ?? this.options.locale;
    const label = this.options.texts(print.label, locale, `resource.${entry.schema.name}.prints.${print.name}.label`);
    for (const entity of entities) {
      await this.audit.recordAfter({ event: printCode(entry.schema.name, printName), entry, recordId: recordIdOf(entity, entry.schema.primaryKeys), title: entry.title(entity) }, ctx);
    }
    const title = entities.length === 1 ? `${label} · ${entry.title(entities[0]!)}` : label;
    return printPage({ title, body: String(body ?? ''), size: print.size, locale });
  }

  /**
   * `GET /resources/:name/export?<list query>`: the rows the list shows for this query (filters, search, tab, sort and
   * scopes, page and page size ignored) as an `.xlsx`, in the export's columns this user may see, up to `max` rows.
   * `offset` (minutes east of UTC) puts date-times on the exporter's clock. The export is audited.
   */
  async export(name: string, query: URLSearchParams, ctx: AdminContext): Promise<{ file: Buffer; filename: string; rows: number; truncated: boolean }> {
    const entry = this.registry.get(name);
    this.policy.require(entry, 'view', ctx);
    if (!entry.export) throw new AdminNotFoundError(`${entry.schema.label} has no export`);
    if (!this.policy.canExport(entry, ctx)) throw new AdminForbiddenError(`You may not export ${entry.schema.label} records`);
    const rest = new URLSearchParams(query);
    const rawOffset = rest.get('offset');
    const offset = rawOffset === null ? 0 : Number(rawOffset);
    if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 60) throw new AdminValidationError({ offset: ['must be minutes east of UTC, from -840 to 840'] });
    for (const key of ['offset', 'page', 'pageSize', 'after']) rest.delete(key);
    const schema = this.view(entry, ctx).schema;
    const params = parseListQuery(rest, schema);
    const sortPath = entry.sortPaths.get(params.sort.field);
    if (sortPath) params.sort = { ...params.sort, field: sortPath };
    const { max } = entry.export;
    const scoped = entry.resource.findMany !== AdminResourceBase.prototype.findMany && this.policy.scoped(entry, 'view', ctx);
    const items: object[] = [];
    let truncated = false;
    for (let page = 1; ; page++) {
      const found = await entry.resource.findMany({ ...params, page, pageSize: EXPORT_PAGE, count: 'none', pagination: 'offset', after: undefined }, ctx);
      let batch = found.items;
      // A findMany override may ignore the scopes; rows outside them never leave (spec §6.4).
      if (scoped) {
        const allowed = await this.policy.allowedIds(entry, batch.map((item) => this.idOf(entry, item)), 'view', ctx);
        batch = batch.filter((item) => allowed.has(recordIdOf(item, schema.primaryKeys)));
      }
      items.push(...batch);
      if (items.length > max) {
        items.length = max;
        truncated = true;
        break;
      }
      if (found.items.length < EXPORT_PAGE || found.hasMore === false) break;
    }
    const locale = ctx.locale ?? this.options.locale;
    const localized = this.schema(name, locale, ctx);
    const visible = new Map(localized.fields.map((field) => [field.name, field]));
    const columns = entry.export.columns.flatMap((column) => (visible.has(column) ? [visible.get(column)!] : []));
    const records = await this.records(entry, items, schema.fields.filter((field) => columns.some((column) => column.name === field.name) && isLoadedField(field)), ctx);
    const rows: Cell[][] = records.map((record) => columns.map((field) => toCell(record[field.name], field, locale, offset)));
    const label = localized.label;
    const file = workbook({ sheet: label, header: columns.map((field) => field.label), rows, rtl: isRtlLocale(locale) });
    await this.audit.recordAfter({ event: `${entry.schema.name}.export`, entry, meta: { query: rest.toString().slice(0, 2_000), rows: rows.length, ...(truncated ? { truncated: true as const } : {}) } }, ctx);
    const day = new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
    return { file, filename: `${entry.schema.name}-${day}.xlsx`, rows: rows.length, truncated };
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

  /**
   * Fields `readonlyIf` and the resource's `readonlyFields` lock on this record, each once. A `readonlyIf` that throws
   * locks its field, a `readonlyFields` that throws locks the update form (each logged once); unknown names are dropped.
   */
  private lockedFields(entry: RegisteredResource, entity: object, ctx: AdminContext): string[] {
    const locked = new Set<string>();
    for (const [name, options] of entry.fieldConfig) {
      if (!options.readonlyIf) continue;
      try {
        if (options.readonlyIf(entity)) locked.add(name);
      } catch (error) {
        locked.add(name);
        this.warnOnce(`${entry.className}.fields.${name}.readonlyIf threw (${error instanceof Error ? error.message : String(error)}); the field stays read-only`);
      }
    }
    let more: readonly string[];
    try {
      more = entry.resource.readonlyFields(entity, ctx);
    } catch (error) {
      more = entry.schema.form.update;
      this.warnOnce(`${entry.className}.readonlyFields threw (${error instanceof Error ? error.message : String(error)}); the record stays read-only`);
    }
    const fields = new Set(entry.schema.fields.map((field) => field.name));
    for (const name of more) {
      if (fields.has(name) && !entry.schema.primaryKeys.includes(name)) locked.add(name);
      else if (!fields.has(name)) this.warnOnce(`${entry.className}.readonlyFields names "${name}", which is not a field; it is ignored`);
    }
    return [...locked];
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
      .map((link) => ({ label: this.options.texts(link.label, locale), href: link.href }));
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

/** The record's (single) key value. */
function recordIdValue(entity: object, key: string): unknown {
  return (entity as Record<string, unknown>)[key];
}

/** A time from MAX() as an ISO string: drivers answer a Date, or (SQLite) text in UTC without a zone. */
function isoTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
