import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';
import { SHAPE_ENTITIES, ShapesModule } from './fixtures/shapes.js';
import { TEST_DB } from './helpers/test-db.js';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const shops = '/admin/api/resources/shop';

beforeAll(async () => {
  app = await createTestApp({ imports: [ShapesModule], entities: SHAPE_ENTITIES });
});
afterAll(async () => {
  await app.close();
});

const newShop = async (name: string) => (await http().post(shops).send({ name })).body as { _id: string; version: number };

describe('@VersionColumn (Review Focus 3)', () => {
  test('the schema names the version field; records start at 1', async () => {
    expect((await http().get('/admin/api/meta/resources/shop')).body.version).toBe('version');
    expect((await newShop('First')).version).toBe(1);
  });

  test('a PATCH with the current version saves; the same version again is a 409 with the current record', async () => {
    const shop = await newShop('Two editors');
    const first = await http().patch(`${shops}/${shop._id}`).set('If-Match', '"1"').send({ stock: 5 });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);

    const second = await http().patch(`${shops}/${shop._id}`).set('If-Match', '"1"').send({ name: 'Mine' });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'CONFLICT', current: { name: 'Two editors', stock: 5, version: 2 } });
    expect((await http().get(`${shops}/${shop._id}`)).body).toMatchObject({ name: 'Two editors', version: 2 });
  });

  test('without If-Match there is no check; a malformed one is a 400', async () => {
    const shop = await newShop('No header');
    expect((await http().patch(`${shops}/${shop._id}`).send({ stock: 1 })).status).toBe(200);
    expect((await http().patch(`${shops}/${shop._id}`).set('If-Match', 'abc').send({ stock: 2 })).status).toBe(400);
    expect((await http().patch(`${shops}/${shop._id}`).set('If-Match', 'W/"2"').send({ stock: 3 })).status).toBe(200);
  });

  test('a DELETE with a stale version is a 409 and keeps the record', async () => {
    const shop = await newShop('Delete race');
    await http().patch(`${shops}/${shop._id}`).set('If-Match', '"1"').send({ stock: 1 });
    const res = await http().delete(`${shops}/${shop._id}`).set('If-Match', '"1"');
    expect(res.status).toBe(409);
    expect((await http().get(`${shops}/${shop._id}`)).status).toBe(200);
    expect((await http().delete(`${shops}/${shop._id}`).set('If-Match', '"2"')).status).toBe(204);
  });

  test('two concurrent saves of the same version: exactly one wins', async () => {
    const shop = await newShop('Race');
    const results = await Promise.all(
      ['A', 'B'].map((name) => http().patch(`${shops}/${shop._id}`).set('If-Match', '"1"').send({ name })),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((await http().get(`${shops}/${shop._id}`)).body.version).toBe(2);
    // SQLite runs admin writes one at a time; Postgres and MySQL make the second wait on the row lock
    if (TEST_DB !== 'sqljs') expect(results.find((res) => res.status === 409)!.body.current.version).toBe(2);
  });
});
