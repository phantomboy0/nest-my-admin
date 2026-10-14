import { Injectable } from '@nestjs/common';
import { QueryFailedError, type SelectQueryBuilder } from 'typeorm';
import { AdminApiService } from '../api/admin-api.service.js';
import { SINGLE_CONNECTION_DRIVERS } from '../api/write-queue.js';
import type { AuditEntry, AuditEntryChange, AuditEntryMeta, AuditResponse } from '../contract.js';
import { likePattern } from '../crud/list-query-builder.js';
import { parseRecordId, recordIdOf } from '../crud/record-id.js';
import { AdminForbiddenError, AdminNotFoundError } from '../errors.js';
import { PageRegistry } from '../pages/page-registry.js';
import { AdminPolicy } from '../policy/admin-policy.service.js';
import type { EffectivePermissions, FieldLevel } from '../policy/effective.js';
import { actionCode } from '../policy/roles.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import { AdminResourceBase, type RecordId } from '../resource/admin-resource-base.js';
import { AUDIT_FILTERS, parseAuditQuery } from './audit-query.js';
import { AdminAudit } from './audit.service.js';
import type { AuditChange } from './diff.js';
import { NmaAuditEntry } from './entities.js';

/** Entries per page. */
export const AUDIT_PAGE_SIZE = 50;
/** The code that opens the audit page (`policy/catalog.ts` adds it to the catalog while the audit log is on). */
const AUDIT_VIEW = 'audit.view';
/** The largest id a 32-bit column holds (the audit table's key on Postgres and MySQL). */
const INT32_MAX = 2_147_483_647;

/** The records a reader can view among those a page of entries names: resource → `_id`s. */
type Viewable = ReadonlyMap<string, ReadonlySet<string>>;
/**
 * Where records ended: resource → `_id` → the id of the newest entry that says the record went for good. That entry
 * and every earlier one of the same `_id` belong to a record that is gone, whatever has the key now.
 */
type Endings = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** `value` without its undefined keys; undefined when nothing is left. */
function compact<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}

/**
 * The event of an entry whose resource the reader cannot reach: the resource's name becomes `*`, and an action's
 * name is left out (`*.updated`, `*.action`).
 */
function anonymousEvent(event: string, resource: string): string {
  const rest = event.startsWith(`${resource}.`) ? event.slice(resource.length + 1) : '';
  const kind = rest.startsWith('action.') ? 'action' : rest;
  return /^[a-z]+$/.test(kind) ? `*.${kind}` : '*';
}

/**
 * Reads the audit log (spec §10.2) for one reader. Entries were recorded whole, whoever the actor was; everything
 * here is decided per reader and per entry, when it is read, so that reading the log never shows more than the
 * reader could see on the record itself:
 *
 * - a record entry is shown in full only when the reader can view the resource and GET would show them the record
 *   now (their scopes, the resource's `query()`, a `findOne` override). Otherwise it says that something happened,
 *   by whom and when, and names the resource only when the reader can reach it: no record id, no title, no changes,
 *   no action input;
 * - a record that went for good (purged, deleted where there is no trash or by a host `delete()` that bypasses it,
 *   deleted by an action; its last entry is stamped `meta.deleted` when it is written, see `endings`) took its
 *   entries with it: nobody can be checked against it any more, and its key may belong to another record since. A
 *   record's history starts after the last such entry; on the audit page those entries are closed like the ones
 *   above to every reader a row restriction applies to (`readsGone`), and read by a superuser and by a reader
 *   nothing restricts in that resource. Only what the admin recorded can be known: a record that went without a
 *   stamp (the cases are listed at `endings`) keeps its entries open to whoever can view a later record with its
 *   key;
 * - in a full entry, a changed field the reader may not view is `{ field, hidden: true }`;
 * - a settings page's entry needs the page (without it, it names no page), the changes of roles, groups and users
 *   need `rbac.view`, and the changes of an entry of no known kind are a superuser's;
 * - no entry is ever left out of a page, so the number of entries tells nothing a filter did not already; and a
 *   filter never matches by something the reader is not shown.
 */
