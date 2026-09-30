import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import {
  AdminAuth,
  AdminCan,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminPrincipal,
  type AdminUser,
  type FieldsConfig,
  type ListConfig,
  type ListParams,
  type RecordId,
} from '../src/index.js';
import { EffectivePermissions } from '../src/policy/effective.js';
import { createAdminContext } from '../src/resource/admin-context.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('pol_team')
class Team {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ length: 10 }) orgId: string;
}

@Entity('pol_project')
class Project {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ length: 10 }) ownerId: string;
  @Column({ type: 'simple-enum', enum: ['draft', 'live'], default: 'draft' }) status: 'draft' | 'live';
  @Column({ type: 'decimal', precision: 10, scale: 2, default: '0.00' }) budget: string;
  @Column({ length: 40, default: '' }) secret: string;
  @Column({ type: 'int', nullable: true }) teamId: number | null;
  @ManyToOne(() => Team, { nullable: true }) @JoinColumn({ name: 'teamId' }) team: Team | null;
}

@AdminResource(Team, { title: 'name' })
class TeamAdmin extends AdminResourceBase<Team> {}

@AdminResource(Project, { title: 'name', permissions: ['approve'] })
class ProjectAdmin extends AdminResourceBase<Project> {
  list: ListConfig<Project> = { columns: ['id', 'name', 'status', 'budget', 'secret', 'teamId', 'team.name'], search: ['name', 'secret'], filters: ['status', 'secret', 'budget', 'teamId'] };
  fields: FieldsConfig<Project> = { budget: { restricted: true } };

  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
  @AdminScope('live') live() {
    return { status: 'live' };
  }
  @AdminCan('delete') onlyDrafts(project: Project) {
    return project.status === 'draft';
  }
}

/** Reads the table itself, ignoring scopes: the API must still keep other people's rows out (Review Focus 3). */
@AdminResource(Project, { name: 'leaky-project', title: 'name' })
class LeakyProjectAdmin extends AdminResourceBase<Project> {
  override async findMany(params: ListParams) {
    const items = await this.repository.find({ take: params.pageSize });
    return { items, total: items.length };
  }
  override async findOne(id: RecordId) {
    return this.repository.findOneBy({ id: Number(id) });
  }
  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
}

const USERS: Record<string, AdminUser> = {
  root: { id: 'root', displayName: 'Root', isSuperuser: true },
  viewer: { id: 'v', displayName: 'Viewer', isSuperuser: false, attrs: { orgId: 'o1' } },
  owner: { id: 'u1', displayName: 'Owner', isSuperuser: false, attrs: { orgId: 'o1' } },
  both: { id: 'u1', displayName: 'Both', isSuperuser: false, attrs: { orgId: 'o1' } },
  finance: { id: 'f', displayName: 'Finance', isSuperuser: false },
  cleaner: { id: 'c', displayName: 'Cleaner', isSuperuser: false },
  leaky: { id: 'u1', displayName: 'Leaky', isSuperuser: false },
  nobody: { id: 'n', displayName: 'Nobody', isSuperuser: false },
};
const ROLES_OF: Record<string, string[]> = {
  viewer: ['viewer'],
  owner: ['owner'],
  both: ['viewer', 'owner'],
  finance: ['finance'],
  cleaner: ['cleaner'],
  leaky: ['leaky'],
};

/** `X-User: <name>`; no cookies, so no CSRF token. */
@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = USERS[String(req.headers['x-user'] ?? '')];
    return user ? { user } : null;
  }
  resolveRoles(user: AdminUser) {
    return ROLES_OF[Object.entries(USERS).find(([, candidate]) => candidate === user)?.[0] ?? ''] ?? [];
  }
}

@Module({ providers: [HeaderAuth, TeamAdmin, ProjectAdmin, LeakyProjectAdmin] })
class PolicyModule {}

