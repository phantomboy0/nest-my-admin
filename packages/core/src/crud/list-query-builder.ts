import type { EntityMetadata, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { FilterCondition, ListParams } from '../resource/admin-resource-base.js';
import { isToOne, resolvePath, type RelationLike } from '../schema/relation-fields.js';
import { applyKeyset } from './cursor.js';
import { persianLike } from '../i18n/persian.js';

type ManyToMany = RelationLike & { junctionEntityMetadata?: EntityMetadata };

/** Where a list field lives in the query: a column expression, or a many-to-many relation (filtered with EXISTS). */
type Target = { column: string; joinAlias?: string } | { manyToMany: ManyToMany };

/**
 * Left-joins the to-one relations of a path (unless the query already has a join with that alias) and returns the
 * alias of the last one. Aliases are `<alias>_<relation>` per segment: `entity_customer`, `entity_customer_company`.
 */
export function ensureJoins(qb: SelectQueryBuilder<any>, relations: RelationLike[]): string {
  let alias = qb.alias;
  for (const relation of relations) {
    const next = `${alias}_${relation.propertyName}`;
    if (!qb.expressionMap.aliases.some((existing) => existing.name === next)) qb.leftJoin(`${alias}.${relation.propertyName}`, next);
    alias = next;
  }
  return alias;
}

function targetOf(qb: SelectQueryBuilder<any>, metadata: EntityMetadata, name: string): Target {
  if (name.includes('.')) {
    const resolved = resolvePath(metadata, name);
    if ('error' in resolved) throw new Error(`nest-my-admin: cannot resolve list path "${name}": ${resolved.error}`);
    const joinAlias = ensureJoins(qb, resolved.relations);
    const column = `${joinAlias}.${resolved.column.propertyPath ?? resolved.column.propertyName}`;
    return resolved.relations.length > 0 ? { column, joinAlias } : { column };
  }
  const relation = (metadata.relations as ManyToMany[]).find((candidate) => candidate.propertyName === name && !isToOne(candidate));
  if (relation?.relationType === 'many-to-many') return { manyToMany: relation };
  // Columns and to-one relations alike: TypeORM turns `entity.customer` into the join column.
  return { column: `${qb.alias}.${name}` };
}

/** `EXISTS (SELECT 1 FROM <join table> WHERE <owner> = entity.<pk> AND <inverse> IN (…))`: no duplicate rows, exact totals. */
function applyManyToMany(qb: SelectQueryBuilder<any>, relation: ManyToMany, filter: FilterCondition, name: string): void {
  const junction = relation.junctionEntityMetadata!;
  const owner = junction.ownerColumns[0]!;
  const inverse = junction.inverseColumns[0]!;
  const table = junction.tablePath.split('.').map((part) => qb.escape(part)).join('.');
  const j = qb.escape(`nma_${name}`);
  qb.andWhere(
    `EXISTS (SELECT 1 FROM ${table} ${j} WHERE ${j}.${qb.escape(owner.databaseName)} = ${qb.alias}.${owner.referencedColumn!.propertyName}` +
      ` AND ${j}.${qb.escape(inverse.databaseName)} IN (:...${name}))`,
    { [name]: filter.value },
  );
}

const COMPARISONS = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

/** LIKE pattern with `!`, `%` and `_` escaped by `!` (valid unquoted on SQLite, Postgres and MySQL). Case is folded by the database (LOWER on both sides), so non-ASCII text matches too. */
export function likePattern(text: string, position: 'anywhere' | 'start'): string {
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
    case 'startsWith': {
      const like = persianLike(column, String(value), name, (text) => likePattern(text, operator === 'contains' ? 'anywhere' : 'start'));
      qb.andWhere(like.sql, like.params);
      return;
    }
    case 'isNull':
      qb.andWhere(`${column} IS ${value ? '' : 'NOT '}NULL`);
      return;
  }
}

/**
 * Applies filters, search, sort (with the primary key as tie-breaker, so pages never overlap) and paging.
 * Field names come from the resource schema's allow-lists (parseListQuery); values are always bound parameters.
 */
export function applyListParams<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, params: ListParams, metadata: EntityMetadata): SelectQueryBuilder<T> {
  const alias = qb.alias;
  const deleted = metadata.deleteDateColumn;
  if (params.trashed && deleted) {
    qb.withDeleted();
    if (params.trashed === 'only') qb.andWhere(`${alias}.${deleted.propertyName} IS NOT NULL`);
  }
  params.filters.forEach((filter, index) => {
    const target = targetOf(qb, metadata, filter.field);
    if ('manyToMany' in target) applyManyToMany(qb, target.manyToMany, filter, `nmaFilter${index}`);
    else applyFilter(qb, target.column, filter, `nmaFilter${index}`);
  });
  if (params.search) {
    const term = params.search.term;
    const clauses = params.search.fields.map((field) => persianLike((targetOf(qb, metadata, field) as { column: string }).column, term, 'nmaSearch', (text) => likePattern(text, 'anywhere')));
    // Every clause binds the same parameters (same term), so one set serves them all.
    qb.andWhere(`(${clauses.map((clause) => clause.sql).join(' OR ')})`, clauses[0]?.params ?? {});
  }
  const sort = targetOf(qb, metadata, params.sort.field) as { column: string; joinAlias?: string };
  // With joins, skip/take paginates with a DISTINCT query that can only order by selected columns.
  if (sort.joinAlias && !qb.expressionMap.selects.some(({ selection }) => selection === sort.column || selection === sort.joinAlias)) {
    qb.addSelect(sort.column);
  }
  qb.orderBy(sort.column, params.sort.direction === 'asc' ? 'ASC' : 'DESC');
  const keys = metadata.primaryColumns.map((column) => column.propertyName).filter((key) => key !== params.sort.field);
  for (const key of keys) qb.addOrderBy(`${alias}.${key}`, 'ASC');
  if (params.pagination === 'keyset') {
    if (params.after) applyKeyset(qb, [sort.column, ...keys.map((key) => `${alias}.${key}`)], params.sort.direction, params.after);
    return qb.take(params.pageSize);
  }
  return qb.skip((params.page - 1) * params.pageSize).take(params.pageSize);
}
