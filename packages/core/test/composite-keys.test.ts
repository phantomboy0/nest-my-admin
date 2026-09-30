import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';
import { SHAPE_ENTITIES, ShapesModule } from './fixtures/shapes.js';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const lines = '/admin/api/resources/line';
const at = (id: string) => `${lines}/${encodeURIComponent(id)}`;

beforeAll(async () => {
  app = await createTestApp({ imports: [ShapesModule], entities: SHAPE_ENTITIES });
});
afterAll(async () => {
  await app.close();
});

describe('composite primary keys (Review Focus 1)', () => {
  test('the schema lists every key; records carry the encoded id', async () => {
    expect((await http().get('/admin/api/meta/resources/line')).body.primaryKeys).toEqual(['orderId', 'sku']);
    const created = await http().post(lines).send({ orderId: 1, sku: 'a,b~c', qty: 3 });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ _id: '1,a~1b~0c', _title: 'a,b~c', orderId: 1, sku: 'a,b~c', qty: 3 });
  });

  test('GET, PATCH and DELETE work by the encoded id', async () => {
    await http().post(lines).send({ orderId: 2, sku: 'x~1', qty: 1 });
    expect((await http().get(at('2,x~01'))).body).toMatchObject({ orderId: 2, sku: 'x~1' });
    expect((await http().patch(at('2,x~01')).send({ qty: 9 })).body).toMatchObject({ qty: 9, _id: '2,x~01' });
    expect((await http().patch(at('2,x~01')).send({ sku: 'y' })).status).toBe(422); // keys are not writable on update
    expect((await http().delete(at('2,x~01'))).status).toBe(204);
    expect((await http().get(at('2,x~01'))).status).toBe(404);
  });

  test('ids that cannot exist are 404', async () => {
    for (const id of ['1', '1,a,b', 'x,a', '1,a~9']) expect((await http().get(at(id))).status).toBe(404);
  });

  test('pages are ordered by every key after the sort column', async () => {
    for (const [orderId, sku] of [[5, 'b'], [5, 'a'], [4, 'z']] as const) await http().post(lines).send({ orderId, sku, qty: 7 });
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await http().get(`${lines}?filter[qty][eq]=7&page=${page}`);
      seen.push(...res.body.items.map((item: { _id: string }) => item._id));
    }
    expect(seen).toEqual(['4,z', '5,a', '5,b']);
  });
});

describe('a single string key named "new"', () => {
  test('is escaped as ~new and readable', async () => {
    const created = await http().post('/admin/api/resources/keyed').send({ code: 'new', label: 'Fresh' });
    expect(created.body._id).toBe('~new');
    expect((await http().get('/admin/api/resources/keyed/~new')).body).toMatchObject({ code: 'new', label: 'Fresh' });
  });
});
