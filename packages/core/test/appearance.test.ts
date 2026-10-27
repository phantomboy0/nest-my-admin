import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import type { DataSource } from 'typeorm';
import { ADMIN_RBAC_ENTITIES, ADMIN_SETTING_ENTITIES, AdminAuth, NmaSetting, type AdminAuthAdapter, type AdminPrincipal, type AdminUserRecord } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

const users = new Map<string, AdminUserRecord>(['root', 'designer', 'clerk'].map((id) => [id, { id, displayName: id, username: id, isSuperuser: id === 'root', isActive: true }]));
@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return user.id === 'root' ? [] : [String(user.id)];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}
@Module({ providers: [TestAuth] })
class AuthModule {}

let app: INestApplication;
const as = (user: string) => ({
  session: () => request(app.getHttpServer()).get('/admin/api/session').set('X-User', user),
  put: (body: object) => request(app.getHttpServer()).put('/admin/api/appearance').set('X-User', user).send(body),
});

beforeAll(async () => {
  app = await createTestApp({
    imports: [AuthModule],
    entities: [...ADMIN_RBAC_ENTITIES, ...ADMIN_SETTING_ENTITIES],
    admin: {
      auth: AdminAuth.custom(TestAuth),
      rbac: {},
      appearance: {},
      roles: [
        { name: 'designer', permissions: ['appearance.manage'] },
        { name: 'clerk', permissions: ['widget.view'] },
      ],
    },
  });
});
afterAll(async () => {
  await app.close();
});

describe(`appearance (${TEST_DB})`, () => {
  test('the session says the admin-wide accent (none yet) and who may change it', async () => {
    expect((await as('designer').session()).body.appearance).toEqual({ accent: null, manage: true });
    expect((await as('clerk').session()).body.appearance).toEqual({ accent: null, manage: false });
  });

  test('appearance.manage sets it for everyone; it is stored; null goes back to the branding', async () => {
    expect((await as('designer').put({ accent: '#0E7490' })).body).toEqual({ accent: '#0E7490' });
    expect((await as('clerk').session()).body.appearance).toEqual({ accent: '#0E7490', manage: false });
    const stored = await app.get<DataSource>(getDataSourceToken()).getRepository(NmaSetting).findOneBy({ key: 'appearance.accent' });
    expect(stored?.value).toBe('#0E7490');
    expect((await as('root').put({ accent: null })).body).toEqual({ accent: null });
    expect((await as('clerk').session()).body.appearance.accent).toBeNull();
  });

  test('others are refused, and only plain CSS colours pass', async () => {
    expect((await as('clerk').put({ accent: '#000' })).status).toBe(403);
    const bad = await as('designer').put({ accent: 'red; background: url(x)' });
    expect(bad.status).toBe(422);
    expect(bad.body.fields.accent).toBeDefined();
    expect((await as('designer').put({ accent: 'oklch(0.6 0.15 280)' })).status).toBe(200);
  });

  test('without ADMIN_SETTING_ENTITIES, boot says what to add', async () => {
    await expect(createTestApp({ admin: { appearance: {} } })).rejects.toThrow('appearance: add ADMIN_SETTING_ENTITIES');
  });
});
