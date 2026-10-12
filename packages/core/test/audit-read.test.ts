import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { Injectable, Logger, Module } from '@nestjs/common';
import { InjectDataSource, getDataSourceToken } from '@nestjs/typeorm';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, DeleteDateColumn, Entity, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, type DataSource, type SelectQueryBuilder } from 'typeorm';
import {
  ADMIN_AUDIT_ENTITIES,
  ADMIN_RBAC_ENTITIES,
  AdminAction,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  AdminSettingsPage,
  AdminUnauthenticatedError,
  NmaAuditEntry,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminModuleOptions,
  type AdminPrincipal,
  type AdminSettingsSource,
  type AdminUserRecord,
  type AuditEntry,
  type AuditEntryChange,
  type AuditResponse,
  type LoginInput,
  type RoleDefinition,
} from '../src/index.js';
import { AdminAudit } from '../src/audit/audit.service.js';
import { createTestApp } from './helpers/create-app.js';

/** Values some readers must never be shown: their answers are searched for them. */
const SALARY_1 = '711711.11';
const SALARY_2 = '722722.22';
const SALARY_OUT = '733733.33';
const NOTES_1 = 'NOTES-SENTINEL-one';
const NOTES_2 = 'NOTES-SENTINEL-two';
const PIN = 'PIN-SENTINEL-4471';
const OUTSIDE = 'OUTSIDE-SENTINEL Bob';
const GONE = 'GONE-SENTINEL Gil';
const VAULT = 'VAULT-SENTINEL-code';
const REASON = 'REASON-SENTINEL';
const SHOP = 'PAGE-SENTINEL Shop';
const ROLE_PERMISSION = 'vault.view';

@Entity('ar_customer')
class Customer {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ length: 10, default: 'u1' }) ownerId: string;
}

@Entity('ar_employee')
class Employee {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 }) salary: string;
  @Column({ type: 'varchar', length: 60, nullable: true }) notes: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) pin: string | null;
  @Column({ length: 10, default: 'u1' }) ownerId: string;
  @ManyToOne(() => Customer, { nullable: true }) customer: Customer | null;
}

@Entity('ar_vault')
class Vault {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) code: string;
}

@Entity('ar_doc')
class Doc {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) title: string;
  @DeleteDateColumn() deletedAt: Date | null;
}

@Entity('ar_setting')
class Setting {
  @PrimaryColumn({ length: 40 }) name: string;
  @Column({ type: 'text' }) value: string;
}

class RaiseDto {
  @IsInt() @Min(1) @Max(50) percent: number;
  @IsOptional() @IsString() reason?: string;
}

@AdminResource(Customer, { title: 'name' })
class CustomerAdmin extends AdminResourceBase<Customer> {
  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
}

@AdminResource(Employee, { title: 'name' })
class EmployeeAdmin extends AdminResourceBase<Employee> {
  fields = { notes: { restricted: true }, pin: { sensitive: true } };

  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }

  @AdminAction({ input: RaiseDto })
  async raise(employee: Employee, input: RaiseDto, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(employee.id, { salary: (Number(employee.salary) * (1 + input.percent / 100)).toFixed(2) });
  }
}

@AdminResource(Vault, { title: 'code' })
class VaultAdmin extends AdminResourceBase<Vault> {}

const CLOSED = 'CLOSED-SENTINEL paper';

@AdminResource(Doc, { title: 'title' })
class DocAdmin extends AdminResourceBase<Doc> {
  /** The host keeps some rows from everyone but `ada`, with no role or scope involved. */
  override query(qb: SelectQueryBuilder<Doc>, ctx: AdminContext): SelectQueryBuilder<Doc> {
    return ctx.user?.id === 'ada' ? qb : qb.andWhere(`${qb.alias}.title <> :closed`, { closed: CLOSED });
  }
}

class ShopDto {
  @IsString() @Length(2, 40) shopName: string;
}

@AdminSettingsPage('shop', { form: ShopDto })
class ShopPage implements AdminSettingsSource<ShopDto> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async load(ctx: AdminContext): Promise<Partial<ShopDto>> {
    const rows = await (ctx.manager ?? this.dataSource.manager).find(Setting);
    return Object.fromEntries(rows.map((row) => [row.name, JSON.parse(row.value)])) as Partial<ShopDto>;
  }
  async save(changes: Partial<ShopDto>, ctx: AdminContext): Promise<void> {
    const repo = (ctx.manager ?? this.dataSource.manager).getRepository(Setting);
    for (const [name, value] of Object.entries(changes)) await repo.save({ name, value: JSON.stringify(value) });
  }
}

const users = new Map<string, AdminUserRecord>();
for (const [id, isSuperuser] of [['ada', true], ['aud', false], ['u1', false], ['u2', false], ['r1', false], ['hana', false], ['max', false]] as const) {
  users.set(id, { id, displayName: `${id.toUpperCase()} Person`, username: id, isSuperuser, isActive: true });
}
const ROLES_OF: Record<string, string[]> = { aud: ['auditor'], u1: ['clerk'], u2: ['clerk'], r1: ['ranger'], hana: ['hr'], max: ['maker'] };
const ROLES: RoleDefinition[] = [
  // Review Focus 2: reads the audit page, and `salary` is hidden from them (`notes` is restricted: hidden unless granted).
  { name: 'auditor', permissions: ['audit.view', 'employee.view', 'customer.view', 'doc.view'], fields: { employee: { salary: 'hidden' } } },
  // No audit page; own rows only, no salary.
  { name: 'clerk', permissions: ['employee.view', 'employee.update', 'customer.view'], fields: { employee: { salary: 'hidden' } }, scopes: { employee: { view: 'own', update: 'own' }, customer: { view: 'own' } } },
  // Reads the audit page, own rows only.
  { name: 'ranger', permissions: ['audit.view', 'employee.view', 'employee.update'], scopes: { employee: { view: 'own', update: 'own' } } },
  // Sees every field, runs the action, sees the settings page and the roles.
  { name: 'hr', permissions: ['audit.view', 'employee.view', 'employee.update', 'employee.action.raise', 'employee.field.notes.view', 'page.shop', 'rbac.view'] },
  // Reaches `vault` (may create) without viewing it.
  { name: 'maker', permissions: ['audit.view', 'vault.create'] },
];

