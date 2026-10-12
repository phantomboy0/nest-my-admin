import { Injectable } from '@nestjs/common';
import { QueryFailedError, type SelectQueryBuilder } from 'typeorm';
import { AdminApiService } from '../api/admin-api.service.js';
import { SINGLE_CONNECTION_DRIVERS } from '../api/write-queue.js';
import type { AuditEntry, AuditEntryChange, AuditEntryMeta, AuditResponse } from '../contract.js';
import { likePattern } from '../crud/list-query-builder.js';
import { parseRecordId, recordIdOf } from '../crud/record-id.js';
import { AdminForbiddenError, AdminNotFoundError } from '../errors.js';
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
 * - a record entry is shown in full only when the reader can view the resource and the record is within their
 *   scopes (and the resource's `query()`) now. Otherwise it says that something happened, by whom and when, and
 *   names the resource only when the reader can reach it: no record id, no title, no changes, no action input;
 * - in a full entry, a changed field the reader may not view is `{ field, hidden: true }`;
 * - the changes of a settings page need the page, those of roles, groups and users `rbac.view`;
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
    const found = await this.rows(before, (qb) => qb.andWhere('entry.resource = :resource AND entry.recordId = :record', { resource: name, record: id }));
    // A case-insensitive collation also finds the entries of a record whose id differs by case: they are not this record's.
    return this.respond(found, ctx, { viewable: new Map([[name, new Set([id])]]), keep: (row) => row.resource === name && row.recordId === id });
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
    if (resource !== undefined) {
      const entry = this.registry.find(resource);
      // A resource the reader cannot reach does not exist for them; one that is gone is a superuser's to read.
      if (entry ? !perms.canReach(resource) : !perms.superuser) return nothing;
      // Asking for one record is seeing it: one they cannot view matches nothing, like one that never existed.
      if (entry && record !== undefined && (!perms.canOn(resource, 'view') || !(await this.asked(entry, record, ctx)))) return nothing;
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
        }
      }
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
  private async respond(found: NmaAuditEntry[], ctx: AdminContext, options: { viewable?: Viewable; keep?: (row: NmaAuditEntry) => boolean } = {}): Promise<AuditResponse> {
    const page = found.slice(0, AUDIT_PAGE_SIZE);
    const next = found.length > AUDIT_PAGE_SIZE ? String(page.at(-1)!.id) : undefined;
    const rows = options.keep ? page.filter(options.keep) : page;
    const viewable = options.viewable ?? (await this.viewable(rows, ctx));
    const perms = this.policy.permissionsOf(ctx);
    const levels = new Map<string, Map<string, FieldLevel>>();
    const entries = rows.map((row) => this.entry(row, perms, viewable, levels, ctx));
    return { entries, ...(next !== undefined ? { next } : {}) };
  }

  /** Which of the records these entries name the reader can view now. */
  private async viewable(rows: NmaAuditEntry[], ctx: AdminContext): Promise<Viewable> {
    const perms = this.policy.permissionsOf(ctx);
    const named = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.resource === null || row.recordId === null) continue;
      if (!named.has(row.resource)) named.set(row.resource, new Set());
      named.get(row.resource)!.add(row.recordId);
    }
    const viewable = new Map<string, Set<string>>();
    for (const [name, ids] of named) {
      const entry = this.registry.find(name);
      if (entry && perms.canOn(name, 'view')) viewable.set(name, await this.inView(entry, [...ids], ctx));
    }
    return viewable;
  }

  /**
   * The `_id`s among `rawIds` that the reader's view scopes and the resource's `query()` let through, trashed
   * records included (a list shows them too). When nothing restricts the resource every id passes, also that of a
   * record deleted for good; when something does, a record that is gone cannot be checked, and stays closed.
   */
  private async inView(entry: RegisteredResource, rawIds: string[], ctx: AdminContext): Promise<Set<string>> {
    const narrowed = entry.resource.query !== AdminResourceBase.prototype.query;
    if (!narrowed && !this.policy.scoped(entry, 'view', ctx)) return new Set(rawIds);
    const keys = entry.schema.primaryKeys;
    const ids: RecordId[] = [];
    for (const raw of rawIds) {
      try {
        ids.push(parseRecordId(raw, entry.schema));
      } catch {
        // Not an id of this resource: no record has it.
      }
    }
    if (ids.length === 0) return new Set();
    const qb = entry.dataSource.getRepository(entry.metadata.target).createQueryBuilder('entity').withDeleted().whereInIds(ids);
    const restricted = this.policy.applyScopes(entry.resource.query(qb, ctx), entry, 'view', ctx);
    const found = await restricted.select(keys.map((key) => `${restricted.alias}.${key}`)).getMany();
    const seen = new Set(found.map((row) => recordIdOf(row as object, keys)));
    return new Set(rawIds.filter((raw) => seen.has(raw)));
  }

  private entry(row: NmaAuditEntry, perms: EffectivePermissions, viewable: Viewable, levels: Map<string, Map<string, FieldLevel>>, ctx: AdminContext): AuditEntry {
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
      // A settings page's values belong to the page, role and user changes to whoever may read roles and users.
      const page = /^page\.(.+)\.updated$/.exec(row.event)?.[1];
      const open = page !== undefined ? perms.canPage(page, 'view') : row.event.startsWith('rbac.') ? perms.can('rbac.view') || perms.can('rbac.manage') : true;
      const meta = compact<AuditEntryMeta>({ ...stored, ...client });
      if (row.changes === null) return { ...base, ...about, ...(meta ? { meta } : {}) };
      return { ...base, ...about, ...(open ? { changes: row.changes } : {}), ...(meta ? { meta } : {}), ...(open ? {} : { restricted: true as const }) };
    }

    const name = row.resource;
    const entry = this.registry.find(name);
    // A resource that is gone has no permissions left to check: only a superuser reads its entries.
    if (entry ? !perms.canReach(name) : !perms.superuser) return { ...base, event: anonymousEvent(row.event, name), restricted: true };
    const viewed = !entry || (perms.canOn(name, 'view') && (row.recordId === null || viewable.get(name)?.has(row.recordId) === true));
    if (!viewed) {
      const meta = compact<AuditEntryMeta>({ action: stored.action, deleted: stored.deleted });
      return { ...base, resource: name, ...(meta ? { meta } : {}), restricted: true };
    }
    // An action's input is for whoever holds the action.
    const holds = stored.action !== undefined && perms.can(actionCode(name, stored.action));
    const meta = compact<AuditEntryMeta>({ action: stored.action, input: holds ? stored.input : undefined, inputTruncated: holds ? stored.inputTruncated : undefined, deleted: stored.deleted, ...client });
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
