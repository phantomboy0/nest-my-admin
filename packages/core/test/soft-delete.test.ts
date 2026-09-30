import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';
import { SHAPE_ENTITIES, ShapesModule, shopDeletes } from './fixtures/shapes.js';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const shops = '/admin/api/resources/shop';
const names = async (query = '') => (await http().get(`${shops}?sort=name&${query}`)).body.items.map((item: { name: string }) => item.name);
const newShop = async (name: string) => (await http().post(shops).send({ name })).body as { _id: string; id: number };

beforeAll(async () => {
  app = await createTestApp({ imports: [ShapesModule], entities: SHAPE_ENTITIES });
});
afterAll(async () => {
  await app.close();
});

describe('soft delete (Review Focus 4)', () => {
  test('the schema says so; resources without a delete-date column do not', async () => {
    expect((await http().get('/admin/api/meta/resources/shop')).body.softDelete).toBe(true);
    expect((await http().get('/admin/api/meta/resources/branch')).body.softDelete).toBe(false);
    expect((await http().get('/admin/api/resources/branch?trashed=only')).body.fields).toEqual({ trashed: ['this resource has no trash'] });
  });

  test('DELETE moves a record to the trash: gone from the list, GET, relation options and relation writes', async () => {
    const kept = await newShop('Kept');
    const trashed = await newShop('Trashed');
    shopDeletes.length = 0;
    expect((await http().delete(`${shops}/${trashed._id}`)).status).toBe(204);
    expect(shopDeletes).toEqual(['Trashed:soft']);
    expect(await names()).toEqual(['Kept']);
    expect((await http().get(`${shops}/${trashed._id}`)).status).toBe(404);
    const options = await http().get('/admin/api/resources/branch/fields/shop/options');
    expect(options.body.items.map((item: { title: string }) => item.title)).toEqual(['Kept']);
    const write = await http().post('/admin/api/resources/branch').send({ name: 'B', shop: trashed.id });
    expect(write.body.fields).toEqual({ shop: ['does not exist'] });
    expect((await http().post('/admin/api/resources/branch').send({ name: 'B', shop: kept.id })).status).toBe(201);
  });

  test('trashed=only lists the trash, trashed=with lists everything', async () => {
    expect(await names('trashed=only')).toEqual(['Trashed']);
    expect(await names('trashed=with')).toEqual(['Kept', 'Trashed']);
    expect((await http().get(`${shops}?trashed=all`)).body.fields).toEqual({ trashed: ['must be only or with'] });
  });

  test('restore brings a record back; restoring a live one is 404', async () => {
    const shop = await newShop('Comeback');
    await http().delete(`${shops}/${shop._id}`);
    const restored = await http().post(`${shops}/${shop._id}/restore`).send({});
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ name: 'Comeback', deletedAt: null });
    expect(await names()).toContain('Comeback');
    expect((await http().post(`${shops}/${shop._id}/restore`).send({})).status).toBe(404);
    expect((await http().post(`/admin/api/resources/branch/1/restore`).send({})).status).toBe(400);
  });

  test('purge removes the row, trashed or not; a referenced record is a 409', async () => {
    const trashed = await newShop('Gone');
    await http().delete(`${shops}/${trashed._id}`);
    shopDeletes.length = 0;
    expect((await http().delete(`${shops}/${trashed._id}?purge=true`)).status).toBe(204);
    expect(shopDeletes).toEqual(['Gone:hard']);
    expect(await names('trashed=with')).not.toContain('Gone');
    expect((await http().delete(`${shops}/${trashed._id}?purge=true`)).status).toBe(404);

    const referenced = await newShop('Referenced');
    await http().post('/admin/api/resources/branch').send({ name: 'Uses it', shop: referenced.id });
    const res = await http().delete(`${shops}/${referenced._id}?purge=true`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Other records still refer to this record');
    expect((await http().delete(`${shops}/${referenced._id}?purge=yes`)).status).toBe(400);
  });
});