@Injectable()
export class AuditReader {
  constructor(
    private readonly audit: AdminAudit,
    private readonly registry: ResourceRegistry,
    private readonly policy: AdminPolicy,
    private readonly api: AdminApiService,
    private readonly pages: PageRegistry,
  ) {}

  /**
   * `GET /api/resources/:resource/:id/history?before=`: the entries of one record, for whoever GET shows the record
   * to. It needs no `audit.view`.
   */
  async history(name: string, rawId: string, query: URLSearchParams, ctx: AdminContext): Promise<AuditResponse> {
    this.requireEnabled();
    // GET itself: its permission, scope and trash checks, and so its 404 and 403, whoever wrote the entries.
    const record = await this.api.get(name, rawId, ctx);
    const { before } = parseAuditQuery(query, ['before']);
    // The record's own `_id`, which is what its entries were written under (the URL may spell it another way).
    const id = String(record._id);
    // A record that had this key before and is gone is another record: this one's history starts after its end.
    const end = (await this.endings(name, [id])).get(id);
    const found = await this.rows(before, (qb) => {
      qb.andWhere('entry.resource = :resource AND entry.recordId = :record', { resource: name, record: id });
      if (end !== undefined) qb.andWhere('entry.id > :end', { end });
    });
    // A case-insensitive collation also finds the entries of a record whose id differs by case: they are not this record's.
    return this.respond(found, ctx, { viewable: new Map([[name, new Set([id])]]), endings: new Map(), keep: (row) => row.resource === name && row.recordId === id });
  }

  /**
   * `GET /api/audit?actor=&event=&resource=&record=&from=&to=&before=`: every entry, for readers with `audit.view`.
   * `record` goes with `resource`; alone it names what an entry without a resource is about (a role, a group, a user).
   */
  async list(query: URLSearchParams, ctx: AdminContext): Promise<AuditResponse> {
    this.requireEnabled();
    const perms = this.policy.permissionsOf(ctx);
    if (!perms.can(AUDIT_VIEW)) throw new AdminForbiddenError('You may not read the audit log');
    const filter = parseAuditQuery(query, AUDIT_FILTERS);
    const nothing: AuditResponse = { entries: [] };
    const { resource, record } = filter;
    let ended: { upTo?: number; after?: number } = {};
    if (resource !== undefined) {
      const entry = this.registry.find(resource);
      // A resource the reader cannot reach does not exist for them; one that is gone is a superuser's to read.
      if (entry ? !perms.canReach(resource) : !perms.superuser) return nothing;
      if (entry && record !== undefined) {
        // Asking for one record is seeing it: one they cannot view matches nothing, like one that never existed.
        const live = perms.canOn(resource, 'view') && (await this.asked(entry, record, ctx));
        const end = (await this.endings(resource, [record])).get(record);
        if (this.readsGone(entry, perms, ctx)) {
          // Whoever reads gone records also finds the ones that had this key before; a live one they cannot view stays out.
          if (!live && end === undefined) return nothing;
          if (!live) ended = { upTo: end! };
        } else {
          if (!live) return nothing;
          // The key names the record that has it now, never the one that had it before.
          if (end !== undefined) ended = { after: end };
        }
      }
    }
    const found = await this.rows(filter.before, (qb) => {
      if (filter.actor !== undefined) qb.andWhere('entry.actorId = :actor', { actor: filter.actor });
      if (resource !== undefined) qb.andWhere('entry.resource = :resource', { resource });
      else if (record !== undefined) qb.andWhere('entry.resource IS NULL');
      if (record !== undefined) qb.andWhere('entry.recordId = :record', { record });
      if (filter.event !== undefined) {
        if (filter.event.endsWith('.*')) qb.andWhere("entry.event LIKE :event ESCAPE '!'", { event: likePattern(filter.event.slice(0, -1), 'start') });
        else qb.andWhere('entry.event = :event', { event: filter.event });
        // The event of an unreachable resource is not shown (`*.updated`), so no event may find it.
        if (!perms.superuser) {
          const reachable = this.registry.list().map((entry) => entry.schema.name).filter((name) => perms.canReach(name));
          if (reachable.length > 0) qb.andWhere('(entry.resource IS NULL OR entry.resource IN (:...reachable))', { reachable });
          else qb.andWhere('entry.resource IS NULL');
          // Nor may one find a settings page they cannot view: its entry names no page (`page.*.updated`).
          const pages = this.pages.list().filter((page) => perms.canPage(page.name, 'view')).map((page) => `page.${page.name}.updated`);
          if (pages.length > 0) qb.andWhere("(entry.resource IS NOT NULL OR entry.event NOT LIKE 'page.%' OR entry.event IN (:...pages))", { pages });
          else qb.andWhere("(entry.resource IS NOT NULL OR entry.event NOT LIKE 'page.%')");
        }
      }
      if (ended.upTo !== undefined) qb.andWhere('entry.id <= :upTo', { upTo: ended.upTo });
      if (ended.after !== undefined) qb.andWhere('entry.id > :after', { after: ended.after });
      if (filter.from) qb.andWhere('entry.at >= :from', { from: filter.from });
      if (filter.to) qb.andWhere(`entry.at ${filter.to.inclusive ? '<=' : '<'} :to`, { to: filter.to.at });
    });
    return this.respond(found, ctx);
  }