@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  async login(input: LoginInput): Promise<AdminPrincipal> {
    const user = users.get(input.username);
    if (!user || input.password !== `${input.username}-pass`) throw new AdminUnauthenticatedError('Wrong username or password');
    return { user };
  }
  resolveRoles(user: { id: string | number }) {
    return ROLES_OF[String(user.id)] ?? [];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [TestAuth, CustomerAdmin, EmployeeAdmin, VaultAdmin, DocAdmin, ShopPage] })
class ReadModule {}

const ENTITIES = [Customer, Employee, Vault, Doc, Setting];

async function boot(admin: Partial<AdminModuleOptions> = { audit: {} }, more: { entities?: Function[]; dataSources?: Record<string, Function[]> } = { entities: [...ADMIN_AUDIT_ENTITIES] }) {
  const app = await createTestApp({
    imports: [ReadModule],
    entities: [...ENTITIES, ...ADMIN_RBAC_ENTITIES, ...(more.entities ?? [])],
    dataSources: more.dataSources,
    admin: { auth: AdminAuth.custom(TestAuth), roles: ROLES, rbac: {}, ...admin },
  });
  const http = (user = 'ada', headers: Record<string, string> = {}) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set(headers),
    post: (path: string, body: object = {}) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', user).set(headers).send(body),
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/admin/api${path}`).set('X-User', user).set(headers).send(body),
    delete: (path: string) => request(app.getHttpServer()).delete(`/admin/api${path}`).set('X-User', user).set(headers),
  });
  const ok = async (pending: PromiseLike<{ status: number; body: Record<string, unknown> }>, status = 200): Promise<Record<string, unknown>> => {
    const res = await pending;
    if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const create = async (resource: string, values: object, user = 'ada'): Promise<string> => (await ok(http(user).post(`/resources/${resource}`, values), 201))._id as string;
  /** Every page of a listing, as `user`. */
  const pages = async (path: string, user: string, headers: Record<string, string> = {}): Promise<AuditEntry[]> => {
    const all: AuditEntry[] = [];
    let before: string | undefined;
    for (let guard = 0; guard < 200; guard++) {
      const res = await http(user, headers).get(`${path}${path.includes('?') ? '&' : '?'}${before ? `before=${before}` : ''}`);
      if (res.status !== 200) throw new Error(`${path} as ${user}: ${res.status} ${JSON.stringify(res.body)}`);
      const body = res.body as AuditResponse;
      all.push(...body.entries);
      if (!body.next) return all;
      before = body.next;
    }
    throw new Error('the listing never ends');
  };
  const auditDb = app.get<DataSource>(getDataSourceToken(admin.audit?.dataSource) as string, { strict: false });
  return { app, http, ok, create, pages, auditDb, audit: app.get(AdminAudit) };
}

const change = (entry: AuditEntry | undefined, field: string): AuditEntryChange | undefined => entry?.changes?.find((item) => item.field === field);
const byEvent = (entries: AuditEntry[], event: string) => entries.filter((entry) => entry.event === event);

describe('audit log: reading', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  let acme: number;
  let globex: number;
  /** Alice: u1's, with a salary, notes and a pin. */
  let alice: string;
  /** Bob: u2's (outside u1's and r1's scopes). */
  let bob: string;
  /** Rhea: r1's at first, handed to u2 after r1 changed her. */
  let rhea: string;
  /** Created and deleted for good. */
  let gone: string;
  /** 61 entries. */
  let busy: string;
  let vault: string;
  let doc: string;
  let seeded: Date;

  beforeAll(async () => {
    t = await boot();
    const db = t.app.get<DataSource>(getDataSourceToken() as string, { strict: false });
    [acme, globex] = (await db.getRepository(Customer).save([{ name: 'Acme', ownerId: 'u1' }, { name: 'Globex', ownerId: 'u2' }])).map((row) => row.id) as [number, number];

    alice = await t.create('employee', { name: 'Alice', salary: SALARY_1, notes: NOTES_1, pin: PIN, ownerId: 'u1', customer: acme });
    await t.ok(t.http().patch(`/resources/employee/${alice}`, { salary: SALARY_2, notes: NOTES_2, pin: `${PIN}-2`, customer: globex }));
    await t.ok(t.http('u1').patch(`/resources/employee/${alice}`, { name: 'Alice B' }));
    await t.ok(t.http('hana').post('/resources/employee/actions/raise', { ids: [alice], input: { percent: 7, reason: REASON } }));

    bob = await t.create('employee', { name: OUTSIDE, salary: SALARY_OUT, ownerId: 'u2', customer: globex });
    rhea = await t.create('employee', { name: 'Rhea', salary: '100.00', ownerId: 'r1' });
    await t.ok(t.http('r1').patch(`/resources/employee/${rhea}`, { name: 'Rhea R' }));
    await t.ok(t.http().patch(`/resources/employee/${rhea}`, { ownerId: 'u2' }));

    gone = await t.create('employee', { name: GONE, salary: '5.00', ownerId: 'u1' });
    expect((await t.http().delete(`/resources/employee/${gone}`)).status).toBe(204);

    busy = await t.create('employee', { name: 'Busy 0', ownerId: 'u1' });
    for (let i = 1; i <= 60; i++) await t.ok(t.http().patch(`/resources/employee/${busy}`, { name: `Busy ${i}` }));

    vault = await t.create('vault', { code: VAULT });
    await t.ok(t.http().patch(`/resources/vault/${vault}`, { code: `${VAULT}-2` }));
    doc = await t.create('doc', { title: 'Paper' });

    await t.ok(t.http().patch('/pages/shop', { shopName: SHOP }));
    await t.ok(t.http().post('/rbac/roles', { name: 'temp', label: 'Temp', permissions: [ROLE_PERMISSION] }), 201);
    expect((await request(t.app.getHttpServer()).post('/admin/api/session').set('User-Agent', 'TestBrowser/1.0').send({ username: 'ada', password: 'ada-pass' })).status).toBe(200);
    await t.audit.idle();
    seeded = new Date();
  });
  afterAll(async () => {
    await t.app.close();
  });

  test('history: 50 a page, newest first, paged by `before`', async () => {
    const first = (await t.ok(t.http().get(`/resources/employee/${busy}/history`))) as unknown as AuditResponse;
    expect(first.entries).toHaveLength(50);
    expect(typeof first.next).toBe('string');
    const ids = first.entries.map((entry) => Number(entry.id));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    expect(first.entries.every((entry) => typeof entry.id === 'string')).toBe(true);
    expect(first.next).toBe(first.entries.at(-1)!.id);
    expect(change(first.entries[0], 'name')).toEqual({ field: 'name', before: 'Busy 59', after: 'Busy 60' });

    const second = (await t.ok(t.http().get(`/resources/employee/${busy}/history?before=${first.next}`))) as unknown as AuditResponse;
    expect(second.entries).toHaveLength(11);
    expect(second.next).toBeUndefined();
    expect(second.entries.at(-1)!.event).toBe('employee.created');
    expect(Math.max(...second.entries.map((entry) => Number(entry.id)))).toBeLessThan(Math.min(...ids));
    // Exactly one page: no `next` pointing at nothing.
    const exact = (await t.ok(t.http().get(`/resources/employee/${busy}/history?before=${first.entries[10]!.id}`))) as unknown as AuditResponse;
    expect(exact.entries).toHaveLength(50);
    expect(exact.next).toBeUndefined();
  });

  test('an entry as it is served', async () => {
    const entries = await t.pages(`/resources/employee/${alice}/history`, 'ada');
    expect(entries.map((entry) => entry.event)).toEqual(['employee.action.raise', 'employee.updated', 'employee.updated', 'employee.created']);
    const created = entries[3]!;
    expect(Object.keys(created).sort()).toEqual(['actor', 'at', 'changes', 'correlationId', 'event', 'id', 'recordId', 'recordTitle', 'resource']);
    expect(created).toMatchObject({ event: 'employee.created', actor: { id: 'ada', name: 'ADA Person' }, resource: 'employee', recordId: alice, recordTitle: 'Alice' });
    expect(new Date(created.at).toISOString()).toBe(created.at);
    expect(Math.abs(Date.parse(created.at) - Date.now())).toBeLessThan(600_000);
    expect(change(created, 'salary')).toEqual({ field: 'salary', after: SALARY_1 });
    expect(entries[1]!.actor).toEqual({ id: 'u1', name: 'U1 Person' });
    // A sensitive field has no values in the table: nobody is shown any, a superuser included.
    expect(change(created, 'pin')).toEqual({ field: 'pin', changed: true });
    expect(change(entries[2], 'pin')).toEqual({ field: 'pin', changed: true });
  });

  test('Review Focus 2: `audit.view` with `salary` hidden shows `{ field, hidden: true }` on the History tab and the audit page', async () => {
    const history = await t.pages(`/resources/employee/${alice}/history`, 'aud');
    const page = (await t.pages('/audit?resource=employee', 'aud')).filter((entry) => entry.recordId === alice);
    for (const entries of [history, page]) {
      expect(entries.map((entry) => entry.event)).toEqual(['employee.action.raise', 'employee.updated', 'employee.updated', 'employee.created']);
      const [raised, , updated, created] = entries;
      expect(change(created, 'salary')).toEqual({ field: 'salary', hidden: true });
      expect(change(updated, 'salary')).toEqual({ field: 'salary', hidden: true });
      expect(change(raised, 'salary')).toEqual({ field: 'salary', hidden: true });
      // Restricted, and not granted to this role.
      expect(change(created, 'notes')).toEqual({ field: 'notes', hidden: true });
      expect(change(updated, 'notes')).toEqual({ field: 'notes', hidden: true });
      // What they can see on the record, they see here.
      expect(change(created, 'name')).toEqual({ field: 'name', after: 'Alice' });
      expect(created).toMatchObject({ recordId: alice, recordTitle: 'Alice' });
      expect(JSON.stringify(entries)).not.toContain(SALARY_1);
      expect(JSON.stringify(entries)).not.toContain(NOTES_2);
    }
    // The role that is granted both sees both.
    const full = await t.pages(`/resources/employee/${alice}/history`, 'hana');
    expect(change(full[2], 'salary')).toEqual({ field: 'salary', before: SALARY_1, after: SALARY_2 });
    expect(change(full[2], 'notes')).toEqual({ field: 'notes', before: NOTES_1, after: NOTES_2 });
  });

  test('a field that is no longer in the schema is hidden from everyone but a superuser', async () => {
    const id = await t.create('employee', { name: 'Legacy', ownerId: 'u1' });
    await t.audit.record({ event: 'employee.updated', entry: { schema: { name: 'employee' } } as never, recordId: id, title: 'Legacy', changes: [{ field: 'badgeNo', before: 'OLD-SENTINEL-1', after: 'OLD-SENTINEL-2' }] }, { correlationId: 'legacy', user: users.get('ada')! });
    for (const reader of ['aud', 'hana', 'u1']) {
      const [entry] = await t.pages(`/resources/employee/${id}/history`, reader);
      expect(entry!.changes).toEqual([{ field: 'badgeNo', hidden: true }]);
    }
    const [entry] = await t.pages(`/resources/employee/${id}/history`, 'ada');
    expect(entry!.changes).toEqual([{ field: 'badgeNo', before: 'OLD-SENTINEL-1', after: 'OLD-SENTINEL-2' }]);
  });

  test('Review Focus 3: history of a record outside the reader’s scopes is the 404 of GET, even for entries they wrote', async () => {
    // r1 changed Rhea while she was theirs; she is u2's now.
    const all = await t.pages(`/resources/employee/${rhea}/history`, 'ada');
    expect(all.some((entry) => entry.actor?.id === 'r1')).toBe(true);
    const got = await t.http('r1').get(`/resources/employee/${rhea}`);
    const history = await t.http('r1').get(`/resources/employee/${rhea}/history`);
    expect(got.status).toBe(404);
    expect(history.status).toBe(404);
    expect(history.body).toMatchObject({ code: got.body.code, message: got.body.message });
    // Never theirs.
    expect((await t.http('u1').get(`/resources/employee/${bob}/history`)).status).toBe(404);
    // The same answer as for a record that does not exist.
    const missing = await t.http('r1').get('/resources/employee/999999/history');
    expect(missing.status).toBe(404);
    expect(String(missing.body.message).replace('999999', rhea)).toBe(history.body.message);
    // And the audit page tells them only that they did something to an employee.
    const own = (await t.pages('/audit?actor=r1', 'r1')).filter((entry) => entry.event === 'employee.updated');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ event: 'employee.updated', resource: 'employee', restricted: true, actor: { id: 'r1' } });
    expect(own[0]!.recordId).toBeUndefined();
    expect(own[0]!.recordTitle).toBeUndefined();
    expect(own[0]!.changes).toBeUndefined();
  });

  test('history asks for what GET asks for: no `audit.view`, but the resource, the record and a signed-in user', async () => {
    // A clerk has no audit page and still reads the history of their own record, with their own field rules.
    const entries = await t.pages(`/resources/employee/${alice}/history`, 'u1');
    expect(entries).toHaveLength(4);
    expect(change(entries[3], 'salary')).toEqual({ field: 'salary', hidden: true });
    expect((await t.http('u1').get('/audit')).status).toBe(403);
    // Unknown and unreachable resources answer alike.
    const unknown = await t.http('u1').get('/resources/nothing/1/history');
    const unreachable = await t.http('u1').get(`/resources/vault/${vault}/history`);
    expect(unknown.status).toBe(404);
    expect(unreachable.status).toBe(404);
    expect(String(unreachable.body.message)).toBe(String(unknown.body.message).replace('nothing', 'vault'));
    // Reached but not viewable: the 403 of GET.
    expect((await t.http('max').get(`/resources/vault/${vault}`)).status).toBe(403);
    expect((await t.http('max').get(`/resources/vault/${vault}/history`)).status).toBe(403);
    expect((await request(t.app.getHttpServer()).get(`/admin/api/resources/employee/${alice}/history`)).status).toBe(401);
    expect((await request(t.app.getHttpServer()).get('/admin/api/audit')).status).toBe(401);
    // A record in the trash is not found by GET, so neither is its history.
    expect((await t.http().get(`/resources/doc/${doc}/history`)).status).toBe(200);
    expect((await t.http().delete(`/resources/doc/${doc}`)).status).toBe(204);
    expect((await t.http().get(`/resources/doc/${doc}`)).status).toBe(404);
    expect((await t.http().get(`/resources/doc/${doc}/history`)).status).toBe(404);
    // The audit page still lists it for whoever may view the resource.
    expect((await t.pages(`/audit?resource=doc&record=${doc}`, 'aud')).map((entry) => entry.event)).toEqual(['doc.deleted', 'doc.created']);
    // Bad paging is a 422, never a 500.
    for (const bad of ['before=abc', 'before=-1', 'before=1&before=2', 'page=2', 'before=1.5', `before=${'9'.repeat(40)}`]) {
      expect((await t.http().get(`/resources/employee/${alice}/history?${bad}`)).status).toBe(422);
    }
  });

  test('where the request came from is shown with `audit.view` only', async () => {
    const id = await t.create('employee', { name: 'Traced', ownerId: 'u1' });
    await t.audit.record({ event: 'employee.updated', entry: { schema: { name: 'employee' } } as never, recordId: id, changes: [], meta: { ip: '203.0.113.7', userAgent: 'AGENT-SENTINEL/1' } }, { correlationId: 'traced', user: users.get('ada')! });
    const [clerk] = await t.pages(`/resources/employee/${id}/history`, 'u1');
    expect(clerk!.meta).toBeUndefined();
    const [auditor] = await t.pages(`/resources/employee/${id}/history`, 'aud');
    expect(auditor!.meta).toEqual({ ip: '203.0.113.7', userAgent: 'AGENT-SENTINEL/1' });
    const login = byEvent(await t.pages('/audit?event=auth.login', 'aud'), 'auth.login')[0]!;
    expect(login).toMatchObject({ actor: { id: 'ada', name: 'ADA Person' }, meta: { userAgent: 'TestBrowser/1.0' } });
    expect(typeof login.meta!.ip).toBe('string');
    expect(login.resource).toBeUndefined();
  });

  test('an action’s input is shown to whoever holds the action', async () => {
    for (const path of [`/resources/employee/${alice}/history`, `/audit?event=employee.action.raise`]) {
      const holder = byEvent(await t.pages(path, 'hana'), 'employee.action.raise')[0]!;
      expect(holder.meta).toEqual({ action: 'raise', input: { percent: 7, reason: REASON } });
      const other = byEvent(await t.pages(path, 'aud'), 'employee.action.raise')[0]!;
      expect(other.meta).toEqual({ action: 'raise' });
      expect(other).toMatchObject({ recordId: alice, actor: { id: 'hana' } });
    }
    const clerk = byEvent(await t.pages(`/resources/employee/${alice}/history`, 'u1'), 'employee.action.raise')[0]!;
    expect(clerk.meta).toEqual({ action: 'raise' });
  });

  test('`/api/audit` needs `audit.view`', async () => {
    for (const user of ['u1', 'u2']) {
      const res = await t.http(user).get('/audit');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    const res = await t.http('aud').get('/audit');
    expect(res.status).toBe(200);
    expect((res.body as AuditResponse).entries).toHaveLength(50);
    expect(typeof (res.body as AuditResponse).next).toBe('string');
    // Every page, newest first, each entry once.
    const all = await t.pages('/audit', 'ada');
    const ids = all.map((entry) => Number(entry.id));
    expect(ids).toEqual([...new Set(ids)].sort((a, b) => b - a));
    expect(all.length).toBe(await t.auditDb.getRepository(NmaAuditEntry).count());
  });

  test('filters: actor, event, resource, record and dates', async () => {
    const all = await t.pages('/audit', 'ada');
    const expectSame = async (query: string, wanted: (entry: AuditEntry) => boolean) => {
      const found = await t.pages(`/audit?${query}`, 'ada');
      expect(found.map((entry) => entry.id)).toEqual(all.filter(wanted).map((entry) => entry.id));
      return found;
    };
    expect((await expectSame('actor=u1', (entry) => entry.actor?.id === 'u1')).length).toBe(1);
    expect((await expectSame('actor=hana', (entry) => entry.actor?.id === 'hana')).length).toBe(1);
    expect((await expectSame('event=employee.updated', (entry) => entry.event === 'employee.updated')).length).toBeGreaterThan(60);
    // `.*` at the end matches by prefix; anything else is the whole name.
    expect((await expectSame('event=employee.*', (entry) => entry.event.startsWith('employee.'))).some((entry) => entry.event === 'employee.action.raise')).toBe(true);
    expect((await expectSame('event=rbac.*', (entry) => entry.event.startsWith('rbac.'))).length).toBe(1);
    await expectSame('event=employee', () => false);
    await expectSame('event=employee.', () => false);
    // `%` and `_` are text.
    await expectSame('event=employee_updated', () => false);
    await expectSame('event=%25.*', () => false);
    expect((await expectSame('resource=vault', (entry) => entry.resource === 'vault')).length).toBe(2);
    expect((await expectSame(`resource=employee&record=${alice}`, (entry) => entry.resource === 'employee' && entry.recordId === alice)).length).toBe(4);
    // Without a resource, `record` names a role, a group or a user.
    expect((await expectSame('record=temp', (entry) => entry.resource === undefined && entry.recordId === 'temp')).map((entry) => entry.event)).toEqual(['rbac.role.changed']);
    await expectSame(`record=${alice}`, () => false);
    expect((await expectSame(`actor=ada&event=employee.updated&resource=employee&record=${alice}`, (entry) => entry.actor?.id === 'ada' && entry.event === 'employee.updated' && entry.recordId === alice)).length).toBe(1);

    // Dates: three entries with their own times, on whatever clock the database keeps.
    const repo = t.auditDb.getRepository(NmaAuditEntry);
    const at = ['2031-03-04T23:59:59.000Z', '2031-03-05T00:00:00.000Z', '2031-03-05T12:30:00.000Z', '2031-03-06T00:00:00.000Z'];
    for (const time of at) await repo.insert({ at: new Date(time), actorId: 'clock', actorName: null, viewAsBy: null, event: 'auth.login', resource: null, recordId: null, recordTitle: null, changes: null, meta: null, correlationId: time } as never);
    const times = async (query: string) => (await t.pages(`/audit?actor=clock&${query}`, 'ada')).map((entry) => entry.at).reverse();
    expect(await times('')).toEqual(at);
    // A day is the whole day, in UTC.
    expect(await times('from=2031-03-05&to=2031-03-05')).toEqual([at[1]!, at[2]!]);
    expect(await times('from=2031-03-05')).toEqual([at[1]!, at[2]!, at[3]!]);
    expect(await times('to=2031-03-04')).toEqual([at[0]!]);
    // A time is that instant, both ends included; a zone is honoured, and none means UTC.
    expect(await times('from=2031-03-05T00:00:00Z&to=2031-03-05T12:30:00Z')).toEqual([at[1]!, at[2]!]);
    expect(await times('from=2031-03-05T12:30:00.001Z')).toEqual([at[3]!]);
    expect(await times(`from=${encodeURIComponent('2031-03-05T03:30:00+03:30')}&to=2031-03-05T12:29:59`)).toEqual([at[1]!]);
    expect(await times('from=2031-03-07')).toEqual([]);
    // Nothing recorded by the seeding is in the future.
    expect((await t.pages(`/audit?to=${seeded.toISOString()}&from=2020-01-01`, 'ada')).length).toBeGreaterThan(70);
    await repo.delete({ actorId: 'clock' });
  });

  test('a filter value nothing matches is an empty answer; a malformed one is a 422, never a 500', async () => {
    for (const query of ['actor=nobody', 'event=no.such.event', 'resource=nothing', 'record=nothing', 'resource=employee&record=abc', 'resource=employee&record=999999', `actor=${'x'.repeat(250)}`, 'actor=%27%3B--', 'event=%25']) {
      const res = await t.http().get(`/audit?${query}`);
      expect([query, res.status, res.body]).toEqual([query, 200, { entries: [] }]);
    }
    for (const query of ['from=yesterday', 'to=2031-02-31', 'from=2031-13-01', 'from=0000-01-01', 'to=99999-01-01', 'before=x', 'before=0x10', 'actor=a&actor=b', 'nope=1', 'actor=%00', `event=${'e'.repeat(400)}`, 'from=2031-03-05T25:00:00Z', 'from=2031-03-05T10', 'to=2031-3-5']) {
      const res = await t.http().get(`/audit?${query}`);
      expect([query, res.status, res.body.code]).toEqual([query, 422, 'VALIDATION']);
    }
    // An empty parameter is one that was not sent.
    const plain = (await t.http().get('/audit')).body as AuditResponse;
    expect(((await t.http().get('/audit?actor=&event=&resource=&record=&from=&to=&before=')).body as AuditResponse).entries.map((entry) => entry.id)).toEqual(plain.entries.map((entry) => entry.id));
    // An id beyond a 32-bit key is "before" nothing more than the newest entry.
    expect(((await t.http().get('/audit?before=999999999999999')).body as AuditResponse).entries.map((entry) => entry.id)).toEqual(plain.entries.map((entry) => entry.id));
    expect((await t.http().get(`/audit?before=${plain.entries.at(-1)!.id}&actor=nobody`)).body).toEqual({ entries: [] });
    // A record id no key can hold, asked by a reader whose scope must be checked in the database.
    expect((await t.http('r1').get('/audit?resource=employee&record=99999999999')).body).toEqual({ entries: [] });
  });

  test('entries of a resource the reader cannot reach say only that something happened', async () => {
    const all = await t.pages('/audit', 'aud');
    const full = await t.pages('/audit', 'ada');
    // Nothing is left out, so the listing itself tells no more than its length did.
    expect(all.map((entry) => entry.id)).toEqual(full.map((entry) => entry.id));
    const vaultIds = new Set(full.filter((entry) => entry.resource === 'vault').map((entry) => entry.id));
    expect(vaultIds.size).toBe(2);
    const seen = all.filter((entry) => vaultIds.has(entry.id));
    expect(seen.map((entry) => entry.event)).toEqual(['*.updated', '*.created']);
    for (const entry of seen) {
      expect(Object.keys(entry).sort()).toEqual(['actor', 'at', 'correlationId', 'event', 'id', 'restricted']);
      expect(entry).toMatchObject({ restricted: true, actor: { id: 'ada', name: 'ADA Person' } });
    }
    expect(JSON.stringify(all)).not.toContain('vault');
    expect(JSON.stringify(all)).not.toContain(VAULT);
    // No filter finds them by what the reader is not shown.
    // (MySQL compares names without case: another spelling must not get through either.)
    for (const query of ['resource=vault', 'resource=VAULT', 'event=vault.updated', 'event=VAULT.updated', 'event=vault.*', `resource=vault&record=${vault}`, `record=${vault}`, 'event=*.updated']) {
      expect((await t.http('aud').get(`/audit?${query}`)).body).toEqual({ entries: [] });
    }
    // Reached (may create) but not viewable: the name, and nothing of the records.
    const maker = (await t.pages('/audit?resource=vault', 'max'));
    expect(maker.map((entry) => entry.event)).toEqual(['vault.updated', 'vault.created']);
    for (const entry of maker) {
      expect(Object.keys(entry).sort()).toEqual(['actor', 'at', 'correlationId', 'event', 'id', 'resource', 'restricted']);
      expect(entry).toMatchObject({ resource: 'vault', restricted: true });
    }
    expect((await t.http('max').get(`/audit?resource=vault&record=${vault}`)).body).toEqual({ entries: [] });
    // The same reader has no reach to `employee`.
    expect((await t.http('max').get('/audit?resource=employee')).body).toEqual({ entries: [] });
    expect(JSON.stringify(await t.pages('/audit', 'max'))).not.toContain('employee');
  });

  test('entries of a record outside the reader’s scopes are treated the same, inside a resource they can view', async () => {
    const full = await t.pages('/audit?resource=employee', 'ada');
    const seen = await t.pages('/audit?resource=employee', 'r1');
    expect(seen.map((entry) => entry.id)).toEqual(full.map((entry) => entry.id));
    // r1 owns no employee any more: every record entry is outside.
    for (const entry of seen) {
      expect(Object.keys(entry).filter((key) => key !== 'meta').sort()).toEqual(['actor', 'at', 'correlationId', 'event', 'id', 'resource', 'restricted']);
      expect(entry.meta?.input).toBeUndefined();
    }
    expect(JSON.stringify(seen)).not.toContain(OUTSIDE);
    expect(JSON.stringify(seen)).not.toContain(SALARY_OUT);
    for (const id of [bob, rhea, gone, '999999']) expect((await t.http('r1').get(`/audit?resource=employee&record=${id}`)).body).toEqual({ entries: [] });

    // One of their own shows in full, and the others stay closed.
    const mine = await t.create('employee', { name: 'Mine', salary: '300.00', ownerId: 'r1' });
    const again = await t.pages('/audit?resource=employee', 'r1');
    const open = again.filter((entry) => entry.restricted !== true);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ event: 'employee.created', recordId: mine, recordTitle: 'Mine' });
    expect(change(open[0], 'salary')).toEqual({ field: 'salary', after: '300.00' });
    expect(change(open[0], 'notes')).toBeUndefined();
    expect((await t.pages(`/audit?resource=employee&record=${mine}`, 'r1')).map((entry) => entry.event)).toEqual(['employee.created']);
  });

  test('a record deleted for good: shown to a reader no scope restricts, closed to one whose scope can no longer be checked', async () => {
    const auditor = await t.pages(`/audit?resource=employee&record=${gone}`, 'aud');
    expect(auditor.map((entry) => entry.event)).toEqual(['employee.deleted', 'employee.created']);
    expect(auditor[0]).toMatchObject({ recordId: gone, recordTitle: GONE });
    expect(change(auditor[0], 'name')).toEqual({ field: 'name', before: GONE });
    expect(change(auditor[0], 'salary')).toEqual({ field: 'salary', hidden: true });
    const ranger = (await t.pages('/audit?event=employee.deleted', 'r1'));
    expect(ranger).toHaveLength(1);
    expect(ranger[0]).toMatchObject({ restricted: true, resource: 'employee' });
    expect(JSON.stringify(ranger)).not.toContain(GONE);
    expect((await t.http().get(`/resources/employee/${gone}/history`)).status).toBe(404);
  });

  test('a record the resource’s `query()` keeps from the reader is closed to them like one out of scope', async () => {
    const closed = await t.create('doc', { title: CLOSED });
    const open = await t.create('doc', { title: 'Open paper' });
    expect((await t.http('aud').get(`/resources/doc/${closed}`)).status).toBe(404);
    expect((await t.http('aud').get(`/resources/doc/${closed}/history`)).status).toBe(404);
    expect((await t.http('aud').get(`/resources/doc/${open}/history`)).status).toBe(200);
    expect((await t.pages(`/resources/doc/${closed}/history`, 'ada')).map((entry) => entry.recordTitle)).toEqual([CLOSED]);
    const seen = (await t.pages('/audit?resource=doc', 'aud')).filter((entry) => entry.event === 'doc.created').slice(0, 2);
    expect(seen[0]).toMatchObject({ recordId: open, recordTitle: 'Open paper' });
    expect(Object.keys(seen[1]!).sort()).toEqual(['actor', 'at', 'correlationId', 'event', 'id', 'resource', 'restricted']);
    expect((await t.http('aud').get(`/audit?resource=doc&record=${closed}`)).body).toEqual({ entries: [] });
    expect(JSON.stringify(await t.pages('/audit', 'aud'))).not.toContain(CLOSED);
    // Deleted for good, `query()` has no row left to decide on: the entries stay closed, to `ada` as well.
    expect((await t.http().delete(`/resources/doc/${open}?purge=true`)).status).toBe(204);
    for (const reader of ['aud', 'ada']) {
      const [purged] = await t.pages('/audit?event=doc.purged', reader);
      expect([reader, purged!.restricted, purged!.recordId, purged!.changes]).toEqual([reader, true, undefined, undefined]);
    }
  });

  test('a related record is shown as the id the record itself shows', async () => {
    // u1 cannot view Globex (u2's customer): the record shows its id with a masked title, the history the same id.
    const record = await t.ok(t.http('u1').get(`/resources/employee/${alice}`));
    expect(record.customer).toEqual({ id: globex, title: `#${globex}` });
    const entries = await t.pages(`/resources/employee/${alice}/history`, 'u1');
    expect(change(entries[2], 'customer')).toEqual({ field: 'customer', before: acme, after: globex });
    expect(JSON.stringify(entries)).not.toContain('Globex');
  });

  test('a settings page’s changes need the page; role and user changes need `rbac.view`', async () => {
    const pageOf = async (user: string) => byEvent(await t.pages('/audit?event=page.shop.updated', user), 'page.shop.updated')[0]!;
    expect(await pageOf('hana')).toMatchObject({ event: 'page.shop.updated', meta: { page: 'shop' }, changes: [{ field: 'shopName', after: SHOP }] });
    const closed = await pageOf('aud');
    expect(closed).toMatchObject({ event: 'page.shop.updated', restricted: true, actor: { id: 'ada' } });
    expect(closed.changes).toBeUndefined();

    const roleOf = async (user: string) => byEvent(await t.pages('/audit?event=rbac.*', user), 'rbac.role.changed')[0]!;
    const open = await roleOf('hana');
    expect(open).toMatchObject({ recordId: 'temp' });
    expect(change(open, 'permissions')).toEqual({ field: 'permissions', after: [ROLE_PERMISSION] });
    const shut = await roleOf('aud');
    expect(shut).toMatchObject({ event: 'rbac.role.changed', recordId: 'temp', restricted: true });
    expect(shut.changes).toBeUndefined();
    expect(JSON.stringify(await t.pages('/audit', 'aud'))).not.toContain(ROLE_PERMISSION);
  });

  test('view-as reads history and the audit page with the viewed user’s permissions, never the superuser’s', async () => {
    const quiet = spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const asClerk = { 'X-View-As': 'u1' };
      const history = await t.pages(`/resources/employee/${alice}/history`, 'ada', asClerk);
      expect(history).toHaveLength(4);
      expect(change(history[3], 'salary')).toEqual({ field: 'salary', hidden: true });
      expect(JSON.stringify(history)).not.toContain(SALARY_1);
      expect((await t.http('ada', asClerk).get(`/resources/employee/${bob}/history`)).status).toBe(404);
      // The clerk has no `audit.view`: the superuser's own does not get through.
      expect((await t.http('ada', asClerk).get('/audit')).status).toBe(403);
      const asAuditor = await t.pages('/audit', 'ada', { 'X-View-As': 'aud' });
      expect(JSON.stringify(asAuditor)).not.toContain(SALARY_1);
      expect(JSON.stringify(asAuditor)).not.toContain(VAULT);
      expect(asAuditor.map((entry) => entry.id)).toEqual((await t.pages('/audit', 'aud')).map((entry) => entry.id));
    } finally {
      quiet.mockRestore();
    }
  });

  test('sentinel: nothing a reader may not see is anywhere in any page of history or of the audit page', async () => {
    // What each reader must never be shown.
    const closed: Record<string, string[]> = {
      aud: [SALARY_1, SALARY_2, SALARY_OUT, NOTES_1, NOTES_2, VAULT, 'vault', SHOP, ROLE_PERMISSION, REASON, 'OLD-SENTINEL'],
      r1: [NOTES_1, NOTES_2, OUTSIDE, SALARY_OUT, GONE, 'Alice', SALARY_1, VAULT, 'vault', SHOP, ROLE_PERMISSION, REASON, 'OLD-SENTINEL'],
      max: [SALARY_1, SALARY_2, SALARY_OUT, NOTES_1, NOTES_2, OUTSIDE, GONE, 'Alice', 'employee', VAULT, SHOP, ROLE_PERMISSION, REASON, 'OLD-SENTINEL'],
      u1: [SALARY_1, SALARY_2, SALARY_OUT, NOTES_1, NOTES_2, OUTSIDE, VAULT, 'AGENT-SENTINEL', 'OLD-SENTINEL', 'Globex'],
      u2: [SALARY_1, SALARY_2, SALARY_OUT, NOTES_1, NOTES_2, VAULT, 'Acme', GONE],
    };
    const everyone = [PIN];
    const employees = ((await t.ok(t.http().get('/resources/employee?pageSize=100'))).items as Array<{ _id: string }>).map((item) => item._id);
    expect(employees.length).toBeGreaterThan(5);
    for (const reader of ['ada', 'hana', ...Object.keys(closed)]) {
      const texts: string[] = [];
      for (const id of [...employees, gone]) {
        const res = await t.http(reader).get(`/resources/employee/${id}/history`);
        const got = await t.http(reader).get(`/resources/employee/${id}`);
        // History answers exactly when the record does.
        expect([reader, id, res.status]).toEqual([reader, id, got.status]);
        // (An error only echoes the request.)
        if (res.status === 200) texts.push(JSON.stringify(await t.pages(`/resources/employee/${id}/history`, reader)));
      }
      const audit = await t.http(reader).get('/audit');
      if (audit.status === 200) {
        texts.push(JSON.stringify(await t.pages('/audit', reader)));
        for (const query of ['resource=employee', 'resource=vault', 'event=employee.*', 'event=vault.*', `resource=employee&record=${bob}`, `resource=employee&record=${alice}`, 'actor=ada', 'from=2020-01-01']) {
          texts.push(JSON.stringify(await t.pages(`/audit?${query}`, reader)));
        }
      }
      const text = texts.join('\n');
      for (const secret of [...everyone, ...(closed[reader] ?? [])]) expect([reader, secret, text.includes(secret)]).toEqual([reader, secret, false]);
    }
    // The values are there for whoever may see them: the search above is not vacuous.
    const open = JSON.stringify(await t.pages('/audit', 'ada'));
    for (const secret of [SALARY_1, SALARY_2, SALARY_OUT, NOTES_1, NOTES_2, OUTSIDE, GONE, VAULT, SHOP, ROLE_PERMISSION, REASON]) expect([secret, open.includes(secret)]).toEqual([secret, true]);
  });
});

