import type { EntityMetadata, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { ComputedValue, FieldSchema } from '../contract.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { ComputedColumn, ComputedSource } from '../resource/admin-resource-base.js';
import { resolvePath } from '../schema/relation-fields.js';
import { recordIdOf } from './record-id.js';
import { serializeValue } from './serialize.js';

type RelationMeta = EntityMetadata['relations'][number];

/** A source once checked against the entity: what to read and how. */
export type CompiledSource =
  | { type: 'field'; path: string }
  | { type: 'aggregate'; fn: 'min' | 'max' | 'sum' | 'count'; relation: RelationMeta; field?: string }
  | { type: 'first'; relation: RelationMeta; field: string; by: string }
  | { type: 'toggle'; field: string; on: string; off: string }
  | { type: 'compute'; fn: (rows: any[], ctx: AdminContext) => Promise<Record<string, unknown>>; fields: string[] };

export interface CompiledComputed {
  key: string;
  column: ComputedColumn;
  source: CompiledSource;
  subline?: CompiledSource;
  previous?: CompiledSource;
  /** What it reads, for the policy: own fields and paths, and the child entities (and their fields) it aggregates. */
  deps: { own: string[]; children: Array<{ entity: Function; fields: string[] }> };
}

const KINDS = ['image', 'title', 'money', 'badge', 'count', 'toggle'] as const;
const AGGREGATES = ['min', 'max', 'sum', 'count'] as const;

/**
 * Checks `list.computed` at boot (spec §5.4) and compiles each column: sources exist, relations are one-to-many of a
 * single-key entity, `sortable` only on aggregates and first rows, a toggle's values are its enum's, `map` only on badges.
 */
export function checkComputed(
  computed: Record<string, ComputedColumn> | undefined,
  metadata: EntityMetadata,
  enumValues: (field: string) => string[] | undefined,
  fail: (message: string) => never,
): Map<string, CompiledComputed> {
  const out = new Map<string, CompiledComputed>();
  for (const [key, column] of Object.entries(computed ?? {})) {
    const where = `list.computed.${key}`;
    if (!KINDS.includes(column.kind)) fail(`${where}: unknown kind "${String(column.kind)}" (use ${KINDS.join(', ')})`);
    const deps: CompiledComputed['deps'] = { own: [], children: [] };
    const compile = (source: ComputedSource, part: string): CompiledSource => compileSource(source, `${where}.${part}`, metadata, enumValues, deps, fail);
    const source = compile(column.source, 'source');
    if (column.sortable && source.type !== 'aggregate' && source.type !== 'first') fail(`${where}: only aggregate and first sources can be sortable`);
    if (column.map !== undefined && (column.kind !== 'badge' || typeof column.map !== 'function')) fail(`${where}: \`map\` is a function, for badges only`);
    if ((column.kind === 'toggle') !== (source.type === 'toggle')) fail(`${where}: a toggle column needs a { toggle, on, off } source, and only it`);
    if (column.subline !== undefined && column.kind !== 'title') fail(`${where}: \`subline\` goes with the title kind`);
    if (column.previous !== undefined && column.kind !== 'money') fail(`${where}: \`previous\` goes with the money kind`);
    out.set(key, {
      key,
      column,
      source,
      ...(column.subline !== undefined ? { subline: compile(column.subline, 'subline') } : {}),
      ...(column.previous !== undefined ? { previous: compile(column.previous, 'previous') } : {}),
      deps,
    });
  }
  return out;
}

function compileSource(
  source: ComputedSource,
  where: string,
  metadata: EntityMetadata,
  enumValues: (field: string) => string[] | undefined,
  deps: CompiledComputed['deps'],
  fail: (message: string) => never,
): CompiledSource {
  const ownField = (name: string, what: string) => {
    if (!metadata.findColumnsWithPropertyPath(name).length && !metadata.relations.some((relation) => relation.propertyName === name)) fail(`${where}: unknown ${what} "${name}" on ${metadata.name}`);
    deps.own.push(name);
  };
  const toMany = (name: string): RelationMeta => {
    if (metadata.primaryColumns.length !== 1) fail(`${where}: relation sources need an entity with one primary key column`);
    const relation = metadata.relations.find((candidate) => candidate.propertyName === name);
    if (!relation) fail(`${where}: unknown relation "${name}" on ${metadata.name}`);
    if (relation!.relationType !== 'one-to-many' || !relation!.inverseRelation) fail(`${where}: "${name}" is not a one-to-many relation`);
    return relation!;
  };
  const childField = (relation: RelationMeta, name: string) => {
    const child = relation.inverseEntityMetadata;
    if (!child.findColumnsWithPropertyPath(name).length) fail(`${where}: unknown field "${name}" on ${child.name}`);
    const entry = deps.children.find((candidate) => candidate.entity === child.target);
    if (entry) entry.fields.push(name);
    else deps.children.push({ entity: child.target as Function, fields: [name] });
  };

  if (typeof source === 'string') {
    if (source.includes('.')) {
      const resolved = resolvePath(metadata, source);
      if ('error' in resolved) fail(`${where}: cannot use "${source}": ${resolved.error}`);
      deps.own.push(source);
    } else ownField(source, 'field');
    return { type: 'field', path: source };
  }
  if ('aggregate' in source) {
    if (!AGGREGATES.includes(source.aggregate)) fail(`${where}: unknown aggregate "${String(source.aggregate)}"`);
    const relation = toMany(source.relation);
    if (source.aggregate !== 'count' && !source.field) fail(`${where}: ${source.aggregate} needs a field`);
    if (source.field) childField(relation, source.field);
    else if (!deps.children.some((entry) => entry.entity === relation.inverseEntityMetadata.target)) deps.children.push({ entity: relation.inverseEntityMetadata.target as Function, fields: [] });
    return { type: 'aggregate', fn: source.aggregate, relation, ...(source.field ? { field: source.field } : {}) };
  }
  if ('first' in source) {
    const relation = toMany(source.first);
    childField(relation, source.field);
    childField(relation, source.by);
    return { type: 'first', relation, field: source.field, by: source.by };
  }
  if ('toggle' in source) {
    ownField(source.toggle, 'field');
    const values = enumValues(source.toggle);
    if (!values) fail(`${where}: "${source.toggle}" is not an enum field`);
    for (const value of [source.on, source.off]) if (!values!.includes(value)) fail(`${where}: "${value}" is not one of ${values!.join(', ')}`);
    return { type: 'toggle', field: source.toggle, on: source.on, off: source.off };
  }
  if ('compute' in source) {
    if (typeof source.compute !== 'function') fail(`${where}: compute must be a function`);
    if (!Array.isArray(source.fields)) fail(`${where}: compute needs \`fields\`, the fields it reads (a viewer who cannot see one does not get the column)`);
    for (const field of source.fields) ownField(field, 'field');
    return { type: 'compute', fn: source.compute, fields: source.fields };
  }
  return fail(`${where}: unknown source`);
}

/** A query of a child entity as the viewer may read it (the child resource's `query()` and scopes), or a plain one. */
export type ChildQuery = (entity: Function, alias: string, ctx: AdminContext | undefined) => SelectQueryBuilder<ObjectLiteral>;

/**
 * The page's computed values, by record id: one query per relation or path source and one `compute` call, whatever the
 * page size (no N+1). Badge labels are localized with `text`.
 */
export async function loadComputed(
  columns: CompiledComputed[],
  rows: ObjectLiteral[],
  metadata: EntityMetadata,
  ctx: AdminContext,
  childQuery: ChildQuery,
  pathQuery: (alias: string) => SelectQueryBuilder<ObjectLiteral>,
  text: (label: LocalizedText) => string,
  /** A field's schema (to serialize decimals as strings, dates as ISO…): the entity's resource field, if any. */
  fieldFor: (entity: Function, name: string) => FieldSchema | undefined,
): Promise<Map<string, Record<string, ComputedValue>>> {
  const keys = metadata.primaryColumns.map((column) => column.propertyName);
  const out = new Map<string, Record<string, ComputedValue>>(rows.map((row) => [recordIdOf(row, keys), {}]));
  if (rows.length === 0 || columns.length === 0) return out;
  const pk = keys[0]!;
  const ids = rows.map((row) => row[pk]);
  const cache = new Map<string, Promise<Map<string, unknown>>>();

  const resolve = (source: CompiledSource): Promise<Map<string, unknown>> => {
    const id = sourceId(source);
    let found = cache.get(id);
    if (!found) cache.set(id, (found = read(source)));
    return found;
  };
  const read = async (source: CompiledSource): Promise<Map<string, unknown>> => {
    const raw = await readRaw(source);
    const field =
      source.type === 'field'
        ? fieldFor(metadata.target as Function, source.path)
        : source.type === 'first' || (source.type === 'aggregate' && source.fn !== 'count' && source.field)
          ? fieldFor(source.relation.inverseEntityMetadata.target as Function, source.field!)
          : undefined;
    if (!field) return raw;
    // Drivers answer SUM/MIN/MAX of an integer as text (Postgres bigint): a number field stays a number.
    const typed = (value: unknown) => (field.type === 'number' && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value);
    return new Map([...raw].map(([id, value]) => [id, serializeValue(typed(value), field)]));
  };
  const readRaw = async (source: CompiledSource): Promise<Map<string, unknown>> => {
    const byRow = new Map<string, unknown>();
    switch (source.type) {
      case 'field': {
        if (!source.path.includes('.')) {
          for (const row of rows) byRow.set(recordIdOf(row, keys), row[source.path] ?? null);
          return byRow;
        }
        const qb = pathQuery('nma_p');
        const segments = source.path.split('.');
        let alias = 'nma_p';
        segments.slice(0, -1).forEach((segment, index) => {
          qb.leftJoin(`${alias}.${segment}`, `nma_j${index}`);
          alias = `nma_j${index}`;
        });
        const raw = await qb.select(`nma_p.${pk}`, 'k').addSelect(`${alias}.${segments.at(-1)}`, 'v').where(`nma_p.${pk} IN (:...nmaIds)`, { nmaIds: ids }).getRawMany<{ k: unknown; v: unknown }>();
        for (const { k, v } of raw) byRow.set(String(k), v ?? null);
        return byRow;
      }
      case 'aggregate': {
        const child = source.relation.inverseEntityMetadata;
        const fk = `nma_c.${source.relation.inverseRelation!.propertyName}`;
        const target = source.field ? `nma_c.${source.field}` : `nma_c.${child.primaryColumns[0]!.propertyName}`;
        const raw = await childQuery(child.target as Function, 'nma_c', ctx)
          .select(fk, 'k')
          .addSelect(`${source.fn.toUpperCase()}(${target})`, 'v')
          .andWhere(`${fk} IN (:...nmaIds)`, { nmaIds: ids })
          .groupBy(fk)
          .getRawMany<{ k: unknown; v: unknown }>();
        for (const { k, v } of raw) byRow.set(String(k), source.fn === 'count' ? Number(v) : v);
        if (source.fn === 'count') for (const row of rows) if (!byRow.has(recordIdOf(row, keys))) byRow.set(recordIdOf(row, keys), 0);
        return byRow;
      }
      case 'first': {
        const child = source.relation.inverseEntityMetadata;
        const fk = `nma_c.${source.relation.inverseRelation!.propertyName}`;
        const raw = await childQuery(child.target as Function, 'nma_c', ctx)
          .select(fk, 'k')
          .addSelect(`nma_c.${source.field}`, 'v')
          .andWhere(`${fk} IN (:...nmaIds)`, { nmaIds: ids })
          .orderBy(`nma_c.${source.by}`, 'ASC')
          .addOrderBy(`nma_c.${child.primaryColumns[0]!.propertyName}`, 'ASC')
          .getRawMany<{ k: unknown; v: unknown }>();
        for (const { k, v } of raw) if (!byRow.has(String(k))) byRow.set(String(k), v ?? null);
        return byRow;
      }
      case 'toggle':
        for (const row of rows) byRow.set(recordIdOf(row, keys), row[source.field] === source.on);
        return byRow;
      case 'compute': {
        const values = await source.fn(rows, ctx);
        for (const row of rows) byRow.set(recordIdOf(row, keys), values[recordIdOf(row, keys)] ?? null);
        return byRow;
      }
    }
  };

  for (const compiled of columns) {
    const [main, subline, previous] = await Promise.all([resolve(compiled.source), compiled.subline && resolve(compiled.subline), compiled.previous && resolve(compiled.previous)]);
    for (const row of rows) {
      const id = recordIdOf(row, keys);
      const value = main.get(id) ?? null;
      const cell: ComputedValue = { value };
      if (subline) cell.subline = subline.get(id) ?? null;
      if (previous) cell.previous = previous.get(id) ?? null;
      if (compiled.column.map) {
        const mapped = compiled.column.map(value, row);
        cell.label = text(mapped.label);
        cell.tone = mapped.tone;
      }
      out.get(id)![compiled.key] = cell;
    }
  }
  return out;
}

const sourceId = (source: CompiledSource): string =>
  source.type === 'field'
    ? `f:${source.path}`
    : source.type === 'aggregate'
      ? `a:${source.fn}:${source.relation.propertyName}:${source.field ?? ''}`
      : source.type === 'first'
        ? `1:${source.relation.propertyName}:${source.field}:${source.by}`
        : source.type === 'toggle'
          ? `t:${source.field}`
          : `c:${Math.random()}`; // each compute function runs once anyway

/**
 * Sorting by an aggregate or first-row column: a correlated subquery over the rows the viewer may read, selected as
 * `nma_sort` so paging with joins can order by it. Returns the expression to order by.
 */
export function addComputedSort(qb: SelectQueryBuilder<ObjectLiteral>, compiled: CompiledComputed, metadata: EntityMetadata, ctx: AdminContext | undefined, childQuery: ChildQuery): string {
  const source = compiled.source;
  if (source.type !== 'aggregate' && source.type !== 'first') throw new Error(`nest-my-admin: ${compiled.key} is not sortable`);
  const child = source.relation.inverseEntityMetadata;
  const childPk = child.primaryColumns[0]!.propertyName;
  const sub = childQuery(child.target as Function, 'nma_s', ctx).andWhere(`nma_s.${source.relation.inverseRelation!.propertyName} = ${qb.alias}.${metadata.primaryColumns[0]!.propertyName}`);
  // A sum over no rows is 0, not NULL: drivers place NULLs differently when sorting (first in Postgres descending).
  if (source.type === 'aggregate') sub.select(source.fn === 'sum' ? `COALESCE(SUM(nma_s.${source.field}), 0)` : `${source.fn.toUpperCase()}(nma_s.${source.field ?? childPk})`);
  else sub.select(`nma_s.${source.field}`).orderBy(`nma_s.${source.by}`, 'ASC').addOrderBy(`nma_s.${childPk}`, 'ASC').limit(1);
  qb.addSelect(`(${sub.getQuery()})`, 'nma_sort').setParameters({ ...qb.getParameters(), ...sub.getParameters() });
  return 'nma_sort';
}
