import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { Injectable, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { fileURLToPath } from 'node:url';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { IsOptional, IsString } from 'class-validator';
import {
  ADMIN_AUDIT_ENTITIES,
  AdminAction,
  AdminForbiddenError,
  AdminModule,
  AdminNotFoundError,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  AdminSettingsPage,
  type ActionOutcome,
  type AdminContext,
  type AdminSettingsSource,
  type AuditEntry,
  type FieldsConfig,
  type FormConfig,
  type ListConfig,
  type ListParams,
} from '@nest-my-admin/core';
import { AdminApiService, AdminPolicy, AuditReader, createAdminContext, runInAdminContext } from '@nest-my-admin/core/internal';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { TEST_DB, testDatabase, type TestDatabase } from '../../core/test/helpers/test-db.js';
import { AdminLeakError, createAdminTestingModule, type AdminTesting } from '../src/index.js';

const UI = fileURLToPath(new URL('../../core/test/fixtures/ui-dist', import.meta.url));

@Entity('tst_project')
class Project {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ length: 10 }) ownerId: string;
  @Column({ length: 40, default: '' }) secret: string;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: '0.00' }) budget: string;
}

@Entity('tst_task')
class Task {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ type: 'int', nullable: true }) projectId: number | null;
  @ManyToOne(() => Project, { nullable: true, eager: true }) @JoinColumn({ name: 'projectId' }) project: Project | null;
  @Column({ length: 40, default: '' }) code: string;
}

@Injectable()
@AdminResource(Project, { title: 'name' })
class ProjectAdmin extends AdminResourceBase<Project> {
  list: ListConfig<Project> = { columns: ['id', 'name', 'ownerId', 'secret', 'budget'], search: ['name', 'secret'], filters: ['ownerId'] };
  fields: FieldsConfig<Project> = { budget: { restricted: true } };
  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
}

/** A title made of a field the role hides: a real mistake the crawler must catch. */
@Injectable()
@AdminResource(Project, { name: 'leaky-project', title: (project: Project) => `${project.name} (${project.secret})` })
class LeakyProjectAdmin extends AdminResourceBase<Project> {}

@Injectable()
@AdminResource(Task, { title: 'name' })
class TaskAdmin extends AdminResourceBase<Task> {
  list: ListConfig<Task> = { columns: ['id', 'name', 'projectId'] };
}

/** Its title reads the (eager) project, whatever the user's scopes on projects say. */
@Injectable()
@AdminResource(Task, { name: 'leaky-task', title: (task: Task) => `${task.name} @ ${task.project?.name ?? '-'}` })
class LeakyTaskAdmin extends AdminResourceBase<Task> {
  override async findMany(params: ListParams) {
    const items = await this.repository.find({ take: params.pageSize, order: { id: 'ASC' } }); // loads the eager project
    return { items, total: items.length };
  }
}

/** Tasks titled with a field the `coder` role hides, listed inline under a project board. */
@Injectable()
@AdminResource(Task, { name: 'coded-task', title: (task: Task) => `${task.name} [${task.code}]` })
class CodedTaskAdmin extends AdminResourceBase<Task> {}

@Injectable()
@AdminResource(Project, { name: 'board', title: 'name' })
class BoardAdmin extends AdminResourceBase<Project> {
  override form: FormConfig = { layout: [{ fields: ['name'] }, { inline: CodedTaskAdmin, link: 'projectId' }] };
}

@Entity('tst_parcel')
class Parcel {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ length: 12, default: 'new' }) state: string;
  @Column({ type: 'varchar', length: 40, nullable: true }) tracking: string | null;
}

class ShipDto {
  @IsString() tracking: string;
}

@Injectable()
@AdminResource(Parcel, { title: 'name' })
class ParcelAdmin extends AdminResourceBase<Parcel> {
  @AdminAction({ bulk: true, input: ShipDto })
  async ship(parcel: Parcel, input: ShipDto, ctx: AdminContext): Promise<ActionOutcome> {
    await this.repositoryFor(ctx).update(parcel.id, { state: 'shipped', tracking: input.tracking });
    return { message: 'Shipped' };
  }

  @AdminAction({ variant: 'destructive' })
  async cancel(parcel: Parcel, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(parcel.id, { state: 'cancelled' });
  }

