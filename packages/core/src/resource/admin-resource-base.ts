import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { applyListParams } from '../crud/list-query-builder.js';
import { toRelationReferences } from '../crud/relation-writes.js';
import type { FilterOperator, SortDirection } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { DtoClass } from '../schema/dto-fields.js';
import type { FieldPath } from '../schema/field-paths.js';
import { getHooks, type HookKind } from '../decorators/hooks.js';
import type { AdminContext } from './admin-context.js';

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
  /** Soft-deletable resources: `only` lists the trash, `with` lists everything. */
  trashed?: 'only' | 'with';
}

export interface FindManyResult<T> {
  items: T[];
  total: number;
}

/**
 * Fields and paths such as `'customer.name'` go through many-to-one and owning one-to-one relations (joined
 * automatically). A relation field is named like the property that holds its id (`customer`, or `customerId`
 * when the entity declares that column), a path by the relation property (`customer.name`).
 */
export interface ListConfig<T> {
  /** Default: every column except json and text, and every to-one relation. */
  columns?: FieldPath<T>[];
  /** `'name'` for ascending, `'-createdAt'` for descending. Defaults to `-<primary key>`. */
  sort?: FieldPath<T> | `-${FieldPath<T>}`;
  pageSize?: number;
  /** Filterable fields. Default: every enum and boolean column. */
  filters?: FieldPath<T>[];
  /** Fields matched by `?search=`. Default: every string column. */
  search?: FieldPath<T>[];
}

export interface FormConfig {
  create?: DtoClass;
  /** Defaults to `create`. Update bodies are always validated as partial: only the fields sent are checked. */
  update?: DtoClass;
}

/**
 * Base class for admin resources. Override `create`/`update` (and the finders) to route
 * admin operations through your own services, so business rules are never bypassed.
 */
export abstract class AdminResourceBase<T extends ObjectLiteral = ObjectLiteral> {
  list?: ListConfig<T>;
  form?: FormConfig;

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
   * The list query with filters, search, sort and paging applied. Override findMany and extend this to add
   * joins or restrictions: `this.buildListQuery(params).andWhere('entity.ownerId = :id', { id })`.
   * A restriction added here applies to the list only: apply the same restriction in `findOne`, which
   * GET, PATCH and DELETE by id use. A restricted `findOne` override should read through
   * `this.repositoryFor(ctx)` so it reads inside the transaction. Pass `ctx` here too when you build the query in
   * a write path: `this.buildListQuery(params, ctx)`.
   */
  protected buildListQuery(params: ListParams, ctx?: AdminContext, alias = 'entity'): SelectQueryBuilder<T> {
    const repository = ctx ? this.repositoryFor(ctx) : this.repository;
    return applyListParams(repository.createQueryBuilder(alias), params, repository.metadata);
  }

  /**
   * Overrides must honour `params.filters` and `params.search` (easiest: start from `this.buildListQuery(params)`),
   * otherwise the UI shows filters and search that do nothing.
   */
  async findMany(params: ListParams, ctx: AdminContext): Promise<FindManyResult<T>> {
    const [items, total] = await this.buildListQuery(params, ctx).getManyAndCount();
    return { items, total };
  }

  /** `options.withDeleted` also finds records in the trash (restore and purge use it). */
  async findOne(id: RecordId, ctx: AdminContext, options: { withDeleted?: boolean } = {}): Promise<T | null> {
    const where = typeof id === 'object' ? id : { [this.primaryKeys[0]!]: id };
    return this.repositoryFor(ctx).findOne({ where: where as FindOptionsWhere<T>, ...(options.withDeleted ? { withDeleted: true } : {}) });
  }

  /**
   * Restricts the records a relation field may point to: the picker's options and the ids accepted on create and
   * update (a restricted id is a 422 on the field). `qb` selects the target entity as `option`. Default: all records.
   */
  relationOptions(_field: string, qb: SelectQueryBuilder<any>, _ctx: AdminContext): SelectQueryBuilder<any> {
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
    repo.merge(existing, toRelationReferences(dto, repo.metadata) as DeepPartial<T>);
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
