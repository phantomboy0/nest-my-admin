import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Injectable, Module, UnauthorizedException, type INestApplication } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import request, { type Response } from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import {
  AdminAction,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  AdminSettingsPage,
  BeforeDelete,
  BeforeSave,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminPrincipal,
  type AdminSettingsSource,
  type RecordId,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

/**
 * To the admin UI a 401 means "signed out". Host code that rethrows a provider's 401 (an action, a settings page, a
 * resource override or a hook) must not throw the user to the login page: it is answered as 400 BUSINESS_RULE.
 */
const REFUSED = 'The provider refused the key';
const refused = () => new UnauthorizedException(REFUSED);

@Entity('hu_job')
class Job {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ length: 12, default: 'new' }) state: string;
}

@AdminResource(Job, { title: 'name' })
class JobAdmin extends AdminResourceBase<Job> {
  @AdminAction({ bulk: true })
  async sync(job: Job, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(job.id, { state: 'synced' });
    if (job.name.startsWith('BAD')) throw refused();
  }

  @AdminAction({ bulk: true, atomic: true })
  async syncTogether(job: Job, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.sync(job, undefined, ctx);
  }

  @AdminAction({ target: 'resource' })
  async syncAll(): Promise<void> {
    throw refused();
  }
}

/** A resource whose writes are the host's own. */
@AdminResource(Job, { name: 'remote-job', title: 'name' })
class RemoteJobAdmin extends AdminResourceBase<Job> {
  override async create(): Promise<Job> {
    throw refused();
  }
  override async update(): Promise<Job> {
    throw refused();
  }
  override async delete(_id: RecordId): Promise<void> {
    throw refused();
  }
}

@AdminResource(Job, { name: 'hooked-job', title: 'name' })
class HookedJobAdmin extends AdminResourceBase<Job> {
  @BeforeSave() checkKey() {
    throw refused();
  }
  @BeforeDelete() checkKeyAgain() {
    throw refused();
  }
}

class KeysDto {
  @IsOptional() @IsString() apiKey?: string;
}

const page: { loadFails: boolean; saveFails: boolean } = { loadFails: false, saveFails: false };

@AdminSettingsPage('keys', { form: KeysDto })
class KeysPage implements AdminSettingsSource<KeysDto> {
  async load(): Promise<KeysDto> {
    if (page.loadFails) throw refused();
    return {};
  }
  async save(): Promise<void> {
    if (page.saveFails) throw refused();
  }
}

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    return req.headers['x-user'] === 'root' ? { user: { id: 'root', displayName: 'Root', isSuperuser: true } } : null;
  }
}

@Module({ providers: [HeaderAuth, JobAdmin, RemoteJobAdmin, HookedJobAdmin, KeysPage] })
class HostModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());
const post = (path: string, body: object = {}) => http().post(`/admin/api${path}`).set('X-User', 'root').send(body);
const job = async (name: string): Promise<string> => {
  const res = await post('/resources/job', { name });
  expect(res.status).toBe(201);
  return res.body._id as string;
};
const stateOf = async (id: string) => (await http().get(`/admin/api/resources/job/${id}`).set('X-User', 'root')).body.state as string;
const expectBusinessRule = (res: Response) => {
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ code: 'BUSINESS_RULE', message: REFUSED });
};

beforeAll(async () => {
  app = await createTestApp({ imports: [HostModule], entities: [Job], admin: { auth: AdminAuth.custom(HeaderAuth) } });
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  page.loadFails = false;
  page.saveFails = false;
});

describe(`a 401 from host code (${TEST_DB})`, () => {
  test("the admin's own 401 is untouched: no session is UNAUTHENTICATED", async () => {
    const res = await http().get('/admin/api/resources/job');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  test('a record action answers 400 BUSINESS_RULE with the host message, and its write is rolled back', async () => {
    const id = await job('BAD one');
    expectBusinessRule(await post('/resources/job/actions/sync', { ids: [id] }));
    expect(await stateOf(id)).toBe('new');
  });

  test('a resource action answers 400 BUSINESS_RULE', async () => {
    expectBusinessRule(await post('/resources/job/actions/syncAll'));
  });

  test('a bulk run reports the record as BUSINESS_RULE, never UNAUTHENTICATED', async () => {
    const good = await job('Good');
    const bad = await job('BAD two');
    const res = await post('/resources/job/actions/sync', { ids: [good, bad] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: [good], failed: [{ id: bad, code: 'BUSINESS_RULE', message: REFUSED }] });
  });

  test('an atomic bulk run answers 400 BUSINESS_RULE', async () => {
    const good = await job('Good');
    const bad = await job('BAD three');
    expectBusinessRule(await post('/resources/job/actions/syncTogether', { ids: [good, bad] }));
    expect(await stateOf(good)).toBe('new');
  });

  test('a settings page load() answers 400 BUSINESS_RULE', async () => {
    page.loadFails = true;
    expectBusinessRule(await http().get('/admin/api/pages/keys').set('X-User', 'root'));
  });

  test('a settings page save() answers 400 BUSINESS_RULE', async () => {
    page.saveFails = true;
    expectBusinessRule(await http().patch('/admin/api/pages/keys').set('X-User', 'root').send({ apiKey: 'k' }));
  });

  test('create, update and delete overrides answer 400 BUSINESS_RULE', async () => {
    const id = await job('Plain');
    expectBusinessRule(await post('/resources/remote-job', { name: 'New' }));
    expectBusinessRule(await http().patch(`/admin/api/resources/remote-job/${id}`).set('X-User', 'root').send({ name: 'Renamed' }));
    expectBusinessRule(await http().delete(`/admin/api/resources/remote-job/${id}`).set('X-User', 'root'));
    const bulk = await post('/resources/remote-job/bulk-delete', { ids: [id] });
    expect(bulk.body.failed).toEqual([expect.objectContaining({ id, code: 'BUSINESS_RULE', message: REFUSED })]);
  });

  test('hooks answer 400 BUSINESS_RULE', async () => {
    const id = await job('Hooked');
    expectBusinessRule(await post('/resources/hooked-job', { name: 'New' }));
    expectBusinessRule(await http().patch(`/admin/api/resources/hooked-job/${id}`).set('X-User', 'root').send({ name: 'Renamed' }));
    expectBusinessRule(await http().delete(`/admin/api/resources/hooked-job/${id}`).set('X-User', 'root'));
  });
});
