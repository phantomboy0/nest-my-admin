import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import type { DataSource } from 'typeorm';
import { ADMIN_RBAC_ENTITIES, AdminAuth, NmaRole, type AdminAuthAdapter, type AdminPrincipal, type AdminUser } from '../src/index.js';
import { EffectivePermissions } from '../src/policy/effective.js';
import { AdminRbac, type RbacManager } from '../src/rbac/rbac.service.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

const USERS: Record<string, AdminUser> = {
  root: { id: 'root', displayName: 'Root', isSuperuser: true },
  u1: { id: 'u1', displayName: 'One', isSuperuser: false },
  u2: { id: 'u2', displayName: 'Two', isSuperuser: false },
};

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = USERS[String(req.headers['x-user'] ?? '')];
    return user ? { user } : null;
  }
}

@Module({ providers: [HeaderAuth] })
class AuthModule {}

let app: INestApplication;
let rbac: AdminRbac;
let dataSource: DataSource;
const root: RbacManager = { userId: 'root', permissions: new EffectivePermissions([], true) };
const as = (user: string) => ({
  get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user),
  patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/admin/api${path}`).set('X-User', user).send(body),
});

beforeAll(async () => {
  app = await createTestApp({
    imports: [AuthModule],
    entities: ADMIN_RBAC_ENTITIES,
    admin: { auth: AdminAuth.custom(HeaderAuth), rbac: {}, roles: [{ name: 'widget-viewer', label: 'Widget viewer', permissions: ['widget.view'] }] },
  });
  rbac = app.get(AdminRbac);
  dataSource = app.get(getDataSourceToken());
});
afterAll(async () => {
  await app.close();
});

describe(`stored roles (${TEST_DB})`, () => {
  test('code roles are stored as system roles at boot, and code wins (Review Focus 3)', async () => {
    const row = await dataSource.getRepository(NmaRole).findOneByOrFail({ name: 'widget-viewer' });
    expect(row).toMatchObject({ system: true, label: 'Widget viewer', definition: { permissions: ['widget.view'] } });
    await dataSource.getRepository(NmaRole).update({ name: 'widget-viewer' }, { definition: { permissions: ['*'] } });
    rbac.invalidate();
    expect((await rbac.roles()).get('widget-viewer')!.permissions).toEqual(['widget.view']); // the stored copy never counts
    await expect(rbac.saveRole({ name: 'widget-viewer', permissions: ['widget.*'] }, root, 'update', 'widget-viewer')).rejects.toThrow('system role');
  });

  test('a code role that went away becomes an ordinary stored role', async () => {
    await dataSource.getRepository(NmaRole).save({ name: 'retired', label: null, description: null, system: true, definition: { permissions: ['widget.view'] } });
    await (rbac as unknown as { syncSystemRoles(): Promise<void> }).syncSystemRoles();
    expect((await dataSource.getRepository(NmaRole).findOneByOrFail({ name: 'retired' })).system).toBe(false);
  });

  test('a stored role that no longer validates grants nothing and is still listed', async () => {
    await dataSource.getRepository(NmaRole).save({ name: 'broken', label: null, description: null, system: false, definition: { permissions: ['gadget.view'] } });
    rbac.invalidate();
    expect((await rbac.roles()).has('broken')).toBe(false);
    expect((await rbac.listRoles()).map((role) => role.name)).toContain('broken');
  });
});

describe(`effective roles (${TEST_DB})`, () => {
  test('direct roles, group roles and their union; changes apply on the next request (Review Focus 2)', async () => {
    expect((await as('u1').get('/resources/widget')).status).toBe(404);
    await rbac.saveRole({ name: 'widget-editor', permissions: ['widget.update'] }, root, 'create');
    await rbac.setUserAssignments('u1', { roles: ['widget-editor'] }, root, { isSuperuser: false });
    expect((await as('u1').get('/resources/widget')).status).toBe(200);

    const group = await rbac.saveGroup({ name: 'viewers', roles: ['widget-viewer'], members: ['u2'] }, root);
    expect(group).toMatchObject({ name: 'viewers', roles: ['widget-viewer'], members: ['u2'] });
    expect((await as('u2').get('/resources/widget')).status).toBe(200);
    expect((await as('u2').get('/meta/resources/widget')).body.permissions.update).toBe(false);

    // Through the group and directly: the union.
    await rbac.saveGroup({ members: ['u1', 'u2'] }, root, group.id);
    expect((await as('u1').get('/meta/resources/widget')).body.permissions).toMatchObject({ update: true });

    await rbac.setUserAssignments('u1', { roles: [], groups: [] }, root, { isSuperuser: false });
    expect((await as('u1').get('/resources/widget')).status).toBe(404);
    await rbac.deleteGroup(group.id, root);
    expect((await as('u2').get('/resources/widget')).status).toBe(404);
  });

  test('deleting a role takes it away from everyone', async () => {
    await rbac.saveRole({ name: 'temp', permissions: ['widget.view'] }, root, 'create');
    await rbac.setUserAssignments('u2', { roles: ['temp'] }, root, { isSuperuser: false });
    expect((await as('u2').get('/resources/widget')).status).toBe(200);
    await rbac.deleteRole('temp', root);
    expect((await as('u2').get('/resources/widget')).status).toBe(404);
    expect((await rbac.userAssignments('u2')).roles).toEqual([]);
  });

  test('stored roles are validated like code roles', async () => {
    await expect(rbac.saveRole({ name: 'bad', permissions: ['widget.veiw'] }, root, 'create')).rejects.toThrow('unknown permission "widget.veiw"');
    await expect(rbac.saveRole({ name: 'has space', permissions: [] }, root, 'create')).rejects.toThrow('Validation failed');
  });
});

describe('rbac boot', () => {
  test('rbac without its entities does not boot', async () => {
    await expect(createTestApp({ admin: { rbac: {} } })).rejects.toThrow('add ADMIN_RBAC_ENTITIES to the entities of the DataSource "default"');
  });
});
