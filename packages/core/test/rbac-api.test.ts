import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminValidationError,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUserChanges,
  type AdminUserRecord,
  type NewAdminUser,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

const users = new Map<string, AdminUserRecord & { password?: string }>();
const reset = () => {
  users.clear();
  for (const [id, isSuperuser] of [['root', true], ['boss', false], ['helper', false], ['reader', false], ['u1', false]] as const) {
    users.set(id, { id, displayName: id.toUpperCase(), username: id, isSuperuser, isActive: true });
  }
};
reset();

/** `X-User: <id>`; users live in memory and support the Users page methods. */
@Injectable()
class MemoryAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user && user.isActive !== false ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return { boss: ['rbac-admin'], helper: ['helper'], reader: ['rbac-reader'] }[String(user.id)] ?? [];
  }
  async listUsers(query: { search?: string; page: number; pageSize: number }) {
    const all = [...users.values()].filter((user) => !query.search || String(user.username).includes(query.search));
    return { items: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: all.length };
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
  async createUser(input: NewAdminUser) {
    if (users.has(input.username)) throw new AdminValidationError({ username: ['is taken'] });
    const user = { id: input.username, username: input.username, displayName: input.displayName, isSuperuser: input.isSuperuser === true, isActive: true, password: input.password };
    users.set(user.id, user);
    return user;
  }
  async updateUser(id: string, changes: AdminUserChanges) {
    const user = users.get(id)!;
    Object.assign(user, Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)));
    return user;
  }
  async setPassword(id: string, password: string) {
    users.get(id)!.password = password;
  }
  async resetTwoFactor(id: string) {
    users.get(id)!.twoFactor = false;
  }
}

@Module({ providers: [MemoryAuth] })
class AuthModule {}

let app: INestApplication;
const as = (user: string) => {
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) => {
    const req = request(app.getHttpServer())[method](`/admin/api/rbac${path}`).set('X-User', user);
    return body ? req.send(body) : req;
  };
  return {
    get: (path: string) => call('get', path),
    post: (path: string, body: object) => call('post', path, body),
    patch: (path: string, body: object) => call('patch', path, body),
    delete: (path: string) => call('delete', path),
  };
};
const roleNames = async () => ((await as('root').get('/roles')).body.items as Array<{ name: string }>).map((role) => role.name);

beforeAll(async () => {
  app = await createTestApp({
    imports: [AuthModule],
    entities: ADMIN_RBAC_ENTITIES,
    admin: {
      auth: AdminAuth.custom(MemoryAuth),
      rbac: {},
      roles: [
        { name: 'rbac-admin', permissions: ['rbac.manage', 'widget.*'] },
        { name: 'helper', permissions: ['rbac.manage', 'widget.view'] },
        { name: 'rbac-reader', permissions: ['rbac.view'] },
      ],
    },
  });
});
afterAll(async () => {
  await app.close();
});

