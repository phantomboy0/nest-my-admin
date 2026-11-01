import type { ObjectLiteral } from 'typeorm';
import { AdminForbiddenError } from '../errors.js';
import type { AdminContext } from './admin-context.js';
import { AdminResourceBase, type FilterCondition, type FilterValue, type FindManyResult, type ListParams, type RecordId } from './admin-resource-base.js';

/**
 * The base of an `@AdminSource` resource: rows that are not database rows (an HTTP API, files, live state). Answer
 * `findMany` (the list: `inMemoryList` does search, filters, sort and paging for rows fetched whole) and `findOne` (one
 * row by id, `null` when there is none). Override `create`, `update` and `delete` to allow them: a source that does not
 * is not offered New, Save or Delete, and the API refuses them (403).
 *
 * There is no DataSource: `ctx.manager` is never set, writes are not wrapped in a transaction, and the TypeORM helpers
 * of AdminResourceBase (`query`, `buildListQuery`, `repository`, `restore`, `purge`) are not used.
 */
export abstract class AdminSourceBase<T extends ObjectLiteral = ObjectLiteral, Id extends RecordId = RecordId> extends AdminResourceBase<T, Id> {
  /** Types only: tells a source class from a table resource, so `@AdminSource` refuses a class that is not one. */
  declare private readonly sourceResource: true;

  abstract override findMany(params: ListParams, ctx: AdminContext): Promise<FindManyResult<T>>;

  abstract override findOne(id: Id, ctx: AdminContext, options?: { withDeleted?: boolean }): Promise<T | null>;

  override async create(_dto: object, _ctx: AdminContext): Promise<T> {
    throw new AdminForbiddenError(`${this.constructor.name} does not create rows`);
  }

  override async update(_id: Id, _dto: object, _ctx: AdminContext): Promise<T> {
    throw new AdminForbiddenError(`${this.constructor.name} does not change rows`);
  }

  override async delete(_id: Id, _ctx: AdminContext): Promise<void> {
    throw new AdminForbiddenError(`${this.constructor.name} does not delete rows`);
  }

  override async restore(_id: Id, _ctx: AdminContext): Promise<T> {
    throw new AdminForbiddenError(`${this.constructor.name} has no trash`);
  }

  override async purge(_id: Id, _ctx: AdminContext): Promise<void> {
    throw new AdminForbiddenError(`${this.constructor.name} has no trash`);
  }

  /** @internal Which writes the class allows: those it overrides. */
  static writesOf(resource: AdminSourceBase<any, any>): { create: boolean; update: boolean; delete: boolean } {
    const proto = AdminSourceBase.prototype;
    return { create: resource.create !== proto.create, update: resource.update !== proto.update, delete: resource.delete !== proto.delete };
  }
}

const comparable = (value: unknown): unknown => (value instanceof Date ? value.getTime() : value);

function compare(a: unknown, b: unknown): number {
  const x = comparable(a);
  const y = comparable(b);
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  if (typeof x === 'number' && typeof y === 'number') return x - y;
  if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y);
  return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
}

/** A filter value next to a row value: dates and numbers compare as such, the rest as text. */
function same(row: unknown, value: unknown): boolean {
  if (row instanceof Date || value instanceof Date) return comparable(row) === comparable(value instanceof Date ? value : new Date(String(value)));
  if (typeof row === 'number') return row === Number(value);
  if (typeof row === 'boolean') return row === (value === true || value === 'true');
  return String(row ?? '') === String(value);
}

function matches(row: ObjectLiteral, condition: FilterCondition): boolean {
  const actual: unknown = row[condition.field];
  const value: FilterValue = condition.value;
  const list = Array.isArray(value) ? value : [value];
  const text = (v: unknown) => String(v ?? '').toLocaleLowerCase();
  switch (condition.operator) {
    case 'eq':
      return same(actual, value);
    case 'ne':
      return !same(actual, value);
    case 'in':
      return list.some((item) => same(actual, item));
    case 'nin':
      return !list.some((item) => same(actual, item));
    case 'lt':
      return actual !== null && actual !== undefined && compare(actual, value) < 0;
    case 'lte':
      return actual !== null && actual !== undefined && compare(actual, value) <= 0;
    case 'gt':
      return actual !== null && actual !== undefined && compare(actual, value) > 0;
    case 'gte':
      return actual !== null && actual !== undefined && compare(actual, value) >= 0;
    case 'between':
      return actual !== null && actual !== undefined && compare(actual, list[0]) >= 0 && compare(actual, list[1]) <= 0;
    case 'contains':
      return text(actual).includes(text(value));
    case 'startsWith':
      return text(actual).startsWith(text(value));
    case 'isNull':
      return (value === true || value === 'true') === (actual === null || actual === undefined);
    default:
      return false;
  }
}

/**
 * A page of `rows` as the list asked for it: `params.search` (case-insensitive, any of its fields), `params.filters`,
 * `params.sort` (stable) and `params.page`/`pageSize`. For sources that fetch every row at once (an API answering a
 * few hundred records, a folder of files): return it from `findMany`.
 */
export function inMemoryList<T extends ObjectLiteral>(rows: readonly T[], params: ListParams): FindManyResult<T> {
  let found = [...rows];
  if (params.search && params.search.term.trim() !== '') {
    const term = params.search.term.trim().toLocaleLowerCase();
    found = found.filter((row) => params.search!.fields.some((field) => String(row[field] ?? '').toLocaleLowerCase().includes(term)));
  }
  for (const condition of params.filters) found = found.filter((row) => matches(row, condition));
  const { field, direction } = params.sort;
  if (field) {
    const sign = direction === 'desc' ? -1 : 1;
    found = found.map((row, index) => ({ row, index })).sort((a, b) => sign * compare(a.row[field], b.row[field]) || a.index - b.index).map(({ row }) => row);
  }
  const start = (Math.max(1, params.page) - 1) * params.pageSize;
  return { items: found.slice(start, start + params.pageSize), total: found.length };
}
