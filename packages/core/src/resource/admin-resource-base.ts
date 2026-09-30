import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import { applyListParams } from '../crud/list-query-builder.js';
import type { FilterOperator, SortDirection } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { DtoClass } from '../schema/dto-fields.js';
import { getHooks, type HookKind } from '../decorators/hooks.js';
import type { AdminContext } from './admin-context.js';

export type RecordId = string | number;

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
}

export interface FindManyResult<T> {
  items: T[];
  total: number;
}

type EntityKey<T> = Extract<keyof T, string>;

export interface ListConfig<T> {
  columns?: EntityKey<T>[];
  /** `'name'` for ascending, `'-createdAt'` for descending. Defaults to `-<primary key>`. */
  sort?: EntityKey<T> | `-${EntityKey<T>}`;
  pageSize?: number;
  /** Filterable fields. Default: every enum and boolean column. */
  filters?: EntityKey<T>[];
  /** Fields matched by `?search=`. Default: every string column. */
  search?: EntityKey<T>[];
}

export interface FormConfig {
  create?: DtoClass;
  /** Defaults to `create`, validated as a partial update. */
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

  protected get primaryKey(): string {
    return this.repository.metadata.primaryColumns[0]!.propertyName;
  }

  /**
   * The list query with filters, search, sort and paging applied. Override findMany and extend this to add
   * joins or restrictions: `this.buildListQuery(params).andWhere('entity.ownerId = :id', { id })`.
   */
  protected buildListQuery(params: ListParams, alias = 'entity'): SelectQueryBuilder<T> {
    return applyListParams(this.repository.createQueryBuilder(alias), params, this.primaryKey);
  }

  async findMany(params: ListParams, _ctx: AdminContext): Promise<FindManyResult<T>> {
    const [items, total] = await this.buildListQuery(params).getManyAndCount();
    return { items, total };
  }

  async findOne(id: RecordId, _ctx: AdminContext): Promise<T | null> {
    return this.repository.findOne({ where: { [this.primaryKey]: id } as FindOptionsWhere<T> });
  }

  async create(dto: object, ctx: AdminContext): Promise<T> {
    await this.runHooks('beforeSave', dto, ctx, 'create');
    const saved = await this.repository.save(this.repository.create({ ...dto } as DeepPartial<T>));
    await this.runHooks('afterSave', saved, ctx, 'create');
    return saved;
  }

  async update(id: RecordId, dto: object, ctx: AdminContext): Promise<T> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    await this.runHooks('beforeSave', dto, ctx, 'update');
    this.repository.merge(existing, { ...dto } as DeepPartial<T>);
    const saved = await this.repository.save(existing);
    await this.runHooks('afterSave', saved, ctx, 'update');
    return saved;
  }

  async delete(id: RecordId, ctx: AdminContext): Promise<void> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    await this.runHooks('beforeDelete', existing, ctx);
    await this.repository.remove(existing);
  }

  /** Runs @BeforeSave/@AfterSave/@BeforeDelete methods in declaration order (parent class first). */
  protected async runHooks(kind: HookKind, ...args: unknown[]): Promise<void> {
    const methods = this as unknown as Record<string | symbol, (...hookArgs: unknown[]) => unknown>;
    for (const key of getHooks(this.constructor, kind)) await methods[key]!.apply(this, args);
  }
}