  /** Whether the reader can view the record a filter names. An id the database refuses (a number no key holds) is no record. */
  private async asked(entry: RegisteredResource, record: string, ctx: AdminContext): Promise<boolean> {
    try {
      return (await this.inView(entry, [record], ctx)).has(record);
    } catch (error) {
      if (error instanceof QueryFailedError) return false;
      throw error;
    }
  }

  /**
   * Who reads the entries of a record that is gone for good: a superuser, as themselves; and a reader who could have
   * read any row of the resource, because nothing restricts it for them (no scope of theirs, no global scope, no
   * `query()` or `findOne` of the host). The field rules still apply to that reader. Anyone a row restriction applies
   * to cannot be checked against a record that is not there, and reads nothing of it.
   */
  private readsGone(entry: RegisteredResource | undefined, perms: EffectivePermissions, ctx: AdminContext): boolean {
    if (perms.superuser && !ctx.viewAs) return true;
    return entry !== undefined && perms.canOn(entry.schema.name, 'view') && !this.restricts(entry, ctx);
  }

  /** Whether anything decides row by row what this reader sees of the resource. */
  private restricts(entry: RegisteredResource, ctx: AdminContext): boolean {
    return entry.resource.query !== AdminResourceBase.prototype.query || entry.resource.findOne !== AdminResourceBase.prototype.findOne || this.policy.scoped(entry, 'view', ctx);
  }

