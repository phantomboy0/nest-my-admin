import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { countRows } from '../crud/count.js';
import { encodeCursor } from '../crud/cursor.js';
import { applyListParams } from '../crud/list-query-builder.js';
import { toRelationReferences } from '../crud/relation-writes.js';
import type { FilterOperator, SortDirection } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { DtoClass } from '../schema/dto-fields.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { FieldsConfig, LayoutConfig } from '../schema/field-config.js';
import type { FieldPath } from '../schema/field-paths.js';
import { getHooks, type HookKind } from '../decorators/hooks.js';
import { AdminContext } from './admin-context.js';

/** A record's key: the value for single-key entities, `{ key: value, … }` for composite primary keys. */
export type RecordId = string | number | Record<string, string | number>;

export type FilterValue = string | number | boolean | Date | Array<string | number | Date>;

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: FilterValue;
}

export interface ListParams {
  page: number;
  pageSize: number;
  sort: { field: string; direction: SortDirection };
  filters: FilterCondition[];
  search?: { term: string; fields: string[] };
  /** How the list is counted (`list.count`). */
  count?: CountMode;
  /** Keyset lists (`list.pagination: 'keyset'`): the position to continue after (sort value, then key values). */
  after?: unknown[];
  /** `list.pagination`; `page` is always 1 for keyset lists. */
  pagination?: 'offset' | 'keyset';
  /** Soft-deletable resources: `only` lists the trash, `with` lists everything. */
  trashed?: 'only' | 'with';
}

export interface FindManyResult<T> {
  items: T[];
  /** `null` when the list is not counted (`count: 'none'`). */
  total: number | null;
  /** `total` is the query planner's estimate. */
  estimated?: boolean;
  /** Without a total: whether a next page exists. */
  hasMore?: boolean;
  /** Keyset lists: `after` for the next page, `null` on the last page. */
  nextCursor?: string | null;
}

/**
 * Fields and paths such as `'customer.name'` go through many-to-one and owning one-to-one relations (joined
 * automatically). A relation field is named like the property that holds its id (`customer`, or `customerId`
 * when the entity declares that column), a path by the relation property (`customer.name`).
 */
export type CountMode = 'exact' | 'estimate' | 'none';

export interface ListConfig<T> {
  /**
   * `exact` (default) counts matches; `estimate` uses the query planner's row estimate on Postgres and MySQL (exact
   * below 1000 rows and on other drivers); `none` does not count and only says whether there is a next page.
   */
  count?: CountMode;
  /**
   * `offset` (default) pages by number. `keyset` pages with a cursor (`?after=`), which stays fast deep into big
   * tables; it sorts only by non-nullable columns, and counts nothing unless `count` says so.
   */
  pagination?: 'offset' | 'keyset';
  /** Default: every column except json and text, and every to-one relation. */
  columns?: FieldPath<T>[];
  /** `'name'` for ascending, `'-createdAt'` for descending. Defaults to `-<primary key>`. */
  sort?: FieldPath<T> | `-${FieldPath<T>}`;
  pageSize?: number;
  /** Filterable fields. Default: every enum and boolean column. */
  filters?: FieldPath<T>[];
  /** Fields matched by `?search=`. Default: every string column. */
  search?: FieldPath<T>[];
  /**
   * Fields edited in place in the list (Django's `list_editable`). They must be in the update form and be text,
   * number, decimal, bigint, boolean, enum or date fields. Each save is a normal PATCH.
   */
  editable?: FieldPath<T>[];
  /**
   * Cards on phones (spec §9.3): the title (default: the record title), a subtitle, a badge and a line of meta fields.
   * Fields or paths, like `columns`; without it a card shows the title, then the columns.
   */
  mobile?: { title?: FieldPath<T>; subtitle?: FieldPath<T>; badge?: FieldPath<T>; meta?: FieldPath<T>[] };
}

export interface FormConfig {
  create?: DtoClass;
  /** Defaults to `create`. Update bodies are always validated as partial: only the fields sent are checked. */
  update?: DtoClass;
  /** Sections (with 1–3 columns), optionally grouped into tabs. Fields left out go into a last section. */
  layout?: LayoutConfig;
}

/** An external link shown in the record's header (Django's `view_on_site`): http(s) or a relative URL. */
export interface RecordLinkConfig {
  label: LocalizedText;
  href: string;
}

/**
 * Base class for admin resources. Override `create`/`update` (and the finders) to route
 * admin operations through your own services, so business rules are never bypassed.
 */
