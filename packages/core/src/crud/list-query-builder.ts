import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { FilterCondition, ListParams } from '../resource/admin-resource-base.js';

const COMPARISONS = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

/** LIKE pattern with `!`, `%` and `_` escaped by `!` (valid unquoted on SQLite, Postgres and MySQL). Case is folded by the database (LOWER on both sides), so non-ASCII text matches too. */
function likePattern(text: string, position: 'anywhere' | 'start'): string {
  const escaped = text.replace(/[!%_]/g, (char) => `!${char}`);
  return position === 'start' ? `${escaped}%` : `%${escaped}%`;
}

function applyFilter<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, column: string, filter: FilterCondition, name: string): void {
  const { operator, value } = filter;
  switch (operator) {
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      qb.andWhere(`${column} ${COMPARISONS[operator]} :${name}`, { [name]: value });
      return;
    case 'in':
      qb.andWhere(`${column} IN (:...${name})`, { [name]: value });
      return;
    case 'nin':
      qb.andWhere(`${column} NOT IN (:...${name})`, { [name]: value });
      return;
    case 'between': {
      const [from, to] = value as Array<string | number | Date>;
      qb.andWhere(`${column} BETWEEN :${name}From AND :${name}To`, { [`${name}From`]: from, [`${name}To`]: to });
      return;
    }
    case 'contains':
      qb.andWhere(`LOWER(${column}) LIKE LOWER(:${name}) ESCAPE '!'`, { [name]: likePattern(String(value), 'anywhere') });
      return;
    case 'startsWith':
      qb.andWhere(`LOWER(${column}) LIKE LOWER(:${name}) ESCAPE '!'`, { [name]: likePattern(String(value), 'start') });
      return;
    case 'isNull':
      qb.andWhere(`${column} IS ${value ? '' : 'NOT '}NULL`);
      return;
  }
}

/**
 * Applies filters, search, sort (with the primary key as tie-breaker, so pages never overlap) and paging.
 * Field names come from the resource schema's allow-lists (parseListQuery); values are always bound parameters.
 */
export function applyListParams<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, params: ListParams, primaryKey: string): SelectQueryBuilder<T> {
  const alias = qb.alias;
  params.filters.forEach((filter, index) => applyFilter(qb, `${alias}.${filter.field}`, filter, `nmaFilter${index}`));
  if (params.search) {
    const clauses = params.search.fields.map((field) => `LOWER(${alias}.${field}) LIKE LOWER(:nmaSearch) ESCAPE '!'`);
    qb.andWhere(`(${clauses.join(' OR ')})`, { nmaSearch: likePattern(params.search.term, 'anywhere') });
  }
  qb.orderBy(`${alias}.${params.sort.field}`, params.sort.direction === 'asc' ? 'ASC' : 'DESC');
  if (params.sort.field !== primaryKey) qb.addOrderBy(`${alias}.${primaryKey}`, 'ASC');
  return qb.skip((params.page - 1) * params.pageSize).take(params.pageSize);
}
