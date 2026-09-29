import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

const base = '/admin/api/resources/widget';

describe('create', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  test('creates a record and returns decimals as strings', async () => {
    const res = await request(app.getHttpServer()).post(base).send({ name: 'Bolt', price: '12.5' });
    expect(res.status).toBe(201);
    // Read the id first: Bun 1.4.2's toMatchObject overwrites matched properties on the received object with the asymmetric matcher.
    const { id } = res.body;
    expect(res.body).toMatchObject({ id: expect.any(Number), name: 'Bolt', price: '12.50' });
    const read = await request(app.getHttpServer()).get(`${base}/${id}`);
    expect(read.body).toMatchObject({ name: 'Bolt', price: '12.50', status: 'draft', visible: true, notes: null });
  });

  test('rejects fields that are unknown or read-only', async () => {
    const res = await request(app.getHttpServer()).post(base).send({ name: 'x', id: 5, bogus: 1 });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ id: ['is not a writable field'], bogus: ['is not a writable field'] });
  });

  test('rejects non-object bodies', async () => {
    const res = await request(app.getHttpServer()).post(base).send([1, 2]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('database not-null violations become field errors', async () => {
    const res = await request(app.getHttpServer()).post(base).send({ price: '1' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION', fields: { name: ['is required'] } });
  });
});

describe('read', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
    for (const name of ['Charlie', 'Alpha', 'Bravo']) {
      await request(app.getHttpServer()).post(base).send({ name });
    }
  });
  afterAll(async () => { await app.close(); });

  test('lists with the default sort (newest first)', async () => {
    const res = await request(app.getHttpServer()).get(base);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 25 });
    expect(res.body.items.map((w: { name: string }) => w.name)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  test('paginates and sorts', async () => {
    const first = await request(app.getHttpServer()).get(`${base}?sort=name&pageSize=2&page=1`);
    expect(first.body.items.map((w: { name: string }) => w.name)).toEqual(['Alpha', 'Bravo']);
    const second = await request(app.getHttpServer()).get(`${base}?sort=name&pageSize=2&page=2`);
    expect(second.body.items.map((w: { name: string }) => w.name)).toEqual(['Charlie']);
  });

  test('rejects invalid list queries', async () => {
    const res = await request(app.getHttpServer()).get(`${base}?sort=bogus&pageSize=500`);
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['pageSize', 'sort']);
  });

  test('ids that cannot exist are 404, not 500', async () => {
    expect((await request(app.getHttpServer()).get(`${base}/abc`)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`${base}/99999`)).status).toBe(404);
  });
});

describe('update', () => {
  let app: INestApplication;
  let id: number;
  beforeAll(async () => {
    app = await createTestApp();
    id = (await request(app.getHttpServer()).post(base).send({ name: 'Nut' })).body.id;
  });
  afterAll(async () => { await app.close(); });

  test('patches only the sent fields', async () => {
    const res = await request(app.getHttpServer()).patch(`${base}/${id}`).send({ status: 'live' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, name: 'Nut', status: 'live' });
  });

  test('clearing a required column is a field error', async () => {
    const res = await request(app.getHttpServer()).patch(`${base}/${id}`).send({ name: null });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ name: ['is required'] });
  });

  test('the primary key is not writable and missing records are 404', async () => {
    expect((await request(app.getHttpServer()).patch(`${base}/${id}`).send({ id: 7 })).status).toBe(422);
    expect((await request(app.getHttpServer()).patch(`${base}/99999`).send({ name: 'x' })).status).toBe(404);
  });
});

describe('routing', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  test('unknown API routes are JSON 404s', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect((await request(app.getHttpServer()).delete(`${base}/1`)).status).toBe(404);
  });

  test('the mount does not swallow sibling paths', async () => {
    expect((await request(app.getHttpServer()).get('/administrator')).status).toBe(404);
  });
});