describe('audit log: retention', () => {
  const DAY = 86_400_000;
  const row = (at: Date, correlationId: string) => ({ at, actorId: 'ada', actorName: null, viewAsBy: null, event: 'auth.login', resource: null, recordId: null, recordTitle: null, changes: null, meta: null, correlationId });

  test('the sweep deletes entries older than `retentionDays`, in batches, and keeps the newer ones', async () => {
    const t = await boot({ audit: { retentionDays: 30 } });
    try {
      const repo = t.auditDb.getRepository(NmaAuditEntry);
      const now = Date.now();
      // 2,300 old ones (three batches), one a minute past the limit, and three inside it.
      const old = Array.from({ length: 2300 }, (_item, index) => row(new Date(now - 31 * DAY - index * 1000), `old-${index}`));
      for (let i = 0; i < old.length; i += 100) await repo.insert(old.slice(i, i + 100) as never);
      await repo.insert([row(new Date(now - 30 * DAY - 60_000), 'just-over'), row(new Date(now - 30 * DAY + 60_000), 'just-inside'), row(new Date(now - DAY), 'yesterday'), row(new Date(now), 'now')] as never);
      expect(await repo.count()).toBe(2304);
      expect(await t.audit.sweep(now)).toBe(2301);
      expect((await repo.find()).map((entry) => entry.correlationId).sort()).toEqual(['just-inside', 'now', 'yesterday']);
      // Nothing left to delete.
      expect(await t.audit.sweep(now)).toBe(0);
      // An entry exactly at the limit stays; a later clock takes the rest.
      expect(await t.audit.sweep(now + 30 * DAY)).toBe(2);
      expect(await t.audit.sweep(now + 30 * DAY + 1)).toBe(1);
      expect(await repo.count()).toBe(0);
    } finally {
      await t.app.close();
    }
  });

  test('without `retentionDays` nothing is ever deleted, and no timer is armed', async () => {
    const t = await boot({ audit: {} });
    try {
      const repo = t.auditDb.getRepository(NmaAuditEntry);
      await repo.insert(row(new Date(Date.now() - 4000 * DAY), 'ancient') as never);
      expect(await t.audit.sweep()).toBe(0);
      expect(await repo.count()).toBe(1);
      expect(t.audit.retentionArmed).toBe(false);
    } finally {
      await t.app.close();
    }
  });

  test('the timer is armed with `retentionDays`, never throws, and is cleared when the app closes', async () => {
    const t = await boot({ audit: { retentionDays: 1 } });
    const warned = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      expect(t.audit.retentionArmed).toBe(true);
      const repo = t.auditDb.getRepository(NmaAuditEntry);
      await repo.insert(row(new Date(Date.now() - 3 * DAY), 'old') as never);
      // What the timer runs: it deletes…
      await t.audit.sweepQuietly();
      expect(await repo.count()).toBe(0);
      // …and a failure is logged, not thrown.
      const broken = spyOn(t.auditDb, 'getRepository').mockImplementation(() => {
        throw new Error('the database is away');
      });
      try {
        await expect(t.audit.sweepQuietly()).resolves.toBeUndefined();
      } finally {
        broken.mockRestore();
      }
      expect(warned.mock.calls.flat().join('\n')).toContain('audit: the retention sweep failed (the database is away)');
    } finally {
      warned.mockRestore();
      await t.app.close();
    }
    expect(t.audit.retentionArmed).toBe(false);
  });

  test('`retentionDays` must be a positive whole number', async () => {
    for (const days of [0, -1, 1.5, Number.NaN, '30' as unknown as number]) {
      await expect(boot({ audit: { retentionDays: days } })).rejects.toThrow(/audit\.retentionDays must be a positive whole number of days/);
    }
  });
});

