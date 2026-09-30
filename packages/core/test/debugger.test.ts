import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminCan,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminPrincipal,
  type AdminUserRecord,
  type FieldsConfig,
  type ListConfig,
  type RoleDefinition,
} from '../src/index.js';
import type { PermissionExplanation } from '../src/contract.js';
import { EffectivePermissions } from '../src/policy/effective.js';
import { AdminRbac } from '../src/rbac/rbac.service.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('dbg_task')
class Task {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ length: 10 }) ownerId: string;
  @Column({ type: 'simple-enum', enum: ['open', 'done'], default: 'open' }) status: 'open' | 'done';
  @Column({ type: 'int', default: 0 }) hours: number;
  @Column({ length: 40, default: '' }) note: string;
}

@AdminResource(Task, { title: 'name' })
class TaskAdmin extends AdminResourceBase<Task> {
  list: ListConfig<Task> = { columns: ['id', 'name', 'status', 'hours', 'note'] };
  fields: FieldsConfig<Task> = { hours: { restricted: true } };

  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
  @AdminScope('open') open() {
    return { status: 'open' };
  }
  @AdminCan('delete') onlyOpen(task: Task) {
    return task.status === 'open';
  }
}

const ROLE_POOL: RoleDefinition[] = [
  { name: 'reader', permissions: ['task.view'], fields: { task: { note: 'hidden' } } },
  { name: 'owner', permissions: ['task.create', 'task.update'], fields: { task: { status: 'readonly' } }, scopes: { task: { view: 'own', update: 'own' } } },
  { name: 'hours', permissions: ['task.view', 'task.field.hours.view'] },
  { name: 'cleaner', permissions: ['task.view', 'task.delete'], scopes: { task: { delete: 'open' } } },
  { name: 'opener', permissions: ['task.update'], scopes: { task: { view: 'open', update: ['open'] } } },
  { name: 'all', permissions: ['task.*'] },
];

const users = new Map<string, AdminUserRecord>();
for (const [id, isSuperuser] of [['root', true], ['boss', false], ['u1', false], ['u2', false], ['nobody', false]] as const) {
  users.set(id, { id, displayName: id.toUpperCase(), username: id, isSuperuser, isActive: true });
}
const rolesOf: Record<string, string[]> = { boss: ['rbac-view'] };
const signedOut: string[] = [];

@Injectable()
class MemoryAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return rolesOf[String(user.id)] ?? [];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
  async logout(principal: AdminPrincipal) {
    signedOut.push(String(principal.user.id));
  }
}

@Module({ providers: [MemoryAuth, TaskAdmin] })
class DebugModule {}

let app: INestApplication;
const api = (user: string, headers: Record<string, string> = {}) => {
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: object) => {
    const req = request(app.getHttpServer())[method](`/admin/api${path}`).set('X-User', user).set(headers);
    return body ? req.send(body) : req;
  };
  return {
    get: (path: string) => call('get', path),
    post: (path: string, body: object) => call('post', path, body),
    patch: (path: string, body: object) => call('patch', path, body),
    delete: (path: string) => call('delete', path),
  };
};
const tasks: Array<{ _id: string; ownerId: string; status: string }> = [];

beforeAll(async () => {
  app = await createTestApp({
    imports: [DebugModule],
    entities: [Task, ...ADMIN_RBAC_ENTITIES],
    admin: { auth: AdminAuth.custom(MemoryAuth), rbac: {}, roles: [...ROLE_POOL, { name: 'rbac-view', permissions: ['rbac.view'] }, { name: 'no-id', permissions: ['task.view'], fields: { task: { id: 'hidden' } } }] },
  });
  for (const task of [
    { name: 'A', ownerId: 'u1', status: 'open', hours: 3, note: 'n1' },
    { name: 'B', ownerId: 'u2', status: 'done', hours: 5, note: 'n2' },
    { name: 'C', ownerId: 'u1', status: 'done', hours: 8, note: 'n3' },
    { name: 'D', ownerId: 'u2', status: 'open', hours: 1, note: 'n4' },
  ]) {
    const created = await api('root').post('/resources/task', task);
    expect(created.status).toBe(201);
    tasks.push(created.body);
  }
});
afterAll(async () => {
  await app.close();
});