  @AdminAction({ target: 'resource' })
  async recount(_input: unknown, ctx: AdminContext): Promise<ActionOutcome> {
    return { message: `Counted ${await this.repositoryFor(ctx).count()}` };
  }
}

class ShopDto {
  @IsOptional() @IsString() shopName?: string;
  @IsOptional() @IsString() apiKey?: string | null;
}

const shop: Record<string, unknown> = { shopName: 'Corner shop' };

@Injectable()
@AdminSettingsPage('shop', { form: ShopDto, fields: { apiKey: { secret: true } } })
class ShopPage implements AdminSettingsSource<ShopDto> {
  async load(): Promise<Partial<ShopDto>> {
    return { ...shop };
  }
  async save(changes: Partial<ShopDto>): Promise<void> {
    Object.assign(shop, changes);
  }
}

@Module({ providers: [ProjectAdmin, LeakyProjectAdmin, TaskAdmin, LeakyTaskAdmin, CodedTaskAdmin, BoardAdmin, ParcelAdmin, ShopPage] })
class AppModule {}

let db: TestDatabase;
let admin: AdminTesting;

beforeAll(async () => {
  db = await testDatabase([Project, Task, Parcel, ...ADMIN_AUDIT_ENTITIES]);
  admin = await createAdminTestingModule({
    imports: [
      TypeOrmModule.forRoot({ ...db.options, retryAttempts: 0 }),
      AdminModule.forRoot({
        uiDistPath: UI,
        audit: {},
        roles: [
          { name: 'auditor', permissions: ['audit.view', 'project.view'], fields: { project: { secret: 'hidden' } }, scopes: { project: { view: 'own' } } },
          { name: 'member', permissions: ['project.view', 'project.create', 'project.update', 'task.view'], fields: { project: { secret: 'hidden' } }, scopes: { project: { view: 'own', update: 'own' } } },
          { name: 'nosy', permissions: ['project.view', 'leaky-task.view'], scopes: { project: { view: 'own' } } },
          { name: 'leaky', permissions: ['leaky-project.view'], fields: { 'leaky-project': { secret: 'hidden' } } },
          { name: 'editor', permissions: ['parcel.view', 'parcel.update', 'parcel.action.ship', 'page.shop', 'page.shop.update'] },
          { name: 'viewer', permissions: ['parcel.view', 'page.shop'] },
          { name: 'coder', permissions: ['coded-task.view', 'board.view'], fields: { 'coded-task': { code: 'hidden' } } },
        ],
        resolveRoles: (user) => (user.attrs?.roles as string[] | undefined) ?? [],
      }),
      AppModule,
    ],
  });
  const root = admin.superuser;
  const apollo = await root.create('project', { name: 'Apollo', ownerId: 'u1', secret: 'TOPSECRET-1', budget: '98765.43' });
  const borealis = await root.create('project', { name: 'Borealis', ownerId: 'u2', secret: 'TOPSECRET-2', budget: '11111.11' });
  await root.create('task', { name: 'Launch', projectId: apollo.id, code: 'CODE-LAUNCH' });
  await root.create('task', { name: 'Survey', projectId: borealis.id });
});
afterAll(async () => {
  await admin?.close();
  await db?.drop();
});