  /**
   * For each of these `_id`s of a resource, the id of the newest entry that ended a record: one stamped
   * `meta.deleted` when it was written (`recordEntry` in `audit-participant.ts`: every purge, and a delete or an
   * action that left no row). The stamp decides, not the event's name or whether the resource has a trash today.
   *
   * An entry is stored under the resource its request went through, and a table may have several (the root and the
   * kinds of an inheritance family, or two resources of one entity): a record deleted through one of them is gone
   * for all, so the stamp is looked for under every resource of the table. One query, along the
   * `(resource, recordId, id)` index; `meta` is JSON text, so a pattern narrows the read and the parsed value decides.
   *
   * What leaves no stamp cannot be seen here, and a key given again then reopens the earlier entries:
   * - a delete (not a purge) that completes after the host method returned: queued, or fire and forget;
   * - rows a database cascade removes when another record is deleted;
   * - a delete whose entry was lost: the insert after commit failed (the audit table on another DataSource, or
   *   `transactions: false`);
   * - a delete on another connection whose stamp, added right after commit, never came: the process died between
   *   the commit and the stamp, or the read or the update failed (which is logged);
   * - a record deleted outside the admin, or by a `target: 'resource'` action (which names no record);
   * - an action that deletes its record on another connection under MySQL's REPEATABLE READ (the admin's
   *   transaction still reads the row, and an action's entry is not checked a second time).
   */
  private async endings(name: string, ids: string[]): Promise<Map<string, number>> {
    const ends = new Map<string, number>();
    if (ids.length === 0) return ends;
    const entry = this.registry.find(name);
    const family = entry ? this.registry.list().filter((other) => other.dataSource === entry.dataSource && other.metadata.tablePath === entry.metadata.tablePath).map((other) => other.schema.name) : [name];
    const rows = await this.audit.db
      .getRepository(NmaAuditEntry)
      .createQueryBuilder('entry')
      .select(['entry.id', 'entry.recordId', 'entry.meta'])
      .where('entry.resource IN (:...family) AND entry.recordId IN (:...ids)', { family, ids })
      .andWhere('entry.meta LIKE :deleted', { deleted: '%"deleted":true%' })
      .getMany();
    const wanted = new Set(ids);
    for (const row of rows) {
      // Exactly this record (whatever the collation matched), and the stamp itself, not an input that reads like it.
      if (row.recordId === null || !wanted.has(row.recordId) || row.meta?.deleted !== true) continue;
      const id = Number(row.id);
      if (id > (ends.get(row.recordId) ?? 0)) ends.set(row.recordId, id);
    }
    return ends;
  }

  private requireEnabled(): void {
    if (!this.audit.enabled) throw new AdminNotFoundError('The audit log is not enabled in this admin');
  }

  /** One page and one more (which says whether there is a next page), newest first. */
  private rows(before: number | undefined, restrict: (qb: SelectQueryBuilder<NmaAuditEntry>) => void): Promise<NmaAuditEntry[]> {
    const db = this.audit.db;
    const qb = db.getRepository(NmaAuditEntry).createQueryBuilder('entry');
    restrict(qb);
    // Beyond a 32-bit key every entry is "before" (and Postgres would refuse the comparison); SQLite's key is 64-bit.
    if (before !== undefined && (before <= INT32_MAX || SINGLE_CONNECTION_DRIVERS.has(db.options.type))) qb.andWhere('entry.id < :before', { before });
    return qb.orderBy('entry.id', 'DESC').take(AUDIT_PAGE_SIZE + 1).getMany();
  }