const explain = async (user: string, record?: string): Promise<PermissionExplanation> => {
  const res = await api('boss').get(`/rbac/explain?user=${user}&resource=task${record ? `&record=${encodeURIComponent(record)}` : ''}`);
  expect(res.status).toBe(200);
  return res.body;
};

/** A small deterministic PRNG, so a failure names a reproducible combination. */
function* combinations(seed: number, count: number): Generator<string[]> {
  let state = seed;
  const next = () => ((state = (state * 1103515245 + 12345) % 2 ** 31), state / 2 ** 31);
  for (let i = 0; i < count; i++) yield ROLE_POOL.filter(() => next() < 0.4).map((role) => role.name);
}

describe(`permission debugger (${TEST_DB})`, () => {
  test('needs rbac.view and names the user and resource', async () => {
    expect((await api('u1').get('/rbac/explain?user=u2&resource=task')).status).toBe(403);
    expect((await api('boss').get('/rbac/explain?resource=task')).body.fields).toEqual({ user: ['is required'] });
    expect((await api('boss').get('/rbac/explain?user=ghost&resource=task')).status).toBe(404);
    expect((await api('boss').get('/rbac/explain?user=u1&resource=nope')).status).toBe(404);
  });

  test('explains where roles come from and what grants each operation, field and scope', async () => {
    rolesOf.u1 = ['reader', 'owner', 'missing-role'];
    const rbac = app.get(AdminRbac);
    const root = { userId: 'root', permissions: new EffectivePermissions([], true) };
    await rbac.setUserAssignments('u1', { roles: ['hours'] }, root, { isSuperuser: false });
    await rbac.saveGroup({ name: 'cleaners', roles: ['cleaner', 'reader'], members: ['u1'] }, root);
    const result = await explain('u1', tasks[1]!._id);
    expect(result.user).toMatchObject({ id: 'u1', displayName: 'U1' });
    const byName = Object.fromEntries(result.roles.map((role) => [role.name, role]));
    expect(byName.reader!.sources).toEqual([{ kind: 'adapter' }, { kind: 'group', group: 'cleaners' }]);
    expect(byName.hours!.sources).toEqual([{ kind: 'direct' }]);
    expect(byName['missing-role']).toMatchObject({ known: false });
    const view = result.operations.find((operation) => operation.operation === 'view')!;
    expect(view.allowed).toBe(true);
    expect(view.grantedBy).toContainEqual({ role: 'owner', pattern: 'task.update', via: 'update' });
    expect(result.operations.find((operation) => operation.operation === 'purge')).toEqual({ operation: 'purge', allowed: false, grantedBy: [] });
    const hours = result.fields.find((field) => field.name === 'hours')!;
    expect(hours).toMatchObject({ restricted: true, level: 'view' });
    expect(hours.byRole).toContainEqual({ role: 'hours', level: 'view', code: 'task.field.hours.view' });
    expect(hours.byRole).toContainEqual({ role: 'reader', level: 'hidden' });
    expect(result.scopes.find((scope) => scope.operation === 'delete')).toMatchObject({ result: ['open'], byRole: [{ role: 'cleaner', scopes: ['open'] }] });
    // B: someone else's, done. Viewable (reader has no scope), not updatable (owner: own only), not deletable (scope open).
    expect(result.record).toMatchObject({ exists: true, view: true, update: false, delete: false, reasons: { update: 'scope', delete: 'scope' } });
    await rbac.setUserAssignments('u1', { roles: [], groups: [] }, root, { isSuperuser: false });
  });

  test('records: missing, and @AdminCan as the reason', async () => {
    rolesOf.u1 = ['all'];
    expect((await explain('u1', '99999')).record).toMatchObject({ exists: false, view: false, reasons: { view: 'missing' } });
    expect((await explain('u1', tasks[2]!._id)).record).toMatchObject({ view: true, update: true, delete: false, reasons: { delete: 'rule' } });
    expect((await explain('root')).superuser).toBe(true);
    rolesOf.u2 = ['no-id'];
    expect((await explain('u2')).fields.find((field) => field.name === 'id')).toMatchObject({ level: 'view', forced: true, byRole: [{ role: 'no-id', level: 'hidden', rule: 'hidden' }] });
    delete rolesOf.u2;
  });

  test('its answers are what the API enforces, for random role combinations (Review Focus 1)', async () => {
    for (const combo of combinations(20260930, 24)) {
      rolesOf.u1 = combo;
      const label = `roles [${combo.join(', ')}]`;
      const result = await explain('u1');
      const allowed = Object.fromEntries(result.operations.map((operation) => [operation.operation, operation.allowed]));
      const schemaRes = await api('u1').get('/meta/resources/task');
      if (!allowed.view && !allowed.create) {
        expect(schemaRes.status, label).toBe(404);
        continue;
      }
      const schema = schemaRes.body;
      expect(schema.permissions, label).toEqual({ create: allowed.create, update: allowed.update, delete: allowed.delete, purge: allowed.purge });
      const visible = result.fields.filter((field) => field.level !== 'hidden').map((field) => field.name).sort();
      expect(schema.fields.map((field: { name: string }) => field.name).sort(), label).toEqual(visible);
      const editable = result.fields.filter((field) => field.level === 'edit').map((field) => field.name);
      if (allowed.update) expect([...schema.form.update].sort(), label).toEqual(schema.form.update.filter((name: string) => editable.includes(name)).sort());
      else expect(schema.form.update, label).toEqual([]);
      if (!allowed.view) continue;
      const list = (await api('u1').get('/resources/task?pageSize=100')).body.items as Array<{ _id: string; _perm?: { update: boolean; delete: boolean } }>;
      for (const task of tasks) {
        const record = (await explain('u1', task._id)).record!;
        const listed = list.find((item) => item._id === task._id);
        expect(Boolean(listed), `${label} view ${task._id}`).toBe(record.view);
        const got = await api('u1').get(`/resources/task/${task._id}`);
        expect(got.status, `${label} get ${task._id}`).toBe(record.view ? 200 : 404);
        if (record.view) expect(got.body._perm ?? { update: true, delete: true }, `${label} _perm ${task._id}`).toEqual({ update: record.update, delete: record.delete });
      }
    }
  });
});

