import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AdminResource, AdminResourceBase, type AdminContext, type FindManyResult, type ListConfig, type ListParams } from '../src/index.js';
import { Company, Customer, ORDER_ENTITIES, Order, OrdersModule, Tag } from './fixtures/orders.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

/** A resource whose finder loads plain rows itself (no relations, no joins): references must still appear. */
@AdminResource(Order, { name: 'plain-order' })
class PlainOrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = { columns: ['number', 'customer', 'customer.name', 'tags'], sort: 'number' };
  async findMany(params: ListParams, _ctx: AdminContext): Promise<FindManyResult<Order>> {
    const [items, total] = await this.repository.findAndCount({ order: { number: 'ASC' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize });
    return { items, total };
  }
}
@Module({ providers: [PlainOrderAdmin] })
class PlainOrdersModule {}

let app: INestApplication;
let selects = 0;
const ids: Record<string, number | string> = {};
const logger = {
  logQuery: (query: string) => {
    if (/^\s*SELECT/i.test(query)) selects++;
  },
  logQueryError: () => undefined,
  logQuerySlow: () => undefined,
  logSchemaBuild: () => undefined,
  logMigration: () => undefined,
  log: () => undefined,
};

beforeAll(async () => {
  app = await createTestApp({ imports: [OrdersModule, PlainOrdersModule], entities: ORDER_ENTITIES, dataSource: { logger, logging: ['query'] } });
  const dataSource = app.get<DataSource>(getDataSourceToken());
  const [acme, globex] = await dataSource.getRepository(Company).save([{ name: 'Acme' }, { name: 'Globex' }]);
  const customers = await dataSource.getRepository(Customer).save([
    { name: 'Ada', company: acme },
    { name: 'Bob', company: globex },
    { name: 'Cyd', company: null },
    { name: 'Dee', company: acme, active: false },
  ]);
  for (const customer of customers) ids[customer.name] = customer.id;
  const tags = await dataSource.getRepository(Tag).save([{ label: 'red' }, { label: 'green' }, { label: 'blue' }]);
  for (const tag of tags) ids[tag.label] = tag.id;
  const tag = (label: string) => tags.find((candidate) => candidate.label === label)!;
  const customer = (name: string) => customers.find((candidate) => candidate.name === name)!;
  const orders: Array<[string, string, string | null, string[]]> = [
    ['A1', 'Ada', 'Bob', ['red', 'green']],
    ['A2', 'Ada', null, ['red']],
    ['B1', 'Bob', 'Ada', ['green']],
    ['B2', 'Bob', null, []],
    ['C1', 'Cyd', null, ['blue', 'red']],
    ['C2', 'Cyd', 'Ada', []],
    ['D1', 'Dee', null, ['green', 'blue']],
  ];
  for (const [number, buyer, seller, labels] of orders) {
    const saved = await dataSource.getRepository(Order).save({
      number,
      customer: customer(buyer),
      sellerId: seller ? customer(seller).id : null,
      tags: labels.map(tag),
    });
    ids[number] = saved.id;
  }
});
afterAll(async () => {
  await app.close();
});

async function list(query: string, resource = 'order') {
  const res = await request(app.getHttpServer()).get(`/admin/api/resources/${resource}?${query}`);
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { items: Array<Record<string, any>>; total: number };
}
const numbers = async (query: string) => (await list(`pageSize=100&${query}`)).items.map((item) => item.number as string).sort();
const ref = (name: string) => ({ id: ids[name], title: name });
const tagRefs = (...labels: string[]) => labels.map(ref).sort((a, b) => String(a.id).localeCompare(String(b.id)));

