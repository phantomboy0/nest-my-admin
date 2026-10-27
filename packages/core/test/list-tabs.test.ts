import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import type { DataSource } from 'typeorm';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUserRecord,
  type ListConfig,
  type ListTab,
  type ResourceSchema,
  type TabCounts,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';
import { Ticket, seedTickets } from './fixtures/tickets.js';

const TABS: ListTab[] = [
  { key: 'all', label: { en: 'All', fa: 'همه' } },
  { key: 'urgent', label: 'Urgent', filter: { 'filter[priority][eq]': '99' } },
  { key: 'low', label: 'Low', filter: { 'filter[priority][eq]': '0' }, count: 'estimate' },
  // What filters cannot say: odd ids.
  { key: 'odd', label: 'Odd', where: (qb) => void qb.andWhere(`${qb.alias}.id % 2 = 1`) },
  { key: 'quiet', label: 'Quiet', filter: { 'filter[priority][eq]': '1' }, count: 'none' },
  { key: 'big', label: 'Big', count: 'estimate' },
];

@AdminResource(Ticket, { name: 'ticket-tabs' })
class TabbedTicketAdmin extends AdminResourceBase<Ticket> {
  list: ListConfig<Ticket> = { filters: ['priority', 'note'], tabs: TABS };
  @AdminScope('ones') ones() {
    return { priority: 1 };
  }
}

const users = new Map<string, AdminUserRecord>(['root', 'ones', 'blind'].map((id) => [id, { id, displayName: id, username: id, isSuperuser: id === 'root', isActive: true }]));

@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return user.id === 'root' ? [] : [String(user.id)];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [TestAuth, TabbedTicketAdmin] })
class TabsModule {}

const queries: string[] = [];
const logger = { logQuery: (query: string) => void queries.push(query), logQueryError: () => undefined, logQuerySlow: () => undefined, logSchemaBuild: () => undefined, logMigration: () => undefined, log: () => undefined };

let app: INestApplication;
const get = (user: string, path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user);

beforeAll(async () => {
  app = await createTestApp({
    imports: [TabsModule],
    entities: [Ticket, ...ADMIN_RBAC_ENTITIES],
    dataSource: { logger, logging: ['query'] },
    admin: {
      auth: AdminAuth.custom(TestAuth),
      rbac: {},
      roles: [
        // Only priority-1 tickets.
        { name: 'ones', permissions: ['ticket-tabs.view'], scopes: { 'ticket-tabs': { view: 'ones' } } },
        // `priority` hidden: tabs filtering on it are not theirs.
        { name: 'blind', permissions: ['ticket-tabs.view'], fields: { 'ticket-tabs': { priority: 'hidden' } } },
      ],
    },
  });
  await seedTickets(app.get<DataSource>(getDataSourceToken()), 2500);
});
afterAll(async () => {
  await app.close();
});

describe(`list tabs (${TEST_DB})`, () => {
  test('the schema lists the tabs: their filters, whether they restrict further, and how they are counted', async () => {
    const schema = (await get('root', '/meta/resources/ticket-tabs')).body as ResourceSchema;
    expect(schema.list.tabs).toEqual([
      { key: 'all', label: 'All', filter: {}, where: false, count: 'exact' },
      { key: 'urgent', label: 'Urgent', filter: { 'filter[priority][eq]': '99' }, where: false, count: 'exact' },
      { key: 'low', label: 'Low', filter: { 'filter[priority][eq]': '0' }, where: false, count: 'estimate' },
      { key: 'odd', label: 'Odd', filter: {}, where: true, count: 'exact' },
      { key: 'quiet', label: 'Quiet', filter: { 'filter[priority][eq]': '1' }, where: false, count: 'none' },
      { key: 'big', label: 'Big', filter: {}, where: false, count: 'estimate' },
    ]);
  });

  test('counts: exact, estimated above 1000 rows on Postgres and MySQL (exact on SQLite-family, which has no planner estimate), none', async () => {
    queries.length = 0;
    const counts = (await get('root', '/resources/ticket-tabs/tab-counts')).body as TabCounts;
    expect(counts.all).toEqual({ count: 2500, estimate: false });
    expect(counts.urgent).toEqual({ count: 3, estimate: false });
    expect(counts.odd).toEqual({ count: 1250, estimate: false });
    // A tab counted `none` is null and runs no query: four counted tabs, at most two queries each (an estimate may plan, then count).
    expect(counts.quiet).toBeNull();
    expect(queries.filter((query) => /priority/.test(query) && /"?1"?/.test(query)).length).toBeLessThanOrEqual(8);
    // 2500 rows: the planner's estimate on Postgres and MySQL; SQLite-family has none, so it counts.
    if (TEST_DB === 'postgres' || TEST_DB === 'mysql') expect(counts.big).toMatchObject({ estimate: true });
    else expect(counts.big).toEqual({ count: 2500, estimate: false });
    // 499 rows (below 1000): exact everywhere.
    expect(counts.low).toEqual({ count: 499, estimate: false });
  });

  test('a where tab restricts the list and its count', async () => {
    const odd = await get('root', '/resources/ticket-tabs?tab=odd&pageSize=5&sort=id');
    expect(odd.body.total).toBe(1250);
    expect(odd.body.items.every((item: { id: number }) => item.id % 2 === 1)).toBe(true);
    expect((await get('root', '/resources/ticket-tabs?tab=nope')).status).toBe(422);
  });

  test('counts follow the viewer’s scopes; tabs on hidden fields are not theirs', async () => {
    const ones = (await get('ones', '/resources/ticket-tabs/tab-counts')).body as TabCounts;
    expect(ones.all).toEqual({ count: 499, estimate: false }); // priority 1: i % 5 === 1 for i ≥ 3
    expect(ones.urgent).toEqual({ count: 0, estimate: false });
    const blind = (await get('blind', '/meta/resources/ticket-tabs')).body as ResourceSchema;
    expect(blind.list.tabs!.map((tab) => tab.key)).toEqual(['all', 'odd', 'big']);
    expect(Object.keys((await get('blind', '/resources/ticket-tabs/tab-counts')).body).sort()).toEqual(['all', 'big', 'odd']);
  });

  test('seven tabs, a bad filter or a repeated key fail at boot', async () => {
    const boot = async (tabs: ListTab[]) => {
      @AdminResource(Ticket, { name: 'bad-tabs' })
      class BadAdmin extends AdminResourceBase<Ticket> {
        list: ListConfig<Ticket> = { filters: ['priority'], tabs };
      }
      @Module({ providers: [BadAdmin] })
      class BadModule {}
      return createTestApp({ imports: [BadModule], entities: [Ticket] });
    };
    await expect(boot(Array.from({ length: 7 }, (_, i) => ({ key: `t${i}`, label: 'T' })))).rejects.toThrow('list.tabs: at most 6 tabs');
    await expect(boot([{ key: 'a', label: 'A', filter: { 'filter[title][eq]': 'x' } }])).rejects.toThrow('list.tabs.a: filter[title]');
    await expect(boot([{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }])).rejects.toThrow('list.tabs: the key "a" is used twice');
  });
});
