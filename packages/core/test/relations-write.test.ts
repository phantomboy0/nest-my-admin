import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AdminResource, AdminResourceBase, type AdminContext } from '../src/index.js';
import { Company, Customer, ORDER_ENTITIES, Order, OrdersModule, Tag } from './fixtures/orders.js';
import { createTestApp } from './helpers/create-app.js';

const received: object[] = [];

/** A service-first resource: its create gets the DTO with plain ids. */
@AdminResource(Order, { name: 'host-order' })
class HostOrderAdmin extends AdminResourceBase<Order> {
  async create(dto: object, ctx: AdminContext) {
    received.push({ ...dto });
    return super.create(dto, ctx);
  }
}
@Module({ providers: [HostOrderAdmin] })
class HostOrdersModule {}

let app: INestApplication;
let dataSource: DataSource;
const ids: Record<string, number | string> = {};
const http = () => request(app.getHttpServer());
const orders = '/admin/api/resources/order';
const options = (field: string, query = '', resource = 'order') => http().get(`/admin/api/resources/${resource}/fields/${field}/options${query ? `?${query}` : ''}`);
const titles = (res: { body: { items: Array<{ title: string }> } }) => res.body.items.map((item) => item.title);
const orderCount = () => dataSource.getRepository(Order).count();

beforeAll(async () => {
  app = await createTestApp({ imports: [OrdersModule, HostOrdersModule], entities: ORDER_ENTITIES });
  dataSource = app.get<DataSource>(getDataSourceToken());
  const [acme] = await dataSource.getRepository(Company).save([{ name: 'Acme' }, { name: 'Globex' }]);
  const customers: Array<Partial<Customer>> = [{ name: 'Ada', company: acme }, { name: 'Bob' }, { name: 'Dee', active: false }];
  for (const customer of await dataSource.getRepository(Customer).save(customers)) {
    ids[customer.name] = customer.id;
  }
  const labels = ['red', 'green', 'blue', ...Array.from({ length: 22 }, (_, i) => `extra-${String(i).padStart(2, '0')}`)];
  for (const tag of await dataSource.getRepository(Tag).save(labels.map((label) => ({ label })))) ids[tag.label] = tag.id;
});
afterAll(async () => {
  await app.close();
});

describe('writing relations', () => {
  test('create and update take ids and answer with refs', async () => {
    const created = await http().post(orders).send({ number: 'N1', customer: ids.Ada, sellerId: ids.Bob, tags: [ids.red, ids.green] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ number: 'N1', customer: { id: ids.Ada, title: 'Ada' }, sellerId: { id: ids.Bob, title: 'Bob' }, _title: 'Order N1' });
    expect(created.body.tags.map((tag: { title: string }) => tag.title).sort()).toEqual(['green', 'red']);

    const updated = await http().patch(`${orders}/${created.body.id}`).send({ customer: ids.Bob, sellerId: null, tags: [ids.blue] });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ customer: { id: ids.Bob, title: 'Bob' }, sellerId: null, tags: [{ id: ids.blue, title: 'blue' }] });

    const cleared = await http().patch(`${orders}/${created.body.id}`).send({ tags: [] });
    expect(cleared.body.tags).toEqual([]);
    const read = await http().get(`${orders}/${created.body.id}`);
    expect(read.body).toMatchObject({ customer: { id: ids.Bob }, sellerId: null, tags: [] });
  });

  test('a missing record is a 422 on the field and nothing is written (Review Focus 4)', async () => {
    const before = await orderCount();
    const missingCustomer = await http().post(orders).send({ number: 'N2', customer: 999999 });
    expect(missingCustomer.status).toBe(422);
    expect(missingCustomer.body).toMatchObject({ code: 'VALIDATION', message: 'A related record does not exist', fields: { customer: ['does not exist'] } });

    const missingTag = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const badTags = await http().post(orders).send({ number: 'N3', customer: ids.Ada, tags: [ids.red, missingTag] });
    expect(badTags.status).toBe(422);
    expect(badTags.body.fields).toEqual({ tags: [`these records do not exist: ${missingTag}`] });
    expect(await orderCount()).toBe(before);

    const created = await http().post(orders).send({ number: 'N4', customer: ids.Ada, tags: [ids.red] });
    const patch = await http().patch(`${orders}/${created.body.id}`).send({ number: 'N4b', tags: [ids.green, missingTag] });
    expect(patch.status).toBe(422);
    expect((await http().get(`${orders}/${created.body.id}`)).body).toMatchObject({ number: 'N4', tags: [{ title: 'red' }] });
  });

  test('ids of the wrong shape are rejected before the database', async () => {
    const res = await http().post(orders).send({ number: 'N5', customer: 'Ada', tags: 'red' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ customer: ['must be an id (an integer)'], tags: ['must be a list of ids'] });
  });

  test('relationOptions() limits what a field accepts', async () => {
    const inactive = await http().post(orders).send({ number: 'N6', customer: ids.Dee });
    expect(inactive.status).toBe(422);
    expect(inactive.body.fields).toEqual({ customer: ['does not exist'] });
    const asSeller = await http().post(orders).send({ number: 'N7', customer: ids.Ada, sellerId: ids.Dee });
    expect(asSeller.status).toBe(201);
  });

  test('a host create override receives the plain ids', async () => {
    received.length = 0;
    const res = await http().post('/admin/api/resources/host-order').send({ number: 'H1', customer: ids.Ada, tags: [ids.red] });
    expect(res.status).toBe(201);
    expect(received).toEqual([{ number: 'H1', customer: ids.Ada, tags: [ids.red] }]);
  });

  test('deleting a record others refer to is a 409 that says so (Review Focus 5)', async () => {
    const res = await http().delete(`/admin/api/resources/customer/${ids.Ada}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'Other records still refer to this record' });
    expect((await http().get(`/admin/api/resources/customer/${ids.Ada}`)).status).toBe(200);
  });
});

describe('relation options', () => {
  test('lists what relationOptions() allows, ordered by title', async () => {
    expect(titles(await options('customer'))).toEqual(['Ada', 'Bob']);
    expect(titles(await options('sellerId'))).toEqual(['Ada', 'Bob', 'Dee']);
    expect((await options('customer')).body.items[0]).toEqual({ id: ids.Ada, title: 'Ada' });
  });

  test('search uses the target resource search fields; at most 20 results', async () => {
    expect(titles(await options('customer', 'search=b'))).toEqual(['Bob']);
    expect(titles(await options('tags', 'search=RE'))).toEqual(['green', 'red']);
    expect((await options('tags')).body.items).toHaveLength(20);
  });

  test('a target without a resource is searched by its title column', async () => {
    expect(titles(await options('company', 'search=glo', 'customer'))).toEqual(['Globex']);
  });

  test('ids resolve titles, still restricted by relationOptions()', async () => {
    expect(titles(await options('customer', `ids=${ids.Ada},${ids.Dee}`))).toEqual(['Ada']);
    expect(titles(await options('tags', `ids=${ids.blue},${ids.red}`))).toEqual(['blue', 'red']);
  });

  test('bad requests', async () => {
    expect((await options('nope')).status).toBe(404);
    expect((await options('number')).status).toBe(400);
    const badIds = await options('customer', 'ids=x');
    expect(badIds.status).toBe(422);
    expect(badIds.body.fields).toEqual({ ids: ['must be 1 to 100 comma-separated ids'] });
    expect((await options('customer', 'limit=5')).body.fields).toEqual({ limit: ['is not a supported parameter'] });
  });
});