describe('audit log: reading, elsewhere', () => {
  test('without `audit` both routes answer 404', async () => {
    // `audit.view` is no code without the audit log, so no role may name it.
    const t = await boot({ roles: ROLES.map((role) => ({ ...role, permissions: role.permissions.filter((code) => code !== 'audit.view') })) }, { entities: [] });
    try {
      const id = await t.create('employee', { name: 'Quiet', ownerId: 'u1' });
      expect((await t.http().get(`/resources/employee/${id}`)).status).toBe(200);
      for (const path of [`/resources/employee/${id}/history`, '/audit', '/audit?resource=employee']) {
        const res = await t.http().get(path);
        expect([path, res.status, res.body.code]).toEqual([path, 404, 'NOT_FOUND']);
      }
    } finally {
      await t.app.close();
    }
  });

  test('the audit table on another DataSource is read from there', async () => {
    const t = await boot({ audit: { dataSource: 'audit' } }, { dataSources: { audit: [...ADMIN_AUDIT_ENTITIES] } });
    try {
      const id = await t.create('employee', { name: 'Far', salary: SALARY_1, ownerId: 'u1' });
      await t.ok(t.http('u1').patch(`/resources/employee/${id}`, { name: 'Farther' }));
      const history = await t.pages(`/resources/employee/${id}/history`, 'u1');
      expect(history.map((entry) => entry.event)).toEqual(['employee.updated', 'employee.created']);
      expect(change(history[1], 'salary')).toEqual({ field: 'salary', hidden: true });
      const outside = await t.create('employee', { name: OUTSIDE, ownerId: 'u2' });
      const page = await t.pages('/audit?resource=employee', 'r1');
      expect(page).toHaveLength(3);
      expect(page.every((entry) => entry.restricted === true && entry.recordId === undefined)).toBe(true);
      expect((await t.http('u1').get(`/resources/employee/${outside}/history`)).status).toBe(404);
    } finally {
      await t.app.close();
    }
  });
});
