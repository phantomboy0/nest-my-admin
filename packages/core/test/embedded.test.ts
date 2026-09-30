import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';
import { SHAPE_ENTITIES, ShapesModule } from './fixtures/shapes.js';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const venues = '/admin/api/resources/venue';
const dtoVenues = '/admin/api/resources/venue-dto';

beforeAll(async () => {
  app = await createTestApp({ imports: [ShapesModule], entities: SHAPE_ENTITIES });
});
afterAll(async () => {
  await app.close();
});

describe('embedded columns', () => {
  test('are written and read as nested objects', async () => {
    const created = await http().post(venues).send({ name: 'Hall', address: { city: 'Tehran', zip: null, geo: { lat: '35.7' } } });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Hall', address: { city: 'Tehran', zip: null, geo: { lat: '35.70000' } } });
    expect((await http().get(`${venues}/${created.body._id}`)).body.address).toEqual({ city: 'Tehran', zip: null, geo: { lat: '35.70000' } });
  });

  test('embedded paths are list columns, filters, search and sort', async () => {
    await http().post(venues).send({ name: 'Arena', address: { city: 'Shiraz', geo: {} } });
    await http().post(venues).send({ name: 'Club', address: { city: 'Isfahan', geo: {} } });
    const list = await http().get(`${venues}?sort=address.city`);
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: Record<string, unknown>) => item['address.city'])).toEqual(['Isfahan', 'Shiraz', 'Tehran']);
    expect((await http().get(`${venues}?filter[address.city][contains]=raz`)).body.items.map((item: { name: string }) => item.name)).toEqual(['Arena']);
    expect((await http().get(`${venues}?search=isfa`)).body.items.map((item: { name: string }) => item.name)).toEqual(['Club']);
  });

  test('a partial PATCH of one embedded field keeps the others (Review Focus 2)', async () => {
    const { body } = await http().post(venues).send({ name: 'Keep', address: { city: 'Yazd', zip: '11111', geo: { lat: '31.9' } } });
    const patched = await http().patch(`${venues}/${body._id}`).send({ address: { zip: '22222' } });
    expect(patched.status).toBe(200);
    expect(patched.body.address).toEqual({ city: 'Yazd', zip: '22222', geo: { lat: '31.90000' } });
  });

  test('without a DTO, unknown and read-only nested keys are rejected', async () => {
    const res = await http().post(venues).send({ name: 'Bad', address: { city: 'X', country: 'IR', geo: 'nope' } });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ 'address.country': ['is not a writable field'], 'address.geo': ['must be an object'] });
    expect((await http().post(venues).send({ name: 'Null', address: null })).body.fields).toEqual({ address: ['is required'] });
  });

  test('a missing embedded value maps to its dotted path', async () => {
    const res = await http().post(venues).send({ name: 'No city', address: { zip: '1' } });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ 'address.city': ['is required'] });
  });
});

describe('nested DTOs', () => {
  test('errors inside objects and lists use dotted paths', async () => {
    const res = await http()
      .post(dtoVenues)
      .send({ name: 'Nested', address: { city: 'X', zip: 'abc' }, hours: [{ day: 'mon', opens: '09:00' }, { day: 'sun', opens: '9' }] });
    expect(res.status).toBe(422);
    expect(res.body.fields).toMatchObject({
      'address.city': [expect.stringContaining('longer than or equal to 2')],
      'address.zip': ['zip must be 5 digits'],
      'hours.1.day': [expect.stringContaining('one of')],
      'hours.1.opens': [expect.any(String)],
    });
  });

  test('a list of sub-forms is stored in its json column and read back as sent', async () => {
    const hours = [{ day: 'mon', opens: '09:00' }, { day: 'tue', opens: '10:30' }];
    const created = await http().post(dtoVenues).send({ name: 'Cafe', address: { city: 'Tabriz' }, hours });
    expect(created.status).toBe(201);
    expect(created.body.hours).toEqual(hours);
  });

  test('a partial PATCH validates only the nested fields it sends (Review Focus 2)', async () => {
    const { body } = await http().post(dtoVenues).send({ name: 'Partial', address: { city: 'Rasht' } });
    const patched = await http().patch(`${dtoVenues}/${body._id}`).send({ address: { zip: '12345' } });
    expect(patched.status).toBe(200);
    expect(patched.body.address).toMatchObject({ city: 'Rasht', zip: '12345' });
    const bad = await http().patch(`${dtoVenues}/${body._id}`).send({ address: { zip: 'x' } });
    expect(bad.body.fields).toEqual({ 'address.zip': ['zip must be 5 digits'] });
  });
});