describe(`@nest-my-admin/testing (${TEST_DB})`, () => {
  test('as(): the same checks as HTTP requests, without signing in', async () => {
    const member = admin.as({ id: 'u1', roles: ['member'] });
    const list = await member.list('project', { sort: 'name' });
    expect(list.items.map((item) => item.name)).toEqual(['Apollo']);
    expect(list.items[0]).not.toHaveProperty('secret');
    expect(list.items[0]).not.toHaveProperty('budget');
    const others = (await admin.superuser.list('project', { filter: { ownerId: { eq: 'u2' } } })).items;
    expect(others.map((item) => item.name)).toEqual(['Borealis']);
    await expect(member.get('project', String(others[0]!._id))).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(member.update('project', String(others[0]!._id), { name: 'Mine now' })).rejects.toBeInstanceOf(AdminNotFoundError);
    const created = await member.create('project', { name: 'Cassini', ownerId: 'u1' });
    expect((await member.update('project', String(created._id), { name: 'Cassini 2' })).name).toBe('Cassini 2');
    await expect(member.update('project', String(created._id), { secret: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN_FIELDS' });
    await expect(member.delete('project', String(created._id))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await member.can('project.update')).toBe(true);
    expect(await member.can('project.delete')).toBe(false);
    expect((await member.schema('project')).permissions).toEqual({ create: true, update: true, delete: false, purge: false });
    await admin.superuser.delete('project', String(created._id));
  });

  test('without roles, the admin resolves them as for a request; unknown roles are an error', async () => {
    const viaResolver = admin.as({ id: 'u1', attrs: { roles: ['member'] } });
    expect((await viaResolver.list('project')).items).toHaveLength(1);
    await expect(admin.as({ id: 'u1' }).meta()).resolves.toMatchObject({ groups: [] });
    await expect(admin.as({ id: 'u1', roles: ['membr'] }).meta()).rejects.toThrow('"membr" is not a role');
  });

  test('runAction(): the editor may ship but not cancel', async () => {
    const editor = admin.as({ id: 'e1', roles: ['editor'] });
    const make = async (name: string) => {
      const created = await admin.superuser.create('parcel', { name });
      return { id: created.id as number, _id: String(created._id) };
    };
    const one = await make('One');
    const two = await make('Two');
    expect((await editor.schema('parcel')).actions.map((action) => action.name)).toEqual(['ship']);

    const shipped = await editor.runAction('parcel', 'ship', { ids: [one.id], input: { tracking: 'TRK-1' } });
    expect(shipped).toMatchObject({ message: 'Shipped', record: { state: 'shipped', tracking: 'TRK-1' } });
    await expect(editor.runAction('parcel', 'ship', { ids: [one._id], input: {} })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await editor.runAction('parcel', 'ship', { ids: [one._id, two._id], input: { tracking: 'TRK-2' } })).toEqual({ ok: [one._id, two._id], failed: [], message: 'Shipped' });

    await expect(editor.runAction('parcel', 'cancel', { ids: [one._id] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(editor.runAction('parcel', 'recount')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await admin.superuser.get('parcel', one._id)).state).toBe('shipped');
    expect(await admin.superuser.runAction('parcel', 'recount')).toEqual({ message: 'Counted 2' });
    expect(await admin.superuser.runAction('parcel', 'cancel', { ids: [one._id] })).toMatchObject({ record: { state: 'cancelled' } });
    // A viewer holds no action, and someone without the resource does not learn it exists.
    await expect(admin.as({ id: 'v1', roles: ['viewer'] }).runAction('parcel', 'ship', { ids: [two._id], input: { tracking: 'X' } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(admin.as({ id: 'u1', roles: ['member'] }).runAction('parcel', 'ship', { ids: [two._id], input: { tracking: 'X' } })).rejects.toBeInstanceOf(AdminNotFoundError);
  });

  test('page() and savePage(): the viewer reads the settings and cannot save them', async () => {
    const viewer = admin.as({ id: 'v1', roles: ['viewer'] });
    const editor = admin.as({ id: 'e1', roles: ['editor'] });
    const seen = await viewer.page('shop');
    expect(seen).toMatchObject({ values: { shopName: 'Corner shop' }, secrets: { apiKey: false } });
    expect(seen.schema.readonly).toBe(true);
    await expect(viewer.savePage('shop', { shopName: 'Mine' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(shop.shopName).toBe('Corner shop');

    const saved = await editor.savePage('shop', { shopName: 'Main street', apiKey: 'sk_test_12345678' });
    expect(saved).toMatchObject({ values: { shopName: 'Main street' }, secrets: { apiKey: true } });
    expect(saved.values).not.toHaveProperty('apiKey');
    expect((await editor.page('shop')).schema.readonly).toBe(false);
    expect((await editor.savePage('shop', { apiKey: null })).secrets).toEqual({ apiKey: false });
    await expect(admin.as({ id: 'u1', roles: ['member'] }).page('shop')).rejects.toBeInstanceOf(AdminNotFoundError);
  });

  test('view-as is read-only for callers that are not HTTP: no action runs, no page is saved', async () => {
    const parcel = { _id: String((await admin.superuser.create('parcel', { name: 'Watched' }))._id) };
    const api = admin.app.get(AdminApiService, { strict: false });
    const request = new IncomingMessage(new Socket());
    request.method = 'POST';
    request.url = '/';
    const ctx = createAdminContext(request);
    ctx.user = { id: 'e1', displayName: 'Editor', isSuperuser: false };
    ctx.permissions = await admin.app.get(AdminPolicy, { strict: false }).forUser({ id: 'root', displayName: 'Root', isSuperuser: true });
    ctx.viewAs = { by: { id: 'root', displayName: 'Root', isSuperuser: true } };

    const refusal = { code: 'FORBIDDEN', message: 'Viewing as another user is read-only' };
    await expect(runInAdminContext(ctx, () => api.runAction('parcel', 'ship', { ids: [parcel._id], input: { tracking: 'TRK-9' } }, ctx))).rejects.toMatchObject(refusal);
    await expect(runInAdminContext(ctx, () => api.runAction('parcel', 'recount', {}, ctx))).rejects.toMatchObject(refusal);
    await expect(runInAdminContext(ctx, () => api.savePage('shop', { shopName: 'Hijacked' }, ctx))).rejects.toMatchObject(refusal);
    expect((await admin.superuser.get('parcel', parcel._id)).state).toBe('new');
    expect(shop.shopName).not.toBe('Hijacked');
    delete ctx.viewAs;
    expect(await runInAdminContext(ctx, () => api.runAction('parcel', 'recount', {}, ctx))).toMatchObject({ message: expect.stringContaining('Counted') });
  });

  test('expectNoLeaks passes when nothing leaks', async () => {
    const report = await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['member'] } });
    expect(report).toMatchObject({ records: 2, outOfScope: 1, leaks: [] });
    expect(report.hiddenFields.sort()).toEqual(['budget', 'secret']);
    expect(report.calls).toBeGreaterThan(5);
    // A user who cannot reach the resource at all.
    expect((await admin.expectNoLeaks('project', { as: { id: 'u9', roles: [] } })).leaks).toEqual([]);
  });

  test('history() and audit(): a record’s entries for whoever sees it, the audit page with `audit.view`', async () => {
    const apollo = String((await admin.superuser.list('project', { search: 'Apollo' })).items[0]!._id);
    const mine = await admin.as({ id: 'u1', roles: ['member'] }).history('project', apollo);
    expect(mine.entries.at(-1)!.event).toBe('project.created');
    expect(mine.entries.at(-1)!.changes).toContainEqual({ field: 'secret', hidden: true });
    expect(mine.entries.at(-1)!.changes).toContainEqual({ field: 'name', after: 'Apollo' });
    await expect(admin.as({ id: 'u2', roles: ['member'] }).history('project', apollo)).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(admin.as({ id: 'u1', roles: ['member'] }).audit()).rejects.toBeInstanceOf(AdminForbiddenError);
    // The auditor sees their own projects' entries in full and the others closed, with no record named.
    const page = await admin.as({ id: 'u1', roles: ['auditor'] }).audit({ resource: 'project' });
    const all = await admin.superuser.audit({ event: 'project.*' });
    expect(page.entries.map((entry) => entry.id)).toEqual(all.entries.map((entry) => entry.id));
    const owned = new Set((await admin.as({ id: 'u1', roles: ['auditor'] }).list('project')).items.map((item) => String(item._id)));
    expect(owned.has(apollo)).toBe(true);
    for (const [index, entry] of page.entries.entries()) {
      const full = all.entries[index]!;
      if (owned.has(full.recordId!)) expect(entry).toMatchObject({ recordId: full.recordId });
      else expect([entry.recordId, entry.recordTitle, entry.changes, entry.restricted]).toEqual([undefined, undefined, undefined, true]);
    }
    expect(page.entries.some((entry) => entry.restricted)).toBe(true);
  });

  test('expectNoLeaks reads the history and the audit page too, and what a hidden field held before is a secret', async () => {
    const apollo = String((await admin.superuser.list('project', { search: 'Apollo' })).items[0]!._id);
    await admin.superuser.update('project', apollo, { secret: 'FORMERSECRET-9' });
    await admin.superuser.update('project', apollo, { secret: 'TOPSECRET-1' });
    const before = await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['member'] } });
    expect(before.leaks).toEqual([]);
    expect((await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['auditor'] } })).leaks).toEqual([]);
    // A history that showed the former value would be caught.
    const reader = admin.app.get(AuditReader, { strict: false });
    const real = reader.history.bind(reader);
    const leaky = spyOn(reader, 'history').mockImplementation(async (resource, id, query, ctx) => {
      const answer = await real(resource, id, query, ctx);
      return ctx.user?.isSuperuser ? answer : { entries: answer.entries.map((entry) => ({ ...entry, changes: [{ field: 'secret', before: 'FORMERSECRET-9' }] })) };
    });
    try {
      const error = await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['member'] } }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AdminLeakError);
      expect((error as AdminLeakError).report.leaks.some((leak) => leak.kind === 'hidden-value' && leak.field === 'secret' && leak.value === 'FORMERSECRET-9' && leak.where.startsWith(`history project ${apollo}`))).toBe(true);
    } finally {
      leaky.mockRestore();
    }
    // And so would an audit page that showed it, or that named a record out of scope with what it was called before.
    const borealis = String((await admin.superuser.list('project', { search: 'Borealis' })).items[0]!._id);
    await admin.superuser.update('project', borealis, { name: 'Formerly Aurora' });
    await admin.superuser.update('project', borealis, { name: 'Borealis' });
    const realList = reader.list.bind(reader);
    for (const [leak, kind, value] of [
      [{ changes: [{ field: 'secret', before: 'FORMERSECRET-9' }] }, 'hidden-value', 'FORMERSECRET-9'],
      [{ recordTitle: 'Formerly Aurora' }, 'out-of-scope-record', 'Formerly Aurora'],
      [{ resource: 'project', recordId: borealis }, 'out-of-scope-record', undefined],
    ] as const) {
      const leakyList = spyOn(reader, 'list').mockImplementation(async (query, ctx) => {
        const answer = await realList(query, ctx);
        return ctx.user?.isSuperuser ? answer : { ...answer, entries: answer.entries.map((entry) => ({ ...entry, ...leak }) as AuditEntry) };
      });
      try {
        const error = await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['auditor'] } }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(AdminLeakError);
        expect((error as AdminLeakError).report.leaks.some((found) => found.kind === kind && found.where.startsWith('audit') && found.value === value)).toBe(true);
      } finally {
        leakyList.mockRestore();
      }
    }
    // A crawl that could not read every page says so.
    expect(before.auditTruncated).toBe(false);
    for (let i = 0; i < 55; i++) await admin.superuser.update('project', apollo, { name: `Apollo ${i}` });
    await admin.superuser.update('project', apollo, { name: 'Apollo' });
    expect((await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['member'] }, maxPages: 1 })).auditTruncated).toBe(true);
    expect((await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['member'] } })).auditTruncated).toBe(false);
  });

  test('expectNoLeaks finds a hidden value in a title (Review Focus 4)', async () => {
    const error = await admin.expectNoLeaks('leaky-project', { as: { id: 'u1', roles: ['leaky'] } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminLeakError);
    const { leaks } = (error as AdminLeakError).report;
    expect(leaks.some((leak) => leak.kind === 'hidden-value' && leak.field === 'secret' && leak.value === 'TOPSECRET-1' && leak.where.startsWith('list leaky-project'))).toBe(true);
    expect((error as Error).message).toContain('hidden field "secret" of leaky-project');
  });

  test('expectNoLeaks reads the rows a parent lists inline (`_inlines`)', async () => {
    const error = await admin.expectNoLeaks('coded-task', { as: { id: 'u1', roles: ['coder'] } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminLeakError);
    const leaks = (error as AdminLeakError).report.leaks.filter((leak) => leak.kind === 'hidden-value' && leak.field === 'code');
    expect(leaks.some((leak) => leak.where.startsWith('get board ') && leak.where.includes('._inlines.coded-task.rows'))).toBe(true);
  });

  test('expectNoLeaks finds an out-of-scope record through another resource (Review Focus 4)', async () => {
    const error = await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['nosy'] } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminLeakError);
    const leaks = (error as AdminLeakError).report.leaks.filter((candidate) => candidate.kind === 'out-of-scope-record');
    expect(leaks.find((leak) => leak.where.startsWith('list leaky-task'))).toMatchObject({ resource: 'project', value: 'Borealis' });
    // The override ignores the search term too, so the palette shows it as well.
    expect(leaks.some((leak) => leak.where.startsWith('search'))).toBe(true);
  });
});