describe(`view-as (${TEST_DB}, Review Focus 2)`, () => {
  const asU1 = () => api('root', { 'X-View-As': 'u1' });

  test('superusers only; the target must exist', async () => {
    rolesOf.u1 = ['owner', 'hours'];
    expect((await api('u2', { 'X-View-As': 'u1' }).get('/meta')).status).toBe(403);
    expect((await api('root', { 'X-View-As': 'ghost' }).get('/meta')).status).toBe(404);
  });

  test('reads exactly what the target reads', async () => {
    for (const path of ['/meta', '/meta/resources/task', '/resources/task?pageSize=100', `/resources/task/${tasks[0]!._id}`, `/resources/task/${tasks[1]!._id}`, '/search?q=A']) {
      const direct = await api('u1').get(path);
      const through = await asU1().get(path);
      expect(through.status, path).toBe(direct.status);
      expect(through.body, path).toEqual({ ...direct.body, ...(direct.body.correlationId ? { correlationId: through.body.correlationId } : {}) });
    }
    const session = (await asU1().get('/session')).body;
    expect(session.user.id).toBe('u1');
    expect(session.viewAs).toEqual({ by: { id: 'root', displayName: 'ROOT', username: 'root', isSuperuser: true } });
    expect((await api('root').get('/session')).body.viewAs).toBeUndefined();
  });

  test('is read-only; the account is closed; signing out signs out the superuser', async () => {
    const own = tasks[0]!._id;
    for (const res of [
      await asU1().post('/resources/task', { name: 'X', ownerId: 'u1' }),
      await asU1().patch(`/resources/task/${own}`, { name: 'X' }),
      await asU1().delete(`/resources/task/${own}`),
      await asU1().post('/resources/task/bulk-delete', { ids: [own] }),
      await asU1().post('/rbac/roles', { name: 'x', permissions: [] }),
      await asU1().get('/account/sessions'),
    ]) {
      expect(res.status).toBe(403);
    }
    expect((await api('u1').patch(`/resources/task/${own}`, { name: 'A' })).status).toBe(200); // the target itself may
    expect((await asU1().delete('/session')).status).toBe(204);
    expect(signedOut).toEqual(['root']);
  });
});
