import type { DeepPartial, FindOptionsOrder, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import type { FilterOperator, SortDirection } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { DtoClass } from '../schema/dto-fields.js';
import type { AdminContext } from './admin-context.js';

export type RecordId = string | number;

export type FilterValue = string | number | boolean | Date | Array<string | number>;

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

  async findMany(params: ListParams, _ctx: AdminContext): Promise<FindManyResult<T>> {
    const [items, total] = await this.repository.findAndCount({
      order: { [params.sort.field]: params.sort.direction.toUpperCase() } as FindOptionsOrder<T>,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    });
    return { items, total };
  }

  async findOne(id: RecordId, _ctx: AdminContext): Promise<T | null> {
    return this.repository.findOne({ where: { [this.primaryKey]: id } as FindOptionsWhere<T> });
  }

  async create(dto: object, _ctx: AdminContext): Promise<T> {
    return this.repository.save(this.repository.create({ ...dto } as DeepPartial<T>));
  }

  async update(id: RecordId, dto: object, ctx: AdminContext): Promise<T> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    this.repository.merge(existing, { ...dto } as DeepPartial<T>);
    return this.repository.save(existing);
  }
}
