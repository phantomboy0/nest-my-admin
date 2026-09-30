import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Module } from '@nestjs/common';
import request from 'supertest';
import { AdminResource, AdminResourceBase } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { Customer, ORDER_ENTITIES, OrdersModule } from './fixtures/orders.js';

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({ imports: [OrdersModule], entities: ORDER_ENTITIES });
});
afterAll(async () => {
  await app.close();
});

const schemaOf = async (name: string) => (await request(app.getHttpServer()).get(`/admin/api/meta/resources/${name}`)).body;

describe('relation fields in resource schemas', () => {
  test('relation fields point at the registered resource of their target', async () => {
    const order = await schemaOf('order');
    const byName = Object.fromEntries(order.fields.map((field: { name: string }) => [field.name, field]));
    expect(byName.customer).toMatchObject({ type: 'relation', label: 'Customer', nullable: false, relation: { kind: 'to-one', resource: 'customer', idType: 'number' } });
    expect(byName.sellerId).toMatchObject({ type: 'relation', label: 'Seller', nullable: true, relation: { kind: 'to-one', resource: 'customer' } });
    expect(byName.tags).toMatchObject({ type: 'relation', relation: { kind: 'to-many', resource: 'tag', idType: 'uuid' } });
    expect(byName['customer.name']).toMatchObject({ type: 'string', readonly: true });
    expect(order.form.create).toEqual(['number', 'sellerId', 'customer', 'tags']);
  });

  test('a relation to an entity without a resource has no resource name', async () => {
    const customer = await schemaOf('customer');
    const company = customer.fields.find((field: { name: string }) => field.name === 'company');
    expect(company.relation).toEqual({ kind: 'to-one', idType: 'number' });
  });
});

describe('titles at boot', () => {
  test('an unknown title column fails the boot', async () => {
    @AdminResource(Customer, { name: 'bad-customer', title: 'nmae' })
    class BadTitleAdmin extends AdminResourceBase<Customer> {}
    @Module({ providers: [BadTitleAdmin] })
    class BadModule {}
    await expect(createTestApp({ imports: [BadModule], entities: ORDER_ENTITIES })).rejects.toThrow(
      'BadTitleAdmin: title: unknown column "nmae" on Customer (did you mean "name"?)',
    );
  });
});
