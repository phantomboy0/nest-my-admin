import type { SelectQueryBuilder } from 'typeorm';
import type { AdminRecord, InlineRows } from '../contract.js';
import { recordIdOf } from '../crud/record-id.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import { AdminResourceBase, type FilterValue, type ListParams, type RecordId } from '../resource/admin-resource-base.js';
import type { RegisteredInline } from './inline-config.js';

export interface InlineReaderDeps {
  policy: AdminPolicy;
  /** Serializes the child's entities exactly as its own record endpoint does (fields cut, `_perm`, `_files`…). */
  serialize: (entry: RegisteredResource, entities: object[], ctx: AdminContext) => Promise<AdminRecord[]>;
  /** Sets `_computed` on the rows for the inline's computed columns this user may see (one batch per inline). */
  computed?: (inline: RegisteredInline, entities: object[], records: AdminRecord[], ctx: AdminContext) => Promise<void>;
}

/**
 * `_inlines` of a record: for each inline the user may see (`AdminPolicy.canSeeInline`: the child's `view` and its link
 * field), the children of this record read through the CHILD resource's own `findMany` (so its `query()`, the user's
 * scopes there and any host override apply, as on the child's list), filtered by the link and sorted by `order` then
 * key, and serialized like the child's records.
 */
export class InlineReader {
  constructor(private readonly deps: InlineReaderDeps) {}

  /** Sets `record._inlines`, unless the parent has no inline this user may see (then the key stays absent). */
  async readInto(record: AdminRecord, parent: RegisteredResource, entity: object, ctx: AdminContext): Promise<void> {
    const out: Record<string, InlineRows> = {};
    for (const inline of parent.inlines) {
      if (this.deps.policy.canSeeInline(inline.child, inline.link, ctx)) out[inline.name] = await this.rows(inline, entity, ctx);
    }
    if (Object.keys(out).length > 0) record._inlines = out;
  }

  /**
   * The default `findMany` gets one page of `max` rows, uncounted (it reads `max + 1` rows to know whether more exist),
   * so an inline costs one query for its rows plus the serializer's lookups (one per relation field and one for files,
   * whatever the number of rows); a truncated inline adds one count query. A child that overrides `findMany` runs its
   * own queries, and its rows are re-checked in one more query (see `overridden`).
   */
  private async rows(inline: RegisteredInline, parent: object, ctx: AdminContext): Promise<InlineRows> {
    const { child } = inline;
    const { policy } = this.deps;
    const value = (parent as Record<string, unknown>)[inline.referenced];
    if (value === null || value === undefined) return { rows: [], total: 0, truncated: false };
    // Sorting by a field the user cannot see would reveal its values (the child's list refuses it too): by key then.
    const order = inline.order !== undefined && (policy.levels(child, ctx).get(inline.order) ?? 'hidden') !== 'hidden' ? inline.order : undefined;
    const params: ListParams = {
      page: 1,
      pageSize: inline.max,
      sort: { field: order ?? child.schema.primaryKeys[0]!, direction: 'asc' },
      filters: [{ field: inline.link, operator: 'eq', value: value as FilterValue }],
      count: 'none',
      pagination: 'offset',
    };
    const found = await child.resource.findMany(params, ctx);
    if (child.resource.findMany !== AdminResourceBase.prototype.findMany) return this.overridden(inline, value, found, ctx);
    const truncated = found.hasMore === true || found.items.length > inline.max;
    const items = found.items.slice(0, inline.max);
    const total = truncated ? await this.children(inline, value, ctx).getCount() : items.length;
    return { rows: await this.serialize(inline, items, ctx), total, truncated };
  }

  /** The child's records, with the inline's computed columns. */
  private async serialize(inline: RegisteredInline, entities: object[], ctx: AdminContext): Promise<AdminRecord[]> {
    const records = await this.deps.serialize(inline.child, entities, ctx);
    if (inline.computed.length > 0 && entities.length > 0) await this.deps.computed?.(inline, entities, records, ctx);
    return records;
  }

  /**
   * A `findMany` override may ignore the link filter and the scopes: its rows are kept only when they are children of
   * THIS parent inside the user's view scopes and the child's `query()` (one query, `children()` with their keys), in
   * the override's order. `truncated` and `total` come after that re-check: the override's own `hasMore`/`total` count
   * rows it may not have filtered, so when it says there are more (or more than `max` remain), the children are
   * counted with `children()` instead of trusting it.
   */
  private async overridden(inline: RegisteredInline, value: unknown, found: { items: object[]; total: number | null; hasMore?: boolean }, ctx: AdminContext): Promise<InlineRows> {
    const { child } = inline;
    const keys = child.schema.primaryKeys;
    const idOf = (item: object) => (keys.length === 1 ? (item as Record<string, unknown>)[keys[0]!] : Object.fromEntries(keys.map((key) => [key, (item as Record<string, unknown>)[key]]))) as RecordId;
    let items = found.items;
    if (items.length > 0) {
      const kept = await this.children(inline, value, ctx).andWhereInIds(items.map(idOf)).select(keys.map((key) => `nma_inline.${key}`)).getMany();
      const allowed = new Set(kept.map((row) => recordIdOf(row, keys)));
      items = items.filter((item) => allowed.has(recordIdOf(item, keys)));
    }
    const more = found.hasMore === true || (found.total ?? 0) > found.items.length;
    const total = more || items.length > inline.max ? await this.children(inline, value, ctx).getCount() : items.length;
    const rows = items.slice(0, inline.max);
    return { rows: await this.serialize(inline, rows, ctx), total, truncated: total > rows.length };
  }

  /** This parent's children as the user may view them: the child's `query()`, the user's view scopes, the link. */
  private children(inline: RegisteredInline, value: unknown, ctx: AdminContext): SelectQueryBuilder<any> {
    const { child } = inline;
    const manager = ctx.manager ?? child.dataSource.manager;
    const qb = manager.getRepository(child.metadata.target).createQueryBuilder('nma_inline');
    return this.deps.policy.applyScopes(child.resource.query(qb, ctx), child, 'view', ctx).andWhere(`nma_inline.${inline.link} = :nmaInlineParent`, { nmaInlineParent: value });
  }
}