describe('relation values in lists', () => {
  test('to-one relations are { id, title }, paths are flat keys, many-to-many is a list of refs', async () => {
    const { items, total } = await list('');
    expect(total).toBe(7);
    expect(items.map((item) => item.number)).toEqual(['A1', 'A2', 'B1']);
    expect(items[0]).toEqual({
      _id: String(ids.A1),
      id: ids.A1,
      number: 'A1',
      customer: ref('Ada'),
      'customer.name': 'Ada',
      'customer.company.name': 'Acme',
      sellerId: ref('Bob'),
      tags: tagRefs('red', 'green'),
      _title: 'Order A1',
    });
    expect(items[1]).toMatchObject({ sellerId: null, tags: tagRefs('red') });
  });

  test('a broken path chain is null', async () => {
    const { items } = await list('filter[customer][eq]=' + ids.Cyd);
    expect(items.map((item) => [item.number, item['customer.company.name']])).toEqual([
      ['C1', null],
      ['C2', null],
    ]);
  });

  test('filters on to-one relations use ids', async () => {
    expect(await numbers(`filter[customer][eq]=${ids.Ada}`)).toEqual(['A1', 'A2']);
    expect(await numbers(`filter[customer][in]=${ids.Ada},${ids.Cyd}`)).toEqual(['A1', 'A2', 'C1', 'C2']);
    expect(await numbers(`filter[customer][ne]=${ids.Bob}`)).toEqual(['A1', 'A2', 'C1', 'C2', 'D1']);
    expect(await numbers(`filter[customer][nin]=${ids.Ada},${ids.Bob}`)).toEqual(['C1', 'C2', 'D1']);
    expect(await numbers(`filter[sellerId][eq]=${ids.Ada}`)).toEqual(['B1', 'C2']);
    expect(await numbers('filter[sellerId][isNull]=true')).toEqual(['A2', 'B2', 'C1', 'D1']);
  });

  test('filters and search on paths join the relation', async () => {
    expect(await numbers('filter[customer.name][contains]=D')).toEqual(['A1', 'A2', 'C1', 'C2', 'D1']);
    expect(await numbers('filter[customer.active][eq]=false')).toEqual(['D1']);
    expect(await numbers('search=cy')).toEqual(['C1', 'C2']);
    expect(await numbers('search=a1')).toEqual(['A1']);
  });

  test('sorting by a path pages through every record once, in order (Review Focus 1)', async () => {
    const pages = async (sort: string) => {
      const seen: Array<Record<string, any>> = [];
      for (let page = 1; page <= 3; page++) seen.push(...(await list(`sort=${sort}&page=${page}`)).items);
      return seen;
    };
    const ascending = await pages('customer.name');
    expect(ascending.map((item) => item.number)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1']);

    // Where NULLs go depends on the driver (Postgres: last ascending, first descending; MySQL and SQLite: the
    // opposite), so check that the named companies are in order and the records without one are together.
    const descending = (await pages('-customer.company.name')).map((item) => [item.number, item['customer.company.name']]);
    expect(descending.map(([number]) => number).sort()).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1']);
    const named = descending.filter(([, company]) => company !== null);
    expect(named).toEqual([
      ['B1', 'Globex'],
      ['B2', 'Globex'],
      ['A1', 'Acme'],
      ['A2', 'Acme'],
      ['D1', 'Acme'],
    ]);
    const nullsFirst = TEST_DB === 'postgres';
    expect(descending.slice(nullsFirst ? 0 : 5, nullsFirst ? 2 : 7).map(([number]) => number)).toEqual(['C1', 'C2']);
  });

  test('a many-to-many filter returns each record once and counts records (Review Focus 2)', async () => {
    const page = await list(`filter[tags][in]=${ids.red},${ids.blue}`);
    expect(page.total).toBe(4);
    expect(page.items.map((item) => item.number)).toEqual(['A1', 'A2', 'C1']);
    expect(await numbers(`filter[tags][in]=${ids.red},${ids.blue}`)).toEqual(['A1', 'A2', 'C1', 'D1']);
    expect(await numbers(`filter[tags][in]=${ids.green}&filter[customer][eq]=${ids.Ada}`)).toEqual(['A1']);
  });

  test('malformed ids are validation errors on the parameter', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/resources/order?filter[customer][eq]=abc&filter[tags][in]=nope');
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({
      'filter[customer][eq]': ['must be an id (an integer)'],
      'filter[tags][in]': ['must be an id (a UUID)'],
    });
  });

  test('references load even when the finder loaded no relations (Review Focus 3)', async () => {
    const { items } = await list('', 'plain-order');
    expect(items[0]).toMatchObject({ number: 'A1', customer: ref('Ada'), 'customer.name': 'Ada', tags: tagRefs('red', 'green'), _title: `#${ids.A1}` }); // no title and no title-like column
  });

  test('a page costs a fixed number of queries, not one per row', async () => {
    selects = 0;
    await list('pageSize=7');
    expect(selects).toBeLessThanOrEqual(4); // count + page + to-one references + one many-to-many field
  });
});

describe('relation values in records', () => {
  test('a record has every relation field, titled by the target resource or by default', async () => {
    const order = await request(app.getHttpServer()).get(`/admin/api/resources/order/${ids.C1}`);
    expect(order.body).toEqual({ _id: String(ids.C1), id: ids.C1, number: 'C1', customer: ref('Cyd'), sellerId: null, tags: tagRefs('blue', 'red'), _title: 'Order C1' });
    const customer = await request(app.getHttpServer()).get(`/admin/api/resources/customer/${ids.Ada}`);
    expect(customer.body).toMatchObject({ name: 'Ada', company: { id: expect.any(Number), title: 'Acme' }, _title: 'Ada' });
  });
});
