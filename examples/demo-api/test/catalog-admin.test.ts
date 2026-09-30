import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { testDatabase, type TestDatabase } from '../../../packages/core/test/helpers/test-db.js';
import { AppModule } from '../src/app.module.js';

let app: INestApplication;
let db: TestDatabase;
const base = '/admin/api/resources/product';
const post = (body: object) => request(app.getHttpServer()).post(base).send(body);

beforeAll(async () => {
  db = await testDatabase([]); // entities come from the demo's own databaseOptions()
  if (db.url) process.env.DATABASE_URL = db.url;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});
afterAll(async () => {
  await app.close();
  delete process.env.DATABASE_URL;
  await db.drop();
});

describe('product admin (service-first)', () => {
  test('the form comes from the DTOs', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/product');
    expect(res.body.form).toMatchObject({
      create: ['name', 'sku', 'price', 'stock', 'status', 'releasedOn'],
      update: ['name', 'price', 'stock', 'status', 'releasedOn'],
      requiredOnCreate: ['name', 'sku', 'price'],
    });
    expect(res.body.form.constraints.create.name).toEqual({ required: true, minLength: 1, maxLength: 120 });
    expect(res.body.form.constraints.create.sku).toMatchObject({ required: true, pattern: { source: '^[A-Za-z0-9-]{2,40}$', flags: '', message: 'sku must be 2-40 letters, digits or dashes' } });
    expect(res.body.form.constraints.create.stock).toEqual({ integer: true, min: 0 });
    expect(res.body.form.constraints.create.status).toEqual({ oneOf: ['draft', 'active', 'archived'] });
  });

  test('create runs ProductsService and decimals stay strings even on SQLite', async () => {
    const res = await post({ name: 'Lamp', sku: 'lamp-1', price: '19.9', stock: 4, status: 'active' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Lamp', sku: 'LAMP-1', price: '19.90', stock: 4, status: 'active' });
    const read = await request(app.getHttpServer()).get(`${base}/${res.body.id}`);
    expect(read.body.price).toBe('19.90');
  });

  test('a rule enforced by the service surfaces as BUSINESS_RULE', async () => {
    const res = await post({ name: 'Ghost', sku: 'ghost-1', price: '5', status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'BUSINESS_RULE', message: 'Active products need stock' });
  });

  test('DTO validation errors are reported per field', async () => {
    const res = await post({ name: '', sku: 'ok-1', price: 'abc' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['name', 'price']);
    expect(res.body.fields.price[0]).toContain('decimal');
  });

  test('fields outside the DTO are rejected', async () => {
    const res = await post({ name: 'Sneaky', sku: 'sneaky-1', price: '1', createdAt: '2020-01-01' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ createdAt: ['is not a writable field'] });
  });

  test('a duplicate unique value is a 409 on that field, not a 500', async () => {
    expect((await post({ name: 'One', sku: 'dup-1', price: '1' })).status).toBe(201);
    const res = await post({ name: 'Two', sku: 'dup-1', price: '1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', fields: { sku: ['already exists'] } });
  });

  test('update uses the update DTO and the service', async () => {
    const { body } = await post({ name: 'Mug', sku: 'mug-1', price: '8' });
    const res = await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ stock: 9 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stock: 9, sku: 'MUG-1' });
    const sku = await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ sku: 'NEW' });
    expect(sku.status).toBe(422);
  });

  test('service exceptions keep their meaning (archived → CONFLICT)', async () => {
    const { body } = await post({ name: 'Old', sku: 'old-1', price: '2' });
    await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ status: 'archived' });
    const res = await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ name: 'Renamed' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'Archived products are read-only' });
  });

  test('filters and search narrow the list', async () => {
    await post({ name: 'Filter lamp', sku: 'flt-1', price: '12', stock: 3, status: 'active' });
    await post({ name: 'Filter mug', sku: 'flt-2', price: '30', status: 'draft' });
    const byStatus = await request(app.getHttpServer()).get(`${base}?filter[status][eq]=draft&search=filter`);
    expect(byStatus.body.items.map((p: { sku: string }) => p.sku)).toEqual(['FLT-2']);
    const byPrice = await request(app.getHttpServer()).get(`${base}?filter[price][between]=10,20&search=flt`);
    expect(byPrice.body.items.map((p: { sku: string }) => p.sku)).toEqual(['FLT-1']);
    const bad = await request(app.getHttpServer()).get(`${base}?filter[sku][eq]=x`);
    expect(bad.status).toBe(422);
    expect(bad.body.fields).toEqual({ 'filter[sku][eq]': ['cannot filter by "sku"'] });
  });

  test('delete goes through the service, which refuses active products', async () => {
    const draft = (await post({ name: 'Doomed', sku: 'del-1', price: '1' })).body;
    expect((await request(app.getHttpServer()).delete(`${base}/${draft.id}`)).status).toBe(204);
    const active = (await post({ name: 'Keeper', sku: 'del-2', price: '1', stock: 1, status: 'active' })).body;
    const refused = await request(app.getHttpServer()).delete(`${base}/${active.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'CONFLICT', message: 'Active products cannot be deleted; archive them first' });
  });
});
