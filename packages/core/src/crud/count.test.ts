import { describe, expect, test } from 'bun:test';
import { mysqlPlanRows, postgresPlanRows } from './count.js';

describe('planner row estimates', () => {
  test('Postgres: the top plan node, whether the driver parsed the JSON or not', () => {
    const plan = [{ Plan: { 'Node Type': 'Seq Scan', 'Plan Rows': 1500 } }];
    expect(postgresPlanRows([{ 'QUERY PLAN': plan }])).toBe(1500);
    expect(postgresPlanRows([{ 'QUERY PLAN': JSON.stringify(plan) }])).toBe(1500);
    expect(postgresPlanRows([])).toBeUndefined();
  });

  test('MySQL: one table, and the last table of a nested loop', () => {
    const single = { query_block: { table: { table_name: 'e', rows_examined_per_scan: 3001, rows_produced_per_join: 1000 } } };
    expect(mysqlPlanRows([{ EXPLAIN: JSON.stringify(single) }])).toBe(1000);
    const joined = {
      query_block: {
        ordering_operation: {
          nested_loop: [{ table: { table_name: 'e', rows_produced_per_join: 3001 } }, { table: { table_name: 'e_customer', rows_produced_per_join: '2990' } }],
        },
      },
    };
    expect(mysqlPlanRows([{ EXPLAIN: JSON.stringify(joined) }])).toBe(2990);
    expect(mysqlPlanRows([{ EXPLAIN: 42 }])).toBeUndefined();
  });
});
