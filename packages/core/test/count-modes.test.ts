import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';
import { TICKET_ENTITIES, TicketsModule, seedTickets } from './fixtures/tickets.js';

let app: INestApplication;
const queries: string[] = [];
const logger = {
  logQuery: (query: string) => void queries.push(query),
  logQueryError: () => undefined,
  logQuerySlow: () => undefined,
  logSchemaBuild: () => undefined,
  logMigration: () => undefined,
  log: () => undefined,
};
const list = async (resource: string, query = '') => {
  const res = await request(app.getHttpServer()).get(`/admin/api/resources/${resource}?${query}`);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body as { items: unknown[]; total: number | null; estimated?: boolean; hasMore?: boolean };
};

beforeAll(async () => {
  app = await createTestApp({ imports: [TicketsModule], entities: TICKET_ENTITIES, dataSource: { logger, logging: ['query'] } });
  await seedTickets(app.get<DataSource>(getDataSourceToken()), 2500);
});
afterAll(async () => {
  await app.close();
});

describe('list.count (Review Focus 3)', () => {
  test('exact is the default', async () => {
    expect(await list('ticket')).toMatchObject({ total: 2500 });
    expect((await list('ticket')).estimated).toBeUndefined();
  });

  test('estimate uses the planner on Postgres and MySQL, and counts elsewhere', async () => {
    const page = await list('ticket-estimate');
    expect(page.items).toHaveLength(25);
    if (TEST_DB === 'sqljs') {
      expect(page).toMatchObject({ total: 2500 }); // SQLite has no row estimate
      expect(page.estimated).toBeUndefined();
    } else {
      expect(page.estimated).toBe(true);
      expect(page.total!).toBeGreaterThan(1250);
      expect(page.total!).toBeLessThan(3750);
    }
  });

  test('a small result is counted exactly even when estimating', async () => {
    const page = await list('ticket-estimate', 'filter[priority][eq]=99');
    expect(page.total).toBe(3);
    expect(page.estimated).toBeUndefined();
  });

  test('none pages without counting', async () => {
    queries.length = 0;
    const first = await list('ticket-none');
    expect(first).toMatchObject({ total: null, hasMore: true });
    expect(first.items).toHaveLength(10);
    expect(queries.some((query) => /COUNT\(/i.test(query))).toBe(false);
    const last = await list('ticket-none', 'page=250');
    expect(last).toMatchObject({ total: null, hasMore: false });
    expect(last.items).toHaveLength(10);
  });
});
