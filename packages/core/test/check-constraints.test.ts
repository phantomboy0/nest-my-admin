import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';
import { SHAPE_ENTITIES, ShapesModule } from './fixtures/shapes.js';
import { TEST_DB } from './helpers/test-db.js';

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({ imports: [ShapesModule], entities: SHAPE_ENTITIES });
});
afterAll(async () => {
  await app.close();
});

// TypeORM does not create CHECK constraints on MySQL, so there is nothing to violate there.
describe.skipIf(TEST_DB === 'mysql')(`CHECK constraints (${TEST_DB})`, () => {
  test('a violated CHECK is a 422 on the columns its expression names, not a 500', async () => {
    const res = await request(app.getHttpServer()).post('/admin/api/resources/shop').send({ name: 'Negative', stock: -1 });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION', message: 'A value is not allowed', fields: { stock: ['is not allowed'] } });
  });
});
