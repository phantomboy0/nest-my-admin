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
    expect((await as('designer').session()).body.appearance).toEqual({ accent: null, manage: true, logo: null, favicon: null });
    expect((await as('clerk').session()).body.appearance).toEqual({ accent: null, manage: false, logo: null, favicon: null });
  });

  test('appearance.manage sets it for everyone; it is stored; null goes back to the branding', async () => {
    expect((await as('designer').put({ accent: '#0E7490' })).body).toEqual({ accent: '#0E7490' });
    expect((await as('clerk').session()).body.appearance).toEqual({ accent: '#0E7490', manage: false, logo: null, favicon: null });
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

/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const image = (user: string, kind: string) => ({
  put: (body: Buffer, type: string) => request(app.getHttpServer()).put(`/admin/api/appearance/${kind}`).set('X-User', user).set('Content-Type', type).send(body),
  remove: () => request(app.getHttpServer()).delete(`/admin/api/appearance/${kind}`).set('X-User', user),
});
const page = async () => (await request(app.getHttpServer()).get('/admin/')).text;
const config = (html: string) => JSON.parse(/<script type="application\/json" id="nma-config">([^]*?)<\/script>/.exec(html)![1]!);

describe(`logo and favicon uploaded in the admin (${TEST_DB})`, () => {
  test('appearance.manage uploads a logo: stored, served to anyone, named in the page and the session', async () => {
    const res = await image('designer', 'logo').put(PNG, 'image/png');
    expect(res.status).toBe(200);
    expect(res.body.logo).toMatch(/^appearance\/logo\?v=[0-9a-f]{12}$/);
    const served = await request(app.getHttpServer()).get('/admin/appearance/logo').buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    expect(config(await page()).branding.logo).toBe(res.body.logo);
    expect((await as('clerk').session()).body.appearance.logo).toBe(res.body.logo);
    const stored = await app.get<DataSource>(getDataSourceToken()).getRepository(NmaSetting).findOneBy({ key: 'appearance.logo' });
    expect((stored?.value as { type: string }).type).toBe('image/png');
  });

  test('a favicon becomes the page’s icon; removing it takes it away', async () => {
    const res = await image('designer', 'favicon').put(PNG, 'image/png');
    expect(res.body.favicon).toMatch(/^appearance\/favicon\?v=/);
    expect(await page()).toContain(`<link rel="icon" href="${res.body.favicon}">`);
    expect((await image('designer', 'favicon').remove()).status).toBe(200);
    expect(await page()).not.toContain('rel="icon"');
    expect((await request(app.getHttpServer()).get('/admin/appearance/favicon')).status).toBe(404);
  });

  test('refused: without appearance.manage, not an image, too big, an unknown kind, a body that is not the type', async () => {
    expect((await image('clerk', 'logo').put(PNG, 'image/png')).status).toBe(403);
    expect((await image('clerk', 'logo').remove()).status).toBe(403);
    expect((await image('designer', 'logo').put(Buffer.from('<html>'), 'text/html')).status).toBe(415);
    expect((await image('designer', 'logo').put(Buffer.alloc(600_000, 1), 'image/png')).status).toBe(413);
    expect((await image('designer', 'banner').put(PNG, 'image/png')).status).toBe(404);
    expect((await image('designer', 'logo').put(Buffer.from('not a png'), 'image/png')).status).toBe(422);
  });

  test('an SVG is served so that opening it cannot run anything', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    expect((await image('designer', 'logo').put(svg, 'image/svg+xml')).status).toBe(200);
    const served = await request(app.getHttpServer()).get('/admin/appearance/logo');
    expect(served.headers['content-type']).toBe('image/svg+xml');
    expect(served.headers['content-security-policy']).toContain('sandbox');
  });

  test('removing the logo goes back to branding.logo (none here)', async () => {
    expect((await image('root', 'logo').remove()).body.logo).toBeNull();
    expect(config(await page()).branding.logo).toBeUndefined();
  });
});
