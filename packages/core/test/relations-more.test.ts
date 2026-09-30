import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import { AdminResource, AdminResourceBase, type ListConfig } from '../src/index.js';
import { Company, Customer, ORDER_ENTITIES, Order, OrdersModule, Tag } from './fixtures/orders.js';
import { createTestApp } from './helpers/create-app.js';

@Entity()
class Owner {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

@Entity()
class Pet {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @ManyToOne(() => Owner, { lazy: true, nullable: true }) owner: Promise<Owner | null>;
}

/** Filters only by number: linking it as a related list of customers adds the `customer` filter. */
@AdminResource(Order, { name: 'order-lite', label: 'Order lite' })
class LiteOrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = { columns: ['number', 'customer'], filters: ['number'] };
}

@AdminResource(Pet)
class PetAdmin extends AdminResourceBase<Pet> {
  list: ListConfig<Pet> = { columns: ['name', 'owner'] };
}

@AdminResource(Owner)
class OwnerAdmin extends AdminResourceBase<Owner> {}

@Module({ providers: [LiteOrderAdmin, PetAdmin, OwnerAdmin] })
class ExtrasModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());
const ids: Record<string, number | string> = {};
const numbers = async (query: string, resource = 'order') =>
  (await http().get(`/admin/api/resources/${resource}?pageSize=100&${query}`)).body.items.map((item: { number: string }) => item.number);

beforeAll(async () => {
  app = await createTestApp({ imports: [OrdersModule, ExtrasModule], entities: [...ORDER_ENTITIES, Owner, Pet] });
  const dataSource = app.get<DataSource>(getDataSourceToken());
  const [acme] = await dataSource.getRepository(Company).save([{ name: 'Acme' }]);
  const people: Array<Partial<Customer>> = [{ name: 'Zoe', company: acme }, { name: 'Ada' }, { name: 'Max' }];
  for (const customer of await dataSource.getRepository(Customer).save(people)) ids[customer.name] = customer.id;
  const [tag] = await dataSource.getRepository(Tag).save([{ label: 'red' }]);
  ids.red = tag!.id;
  const rows: Array<[string, string, string | null]> = [['O1', 'Zoe', 'Max'], ['O2', 'Ada', 'Zoe'], ['O3', 'Max', null], ['O4', 'Ada', 'Max']];
  for (const [number, buyer, seller] of rows) {
    const saved = await dataSource.getRepository(Order).save({
      number,
      customer: { id: ids[buyer] as number },
      sellerId: seller ? (ids[seller] as number) : null,
      tags: number === 'O1' ? [tag!] : [],
    });
    ids[number] = saved.id;
  }
});
afterAll(async () => {
  await app.close();
});

describe('related lists (Review Focus 5)', () => {
  test('a resource lists the relation fields that point at it', async () => {
    const customer = (await http().get('/admin/api/meta/resources/customer')).body;
    expect(customer.related).toEqual([
      { label: 'Order (Customer)', resource: 'order', field: 'customer', operator: 'eq' },
      { label: 'Order (Seller)', resource: 'order', field: 'sellerId', operator: 'eq' },
      { label: 'Order lite (Customer)', resource: 'order-lite', field: 'customer', operator: 'eq' },
      { label: 'Order lite (Seller)', resource: 'order-lite', field: 'sellerId', operator: 'eq' },
    ]);
    expect((await http().get('/admin/api/meta/resources/tag')).body.related).toEqual([
      { label: 'Order', resource: 'order', field: 'tags', operator: 'in' },
      { label: 'Order lite', resource: 'order-lite', field: 'tags', operator: 'in' },
    ]);
  });

  test("the link lists exactly that record's related records, adding the filter where needed", async () => {
    expect(await numbers(`filter[customer][eq]=${ids.Ada}`)).toEqual(['O2', 'O4']);
    expect(await numbers(`filter[tags][in]=${ids.red}`)).toEqual(['O1']);
    const lite = (await http().get('/admin/api/meta/resources/order-lite')).body;
    expect(lite.list.filters.map((filter: { field: string }) => filter.field)).toEqual(['number', 'customer', 'sellerId', 'tags']);
    expect(await numbers(`filter[customer][eq]=${ids.Max}`, 'order-lite')).toEqual(['O3']);
  });
});

describe('sorting a relation by its title', () => {
  test('sort=customer orders by customer name; the seller too', async () => {
    expect((await http().get('/admin/api/meta/resources/order')).body.list.sortable).toEqual(expect.arrayContaining(['customer', 'sellerId']));
    expect(await numbers('sort=customer')).toEqual(['O2', 'O4', 'O3', 'O1']);
    expect(await numbers('sort=-sellerId&filter[sellerId][isNull]=false')).toEqual(['O2', 'O1', 'O4']);
  });
});

describe('lazy relations', () => {
  test('are fields: written by id, read as refs, filtered', async () => {
    const owner = (await http().post('/admin/api/resources/owner').send({ name: 'Kim' })).body;
    const other = (await http().post('/admin/api/resources/owner').send({ name: 'Lee' })).body;
    const pet = await http().post('/admin/api/resources/pet').send({ name: 'Rex', owner: owner.id });
    expect(pet.status).toBe(201);
    expect(pet.body.owner).toEqual({ id: owner.id, title: 'Kim' });
    const list = await http().get(`/admin/api/resources/pet?filter[owner][eq]=${owner.id}`);
    expect(list.body.items).toEqual([expect.objectContaining({ name: 'Rex', owner: { id: owner.id, title: 'Kim' } })]);
    const moved = await http().patch(`/admin/api/resources/pet/${pet.body._id}`).send({ owner: other.id });
    expect(moved.body.owner).toEqual({ id: other.id, title: 'Lee' });
  });
});

describe('options that depend on other values', () => {
  const sellers = async (values?: object) =>
    (await http().get(`/admin/api/resources/order/fields/sellerId/options${values ? `?values=${encodeURIComponent(JSON.stringify(values))}` : ''}`)).body;

  test("the picker gets the form's values", async () => {
    expect((await sellers()).items.map((item: { title: string }) => item.title)).toEqual(['Ada', 'Max', 'Zoe']);
    expect((await sellers({ customer: ids.Ada })).items.map((item: { title: string }) => item.title)).toEqual(['Max', 'Zoe']);
    const bad = await http().get('/admin/api/resources/order/fields/sellerId/options?values=[1]');
    expect(bad.body.fields).toEqual({ values: ['must be a JSON object of at most 4096 characters'] });
  });

  test('writes are checked against the body, and on update against the stored record too', async () => {
    const created = await http().post('/admin/api/resources/order').send({ number: 'O9', customer: ids.Ada, sellerId: ids.Ada });
    expect(created.body.fields).toEqual({ sellerId: ['does not exist'] });
    // O4 is Ada's: making Ada its seller breaks the rule although the body does not mention the customer
    const updated = await http().patch(`/admin/api/resources/order/${ids.O4}`).send({ sellerId: ids.Ada });
    expect(updated.body.fields).toEqual({ sellerId: ['does not exist'] });
    expect((await http().patch(`/admin/api/resources/order/${ids.O4}`).send({ sellerId: ids.Zoe })).status).toBe(200);
  });
});
