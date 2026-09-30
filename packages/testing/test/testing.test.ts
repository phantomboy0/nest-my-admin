import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { fileURLToPath } from 'node:url';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AdminModule, AdminNotFoundError, AdminResource, AdminResourceBase, AdminScope, type AdminContext, type FieldsConfig, type ListConfig, type ListParams } from '@nest-my-admin/core';
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

@Module({ providers: [ProjectAdmin, LeakyProjectAdmin, TaskAdmin, LeakyTaskAdmin] })
class AppModule {}

let db: TestDatabase;
let admin: AdminTesting;

beforeAll(async () => {
  db = await testDatabase([Project, Task]);
  admin = await createAdminTestingModule({
    imports: [
      TypeOrmModule.forRoot({ ...db.options, retryAttempts: 0 }),
      AdminModule.forRoot({
        uiDistPath: UI,
        roles: [
          { name: 'member', permissions: ['project.view', 'project.create', 'project.update', 'task.view'], fields: { project: { secret: 'hidden' } }, scopes: { project: { view: 'own', update: 'own' } } },
          { name: 'nosy', permissions: ['project.view', 'leaky-task.view'], scopes: { project: { view: 'own' } } },
          { name: 'leaky', permissions: ['leaky-project.view'], fields: { 'leaky-project': { secret: 'hidden' } } },
        ],
        resolveRoles: (user) => (user.attrs?.roles as string[] | undefined) ?? [],
      }),
      AppModule,
    ],
  });
  const root = admin.superuser;
  const apollo = await root.create('project', { name: 'Apollo', ownerId: 'u1', secret: 'TOPSECRET-1', budget: '98765.43' });
  const borealis = await root.create('project', { name: 'Borealis', ownerId: 'u2', secret: 'TOPSECRET-2', budget: '11111.11' });
  await root.create('task', { name: 'Launch', projectId: apollo.id });
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

  test('expectNoLeaks passes when nothing leaks', async () => {
    const report = await admin.expectNoLeaks('project', { as: { id: 'u1', roles: ['member'] } });
    expect(report).toMatchObject({ records: 2, outOfScope: 1, leaks: [] });
    expect(report.hiddenFields.sort()).toEqual(['budget', 'secret']);
    expect(report.calls).toBeGreaterThan(5);
    // A user who cannot reach the resource at all.
    expect((await admin.expectNoLeaks('project', { as: { id: 'u9', roles: [] } })).leaks).toEqual([]);
  });

  test('expectNoLeaks finds a hidden value in a title (Review Focus 4)', async () => {
    const error = await admin.expectNoLeaks('leaky-project', { as: { id: 'u1', roles: ['leaky'] } }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AdminLeakError);
    const { leaks } = (error as AdminLeakError).report;
    expect(leaks.some((leak) => leak.kind === 'hidden-value' && leak.field === 'secret' && leak.value === 'TOPSECRET-1' && leak.where.startsWith('list leaky-project'))).toBe(true);
    expect((error as Error).message).toContain('hidden field "secret" of leaky-project');
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
