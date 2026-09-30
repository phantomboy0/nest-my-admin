import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/** Below this many estimated rows an exact count is cheap, so it is used instead. */
export const EXACT_COUNT_BELOW = 1000;

/** Rows the planner expects from a Postgres `EXPLAIN (FORMAT JSON)` result. */
export function postgresPlanRows(rows: Array<Record<string, unknown>>): number | undefined {
  let plan: unknown = rows[0]?.['QUERY PLAN'];
  if (typeof plan === 'string') plan = JSON.parse(plan);
  const top = (plan as Array<{ Plan?: { 'Plan Rows'?: unknown } }> | undefined)?.[0]?.Plan?.['Plan Rows'];
  return typeof top === 'number' ? top : undefined;
}

/**
 * Rows MySQL expects from an `EXPLAIN FORMAT=JSON` result: the `rows_produced_per_join` of the last table it joins
 * (nested loops multiply through, so the last one is the result).
 */
export function mysqlPlanRows(rows: Array<Record<string, unknown>>): number | undefined {
  const raw = rows[0]?.['EXPLAIN'];
  if (typeof raw !== 'string') return undefined;
  let last: number | undefined;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'rows_produced_per_join' && (typeof value === 'number' || typeof value === 'string')) last = Number(value);
        else visit(value);
      }
    }
  };
  visit((JSON.parse(raw) as { query_block?: unknown }).query_block);
  return last !== undefined && Number.isFinite(last) ? last : undefined;
}

/**
 * The number of rows a list query matches, from the query planner on Postgres and MySQL (no COUNT scan), or an exact
 * count on other drivers and whenever the estimate is small. `estimated` says which one it is.
 */
export async function countRows<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>): Promise<{ total: number; estimated: boolean }> {
  const type = qb.connection.options.type;
  if (type === 'postgres' || type === 'mysql' || type === 'mariadb') {
    const probe = qb.clone().skip(undefined).take(undefined).offset(undefined).limit(undefined).orderBy();
    const [sql, parameters] = probe.getQueryAndParameters();
    const runner = qb.connection.manager;
    const estimate =
      type === 'postgres'
        ? postgresPlanRows(await runner.query(`EXPLAIN (FORMAT JSON) ${sql}`, parameters))
        : mysqlPlanRows(await runner.query(`EXPLAIN FORMAT=JSON ${sql}`, parameters));
    if (estimate !== undefined && estimate >= EXACT_COUNT_BELOW) return { total: Math.round(estimate), estimated: true };
  }
  return { total: await qb.getCount(), estimated: false };
}