  /**
   * The page as the reader may see it. Entries are cut after paging and never dropped for what they hold, so a
   * page's length says nothing about what was withheld (`keep` only drops another record's entries).
   */
  private async respond(found: NmaAuditEntry[], ctx: AdminContext, options: { viewable?: Viewable; endings?: Endings; keep?: (row: NmaAuditEntry) => boolean } = {}): Promise<AuditResponse> {
    const page = found.slice(0, AUDIT_PAGE_SIZE);
    const next = found.length > AUDIT_PAGE_SIZE ? String(page.at(-1)!.id) : undefined;
    const rows = options.keep ? page.filter(options.keep) : page;
    // The records the page names, by resource: two queries per resource at most (where each ended, which are in view).
    const named = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.resource === null || row.recordId === null) continue;
      if (!named.has(row.resource)) named.set(row.resource, new Set());
      named.get(row.resource)!.add(row.recordId);
    }
    const endings = options.endings ?? new Map(await Promise.all([...named].map(async ([name, ids]) => [name, await this.endings(name, [...ids])] as const)));
    const viewable = options.viewable ?? (await this.viewable(named, ctx));
    const perms = this.policy.permissionsOf(ctx);
    const levels = new Map<string, Map<string, FieldLevel>>();
    const entries = rows.map((row) => this.entry(row, perms, viewable, endings, levels, ctx));
    return { entries, ...(next !== undefined ? { next } : {}) };
  }

  /** Which of the records a page names the reader can view now. */
  private async viewable(named: ReadonlyMap<string, ReadonlySet<string>>, ctx: AdminContext): Promise<Viewable> {
    const perms = this.policy.permissionsOf(ctx);
    const viewable = new Map<string, Set<string>>();
    for (const [name, ids] of named) {
      const entry = this.registry.find(name);
      if (!entry || !perms.canOn(name, 'view')) continue;
      try {
        viewable.set(name, await this.inView(entry, [...ids], ctx));
      } catch (error) {
        // An id the database refuses fails the statement for all of them: none is shown, and the page still answers.
        if (!(error instanceof QueryFailedError)) throw error;
      }
    }
    return viewable;
  }

  /**
   * The `_id`s among `rawIds` that GET would show the reader now: within their view scopes and the resource's
   * `query()`, and found by its `findOne` when the host overrides that. Trashed records count (a list shows them).
   * When nothing restricts the resource every id passes; when something does, a record that is not there cannot be
   * checked, and stays closed.
   */
  private async inView(entry: RegisteredResource, rawIds: string[], ctx: AdminContext): Promise<Set<string>> {
    const narrowed = entry.resource.query !== AdminResourceBase.prototype.query || this.policy.scoped(entry, 'view', ctx);
    const overridden = entry.resource.findOne !== AdminResourceBase.prototype.findOne;
    if (!narrowed && !overridden) return new Set(rawIds);
    const keys = entry.schema.primaryKeys;
    const ids = new Map<string, RecordId>();
    for (const raw of rawIds) {
      try {
        ids.set(raw, parseRecordId(raw, entry.schema));
      } catch {
        // Not an id of this resource: no record has it.
      }
    }
    if (ids.size === 0) return new Set();
    let seen = new Set(ids.keys());
    if (narrowed) {
      const qb = entry.dataSource.getRepository(entry.metadata.target).createQueryBuilder('entity').withDeleted();
      // The ids go on last: a `query()` that starts its own `where()` must not leave the select unbounded.
      const restricted = this.policy.applyScopes(entry.resource.query(qb, ctx), entry, 'view', ctx).andWhereInIds([...ids.values()]);
      const found = await restricted.select(keys.map((key) => `${restricted.alias}.${key}`)).getMany();
      const within = new Set(found.map((row) => recordIdOf(row as object, keys)));
      seen = new Set([...seen].filter((raw) => within.has(raw)));
    }
    if (overridden) {
      // The host's own finder decides, as it does for GET. One that throws (before or after it answers a promise)
      // shows nothing.
      for (const raw of [...seen]) {
        let found: unknown;
        try {
          found = await entry.resource.findOne(ids.get(raw)!, ctx, { withDeleted: true });
        } catch {
          found = null;
        }
        if (!found) seen.delete(raw);
      }
    }
    return seen;
  }

  private entry(row: NmaAuditEntry, perms: EffectivePermissions, viewable: Viewable, endings: Endings, levels: Map<string, Map<string, FieldLevel>>, ctx: AdminContext): AuditEntry {
    const base: AuditEntry = {
      id: String(row.id),
      at: new Date(row.at).toISOString(),
      event: row.event,
      actor: row.actorId === null ? null : { id: row.actorId, name: row.actorName },
      ...(row.viewAsBy !== null ? { viewAsBy: row.viewAsBy } : {}),
      correlationId: row.correlationId,
    };
    const stored = row.meta ?? {};
    // Where a request came from is the audit page's to show: a History tab shows it to its readers only.
    const traced = perms.can(AUDIT_VIEW);
    const client = { ip: traced ? stored.ip : undefined, userAgent: traced ? stored.userAgent : undefined };
    const about = { ...(row.recordId !== null ? { recordId: row.recordId } : {}), ...(row.recordTitle !== null ? { recordTitle: row.recordTitle } : {}) };

    if (row.resource === null) {
      const page = /^page\.(.+)\.updated$/.exec(row.event)?.[1];
      // A settings page the reader cannot view does not exist for them (nor does one that is gone, but for a superuser).
      if (page !== undefined && !perms.superuser && !(this.pages.find(page) && perms.canPage(page, 'view'))) return { ...base, event: 'page.*.updated', restricted: true };
      // Role and user changes are for whoever may read roles and users; sign-ins carry none; what else a host or a
      // later version records is a superuser's until something says who may see it.
      const open = page !== undefined || row.event.startsWith('auth.') || (row.event.startsWith('rbac.') ? perms.can('rbac.view') || perms.can('rbac.manage') : perms.superuser);
      const meta = compact<AuditEntryMeta>({ ...stored, ...client });
      if (row.changes === null) return { ...base, ...about, ...(meta ? { meta } : {}) };
      return { ...base, ...about, ...(open ? { changes: row.changes } : {}), ...(meta ? { meta } : {}), ...(open ? {} : { restricted: true as const }) };
    }

    const name = row.resource;
    const entry = this.registry.find(name);
    // A resource that is gone has no permissions left to check: only a superuser reads its entries.
    if (entry ? !perms.canReach(name) : !perms.superuser) return { ...base, event: anonymousEvent(row.event, name), restricted: true };
    // An entry at or before the end of its record is of a record that is gone, whoever has the key now (`readsGone`).
    const end = row.recordId === null ? undefined : endings.get(name)?.get(row.recordId);
    const gone = end !== undefined && Number(row.id) <= end;
    const viewed = gone ? this.readsGone(entry, perms, ctx) : !entry || (perms.canOn(name, 'view') && (row.recordId === null || viewable.get(name)?.has(row.recordId) === true));
    if (!viewed) {
      const meta = compact<AuditEntryMeta>({ action: stored.action, deleted: stored.deleted });
      return { ...base, resource: name, ...(meta ? { meta } : {}), restricted: true };
    }
    // An action's input is for whoever holds the action.
    const holds = stored.action !== undefined && perms.can(actionCode(name, stored.action));
    // A child saved inline names its parent, for readers who may view the parent's resource.
    const parent = stored.parent && perms.canOn(stored.parent.resource, 'view') ? stored.parent : undefined;
    const meta = compact<AuditEntryMeta>({ action: stored.action, input: holds ? stored.input : undefined, inputTruncated: holds ? stored.inputTruncated : undefined, deleted: stored.deleted, parent, ...client });
    const titled = !entry || this.policy.titleVisible(entry, ctx);
    return {
      ...base,
      resource: name,
      ...(row.recordId !== null ? { recordId: row.recordId } : {}),
      ...(row.recordTitle !== null && titled ? { recordTitle: row.recordTitle } : {}),
      ...(row.changes !== null ? { changes: this.mask(row.changes, entry, perms, levels, ctx) } : {}),
      ...(meta ? { meta } : {}),
    };
  }

  /** A field the reader may not view on the record keeps its name and loses its values. */
  private mask(changes: AuditChange[], entry: RegisteredResource | undefined, perms: EffectivePermissions, cache: Map<string, Map<string, FieldLevel>>, ctx: AdminContext): AuditEntryChange[] {
    if (perms.superuser || !entry) return changes;
    const name = entry.schema.name;
    if (!cache.has(name)) cache.set(name, this.policy.levels(entry, ctx));
    const levels = cache.get(name)!;
    return changes.map((change) => {
      // Not a field of the resource any more: nothing says who may see it.
      const level = levels.get(change.field) ?? 'hidden';
      return level === 'hidden' ? { field: change.field, hidden: true } : change;
    });
  }
}
