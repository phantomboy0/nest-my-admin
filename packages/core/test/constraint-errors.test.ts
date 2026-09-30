import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Gadget, GadgetsModule } from './fixtures/gadgets.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

const widgets = '/admin/api/resources/widget';
const gadgets = '/admin/api/resources/gadget';

describe(`database constraint errors (${TEST_DB})`, () => {
  let app: INestApplication;
  let widgetId: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({ entities: [Gadget], imports: [GadgetsModule] });
    widgetId = (await http().post(widgets).send({ name: 'Parent' })).body.id;
    expect((await http().post(gadgets).send({ batch: 'B1', serial: 'S1', widgetId })).status).toBe(201);
  });
  afterAll(async () => {
    await app.close();
  });

  test('creating with a foreign key to a missing record is 422 on the property (Review Focus 4)', async () => {
    const res = await http().post(gadgets).send({ batch: 'B1', serial: 'S2', widgetId: 999999 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.message).toBe('A related record does not exist');
    // widgetId is a relation field (M1c-2), so the admin finds the missing record before the database does and names
    // the property on every driver; the driver-error mapping for this case is covered in error-response.test.ts
    expect(res.body.fields).toEqual({ widgetId: ['does not exist'] });
  });

  test('updating to a missing record is 422 too', async () => {
    const created = await http().post(gadgets).send({ batch: 'B2', serial: 'S1', widgetId });
    const res = await http().patch(`${gadgets}/${created.body.id}`).send({ widgetId: 999999 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
  });

  test('deleting a record that others reference is 409 and keeps it', async () => {
    const res = await http().delete(`${widgets}/${widgetId}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'Other records still refer to this record' });
    expect((await http().get(`${widgets}/${widgetId}`)).status).toBe(200);
  });

  test('a duplicate across a two-column unique constraint names both fields (Review Focus 3)', async () => {
    const res = await http().post(gadgets).send({ batch: 'B1', serial: 'S1', widgetId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    // Postgres and MySQL name the constraint/index; SQLite lists both columns
    expect(res.body.fields).toEqual({ batch: ['already exists'], serial: ['already exists'] });
  });

  test.skipIf(TEST_DB === 'sqljs')('a value longer than its column is 422, not 500 (SQLite ignores lengths)', async () => {
    const res = await http().post(widgets).send({ name: 'x'.repeat(81) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
    // Postgres does not name the column for this error; MySQL does
    if (TEST_DB === 'mysql') expect(res.body.fields).toEqual({ name: ['is invalid'] });
  });
});
