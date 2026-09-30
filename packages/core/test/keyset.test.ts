import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { createTestApp } from './helpers/create-app.js';
import { TICKET_ENTITIES, TicketsModule, seedTickets } from './fixtures/tickets.js';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const keyset = '/admin/api/resources/ticket-keyset';

beforeAll(async () => {
  app = await createTestApp({ imports: [TicketsModule], entities: TICKET_ENTITIES });
  await seedTickets(app.get<DataSource>(getDataSourceToken()), 120);
});
afterAll(async () => {
  await app.close();
});

/** Every page of the keyset list, following nextCursor. */
async function walk(query: string): Promise<string[]> {
  const titles: string[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const res = await http().get(`${keyset}?${query}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    if (res.status !== 200) throw new Error(JSON.stringify(res.body));
    expect(res.body.total).toBeNull();
    titles.push(...res.body.items.map((item: { title: string }) => item.title));
    after = res.body.nextCursor;
    if (after === null) return titles;
  }
  throw new Error('no last page');
}

/** The same order from the offset list, all at once. */
async function offsetOrder(query: string): Promise<string[]> {
  const res = await http().get(`/admin/api/resources/ticket?${query}&pageSize=100`);
  const second = await http().get(`/admin/api/resources/ticket?${query}&pageSize=100&page=2`);
  return [...res.body.items, ...second.body.items].map((item: { title: string }) => item.title);
}

describe('keyset pagination (Review Focus 2)', () => {
  test.each(['sort=priority', 'sort=-openedAt', 'sort=title', 'sort=-id', 'sort=-priority&filter[priority][in]=1,2'])(
    '%s: every row once, in offset order',
    async (query) => {
      const titles = await walk(query);
      expect(new Set(titles).size).toBe(titles.length);
      expect(titles).toEqual(await offsetOrder(query));
    },
  );

  test('the schema says keyset and only non-nullable columns are sortable', async () => {
    const schema = (await http().get('/admin/api/meta/resources/ticket-keyset')).body;
    expect(schema.list).toMatchObject({ pagination: 'keyset', count: 'none', sortable: ['id', 'title', 'priority', 'openedAt'] });
  });

  test('bad requests', async () => {
    expect((await http().get(`${keyset}?after=nope`)).body.fields).toEqual({ after: ['is not a valid cursor'] });
    const first = await http().get(`${keyset}?sort=title`);
    const other = await http().get(`${keyset}?sort=priority&after=${encodeURIComponent(first.body.nextCursor)}`);
    expect(other.body.fields).toEqual({ after: ['belongs to another sort order; start from the first page'] });
    const forged = Buffer.from(JSON.stringify({ s: 'title', v: [{ $gt: 1 }, 1] })).toString('base64url');
    expect((await http().get(`${keyset}?sort=title&after=${forged}`)).status).toBe(422);
    expect((await http().get(`${keyset}?page=2`)).body.fields).toEqual({ page: ['this list pages with after, not page numbers'] });
    expect((await http().get(`/admin/api/resources/ticket?after=x`)).body.fields).toEqual({ after: ['this list pages by page number'] });
    expect((await http().get(`${keyset}?sort=note`)).body.fields).toEqual({ sort: ['cannot sort by "note"'] });
  });
});