export abstract class AdminResourceBase<T extends ObjectLiteral = ObjectLiteral> {
  list?: ListConfig<T>;
  form?: FormConfig;
  /** Per-field labels, help, widgets, enum labels, `showIf`, `readonly`, `readonlyIf` (spec §5.2 `fields`). */
  fields?: FieldsConfig<T>;

  /** External links of a record, shown in its header. */
  links(_record: T): RecordLinkConfig[] {
    return [];
  }

  #repository?: Repository<T>;

  /** @internal Called once by the registry during bootstrap. */
  attachRepository(repository: Repository<T>): void {
    this.#repository = repository;
  }

  protected get repository(): Repository<T> {
    if (!this.#repository) {
      throw new Error(`${this.constructor.name} was used before nest-my-admin attached its repository`);
    }
    return this.#repository;
  }

  protected get primaryKeys(): string[] {
    return this.repository.metadata.primaryColumns.map((column) => column.propertyName);
  }

  /** The repository for this operation: the admin transaction's when one is running (ctx.manager), else the default. */
  protected repositoryFor(ctx: AdminContext): Repository<T> {
    return ctx.manager ? ctx.manager.getRepository<T>(this.repository.target) : this.repository;
  }

  /**
   * The list query: `query()` restrictions, then filters, search, sort and paging. Override findMany and extend this to
   * add joins or aggregates: `this.buildListQuery(params, ctx).leftJoinAndSelect('entity.owner', 'owner')`. Put row
   * restrictions in `query()` instead, so records by id and pickers get them too. Pass `ctx` in write paths so the
   * query runs inside the transaction.
   */
  protected buildListQuery(params: ListParams, ctx?: AdminContext, alias = 'entity'): SelectQueryBuilder<T> {
    const repository = ctx ? this.repositoryFor(ctx) : this.repository;
    const qb = this.query(repository.createQueryBuilder(alias), (ctx ?? AdminContext.current()) as AdminContext);
    return applyListParams(qb, params, repository.metadata);
  }

  /**
   * Restricts which records the admin sees, on every read path: the list (`buildListQuery`), `findOne` (so GET, PATCH,
   * DELETE, restore and purge by id), and pickers of relations that point at this resource, including the check of
   * ids sent to them. Add conditions with `qb.alias` (the alias differs per path): `qb.andWhere(\`${qb.alias}.ownerId
   * = :me\`, { me: ctx.user.id })`. Default: no restriction.
   */
  query(qb: SelectQueryBuilder<T>, _ctx: AdminContext): SelectQueryBuilder<T> {
    return qb;
  }

