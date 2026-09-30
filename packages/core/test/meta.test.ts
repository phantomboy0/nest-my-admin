import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({ admin: { title: 'Test shop' } });
});
afterAll(async () => {
  await app.close();
});

describe('meta API', () => {
  test('lists groups and their resources', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      schemaVersion: 1,
      title: 'Test shop',
      groups: [{ key: 'widgets', label: 'Inventory', icon: 'boxes', resources: [{ name: 'widget', label: 'Widget' }] }],
    });
  });

  test('returns the resource schema', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/widget');
    expect(res.status).toBe(200);
    expect(res.body.primaryKeys).toEqual(['id']);
    expect(res.body.list.columns).toEqual(['id', 'name', 'price', 'status', 'visible']);
    expect(res.body.form).toMatchObject({
      create: ['name', 'price', 'status', 'visible', 'notes'],
      update: ['name', 'price', 'status', 'visible', 'notes'],
      requiredOnCreate: ['name'],
    });
  });

  test('unknown resources are NOT_FOUND with a correlation id', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Unknown resource "nope"', correlationId: expect.any(String) });
  });
});