let app: INestApplication;
const as = (user: string) => ({
  get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user),
  post: (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', user).send(body),
  patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/admin/api${path}`).set('X-User', user).send(body),
  delete: (path: string) => request(app.getHttpServer()).delete(`/admin/api${path}`).set('X-User', user),
});
const names = (res: request.Response) => (res.body.items as Array<{ name: string }>).map((item) => item.name).sort();
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await createTestApp({
    imports: [PolicyModule],
    entities: [Team, Project],
    admin: {
      auth: AdminAuth.custom(HeaderAuth),
      roles: [
        { name: 'viewer', permissions: ['project.view', 'team.view'], fields: { project: { secret: 'hidden' } } },
        { name: 'owner', permissions: ['project.create', 'project.update'], fields: { project: { status: 'readonly' } }, scopes: { project: { view: 'own', update: 'own' } } },
        { name: 'finance', permissions: ['project.view', 'project.field.budget.view'] },
        { name: 'cleaner', permissions: ['project.view', 'project.delete'] },
        { name: 'leaky', permissions: ['leaky-project.view', 'leaky-project.update'], scopes: { 'leaky-project': { view: 'own', update: 'own' } } },
      ],
      globalScopes: [{ name: 'org', appliesTo: ({ name }) => name === 'team', where: (ctx) => ({ orgId: ctx.user?.attrs?.orgId }), exemptSuperusers: true }],
    },
  });
  const root = as('root');
  const alpha = (await root.post('/resources/team', { name: 'Alpha', orgId: 'o1' })).body;
  const beta = (await root.post('/resources/team', { name: 'Beta', orgId: 'o2' })).body;
  ids.alpha = alpha._id;
  ids.beta = beta._id;
  for (const project of [
    { name: 'Apollo', ownerId: 'u1', status: 'draft', budget: '98765.43', secret: 'TOPSECRET-1', teamId: alpha.id },
    { name: 'Borealis', ownerId: 'u2', status: 'live', budget: '11111.11', secret: 'TOPSECRET-2', teamId: beta.id },
    { name: 'Cygnus', ownerId: 'u1', status: 'live', budget: '22222.22', secret: 'TOPSECRET-3', teamId: alpha.id },
  ]) {
    const created = await root.post('/resources/project', project);
    expect(created.status).toBe(201);
    ids[project.name] = created.body._id;
  }
});
afterAll(async () => {
  await app.close();
});

describe(`entity permissions (${TEST_DB})`, () => {
  test('meta lists only what the user may view; the rest is 404', async () => {
    const resources = (res: request.Response) => res.body.groups.flatMap((group: { resources: Array<{ name: string }> }) => group.resources.map((resource) => resource.name)).sort();
    expect(resources(await as('viewer').get('/meta'))).toEqual(['project', 'team']);
    expect(resources(await as('nobody').get('/meta'))).toEqual([]);
    expect(resources(await as('root').get('/meta'))).toEqual(['leaky-project', 'project', 'team', 'widget']);
    expect((await as('nobody').get('/meta/resources/project')).status).toBe(404);
    expect((await as('nobody').get('/resources/project')).status).toBe(404);
    expect((await as('viewer').get('/resources/widget')).status).toBe(404);
  });

  test('operations need their permission (403) and schemas say which ones the user has', async () => {
    const viewer = as('viewer');
    expect((await viewer.get('/meta/resources/project')).body.permissions).toEqual({ create: false, update: false, delete: false, purge: false });
    expect((await as('owner').get('/meta/resources/project')).body.permissions).toEqual({ create: true, update: true, delete: false, purge: false });
    const refused = await viewer.post('/resources/project', { name: 'X', ownerId: 'v' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FORBIDDEN');
    expect((await viewer.patch(`/resources/project/${ids.Apollo}`, { name: 'X' })).status).toBe(403);
    expect((await viewer.delete(`/resources/project/${ids.Apollo}`)).status).toBe(403);
    expect((await viewer.post('/resources/project/bulk-delete', { ids: [ids.Apollo] })).status).toBe(403);
  });
});

describe(`field rules (${TEST_DB})`, () => {
  test('hidden and restricted fields are gone from the schema and the records', async () => {
    const schema = (await as('viewer').get('/meta/resources/project')).body;
    const fieldNames = schema.fields.map((field: { name: string }) => field.name);
    expect(fieldNames).not.toContain('secret');
    expect(fieldNames).not.toContain('budget'); // restricted, not granted
    expect(schema.list.columns).toEqual(['id', 'name', 'status', 'teamId', 'team.name']);
    expect(schema.list.search).toEqual(['name']);
    expect(schema.list.filters.map((filter: { field: string }) => filter.field)).toEqual(['status', 'teamId']);
    const record = (await as('viewer').get(`/resources/project/${ids.Apollo}`)).body;
    expect(record).not.toHaveProperty('secret');
    expect(record).not.toHaveProperty('budget');
    expect(record.name).toBe('Apollo');
  });

  test('filter, sort and search cannot probe hidden fields (anti-oracle)', async () => {
    const viewer = as('viewer');
    // The same answer as for a field that does not exist.
    expect((await viewer.get('/resources/project?filter[secret][eq]=TOPSECRET-1')).status).toBe(422);
    expect((await viewer.get('/resources/project?sort=budget')).status).toBe(422);
    expect((await viewer.get('/resources/project?filter[budget][gte]=90000')).status).toBe(422);
    expect((await viewer.get('/resources/project?search=TOPSECRET')).body.items).toEqual([]);
    expect(names(await as('root').get('/resources/project?search=TOPSECRET'))).toEqual(['Apollo', 'Borealis', 'Cygnus']);
  });

  test('restricted fields show for a role granting the field code', async () => {
    const schema = (await as('finance').get('/meta/resources/project')).body;
    expect(schema.fields.map((field: { name: string }) => field.name)).toContain('budget');
    expect((await as('finance').get(`/resources/project/${ids.Apollo}`)).body.budget).toBe('98765.43');
  });

  test('titles of resources the user cannot view become #id, and paths into them disappear', async () => {
    const schema = (await as('finance').get('/meta/resources/project')).body;
    expect(schema.list.columns).not.toContain('team.name');
    const record = (await as('finance').get(`/resources/project/${ids.Apollo}`)).body;
    expect(record.teamId).toEqual({ id: expect.anything(), title: expect.stringMatching(/^#/) });
    expect((await as('viewer').get(`/resources/project/${ids.Apollo}`)).body.teamId.title).toBe('Alpha');
  });

  test('writes naming hidden or read-only fields are 403 FORBIDDEN_FIELDS; the union of roles wins (Review Focus 2, 4)', async () => {
    const readOnly = await as('owner').patch(`/resources/project/${ids.Apollo}`, { status: 'live', name: 'Apollo' });
    expect(readOnly.status).toBe(403);
    expect(readOnly.body).toMatchObject({ code: 'FORBIDDEN_FIELDS', fields: { status: ['is read-only for you'] } });
    const hidden = await as('owner').patch(`/resources/project/${ids.Apollo}`, { budget: '1.00' });
    expect(hidden.body).toMatchObject({ code: 'FORBIDDEN_FIELDS', fields: { budget: ['is not available'] } });
    expect((await as('root').get(`/resources/project/${ids.Apollo}`)).body).toMatchObject({ status: 'draft', budget: '98765.43' });
    // secret: hidden for viewer, editable for owner → "both" may edit it
    const both = await as('both').patch(`/resources/project/${ids.Apollo}`, { secret: 'TOPSECRET-1' });
    expect(both.status).toBe(200);
  });
});

describe(`row scopes (${TEST_DB})`, () => {
  test('view and update scopes: other rows are not found (404), counts included', async () => {
    const owner = as('owner');
    const list = await owner.get('/resources/project');
    expect(names(list)).toEqual(['Apollo', 'Cygnus']);
    expect(list.body.total).toBe(2);
    expect((await owner.get(`/resources/project/${ids.Borealis}`)).status).toBe(404);
    const patch = await owner.patch(`/resources/project/${ids.Borealis}`, { name: 'Mine now' });
    expect(patch.status).toBe(404);
    expect((await owner.patch(`/resources/project/${ids.Apollo}`, { name: 'Apollo' })).status).toBe(200);
    expect(names(await owner.get('/resources/project?search=o'))).toEqual(['Apollo', 'Cygnus']);
    expect((await owner.get('/search?q=Borealis')).body.groups).toEqual([]);
  });

  test('roles OR their scopes per operation', async () => {
    const both = as('both');
    expect(names(await both.get('/resources/project'))).toEqual(['Apollo', 'Borealis', 'Cygnus']); // viewer sees all
    expect((await both.patch(`/resources/project/${ids.Borealis}`, { name: 'Nope' })).status).toBe(404); // only owner updates
  });

  test('global scopes: teams of the user\'s org only; superusers exempt; a missing attribute sees nothing', async () => {
    expect(names(await as('viewer').get('/resources/team'))).toEqual(['Alpha']);
    expect((await as('viewer').get(`/resources/team/${ids.beta}`)).status).toBe(404);
    expect(names(await as('root').get('/resources/team'))).toEqual(['Alpha', 'Beta']);
    const options = await as('viewer').get('/resources/project/fields/teamId/options?search=a');
    expect(options.body.items.map((item: { title: string }) => item.title)).toEqual(['Alpha']);
    expect((await as('finance').get('/resources/project/fields/teamId/options')).status).toBe(403); // cannot view teams
  });

  test('a relation id outside the scope cannot be linked', async () => {
    const res = await as('both').patch(`/resources/project/${ids.Apollo}`, { teamId: Number(ids.beta) });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ teamId: ['does not exist'] });
  });

  test('overrides of findMany/findOne cannot bypass scopes (Review Focus 3)', async () => {
    const leaky = as('leaky');
    expect(names(await leaky.get('/resources/leaky-project'))).toEqual(['Apollo', 'Cygnus']);
    expect((await leaky.get(`/resources/leaky-project/${ids.Borealis}`)).status).toBe(404);
    expect((await leaky.patch(`/resources/leaky-project/${ids.Borealis}`, { name: 'Leaked' })).status).toBe(404);
    expect((await as('root').get(`/resources/project/${ids.Borealis}`)).body.name).toBe('Borealis');
  });
});

describe(`record rules (${TEST_DB})`, () => {
  test('_perm combines permissions, scopes and @AdminCan; DELETE re-checks it (Review Focus 4)', async () => {
    const owner = (await as('owner').get('/resources/project')).body.items as Array<{ name: string; _perm: unknown }>;
    expect(owner.find((item) => item.name === 'Apollo')!._perm).toEqual({ update: true, delete: false });
    const cleaner = (await as('cleaner').get('/resources/project')).body.items as Array<{ name: string; _perm: unknown }>;
    expect(cleaner.find((item) => item.name === 'Apollo')!._perm).toEqual({ update: false, delete: true });
    expect(cleaner.find((item) => item.name === 'Cygnus')!._perm).toEqual({ update: false, delete: false }); // live
    const refused = await as('cleaner').delete(`/resources/project/${ids.Cygnus}`);
    expect(refused.status).toBe(403);
    const draft = (await as('root').post('/resources/project', { name: 'Doomed', ownerId: 'x' })).body;
    expect((await as('cleaner').delete(`/resources/project/${draft._id}`)).status).toBe(204);
    expect((await as('root').get('/resources/project')).body.items).toHaveLength(3);
    expect((await as('root').get('/resources/project')).body.items[0]._perm).toBeDefined(); // @AdminCan applies to superusers too
  });

  test('ctx.can() answers custom codes (and denies without permissions)', () => {
    const ctx = createAdminContext({} as IncomingMessage);
    expect(ctx.can('project.approve')).toBe(false);
    ctx.permissions = new EffectivePermissions([{ name: 'a', permissions: ['project.approve'] }], false);
    expect(ctx.can('project.approve')).toBe(true);
    expect(ctx.can('project.delete')).toBe(false);
  });
});

describe(`no leaks (${TEST_DB})`, () => {
  test('nothing a limited user can reach contains hidden values or out-of-scope rows (Review Focus 1)', async () => {
    const bodies: string[] = [];
    const crawl = async (user: string) => {
      const client = as(user);
      const paths = [
        '/meta',
        '/meta/resources/project',
        '/meta/resources/team',
        '/resources/project',
        '/resources/project?search=TOPSECRET',
        '/resources/project?search=Borealis',
        '/resources/team',
        '/search?q=TOPSECRET',
        '/search?q=Borealis',
        '/search?q=Beta',
        '/resources/project/fields/teamId/options',
        '/resources/project/fields/teamId/options?search=Beta',
        `/resources/project/fields/teamId/options?ids=${ids.beta}`,
        `/resources/project/${ids.Apollo}`,
        `/resources/project/${ids.Borealis}`,
        `/resources/team/${ids.beta}`,
      ];
      for (const path of paths) bodies.push(JSON.stringify((await client.get(path)).body));
      bodies.push(JSON.stringify((await client.patch(`/resources/project/${ids.Borealis}`, { name: 'x' })).body));
    };
    await crawl('owner');
    const ownerText = bodies.join('\n');
    // The owner sees their own projects' secrets, never someone else's project or any budget (restricted).
    for (const secret of ['Borealis', 'TOPSECRET-2', '98765.43', '11111.11', '22222.22', 'Beta']) expect(ownerText).not.toContain(secret);
    bodies.length = 0;
    await crawl('viewer');
    const viewerText = bodies.join('\n');
    for (const secret of ['TOPSECRET', '98765.43', '11111.11', 'Beta']) expect(viewerText).not.toContain(secret);
  });
});