  /**
   * Overrides must honour `params.filters` and `params.search` (easiest: start from `this.buildListQuery(params)`),
   * otherwise the UI shows filters and search that do nothing.
   */
  async findMany(params: ListParams, ctx: AdminContext): Promise<FindManyResult<T>> {
    const qb = this.buildListQuery(params, ctx);
    if (params.pagination === 'keyset') {
      const rows = await qb.clone().take(params.pageSize + 1).getMany();
      const items = rows.slice(0, params.pageSize);
      const nextCursor = rows.length > params.pageSize ? encodeCursor(items[items.length - 1]!, params.sort.field, this.primaryKeys) : null;
      if (params.count === 'none') return { items, total: null, hasMore: nextCursor !== null, nextCursor };
      const counted = params.count === 'estimate' ? await countRows(qb) : { total: await qb.getCount(), estimated: false };
      return { items, total: counted.total, ...(counted.estimated ? { estimated: true } : {}), nextCursor };
    }
    if (params.count === 'none') {
      // One row more than a page says whether there is a next page, without counting.
      const rows = await qb.take(params.pageSize + 1).getMany();
      return { items: rows.slice(0, params.pageSize), total: null, hasMore: rows.length > params.pageSize };
    }
    if (params.count === 'estimate') {
      const [items, { total, estimated }] = await Promise.all([qb.getMany(), countRows(qb)]);
      return { items, total, ...(estimated ? { estimated } : {}) };
    }
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /** `options.withDeleted` also finds records in the trash (restore and purge use it). */
  async findOne(id: RecordId, ctx: AdminContext, options: { withDeleted?: boolean } = {}): Promise<T | null> {
    const where = typeof id === 'object' ? id : { [this.primaryKeys[0]!]: id };
    const qb = this.repositoryFor(ctx)
      .createQueryBuilder('entity')
      .setFindOptions({ where: where as FindOptionsWhere<T>, withDeleted: options.withDeleted === true, loadEagerRelations: true });
    return this.query(qb, ctx).getOne();
  }

  /**
   * Restricts the records a relation field may point to: the picker's options and the ids accepted on create and
   * update (a restricted id is a 422 on the field). `qb` selects the target entity as `option`; the target resource's
   * `query()` has already been applied. `values` are the record's values as the user sees them: the form's current
   * values in the picker, the body on create, the stored record with the body on top on update (relations as ids),
   * so one field's options can depend on another (`city` on `province`). Default: all records.
   */
  relationOptions(_field: string, qb: SelectQueryBuilder<any>, _ctx: AdminContext, _values: Record<string, unknown>): SelectQueryBuilder<any> {
    return qb;
  }

  /**
   * Overriding this skips the @BeforeSave/@AfterSave hooks; call `this.runHooks(...)` yourself to keep them.
   * Relation fields arrive as ids (`customer: 3`, `tags: ['a', 'b']`), already checked to exist; the default
   * turns them into references for TypeORM.
   */
  async create(dto: object, ctx: AdminContext): Promise<T> {
    const repo = this.repositoryFor(ctx);
    await this.runHooks('beforeSave', dto, ctx, 'create');
    const saved = await repo.save(repo.create(toRelationReferences(dto, repo.metadata) as DeepPartial<T>));
    await this.runHooks('afterSave', saved, ctx, 'create');
    return saved;
  }

  /** Overriding this skips the @BeforeSave/@AfterSave hooks; call `this.runHooks(...)` yourself to keep them. */
  async update(id: RecordId, dto: object, ctx: AdminContext): Promise<T> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    await this.runHooks('beforeSave', dto, ctx, 'update');
    const repo = this.repositoryFor(ctx);
    const changes = toRelationReferences(dto, repo.metadata) as Record<string, unknown>;
    repo.merge(existing, changes as DeepPartial<T>);
    // merge() leaves lazy relations alone; their setters take the reference directly.
    for (const relation of repo.metadata.relations) {
      if (relation.isLazy && Object.hasOwn(changes, relation.propertyName)) (existing as Record<string, unknown>)[relation.propertyName] = changes[relation.propertyName];
    }
    const saved = await repo.save(existing);
    await this.runHooks('afterSave', saved, ctx, 'update');
    return saved;
  }

  /**
   * Moves the record to the trash when the entity has a @DeleteDateColumn, else removes it.
   * Overriding this skips the @BeforeDelete hooks; call `this.runHooks(...)` yourself to keep them.
   */
  async delete(id: RecordId, ctx: AdminContext): Promise<void> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    const repo = this.repositoryFor(ctx);
    const soft = repo.metadata.deleteDateColumn !== undefined;
    await this.runHooks('beforeDelete', existing, ctx, soft ? 'soft' : 'hard');
    if (soft) await repo.softRemove(existing);
    else await repo.remove(existing);
  }

  /** Takes a record out of the trash (soft-deletable entities only). */
  async restore(id: RecordId, ctx: AdminContext): Promise<T> {
    const repo = this.repositoryFor(ctx);
    const column = repo.metadata.deleteDateColumn;
    const existing = await this.findOne(id, ctx, { withDeleted: true });
    if (!column || !existing || (existing as Record<string, unknown>)[column.propertyName] == null) throw new AdminNotFoundError();
    await repo.restore(repo.getId(existing));
    return (await this.findOne(id, ctx))!;
  }

  /** Removes a record for good, whether it is in the trash or not. Runs the @BeforeDelete hooks with `'hard'`. */
  async purge(id: RecordId, ctx: AdminContext): Promise<void> {
    const existing = await this.findOne(id, ctx, { withDeleted: true });
    if (!existing) throw new AdminNotFoundError();
    await this.runHooks('beforeDelete', existing, ctx, 'hard');
    await this.repositoryFor(ctx).remove(existing);
  }

  /** Runs @BeforeSave/@AfterSave/@BeforeDelete methods in declaration order (parent class first). */
  protected async runHooks(kind: HookKind, ...args: unknown[]): Promise<void> {
    const methods = this as unknown as Record<string | symbol, (...hookArgs: unknown[]) => unknown>;
    for (const key of getHooks(this.constructor, kind)) await methods[key]!.apply(this, args);
  }
}
