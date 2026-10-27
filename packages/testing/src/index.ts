import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import type { INestApplicationContext, ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import {
  AdminError,
  type ActionResult,
  type AdminContext,
  type AdminRecord,
  type AdminUser,
  type AuditEntry,
  type AuditResponse,
  type ListResponse,
  type DashboardResponse,
  type MenuBadges,
  type WidgetData,
  type WidgetParams,
  type TabCounts,
  type MetaResponse,
  type OptionsResponse,
  type PageResponse,
  type ResourceSchema,
  type SearchResponse,
} from '@nest-my-admin/core';
import { ADMIN_OPTIONS, AdminApiService, DashboardService, AdminAudit, AdminPolicy, AdminRbac, AuditReader, EffectivePermissions, ResourceRegistry, createAdminContext, runInAdminContext, type ResolvedAdminOptions } from '@nest-my-admin/core/internal';

/** Who a test acts as. With `roles`, exactly these roles (code or stored); without, the admin resolves them as for a request. */
export interface TestUser extends Partial<Omit<AdminUser, 'id'>> {
  id: string | number;
  roles?: string[];
}

/** Query parameters: a string (`search=x&page=2`), URLSearchParams, or an object (`{ filter: { status: { eq: 'open' } } }`). */
export type TestQuery = string | URLSearchParams | Record<string, unknown>;

/** Calls the admin API as one user, in-process, through the same checks as HTTP requests (no sign-in, no HTTP). */
export class AdminClient {
  constructor(
    private readonly app: INestApplicationContext,
    readonly user: AdminUser,
    private readonly roles: string[] | undefined,
    private readonly locale?: string,
  ) {}

  /** The user's effective permissions. */
  async permissions(): Promise<EffectivePermissions> {
    const policy = this.app.get(AdminPolicy, { strict: false });
    if (this.user.isSuperuser || this.roles === undefined) return policy.forUser(this.user);
    const known = await this.app.get(AdminRbac, { strict: false }).roles();
    return new EffectivePermissions(
      this.roles.map((name) => {
        const role = known.get(name);
        if (!role) throw new Error(`@nest-my-admin/testing: "${name}" is not a role (known: ${[...known.keys()].join(', ') || 'none'})`);
        return role;
      }),
      false,
    );
  }

  /** Whether the user holds a permission code. */
  async can(code: string): Promise<boolean> {
    return (await this.permissions()).can(code);
  }

  private async run<T>(fn: (api: AdminApiService, ctx: AdminContext) => T | Promise<T>): Promise<T> {
    const request = new IncomingMessage(new Socket());
    request.method = 'GET';
    request.url = '/';
    const ctx = createAdminContext(request);
    ctx.user = this.user;
    ctx.permissions = await this.permissions();
    if (this.locale) ctx.locale = this.locale;
    const api = this.app.get(AdminApiService, { strict: false });
    return runInAdminContext(ctx, async () => fn(api, ctx));
  }

  meta(): Promise<MetaResponse> {
    return this.run((api, ctx) => api.meta(ctx.locale, ctx));
  }
  /** The dashboard's widgets this user sees (`GET /api/dashboard`). */
  dashboard(): Promise<DashboardResponse> {
    return this.run(async (_api, ctx) => this.app.get(DashboardService, { strict: false }).layout(ctx));
  }
  /** One widget's data for a period (the last seven days by default). */
  widget(name: string, period: Partial<WidgetParams> = {}): Promise<WidgetData> {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const params = { period: 'week', from: new Date(now - 7 * day).toISOString(), to: new Date(now).toISOString(), previousFrom: new Date(now - 14 * day).toISOString(), previousTo: new Date(now - 7 * day).toISOString(), ...period };
    return this.run((_api, ctx) => this.app.get(DashboardService, { strict: false }).load(name, new URLSearchParams(params), ctx));
  }
  /** A print template's page for these records (`GET /api/resources/:resource/print/:name`): the whole HTML document. */
  async print(resource: string, name: string, ids: Array<string | number>): Promise<string> {
    return (await this.run((api, ctx) => api.print(resource, name, ids.map(String), ctx))).html;
  }
  /** The list exported as Excel (`GET /api/resources/:resource/export`), for a list query like `list()`'s. */
  export(resource: string, query: Record<string, string> = {}): Promise<{ file: Buffer; filename: string; rows: number; truncated: boolean }> {
    return this.run((api, ctx) => api.export(resource, new URLSearchParams(query), ctx));
  }
  /** A list's tab counts (`GET /api/resources/:resource/tab-counts`). */
  tabCounts(resource: string): Promise<TabCounts> {
    return this.run((api, ctx) => api.tabCounts(resource, ctx));
  }
  /** The menu's counts (`GET /api/menu/badges`). */
  badges(): Promise<MenuBadges> {
    return this.run((api, ctx) => api.badges(ctx));
  }
  /** The menu badges on a resource: their key and filters (from the `menu` option). */
  badgeQueries(resource: string): Array<{ key: string; params: Record<string, string> }> {
    const options = this.app.get<ResolvedAdminOptions>(ADMIN_OPTIONS, { strict: false });
    return (options.menu?.sections ?? []).flatMap((section) =>
      section.items.flatMap((item) => ('resource' in item && item.resource === resource && item.badge ? [{ key: `${section.key}.${resource}`, params: item.badge }] : [])),
    );
  }
  /** Every resource the user may view, those without a navigation entry (`nav: false`) included. */
  async resources(): Promise<string[]> {
    const permissions = await this.permissions();
    return this.app.get(ResourceRegistry, { strict: false }).list().map((entry) => entry.schema.name).filter((name) => permissions.canOn(name, 'view'));
  }
  schema(resource: string): Promise<ResourceSchema> {
    return this.run((api, ctx) => api.schema(resource, ctx.locale, ctx));
  }
  list(resource: string, query?: TestQuery): Promise<ListResponse> {
    return this.run((api, ctx) => api.list(resource, toParams(query), ctx));
  }
  get(resource: string, id: string | number): Promise<AdminRecord> {
    return this.run((api, ctx) => api.get(resource, String(id), ctx));
  }
  create(resource: string, body: object): Promise<AdminRecord> {
    return this.run((api, ctx) => api.create(resource, body, ctx));
  }
  update(resource: string, id: string | number, body: object, options: { version?: number } = {}): Promise<AdminRecord> {
    return this.run((api, ctx) => api.update(resource, String(id), body, ctx, options.version));
  }
  delete(resource: string, id: string | number, options: { version?: number } = {}): Promise<void> {
    return this.run((api, ctx) => api.remove(resource, String(id), ctx, options.version));
  }
  restore(resource: string, id: string | number): Promise<AdminRecord> {
    return this.run((api, ctx) => api.restore(resource, String(id), ctx));
  }
  purge(resource: string, id: string | number): Promise<void> {
    return this.run((api, ctx) => api.purge(resource, String(id), ctx));
  }
  search(q: string, query?: TestQuery): Promise<SearchResponse> {
    const params = toParams(query);
    params.set('q', q);
    return this.run((api, ctx) => api.search(params, ctx));
  }
  /** A relation field's choices (`?search=`, `values`). */
  options(resource: string, field: string, query?: TestQuery): Promise<OptionsResponse> {
    return this.run((api, ctx) => api.fieldOptions(resource, field, toParams(query), ctx));
  }
  /**
   * Runs an `@AdminAction`. With one id the answer holds the record, with several `ok` and `failed`; a resource
   * action takes no ids. `input` is the action's form.
   */
  runAction(resource: string, action: string, options: { ids?: Array<string | number>; input?: object } = {}): Promise<ActionResult> {
    const body = { ...(options.ids ? { ids: options.ids.map(String) } : {}), ...(options.input ? { input: options.input } : {}) };
    return this.run((api, ctx) => api.runAction(resource, action, body, ctx));
  }
  /** A settings page: its form, its values without the secrets, and which secrets are set. */
  page(name: string): Promise<PageResponse> {
    return this.run((api, ctx) => api.page(name, ctx));
  }
  /** Saves the keys of `changes` on a settings page (a secret: text replaces it, `null` clears it). */
  savePage(name: string, changes: object): Promise<PageResponse> {
    return this.run((api, ctx) => api.savePage(name, changes, ctx));
  }
  /** A record's audit entries, newest first, 50 a page (`{ before }` is the page before's `next`). */
  history(resource: string, id: string | number, query?: TestQuery): Promise<AuditResponse> {
    return this.run((_api, ctx) => this.app.get(AuditReader, { strict: false }).history(resource, String(id), toParams(query), ctx));
  }
  /** The audit page (`actor`, `event`, `resource`, `record`, `from`, `to`, `before`); needs `audit.view`. */
  audit(query?: TestQuery): Promise<AuditResponse> {
    return this.run((_api, ctx) => this.app.get(AuditReader, { strict: false }).list(toParams(query), ctx));
  }
}

/** One thing a user saw that they should not have. */
export interface Leak {
  kind: 'hidden-value' | 'out-of-scope-record' | 'unreachable-resource' | 'badge-count' | 'tab-count';
  resource: string;
  /** The record it belongs to (`_id`), when there is one. */
  record?: string;
  /** The hidden field whose value appeared. */
  field?: string;
  /** Where it appeared: the call and the JSON path. */
  where: string;
  /** The value, shortened. */
  value?: string;
}

export interface LeakReport {
  /** API calls made as the user. */
  calls: number;
  /** Records of the resource (as a superuser) the crawl knew about. */
  records: number;
  hiddenFields: string[];
  outOfScope: number;
  /**
   * With the audit log on: a history or the audit page had more pages than `maxPages` (50 entries each), so the
   * crawl did not read all of it. Raise `maxPages` to cover the rest.
   */
  auditTruncated?: boolean;
  leaks: Leak[];
}

export class AdminLeakError extends Error {
  constructor(readonly report: LeakReport) {
    const lines = report.leaks.slice(0, 50).map((leak) => {
      const what = leak.kind === 'hidden-value' ? `hidden field "${leak.field}" of ${leak.resource} ${leak.record}` : leak.kind === 'out-of-scope-record' ? `out-of-scope ${leak.resource} ${leak.record}` : `resource "${leak.resource}"`;
      return `  - ${what}${leak.value !== undefined ? ` (${JSON.stringify(leak.value)})` : ''} in ${leak.where}`;
    });
    const more = report.leaks.length > 50 ? `\n  … and ${report.leaks.length - 50} more` : '';
    super(`${report.leaks.length} permission leak(s):\n${lines.join('\n')}${more}`);
    this.name = 'AdminLeakError';
  }
}

export interface NoLeaksOptions {
  as: TestUser;
  /** Pages crawled per list (100 records each). Default 20. */
  maxPages?: number;
  /** Hidden values searched for with `/api/search`. Default 20. */
  maxSearches?: number;
}

/** Test helpers around an app that imports `AdminModule`. */
export class AdminTesting {
  constructor(readonly app: INestApplicationContext) {}

  /** A client acting as `user`. */
  as(user: TestUser, options: { locale?: string } = {}): AdminClient {
    const { roles, ...rest } = user;
    const adminUser: AdminUser = { displayName: String(user.id), isSuperuser: false, ...rest, id: user.id };
    return new AdminClient(this.app, adminUser, roles, options.locale);
  }

  /** A client that may do everything. */
  get superuser(): AdminClient {
    return this.as({ id: '@nest-my-admin/testing', displayName: 'Test superuser', isSuperuser: true });
  }

  /**
   * Crawls everything `options.as` can reach around `resource` and fails (with `AdminLeakError`) when any value of a
   * field hidden from them, or any record outside their scopes, shows up: in meta, the schema, every list page, each
   * record, global search for the hidden values, other resources' relation columns and pickers, and the rows parents list
   * inline (`_inlines` of each parent record on the first page). With the audit
   * log on, also in each record's history and (for a user with `audit.view`) the audit page, where the values the
   * hidden fields held before count too.
   */
  async expectNoLeaks(resource: string, options: NoLeaksOptions): Promise<LeakReport> {
    const root = this.superuser;
    const user = this.as(options.as);
    const maxPages = options.maxPages ?? 20;
    const leaks: Leak[] = [];
    let calls = 0;
    const call = async <T,>(fn: () => Promise<T>): Promise<T> => {
      calls++;
      return fn();
    };

    const full = await root.schema(resource);
    const all = await crawlList(root, resource, maxPages);
    let auditTruncated: boolean | undefined;
    /** Every page of an audit listing, up to `maxPages`; the report says when there was more. */
    const auditPages = async (fetch: (query: { before?: string }) => Promise<AuditResponse>): Promise<AuditEntry[]> => {
      const { entries, truncated } = await crawlAudit(fetch, maxPages);
      auditTruncated = auditTruncated === true || truncated;
      return entries;
    };
    const report = (hiddenFields: string[], outOfScope: number): LeakReport => {
      const result = { calls, records: all.length, hiddenFields, outOfScope, ...(auditTruncated !== undefined ? { auditTruncated } : {}), leaks };
      if (leaks.length > 0) throw new AdminLeakError(result);
      return result;
    };

    // Not reachable: the user may not view it, and every call is "not found". (Meta is no guide: it leaves out `nav: false` resources.)
    const meta = await call(() => user.meta());
    const viewable = await user.resources();
    const reachable = viewable.includes(resource);
    if (!reachable) {
      const probes: Array<[string, () => Promise<unknown>]> = [
        ['schema', () => user.schema(resource)],
        ['tab-counts', () => user.tabCounts(resource)],
        ['list', () => user.list(resource)],
        ...all.slice(0, 5).map((record): [string, () => Promise<unknown>] => [`get ${idOf(record)}`, () => user.get(resource, idOf(record))]),
      ];
      for (const [label, probe] of probes) {
        if (!(await answersNotFound(() => call(probe)))) leaks.push({ kind: 'unreachable-resource', resource, where: label });
      }
      const counted = await call(() => user.badges());
      for (const { key } of user.badgeQueries(resource)) if (key in counted) leaks.push({ kind: 'unreachable-resource', resource, where: `menu badge ${key}` });
      return report([], all.length);
    }

    const schema = await call(() => user.schema(resource));
    const visible = new Set(schema.fields.map((field) => field.name));
    const hiddenFields = full.fields.map((field) => field.name).filter((name) => !visible.has(name));
    const seen = await crawlList(user, resource, maxPages, () => calls++);
    const seenIds = new Set(seen.map((record) => idOf(record)));
    const outside = all.filter((record) => !seenIds.has(idOf(record)));
    const outsideIds = new Set(outside.map((record) => idOf(record)));
    const primary = full.primaryKeys.length === 1 ? full.primaryKeys[0]! : undefined;
    const outsideKeys = new Set(primary ? outside.map((record) => String(record[primary])) : []);

    // Values the user must never see: hidden fields of every record. A value that is also visible legitimately
    // (the same text in a visible field of a record in scope) is not a secret.
    const allowed = new Set<string>();
    for (const record of all) if (seenIds.has(idOf(record))) for (const name of visible) for (const value of leaves(record[name])) allowed.add(value);
    const secrets = new Map<string, { kind: Leak['kind']; record: string; field?: string }>();
    for (const record of all) {
      for (const field of hiddenFields) {
        for (const value of leaves(record[field])) if (value.length >= 4 && !allowed.has(value) && !secrets.has(value)) secrets.set(value, { kind: 'hidden-value', record: idOf(record), field });
      }
    }
    // Records out of scope: their title and texts (seen through another resource's title or column).
    for (const record of outside) {
      for (const value of [String(record._title ?? ''), ...full.fields.filter((field) => field.type === 'string' || field.type === 'text').flatMap((field) => leaves(record[field.name]))]) {
        if (value.length >= 4 && !allowed.has(value) && !secrets.has(value)) secrets.set(value, { kind: 'out-of-scope-record', record: idOf(record) });
      }
    }

    // With the audit log on, what was is as secret as what is: the values the hidden fields held before, and the
    // titles and texts the records out of scope had.
    const audited = this.app.get(AdminAudit, { strict: false }).enabled;
    if (audited) {
      const texts = new Set(full.fields.filter((field) => field.type === 'string' || field.type === 'text').map((field) => field.name));
      const add = (value: string, owner: { kind: Leak['kind']; record: string; field?: string }) => {
        if (value.length >= 4 && !allowed.has(value) && !secrets.has(value)) secrets.set(value, owner);
      };
      for (const record of all) {
        const id = idOf(record);
        // A record the superuser cannot open (in the trash since it was listed) has no history to read: only that.
        const entries = await auditPages((before) => root.history(resource, id, before)).catch((error: unknown) => (isAdminError(error) && error.code === 'NOT_FOUND' ? [] : Promise.reject(error)));
        for (const entry of entries) {
          if (outsideIds.has(id) && entry.recordTitle) add(entry.recordTitle, { kind: 'out-of-scope-record', record: id });
          for (const item of entry.changes ?? []) {
            const values = [...leaves((item as { before?: unknown }).before), ...leaves((item as { after?: unknown }).after)];
            if (hiddenFields.includes(item.field)) for (const value of values) add(value, { kind: 'hidden-value', record: id, field: item.field });
            else if (outsideIds.has(id) && texts.has(item.field)) for (const value of values) add(value, { kind: 'out-of-scope-record', record: id });
          }
        }
      }
    }

    const scan = (where: string, body: unknown, ownRecords: boolean) => {
      walk(body, '$', (path, value, parent) => {
        if (typeof value === 'string' || typeof value === 'number') {
          const text = String(value);
          for (const [secret, owner] of secrets) {
            if (text.includes(secret)) leaks.push({ kind: owner.kind, resource, record: owner.record, ...(owner.field ? { field: owner.field } : {}), where: `${where} ${path}`, value: shorten(secret) });
          }
        }
        if (ownRecords && path.endsWith('._id') && typeof value === 'string' && outsideIds.has(value)) {
          leaks.push({ kind: 'out-of-scope-record', resource, record: value, where: `${where} ${path}` });
        }
        void parent;
      });
    };

    scan('meta', meta, false);
    // The dashboard: every widget this user sees, for the last week.
    for (const widget of (await call(() => user.dashboard())).widgets) {
      try {
        scan(`dashboard ${widget.name}`, await call(() => user.widget(widget.name)), false);
      } catch {
        // A widget that fails shows its own error card; it reveals nothing.
      }
    }
    scan(`schema ${resource}`, schema, false);
    // A tab counts no more than the user's own list on that tab shows.
    if (schema.list.tabs?.length) {
      const tabCounts = await call(() => user.tabCounts(resource));
      for (const tab of schema.list.tabs) {
        const counted = tabCounts[tab.key];
        if (!counted || counted.estimate) continue;
        const listed = await call(() => user.list(resource, new URLSearchParams({ ...tab.filter, ...(tab.where ? { tab: tab.key } : {}), pageSize: '1' })));
        if (listed.total !== null && counted.count > listed.total) leaks.push({ kind: 'tab-count', resource, where: `tab ${tab.key}`, value: `${counted.count} > ${listed.total}` });
      }
    }
    // A menu badge counts no more than the user's own list with the same filters shows.
    const counted = await call(() => user.badges());
    for (const { key, params } of user.badgeQueries(resource)) {
      const badge = counted[key];
      if (!badge || badge.estimate) continue;
      const listed = await call(() => user.list(resource, new URLSearchParams({ ...params, pageSize: '1' })));
      if (listed.total !== null && badge.count > listed.total) leaks.push({ kind: 'badge-count', resource, where: `menu badge ${key}`, value: `${badge.count} > ${listed.total}` });
    }
    scan(`list ${resource}`, seen, true);
    for (const record of seen) scan(`get ${resource} ${idOf(record)}`, await call(() => user.get(resource, idOf(record))), true);
    for (const record of outside) {
      if (!(await answersNotFound(() => call(() => user.get(resource, idOf(record)))))) leaks.push({ kind: 'out-of-scope-record', resource, record: idOf(record), where: `get ${resource} ${idOf(record)}` });
    }
    if (audited) {
      for (const record of seen) scan(`history ${resource} ${idOf(record)}`, await auditPages((before) => call(() => user.history(resource, idOf(record), before))), false);
      for (const record of outside) {
        if (!(await answersNotFound(() => call(() => user.history(resource, idOf(record)))))) leaks.push({ kind: 'out-of-scope-record', resource, record: idOf(record), where: `history ${resource} ${idOf(record)}` });
      }
      if (await user.can('audit.view')) {
        const entries = await auditPages((before) => call(() => user.audit(before)));
        scan('audit', entries, false);
        for (const entry of entries) {
          if (entry.resource === resource && entry.recordId !== undefined && outsideIds.has(entry.recordId)) leaks.push({ kind: 'out-of-scope-record', resource, record: entry.recordId, where: `audit entry ${entry.id}` });
        }
      }
    }
    const hiddenValues = [...secrets.entries()].filter(([, owner]) => owner.kind === 'hidden-value').map(([secret]) => secret);
    for (const secret of hiddenValues.slice(0, options.maxSearches ?? 20)) {
      const found = await call(() => user.search(secret));
      scan(`search ${JSON.stringify(shorten(secret))}`, found, false);
      for (const group of found.groups) {
        if (group.resource !== resource) continue;
        for (const item of group.items) if (outsideIds.has(item._id)) leaks.push({ kind: 'out-of-scope-record', resource, record: item._id, where: `search ${JSON.stringify(shorten(secret))}` });
      }
    }
    // Every other resource the user reaches: its titles and columns, and the relations pointing here (columns, pickers).
    for (const other of viewable) {
      if (other === resource) continue;
      const otherSchema = await call(() => user.schema(other));
      const page = await call(() => user.list(other, { pageSize: 100 }));
      scan(`list ${other}`, page, false);
      const pointing = otherSchema.fields.filter((field) => field.type === 'relation' && field.relation?.resource === resource);
      for (const record of page.items) {
        for (const field of pointing) {
          for (const ref of refs(record[field.name])) {
            if (outsideKeys.has(String(ref.id)) && !ref.title.startsWith('#')) leaks.push({ kind: 'out-of-scope-record', resource, record: String(ref.id), where: `list ${other} ${idOf(record)} ${field.name}`, value: shorten(ref.title) });
          }
        }
      }
      // A parent that lists this resource inline: each of its records carries rows of this resource in `_inlines`.
      if (otherSchema.inlines?.[resource]) {
        for (const record of page.items) {
          const parent = await call(() => user.get(other, idOf(record)));
          scan(`get ${other} ${idOf(record)}`, parent, false);
          const rows = (parent._inlines as Record<string, { rows?: AdminRecord[] }> | undefined)?.[resource]?.rows ?? [];
          rows.forEach((row, index) => {
            if (outsideIds.has(idOf(row))) leaks.push({ kind: 'out-of-scope-record', resource, record: idOf(row), where: `get ${other} ${idOf(record)} $._inlines.${resource}.rows[${index}]` });
          });
        }
      }
      for (const field of pointing) {
        if (!otherSchema.form.create.includes(field.name) && !otherSchema.form.update.includes(field.name)) continue;
        const choices = await call(() => user.options(other, field.name, { pageSize: 100 })).catch((error: unknown) => (isAdminError(error) ? { items: [] } : Promise.reject(error)));
        scan(`options ${other}.${field.name}`, choices, false);
        for (const ref of choices.items) if (outsideKeys.has(String(ref.id))) leaks.push({ kind: 'out-of-scope-record', resource, record: String(ref.id), where: `options ${other}.${field.name}` });
      }
    }
    return report(hiddenFields, outside.length);
  }

  async close(): Promise<void> {
    await this.app.close();
  }
}

/**
 * Compiles and initializes a testing module around your app's imports, for `as()` and `expectNoLeaks()`.
 * `configure` can override providers (`builder.overrideProvider(...)`).
 */
export async function createAdminTestingModule(metadata: ModuleMetadata, configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder): Promise<AdminTesting> {
  let builder = Test.createTestingModule(metadata);
  if (configure) builder = configure(builder);
  const moduleRef = await builder.compile();
  await moduleRef.init();
  return new AdminTesting(moduleRef);
}

/** The same helpers for an application you already created (an e2e test's `app`). */
export function adminTesting(app: INestApplicationContext): AdminTesting {
  return new AdminTesting(app);
}

async function crawlList(client: AdminClient, resource: string, maxPages: number, count?: () => void): Promise<AdminRecord[]> {
  const records: AdminRecord[] = [];
  let after: string | undefined;
  for (let page = 1; page <= maxPages; page++) {
    count?.();
    const result = await client.list(resource, { pageSize: 100, ...(after ? { after } : { page }) });
    records.push(...result.items);
    if (result.nextCursor !== undefined) {
      if (!result.nextCursor) break;
      after = result.nextCursor;
    } else if (result.items.length < result.pageSize || (result.total !== null && page * result.pageSize >= result.total) || result.hasMore === false) break;
  }
  return records;
}

/** Every page of an audit listing (50 entries each), up to `maxPages`; `truncated` when there were more. */
async function crawlAudit(fetch: (query: { before?: string }) => Promise<AuditResponse>, maxPages: number): Promise<{ entries: AuditEntry[]; truncated: boolean }> {
  const entries: AuditEntry[] = [];
  let before: string | undefined;
  for (let page = 1; page <= maxPages; page++) {
    const result = await fetch(before ? { before } : {});
    entries.push(...result.entries);
    if (!result.next) return { entries, truncated: false };
    before = result.next;
  }
  return { entries, truncated: true };
}

async function answersNotFound(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (error) {
    if (isAdminError(error) && error.code === 'NOT_FOUND') return true;
    throw error;
  }
}

function isAdminError(error: unknown): error is AdminError {
  return error instanceof AdminError;
}

function toParams(query: TestQuery | undefined): URLSearchParams {
  if (query === undefined) return new URLSearchParams();
  if (typeof query === 'string') return new URLSearchParams(query);
  if (query instanceof URLSearchParams) return new URLSearchParams(query);
  const params = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (Array.isArray(value)) value.forEach((item) => add(key, item));
    else if (value !== null && typeof value === 'object') for (const [inner, nested] of Object.entries(value)) add(`${key}[${inner}]`, nested);
    else params.append(key, String(value));
  };
  for (const [key, value] of Object.entries(query)) add(key, value);
  return params;
}

/** The texts inside a value (a relation's title, an object's strings), numbers as text. */
function leaves(value: unknown): string[] {
  const out: string[] = [];
  walk(value, '', (_path, leaf) => {
    if (typeof leaf === 'string' || (typeof leaf === 'number' && Number.isFinite(leaf))) out.push(String(leaf));
  });
  return out;
}

function walk(value: unknown, path: string, visit: (path: string, value: unknown, parent: unknown) => void, parent?: unknown): void {
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`, visit, value));
  else if (value !== null && typeof value === 'object' && !(value instanceof Date)) for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`, visit, value);
  else visit(path, value instanceof Date ? value.toISOString() : value, parent);
}

function refs(value: unknown): Array<{ id: unknown; title: string }> {
  return (Array.isArray(value) ? value : value ? [value] : []).filter((ref): ref is { id: unknown; title: string } => typeof ref === 'object' && ref !== null && 'id' in ref && typeof (ref as { title?: unknown }).title === 'string');
}

function shorten(text: string): string {
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

function idOf(record: AdminRecord): string {
  return String(record._id);
}
