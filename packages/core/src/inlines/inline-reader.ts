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
}

/**
 * `_inlines` of a record: for each inline whose child the user may view, the children of this record read through the
 * CHILD resource's own `findMany` (so its `query()`, the user's scopes there and any host override apply, as on the
 * child's list), filtered by the link and sorted by `order` then key, and serialized like the child's records.
 */
export class InlineReader {
  constructor(private readonly deps: InlineReaderDeps) {}

  async read(parent: RegisteredResource, entity: object, ctx: AdminContext): Promise<Record<string, InlineRows>> {
    const perms = this.deps.policy.permissionsOf(ctx);
    const out: Record<string, InlineRows> = {};
    for (const inline of parent.inlines) {
      if (perms.canOn(inline.name, 'view')) out[inline.name] = await this.rows(inline, entity, ctx);
    }
    return out;
  }

  /**
   * One page of `max` rows, uncounted (the default `findMany` reads `max + 1` rows to know whether more exist), so the
   * common case costs one query for the rows plus the serializer's batched lookups, whatever the number of rows. Only
   * a truncated inline is counted, with a second `findMany`. A child that overrides `findMany` runs its own queries.
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
    const truncated = found.hasMore === true || found.items.length > inline.max || (found.total ?? 0) > inline.max;
    let items = found.items.slice(0, inline.max);
    // A findMany override may ignore the scopes; rows outside them never leave (as on the child's list).
    if (child.resource.findMany !== AdminResourceBase.prototype.findMany && policy.scoped(child, 'view', ctx)) {
      const keys = child.schema.primaryKeys;
      const idOf = (item: object) => (keys.length === 1 ? (item as Record<string, unknown>)[keys[0]!] : Object.fromEntries(keys.map((key) => [key, (item as Record<string, unknown>)[key]]))) as RecordId;
      const allowed = await policy.allowedIds(child, items.map(idOf), 'view', ctx);
      items = items.filter((item) => allowed.has(recordIdOf(item, keys)));
    }
    // Every row the user may see is here unless truncated; else the child's own count (an override's count is its
    // own business, as its list's total is).
    const total = !truncated ? items.length : (found.total ?? (await child.resource.findMany({ ...params, pageSize: 1, count: 'exact' }, ctx)).total ?? items.length);
    return { rows: await this.deps.serialize(child, items, ctx), total, truncated };
  }
}
