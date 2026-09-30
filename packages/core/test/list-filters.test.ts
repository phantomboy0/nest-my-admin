import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

const base = '/admin/api/resources/widget';
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
  const seed = [
    { name: 'Alpha lamp', price: '5', status: 'live', visible: true, notes: 'bright' },
    { name: 'beta Lamp', price: '15.5', status: 'draft', visible: false, notes: null },
    { name: 'Gamma', price: '50', status: 'live', visible: false, notes: '50% off' },
    { name: 'Delta_x', price: '99.99', status: 'draft', visible: true, notes: 'n_a' },
  ];
  for (const widget of seed) {
    const res = await request(app.getHttpServer()).post(base).send(widget);
    if (res.status !== 201) throw new Error(`seed failed: ${JSON.stringify(res.body)}`);
  }
});
afterAll(async () => {
  await app.close();
});

async function names(query: string): Promise<string[]> {
  const res = await request(app.getHttpServer()).get(`${base}?${query}`);
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return (res.body.items as Array<{ name: string }>).map((w) => w.name).sort();
}

describe('list filters', () => {
  test('equality, membership and booleans', async () => {
    expect(await names('filter[status][eq]=live')).toEqual(['Alpha lamp', 'Gamma']);
    expect(await names('filter[status]=draft')).toEqual(['Delta_x', 'beta Lamp']);
    expect(await names('filter[status][in]=draft,live')).toHaveLength(4);
    expect(await names('filter[status][ne]=live')).toEqual(['Delta_x', 'beta Lamp']);
    expect(await names('filter[visible][eq]=false')).toEqual(['Gamma', 'beta Lamp']);
  });

  test('ranges on decimals', async () => {
    expect(await names('filter[price][gte]=15.5')).toEqual(['Delta_x', 'Gamma', 'beta Lamp']);
    expect(await names('filter[price][between]=5,15.5')).toEqual(['Alpha lamp', 'beta Lamp']);
    expect(await names('filter[price][lt]=5')).toEqual([]);
  });

  test('null checks', async () => {
    expect(await names('filter[notes][isNull]=true')).toEqual(['beta Lamp']);
    expect(await names('filter[notes][isNull]=false')).toEqual(['Alpha lamp', 'Delta_x', 'Gamma']);
  });

  test('contains and startsWith are case-insensitive', async () => {
    expect(await names('filter[name][contains]=LAMP')).toEqual(['Alpha lamp', 'beta Lamp']);
    expect(await names('filter[name][startsWith]=BE')).toEqual(['beta Lamp']);
  });

  test('LIKE wildcards typed by users match literally (Review Focus 1)', async () => {
    expect(await names('filter[notes][contains]=_')).toEqual(['Delta_x']);
    expect(await names(`search=${encodeURIComponent('%')}`)).toEqual(['Gamma']);
    expect(await names(`filter[notes][contains]=${encodeURIComponent('50%')}`)).toEqual(['Gamma']);
  });

  test('datetime ranges work against SQLite text storage (Review Focus 4)', async () => {
    expect(await names('filter[createdAt][gte]=2000-01-01T00:00:00Z')).toHaveLength(4);
    expect(await names('filter[createdAt][lt]=2000-01-01T00:00:00Z')).toEqual([]);
  });

  test('bad values are 422 before reaching the database (Review Focus 2)', async () => {
    const res = await request(app.getHttpServer()).get(`${base}?filter[price][gte]=abc`);
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ 'filter[price][gte]': ['must be a number'] });
  });
});

describe('search', () => {
  test('matches any search field, case-insensitively, and combines with filters', async () => {
    expect(await names('search=lamp')).toEqual(['Alpha lamp', 'beta Lamp']);
    expect(await names('search=BRIGHT')).toEqual(['Alpha lamp']);
    expect(await names('search=lamp&filter[status][eq]=draft')).toEqual(['beta Lamp']);
  });

  test('the total reflects the filters', async () => {
    const res = await request(app.getHttpServer()).get(`${base}?filter[status][eq]=live&pageSize=1`);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('database-side case folding, bang escaping and date-time ranges', () => {
  test('non-ASCII text matches through search and contains', async () => {
    const extra = await createTestApp();
    const http = extra.getHttpServer();
    await request(http).post(base).send({ name: 'École', notes: 'Hey!%' });
    await request(http).post(base).send({ name: 'Plain', notes: 'Hey!' });
    const found = async (query: string) =>
      ((await request(http).get(`${base}?${query}`)).body.items as Array<{ name: string }>).map((w) => w.name).sort();
    expect(await found(`search=${encodeURIComponent('École')}`)).toEqual(['École']);
    expect(await found(`filter[name][contains]=${encodeURIComponent('Éco')}`)).toEqual(['École']);
    expect(await found(`filter[notes][contains]=${encodeURIComponent('!%')}`)).toEqual(['École']);
    expect(await found(`filter[notes][contains]=${encodeURIComponent('!')}`)).toEqual(['Plain', 'École']);
    await extra.close();
  });

  test('datetime between returns records inside the range', async () => {
    expect(await names('filter[createdAt][between]=2000-01-01T00:00:00Z,2100-01-01T00:00:00Z')).toHaveLength(4);
    expect(await names('filter[createdAt][between]=1990-01-01T00:00:00Z,2000-01-01T00:00:00Z')).toEqual([]);
  });
});

describe('stable pagination (Review Focus 3)', () => {
  test('ties in the sort column never repeat or skip records across pages', async () => {
    const tied = await createTestApp();
    const http = tied.getHttpServer();
    for (let i = 0; i < 5; i++) await request(http).post(base).send({ name: 'Same' });
    const seen: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await request(http).get(`${base}?sort=name&pageSize=2&page=${page}`);
      seen.push(...(res.body.items as Array<{ id: number }>).map((w) => w.id));
    }
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    await tied.close();
  });
});