describe(`RBAC API (${TEST_DB})`, () => {
  test('rbac.view reads, rbac.manage writes, others get nothing', async () => {
    expect((await as('reader').get('/roles')).status).toBe(200);
    expect((await as('reader').post('/roles', { name: 'x', permissions: [] })).status).toBe(403);
    expect((await as('u1').get('/roles')).status).toBe(403);
    expect((await as('u1').get('/users')).status).toBe(403);
    const session = await request(app.getHttpServer()).get('/admin/api/session').set('X-User', 'reader');
    expect(session.body.rbac).toEqual({ enabled: true, view: true, manage: false });
  });

  test('the catalog lists what roles can name', async () => {
    const catalog = (await as('reader').get('/catalog')).body;
    expect(catalog.operations).toEqual(['view', 'create', 'update', 'delete', 'purge']);
    expect(catalog.resources.find((resource: { name: string }) => resource.name === 'widget')).toMatchObject({ label: 'Widget', fields: expect.arrayContaining([{ name: 'price', label: 'Price', restricted: false }]) });
    expect(catalog.global).toEqual(['rbac.view', 'rbac.manage']);
  });

  test('role CRUD: validation, system roles refused, delete', async () => {
    const boss = as('boss');
    expect((await boss.post('/roles', { name: 'widget-editor', label: { en: 'Widget editor', fa: 'ویرایشگر' }, permissions: ['widget.update'], fields: { widget: { price: 'readonly' } } })).status).toBe(201);
    expect((await boss.get('/roles/widget-editor')).body).toMatchObject({ system: false, permissions: ['widget.update'], label: { en: 'Widget editor' } });
    expect((await boss.patch('/roles/widget-editor', { permissions: ['widget.update', 'widget.delete'] })).body.permissions).toEqual(['widget.update', 'widget.delete']);
    const invalid = await boss.post('/roles', { name: 'typo', permissions: ['widget.veiw'] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.fields.definition[0]).toContain('unknown permission "widget.veiw"');
    expect((await boss.patch('/roles/helper', { permissions: [] })).status).toBe(403); // system
    expect((await boss.delete('/roles/helper')).status).toBe(403);
    expect((await boss.post('/roles', { name: 'widget-editor', permissions: [] })).body.fields).toEqual({ name: ['is taken'] });
    expect((await boss.post('/roles', { name: 'short-lived', permissions: ['widget.view'] })).status).toBe(201);
    expect((await boss.delete('/roles/short-lived')).status).toBe(204);
    expect(await roleNames()).not.toContain('short-lived');
  });

  test('users: list with assignments, create, change, set a password; groups with roles and members', async () => {
    const boss = as('boss');
    const created = await boss.post('/users', { username: 'kim', displayName: 'Kim', password: 'kim-password-1', roles: ['widget-editor'] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ id: 'kim', roles: ['widget-editor'], groups: [] });
    const group = (await boss.post('/groups', { name: 'editors', roles: ['widget-editor'], members: ['u1'] })).body;
    expect(group).toMatchObject({ name: 'editors', roles: ['widget-editor'], members: ['u1'] });
    const list = (await boss.get('/users?search=u1')).body;
    expect(list).toMatchObject({ total: 1, capabilities: { list: true, create: true, update: true, password: true, resetTwoFactor: true } });
    expect(list.items[0]).toMatchObject({ id: 'u1', groups: [group.id], roles: [] });
    expect((await boss.patch('/users/kim', { displayName: 'Kim K.', groups: [group.id] })).body).toMatchObject({ displayName: 'Kim K.', groups: [group.id] });
    expect((await boss.post('/users/kim/password', { password: 'another-pass-1' })).status).toBe(204);
    expect(users.get('kim')!.password).toBe('another-pass-1');
    // The group's role works for u1 right away.
    expect((await request(app.getHttpServer()).get('/admin/api/meta/resources/widget').set('X-User', 'u1')).body.permissions.update).toBe(true);
  });

  test('export and import round-trip; import is all or nothing (Review Focus 4)', async () => {
    const exported = (await as('boss').get('/roles/export')).body;
    expect(exported.version).toBe(1);
    expect(exported.roles.map((role: { name: string }) => role.name)).toEqual(['widget-editor']);
    const refused = await as('boss').post('/roles/import', { roles: [{ name: 'fine', permissions: ['widget.view'] }, { name: 'typo', permissions: ['nope'] }] });
    expect(refused.status).toBe(422);
    expect(await roleNames()).not.toContain('fine');
    const imported = await as('boss').post('/roles/import', { roles: [...exported.roles, { name: 'fine', permissions: ['widget.view'] }] });
    expect(imported.body).toEqual({ imported: ['widget-editor', 'fine'] });
    expect(await roleNames()).toContain('fine');
    expect((await as('boss').post('/roles/import', { roles: [{ name: 'helper', permissions: [] }] })).status).toBe(403); // a system role
  });
});

describe(`anti-escalation over the API (${TEST_DB}, Review Focus 1)`, () => {
  const helper = as('helper'); // holds rbac.manage and widget.view only

  test('cannot create or change a role beyond what they hold', async () => {
    expect((await helper.post('/roles', { name: 'h-update', permissions: ['widget.update'] })).status).toBe(403);
    const star = await helper.post('/roles', { name: 'h-star', permissions: ['*'] });
    expect(star.status).toBe(403);
    expect(star.body.message).toContain('grants');
    expect((await helper.post('/roles', { name: 'h-view', permissions: ['widget.view'] })).status).toBe(201);
    expect((await helper.patch('/roles/h-view', { permissions: ['widget.view', 'widget.delete'] })).status).toBe(403);
    expect((await helper.patch('/roles/widget-editor', { permissions: ['widget.view'] })).status).toBe(403); // cannot even narrow a stronger role
    expect((await helper.delete('/roles/widget-editor')).status).toBe(403);
    expect((await helper.post('/roles/import', { roles: [{ name: 'h-ok', permissions: ['widget.view'] }, { name: 'h-bad', permissions: ['widget.purge'] }] })).status).toBe(403);
    expect(await roleNames()).not.toContain('h-ok');
  });

  test('cannot assign stronger roles, touch superusers, or grant themselves anything', async () => {
    expect((await helper.patch('/users/u1', { roles: ['widget-editor'] })).status).toBe(403);
    expect((await helper.patch('/users/u1', { roles: ['h-view'] })).status).toBe(200);
    expect((await helper.patch('/users/helper', { roles: ['h-view'] })).status).toBe(403);
    expect((await helper.patch('/users/root', { displayName: 'Hacked' })).status).toBe(403);
    expect((await helper.post('/users/root/password', { password: 'new-root-pass' })).status).toBe(403);
    expect((await helper.patch('/users/u1', { isSuperuser: true })).status).toBe(403);
    expect((await helper.post('/users', { username: 'evil', displayName: 'Evil', password: 'evil-password-1', isSuperuser: true })).status).toBe(403);
    expect(users.has('evil')).toBe(false);
    users.get('root')!.twoFactor = true;
    expect((await helper.post('/users/root/2fa/reset', {})).status).toBe(403);
    expect(users.get('root')!.twoFactor).toBe(true);
  });

  test('cannot build a group that gives more, nor join one', async () => {
    const groups = (await as('root').get('/groups')).body.items as Array<{ id: number; name: string }>;
    const editors = groups.find((group) => group.name === 'editors')!;
    expect((await helper.post('/groups', { name: 'sneaky', roles: ['widget-editor'] })).status).toBe(403);
    expect((await helper.patch(`/groups/${editors.id}`, { members: ['u1', 'reader'] })).status).toBe(403); // it holds widget-editor
    const own = (await helper.post('/groups', { name: 'viewers', roles: ['h-view'] })).body;
    expect((await helper.patch(`/groups/${own.id}`, { members: ['helper'] })).status).toBe(403);
    expect((await helper.patch(`/groups/${own.id}`, { members: ['u1'] })).status).toBe(200);
  });

  test('resetting a second factor needs rbac.manage', async () => {
    users.get('u1')!.twoFactor = true;
    expect((await as('reader').post('/users/u1/2fa/reset', {})).status).toBe(403);
    expect((await as('helper').post('/users/u1/2fa/reset', {})).status).toBe(204);
    expect(users.get('u1')!.twoFactor).toBe(false);
    expect((await as('boss').get('/users/u1')).body.twoFactor).toBe(false);
  });

  test('superusers may do all of it', async () => {
    expect((await as('root').patch('/users/u1', { roles: ['widget-editor'] })).status).toBe(200);
    expect((await as('root').post('/roles', { name: 'everything', permissions: ['*'] })).status).toBe(201);
  });
});
