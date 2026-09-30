import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import {
  AdminAuth,
  AdminContext,
  AdminResource,
  AdminResourceBase,
  AdminUnauthenticatedError,
  appendSetCookie,
  parseCookies,
  serializeCookie,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminSessionInfo,
  type AuthIO,
  type LoginInput,
} from '../src/index.js';
import { resolveAdminOptions } from '../src/options.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';
import { Widget } from './fixtures/widgets.js';

interface FakeSession {
  id: string;
  username: string;
  csrf: string;
}

/** An in-memory adapter: cookie `fake=<session id>`, users ada/ada-pass and bob/bob-pass. */
@Injectable()
class FakeAuth implements AdminAuthAdapter {
  readonly sessions = new Map<string, FakeSession>();
  private next = 1;
  failAuthenticate = false;

  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    if (this.failAuthenticate) throw new Error('user store is down');
    const session = this.sessions.get(parseCookies(req.headers.cookie).fake ?? '');
    return session ? this.principal(session) : null;
  }

  private principal(session: FakeSession): AdminPrincipal {
    return { user: { id: session.username, displayName: session.username.toUpperCase(), username: session.username, isSuperuser: session.username === 'ada' }, csrfToken: session.csrf, sessionId: session.id };
  }

  async login(input: LoginInput, io: AuthIO): Promise<AdminPrincipal> {
    if (input.password !== `${input.username}-pass`) throw new AdminUnauthenticatedError('Wrong username or password');
    const session = { id: `s${this.next++}`, username: input.username, csrf: `csrf-${this.next}` };
    this.sessions.set(session.id, session);
    appendSetCookie(io.res, serializeCookie('fake', session.id, { path: '/admin', httpOnly: true, sameSite: 'Lax' }));
    return this.principal(session);
  }

  async logout(principal: AdminPrincipal, io: AuthIO): Promise<void> {
    this.sessions.delete(principal.sessionId!);
    appendSetCookie(io.res, serializeCookie('fake', '', { path: '/admin', maxAge: 0 }));
  }

  async listSessions(principal: AdminPrincipal): Promise<AdminSessionInfo[]> {
    const at = new Date('2026-01-01T00:00:00Z');
    return [...this.sessions.values()]
      .filter((session) => session.username === principal.user.username)
      .map((session) => ({ id: session.id, createdAt: at, lastSeenAt: at, expiresAt: at, userAgent: 'test' }));
  }

  async revokeSession(principal: AdminPrincipal, id: string): Promise<void> {
    if (this.sessions.get(id)?.username === principal.user.username) this.sessions.delete(id);
  }
}

/** Records who AdminContext says is signed in, from inside a resource method. */
const seen: Array<string | undefined> = [];

@AdminResource(Widget, { name: 'gadget' })
class GadgetAdmin extends AdminResourceBase<Widget> {
  override async create(dto: Partial<Widget>, ctx: AdminContext) {
    seen.push(`${ctx.user?.displayName}/${AdminContext.current()?.user?.displayName}`);
    return super.create(dto, ctx);
  }
}

@Module({ providers: [FakeAuth, GadgetAdmin] })
class AuthModule {}

let app: INestApplication;
let fake: FakeAuth;
const http = () => request(app.getHttpServer());

/** Logs in; returns the cookie and CSRF token. */
async function login(username = 'ada'): Promise<{ cookie: string; csrf: string }> {
  const res = await http().post('/admin/api/session').send({ username, password: `${username}-pass` });
  expect(res.status).toBe(200);
  return { cookie: String(res.headers['set-cookie']![0]).split(';')[0]!, csrf: res.body.csrfToken };
}

beforeAll(async () => {
  app = await createTestApp({
    imports: [AuthModule],
    // ada is a superuser; bob may use gadgets.
    admin: { auth: AdminAuth.custom(FakeAuth), roles: [{ name: 'maker', permissions: ['gadget.*'] }], resolveRoles: (user) => (user.username === 'bob' ? ['maker'] : []) },
  });
  fake = app.get(FakeAuth);
});
afterAll(async () => {
  await app.close();
});

