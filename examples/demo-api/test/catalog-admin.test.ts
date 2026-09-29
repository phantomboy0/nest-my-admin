import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

let app: INestApplication;
const base = '/admin/api/resources/product';
const post = (body: object) => request(app.getHttpServer()).post(base).send(body);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});
afterAll(async () => {
  await app.close();
});

describe('product admin (service-first)', () => {
  test('the form comes from the DTOs', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/product');
    expect(res.body.form).toEqual({
      create: ['name', 'sku', 'price', 'stock', 'status', 'releasedOn'],
      update: ['name', 'price', 'stock', 'status', 'releasedOn'],
      requiredOnCreate: ['name', 'sku', 'price'],
    });
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
});