describe(`authentication (${TEST_DB})`, () => {
  test('no route but the session ones answers without a session (Review Focus 1)', async () => {
    for (const [method, path] of [
      ['get', '/admin/api/meta'],
      ['get', '/admin/api/meta/resources/widget'],
      ['get', '/admin/api/resources/widget'],
      ['get', '/admin/api/resources/widget/1'],
      ['get', '/admin/api/search?q=x'],
      ['get', '/admin/api/account/sessions'],
      ['delete', '/admin/api/session'],
      ['delete', '/admin/api/resources/widget/1'],
    ] as const) {
      const res = await http()[method](path);
      expect({ path, status: res.status, code: res.body.code }).toEqual({ path, status: 401, code: 'UNAUTHENTICATED' });
    }
    const post = await http().post('/admin/api/resources/widget').send({ name: 'x' });
    expect(post.status).toBe(401);
    expect((await http().get('/admin/api/session')).status).toBe(401);
    expect((await http().get('/admin/')).status).toBe(200); // the UI (and its login page) stays public
  });

  test('log in, then GET /api/session tells who and which features', async () => {
    expect((await http().post('/admin/api/session').send({ username: 'ada', password: 'nope' })).body).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Wrong username or password' });
    expect((await http().post('/admin/api/session').send({ username: '' })).body).toMatchObject({ code: 'VALIDATION', fields: { username: ['is required'], password: ['is required'] } });
    const { cookie, csrf } = await login();
    const session = await http().get('/admin/api/session').set('Cookie', cookie);
    expect(session.body).toEqual({
      user: { id: 'ada', displayName: 'ADA', username: 'ada', isSuperuser: true },
      csrfToken: csrf,
      open: false,
      auth: { login: true, logout: true, sessions: true, revokeOthers: false, password: false, twoFactor: false },
      rbac: { enabled: false, view: false, manage: false },
      permissionsVersion: expect.any(Number),
    });
    expect((await http().get('/admin/api/meta').set('Cookie', cookie)).status).toBe(200);
  });

  test('writes need the session CSRF token (Review Focus 2)', async () => {
    const { cookie, csrf } = await login();
    const refused = await http().post('/admin/api/resources/gadget').set('Cookie', cookie).send({ name: 'no token' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FORBIDDEN');
    expect((await http().post('/admin/api/resources/gadget').set('Cookie', cookie).set('X-CSRF-Token', 'csrf-wrong').send({ name: 'x' })).status).toBe(403);
    expect((await http().get('/admin/api/resources/widget?search=no%20token').set('Cookie', cookie)).body.items).toEqual([]);
    expect((await http().delete('/admin/api/session').set('Cookie', cookie)).status).toBe(403); // logout too
    expect((await http().delete('/admin/api/account/sessions/s1').set('Cookie', cookie)).status).toBe(403);

    const created = await http().post('/admin/api/resources/gadget').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ name: 'with token' });
    expect(created.status).toBe(201);
  });

  test('resource methods and host code see the user through ctx and AdminContext.current()', async () => {
    const { cookie, csrf } = await login('bob');
    seen.length = 0;
    await http().post('/admin/api/resources/gadget').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ name: 'bob made it' });
    expect(seen).toEqual(['BOB/BOB']);
  });

  test('sessions: list with "current", revoke one, log out', async () => {
    const first = await login('bob');
    const second = await login('bob');
    const list = await http().get('/admin/api/account/sessions').set('Cookie', second.cookie);
    const mine = list.body.items as Array<{ id: string; current: boolean }>;
    expect(mine.filter((session) => session.current)).toHaveLength(1);
    const firstId = first.cookie.split('=')[1]!;
    expect(mine.find((session) => session.id === firstId)?.current).toBe(false);

    expect((await http().delete(`/admin/api/account/sessions/${firstId}`).set('Cookie', second.cookie).set('X-CSRF-Token', second.csrf)).status).toBe(204);
    expect((await http().get('/admin/api/meta').set('Cookie', first.cookie)).status).toBe(401);

    const out = await http().delete('/admin/api/session').set('Cookie', second.cookie).set('X-CSRF-Token', second.csrf);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect((await http().get('/admin/api/meta').set('Cookie', second.cookie)).status).toBe(401);
  });

  test('features the adapter lacks are 404', async () => {
    const { cookie, csrf } = await login();
    expect((await http().delete('/admin/api/account/sessions').set('Cookie', cookie).set('X-CSRF-Token', csrf)).status).toBe(404);
    expect((await http().post('/admin/api/account/password').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ current: 'a', next: 'b' })).status).toBe(404);
  });

  test('an adapter that throws is a 500 with a correlation id, never a way in', async () => {
    const { cookie } = await login();
    fake.failAuthenticate = true;
    try {
      const res = await http().get('/admin/api/meta').set('Cookie', cookie);
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({ code: 'INTERNAL', correlationId: expect.any(String) });
    } finally {
      fake.failAuthenticate = false;
    }
  });
});

describe('open admins', () => {
  test('AdminAuth.none() lets everyone in as a superuser', async () => {
    const open = await createTestApp({ admin: { auth: AdminAuth.none() } });
    try {
      const session = await request(open.getHttpServer()).get('/admin/api/session');
      expect(session.body).toMatchObject({ user: { id: 'anonymous', isSuperuser: true }, open: true, auth: { login: false } });
      expect(session.body.csrfToken).toBeUndefined();
      expect((await request(open.getHttpServer()).post('/admin/api/session').send({ username: 'a', password: 'b' })).status).toBe(404);
    } finally {
      await open.close();
    }
  });

  test('no auth with NODE_ENV=production does not boot', () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => resolveAdminOptions({})).toThrow('no `auth` configured with NODE_ENV=production');
      expect(() => resolveAdminOptions({ auth: AdminAuth.none() })).not.toThrow();
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
