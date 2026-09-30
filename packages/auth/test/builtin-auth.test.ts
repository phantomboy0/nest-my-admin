import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AdminModule } from '@nest-my-admin/core';
import { AdminAuthService } from '../../core/dist/auth/auth.service.js';
import { TEST_DB, testDatabase } from '../../core/test/helpers/test-db.js';
import { ADMIN_AUTH_ENTITIES, BuiltinAuthAdapter, NmaSession, NmaUser, builtinAuth, createAdminUser, totpCode, type BuiltinAuthOptions } from '../src/index.js';

const UI = fileURLToPath(new URL('../../core/test/fixtures/ui-dist', import.meta.url));
const FAST = { N: 1024, r: 8, p: 1, keylen: 64 };
const START = new Date('2026-03-01T08:00:00Z');

let clock = START;
const tick = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

/** An app with the built-in auth on its own test database; closing it drops the database. */
async function authApp(options: BuiltinAuthOptions = {}, entities: Function[] = ADMIN_AUTH_ENTITIES): Promise<INestApplication> {
  const db = await testDatabase(entities);
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({ ...db.options, retryAttempts: 0 }),
        AdminModule.forRoot({ uiDistPath: UI, auth: builtinAuth({ now: () => clock, scrypt: FAST, ...options }) }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    app.set('trust proxy', true);
    await app.init();
    const close = app.close.bind(app);
    app.close = async () => {
      try {
        await close();
      } finally {
        await db.drop();
      }
    };
    return app;
  } catch (error) {
    await db.drop();
    throw error;
  }
}

let app: INestApplication;
let dataSource: DataSource;
const http = () => request(app.getHttpServer());
const cookieOf = (res: request.Response) => String((res.headers['set-cookie'] as unknown as string[])[0]).split(';')[0]!;

async function login(username = 'ada', password = 'ada-password-1'): Promise<{ cookie: string; csrf: string; res: request.Response }> {
  const res = await http().post('/admin/api/session').send({ username, password });
  return { cookie: res.status === 200 ? cookieOf(res) : '', csrf: res.body.csrfToken, res };
}

beforeAll(async () => {
  app = await authApp({ bootstrapSuperuser: { username: 'Ada', password: 'ada-password-1', displayName: 'Ada Lovelace' } });
  dataSource = app.get(getDataSourceToken());
  await createAdminUser(dataSource, { username: 'bob', password: 'bob-password-1' }, { scrypt: FAST });
});
afterAll(async () => {
  await app.close();
});

describe(`built-in auth (${TEST_DB})`, () => {
  test('the bootstrap superuser exists, and only the hash of the password is stored', async () => {
    const ada = await dataSource.getRepository(NmaUser).findOneByOrFail({ username: 'ada' });
    expect(ada).toMatchObject({ displayName: 'Ada Lovelace', isSuperuser: true, isActive: true });
    expect(ada.passwordHash).toStartWith('scrypt$1024$8$1$');
    expect(ada.passwordHash).not.toContain('ada-password-1');
  });

  test('login sets an HttpOnly, SameSite=Lax cookie on the admin path; only the token hash is stored (Review Focus 3)', async () => {
    clock = START;
    const { res, cookie, csrf } = await login('ADA ', 'ada-password-1'); // usernames ignore case and spaces
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: expect.any(String), displayName: 'Ada Lovelace', username: 'ada', isSuperuser: true });
    const header = String((res.headers['set-cookie'] as unknown as string[])[0]);
    expect(header).toMatch(/^nma_session=[A-Za-z0-9_-]{43}; Path=\/admin; Max-Age=2592000; HttpOnly; SameSite=Lax$/);
    const token = cookie.split('=')[1]!;
    const rows = await dataSource.getRepository(NmaSession).find();
    expect(rows.some((row) => row.tokenHash === token || row.id === token)).toBe(false);
    expect(rows.map((row) => row.tokenHash)).toContain(new Bun.CryptoHasher('sha256').update(token).digest('hex'));
    const session = await http().get('/admin/api/session').set('Cookie', cookie);
    expect(session.body).toMatchObject({ csrfToken: csrf, open: false, auth: { login: true, logout: true, sessions: true, revokeOthers: true, password: true } });
  });

  test('the cookie is Secure on https', async () => {
    const res = await http().post('/admin/api/session').set('X-Forwarded-Proto', 'https').send({ username: 'ada', password: 'ada-password-1' });
    expect(String((res.headers['set-cookie'] as unknown as string[])[0])).toContain('; Secure; SameSite=Lax');
  });

  test('unknown user, wrong password and locked account answer the same (Review Focus 4)', async () => {
    const unknown = await login('nobody', 'whatever-password');
    const wrong = await login('bob', 'not-his-password');
    for (const res of [unknown.res, wrong.res]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Wrong username or password' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  test('5 wrong passwords lock the account for 15 minutes, even for the right password', async () => {
    clock = START;
    await createAdminUser(dataSource, { username: 'carol', password: 'carol-password-1' }, { scrypt: FAST });
    for (let i = 0; i < 5; i++) expect((await login('carol', 'wrong-password')).res.status).toBe(401);
    const locked = await login('carol', 'carol-password-1');
    expect(locked.res.status).toBe(401);
    expect(locked.res.body.message).toBe('Wrong username or password');
    tick(15 * 60 + 1);
    expect((await login('carol', 'carol-password-1')).res.status).toBe(200);
    expect((await dataSource.getRepository(NmaUser).findOneByOrFail({ username: 'carol' })).failedLogins).toBe(0);
  });

  test('idle and absolute expiry end a session for good', async () => {
    clock = START;
    const { cookie } = await login('bob', 'bob-password-1');
    tick(11 * 3600);
    expect((await http().get('/admin/api/meta').set('Cookie', cookie)).status).toBe(200); // slides
    tick(11 * 3600);
    expect((await http().get('/admin/api/meta').set('Cookie', cookie)).status).toBe(200);
    tick(12 * 3600 + 1);
    expect((await http().get('/admin/api/meta').set('Cookie', cookie)).status).toBe(401); // idle

    clock = START;
    const kept = await login('bob', 'bob-password-1');
    // Active every 11 hours (inside the idle limit): fine until 30 days after sign-in, however active.
    for (let elapsed = 11 * 3600; ; elapsed += 11 * 3600) {
      tick(11 * 3600);
      const res = await http().get('/admin/api/meta').set('Cookie', kept.cookie);
      if (elapsed < 30 * 24 * 3600) expect(res.status).toBe(200);
      else {
        expect(res.status).toBe(401);
        break;
      }
    }
  });

  test('logout, revoke and log out everywhere else', async () => {
    clock = START;
    const a = await login('bob', 'bob-password-1');
    const b = await login('bob', 'bob-password-1');
    const c = await login('bob', 'bob-password-1');
    const sessions = (await http().get('/admin/api/account/sessions').set('Cookie', a.cookie)).body.items as Array<{ id: string; current: boolean }>;
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    const other = sessions.find((session) => !session.current)!;
    expect((await http().delete(`/admin/api/account/sessions/${other.id}`).set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf)).status).toBe(204);

    expect((await http().delete('/admin/api/account/sessions').set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf)).status).toBe(204);
    expect((await http().get('/admin/api/meta').set('Cookie', b.cookie)).status).toBe(401);
    expect((await http().get('/admin/api/meta').set('Cookie', c.cookie)).status).toBe(401);
    expect((await http().get('/admin/api/meta').set('Cookie', a.cookie)).status).toBe(200);

    const out = await http().delete('/admin/api/session').set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf);
    expect(out.status).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('nma_session=; Path=/admin; Max-Age=0');
    expect((await http().get('/admin/api/meta').set('Cookie', a.cookie)).status).toBe(401);
  });

  test('a session of someone else cannot be revoked', async () => {
    const ada = await login();
    const bob = await login('bob', 'bob-password-1');
    const bobSession = (await http().get('/admin/api/account/sessions').set('Cookie', bob.cookie)).body.items.find((s: { current: boolean }) => s.current).id;
    expect((await http().delete(`/admin/api/account/sessions/${bobSession}`).set('Cookie', ada.cookie).set('X-CSRF-Token', ada.csrf)).status).toBe(204);
    expect((await http().get('/admin/api/meta').set('Cookie', bob.cookie)).status).toBe(200);
  });

  test('password change: checks the current one and the policy, then ends the other sessions (Review Focus 3)', async () => {
    await createAdminUser(dataSource, { username: 'dan', password: 'dan-password-1' }, { scrypt: FAST });
    const here = await login('dan', 'dan-password-1');
    const elsewhere = await login('dan', 'dan-password-1');
    const change = (body: object) => http().post('/admin/api/account/password').set('Cookie', here.cookie).set('X-CSRF-Token', here.csrf).send(body);
    expect((await change({ current: 'nope-nope-nope', next: 'dan-password-2' })).body).toMatchObject({ code: 'VALIDATION', fields: { current: ['is wrong'] } });
    expect((await change({ current: 'dan-password-1', next: 'short' })).body).toMatchObject({ fields: { next: ['must be at least 10 characters'] } });
    expect((await change({ current: 'dan-password-1', next: 'dan-password-2' })).status).toBe(204);
    expect((await http().get('/admin/api/meta').set('Cookie', elsewhere.cookie)).status).toBe(401);
    expect((await http().get('/admin/api/meta').set('Cookie', here.cookie)).status).toBe(200);
    expect((await login('dan', 'dan-password-1')).res.status).toBe(401);
    expect((await login('dan', 'dan-password-2')).res.status).toBe(200);
  });

  test('an inactive user cannot sign in, and their sessions stop working', async () => {
    await createAdminUser(dataSource, { username: 'eve', password: 'eve-password-1' }, { scrypt: FAST });
    const { cookie } = await login('eve', 'eve-password-1');
    await dataSource.getRepository(NmaUser).update({ username: 'eve' }, { isActive: false });
    expect((await http().get('/admin/api/meta').set('Cookie', cookie)).status).toBe(401);
    expect((await login('eve', 'eve-password-1')).res.body.message).toBe('Wrong username or password');
  });
});

describe(`built-in auth limits and boot (${TEST_DB})`, () => {
  test('more than the per-IP attempts per minute is 429 with Retry-After (Review Focus 4)', async () => {
    const limited = await authApp({ loginAttemptsPerMinute: 3 });
    try {
      const attempt = () => request(limited.getHttpServer()).post('/admin/api/session').send({ username: 'x', password: 'y' });
      for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
      const refused = await attempt();
      expect(refused.status).toBe(429);
      expect(refused.body.code).toBe('RATE_LIMITED');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });

  test('bootstrap only on an empty table; a DataSource without the entities does not boot', async () => {
    expect(await dataSource.getRepository(NmaUser).count()).toBeGreaterThan(1);
    await expect(authApp({}, [])).rejects.toThrow('add ADMIN_AUTH_ENTITIES to the entities of the DataSource "default"');
  });

  test('createAdminUser checks the username and the policy', async () => {
    await expect(createAdminUser(dataSource, { username: 'has space', password: 'long-enough-1' }, { scrypt: FAST })).rejects.toThrow('not a valid username');
    await expect(createAdminUser(dataSource, { username: 'frank', password: 'short' }, { scrypt: FAST })).rejects.toThrow('must be at least 10 characters');
  });
});

describe(`built-in auth: the Users page methods (${TEST_DB})`, () => {
  const adapter = () => (app.get(AdminAuthService) as AdminAuthService).adapter as BuiltinAuthAdapter;

  test('create (policy and uniqueness checked), list with search, get', async () => {
    await expect(adapter().createUser({ username: 'Gina', displayName: ' Gina ', password: 'short' })).rejects.toThrow('Validation failed');
    const gina = await adapter().createUser({ username: 'Gina', displayName: ' Gina ', email: 'gina@example.test', password: 'gina-password-1' });
    expect(gina).toMatchObject({ username: 'gina', displayName: 'Gina', email: 'gina@example.test', isSuperuser: false, isActive: true });
    await expect(adapter().createUser({ username: 'gina', displayName: 'Again', password: 'gina-password-2' })).rejects.toMatchObject({ fields: { username: ['is taken'] } });
    const found = await adapter().listUsers({ search: 'GINA', page: 1, pageSize: 10 });
    expect(found.items.map((user) => user.username)).toEqual(['gina']);
    expect(found.total).toBe(1);
    expect((await adapter().getUser(String(gina.id)))!.email).toBe('gina@example.test');
    expect(await adapter().getUser('not-a-number')).toBeNull();
  });

  test('deactivating ends the sessions; setting a password ends them too', async () => {
    const hal = await adapter().createUser({ username: 'hal', displayName: 'Hal', password: 'hal-password-1' });
    const first = await login('hal', 'hal-password-1');
    await adapter().updateUser(String(hal.id), { isActive: false });
    expect((await http().get('/admin/api/meta').set('Cookie', first.cookie)).status).toBe(401);
    await adapter().updateUser(String(hal.id), { isActive: true, displayName: 'Hal 9000' });
    const second = await login('hal', 'hal-password-1');
    expect(second.res.body.user.displayName).toBe('Hal 9000');
    await expect(adapter().setPassword(String(hal.id), 'hal')).rejects.toThrow('Validation failed');
    await adapter().setPassword(String(hal.id), 'hal-password-2');
    expect((await http().get('/admin/api/meta').set('Cookie', second.cookie)).status).toBe(401);
    expect((await login('hal', 'hal-password-2')).res.status).toBe(200);
  });
});

describe(`built-in auth: two-factor sign-in (${TEST_DB}, Review Focus 3)`, () => {
  let twoFa: INestApplication;
  const key = Buffer.alloc(32, 7).toString('base64');
  const post = (path: string, session: { cookie: string; csrf: string }, body: object = {}) =>
    request(twoFa.getHttpServer()).post(`/admin/api${path}`).set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf).send(body);
  const signIn = async (body: object) => {
    tick(1); // stay under the per-minute attempts
    const res = await request(twoFa.getHttpServer()).post('/admin/api/session').send({ username: 'cy', password: 'cy-password-1', ...body });
    return { res, cookie: res.status === 200 ? cookieOf(res) : '', csrf: res.body.csrfToken as string };
  };
  let secret = '';
  let recovery: string[] = [];

  beforeAll(async () => {
    clock = START;
    twoFa = await authApp({ secretKey: key, issuer: 'Demo Admin' });
    await createAdminUser(twoFa.get(getDataSourceToken()), { username: 'cy', password: 'cy-password-1' }, { scrypt: FAST });
  });
  afterAll(async () => {
    await twoFa.close();
  });

  test('setup: a key to scan, confirmed with a code; recovery codes once; the key is sealed at rest', async () => {
    const first = await signIn({});
    const other = await signIn({});
    expect((await request(twoFa.getHttpServer()).get('/admin/api/session').set('Cookie', first.cookie)).body.auth.twoFactor).toBe(true);
    const setup = await post('/account/2fa/setup', first);
    expect(setup.status).toBe(200);
    secret = setup.body.secret;
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUrl).toBe(`otpauth://totp/Demo%20Admin:cy?secret=${secret}&issuer=Demo+Admin&algorithm=SHA1&digits=6&period=30`);
    expect((await post('/account/2fa/confirm', first, { code: '000000' })).body.fields).toEqual({ code: ['is wrong'] });
    const confirmed = await post('/account/2fa/confirm', first, { code: totpCode(secret, clock) });
    expect(confirmed.status).toBe(200);
    recovery = confirmed.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect(recovery[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    const row = await twoFa.get(getDataSourceToken()).getRepository(NmaUser).findOneByOrFail({ username: 'cy' });
    expect(row.totpSecret).toStartWith('v1:');
    expect(row.totpSecret).not.toContain(secret);
    expect(row.recoveryCodes).not.toContain(recovery[0]!);
    // Other sessions signed in without the second factor: they end.
    expect((await request(twoFa.getHttpServer()).get('/admin/api/session').set('Cookie', other.cookie)).status).toBe(401);
    expect((await request(twoFa.getHttpServer()).get('/admin/api/account/2fa').set('Cookie', first.cookie)).body).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    expect((await post('/account/2fa/setup', first)).status).toBe(422); // already on
  });

  test('no session without the second factor; a code works once', async () => {
    const missing = await signIn({});
    expect(missing.res.status).toBe(401);
    expect(missing.res.body.code).toBe('TWO_FACTOR_REQUIRED');
    expect(missing.res.headers['set-cookie']).toBeUndefined();
    tick(60); // a new step: the setup code's step is used
    const code = totpCode(secret, clock);
    const ok = await signIn({ otp: code });
    expect(ok.res.status).toBe(200);
    const replay = await signIn({ otp: code });
    expect(replay.res.status).toBe(401);
    expect(replay.res.body).toMatchObject({ code: 'TWO_FACTOR_REQUIRED', message: 'The code is wrong or was already used' });
    // The password still has to be right: a code does not replace it.
    tick(30);
    expect((await signIn({ password: 'wrong-password', otp: totpCode(secret, clock) })).res.body.code).toBe('UNAUTHENTICATED');
  });

  test('recovery codes work once each, in any case and spacing', async () => {
    const used = recovery[0]!;
    expect((await signIn({ otp: used.toUpperCase().replace('-', ' ') })).res.status).toBe(200);
    expect((await signIn({ otp: used })).res.status).toBe(401);
    const session = await signIn({ otp: recovery[1]! });
    expect((await request(twoFa.getHttpServer()).get('/admin/api/account/2fa').set('Cookie', session.cookie)).body.recoveryCodesLeft).toBe(8);
    expect((await post('/account/2fa/recovery-codes', session, { password: 'nope' })).status).toBe(422);
    const fresh = await post('/account/2fa/recovery-codes', session, { password: 'cy-password-1' });
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect((await signIn({ otp: recovery[2]! })).res.status).toBe(401); // the old ones are gone
    recovery = fresh.body.recoveryCodes;
  });

  test('wrong codes count toward the lockout', async () => {
    tick(20 * 60); // clear the earlier lockout window and failures
    await signIn({ otp: recovery[3]! }); // a success resets the counter
    for (let i = 0; i < 5; i++) expect((await signIn({ otp: '123456' })).res.status).toBe(401);
    tick(30);
    const locked = await signIn({ otp: totpCode(secret, clock) });
    expect(locked.res.body).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Wrong username or password' });
    tick(16 * 60);
    expect((await signIn({ otp: totpCode(secret, clock) })).res.status).toBe(200);
  });

  test('disabling needs the password; then the password alone signs in', async () => {
    tick(60);
    const session = await signIn({ otp: totpCode(secret, clock) });
    expect((await post('/account/2fa/disable', session, { password: 'wrong' })).body.fields).toEqual({ password: ['is wrong'] });
    expect((await post('/account/2fa/disable', session, { password: 'cy-password-1' })).status).toBe(204);
    expect((await signIn({})).res.status).toBe(200);
    const row = await twoFa.get(getDataSourceToken()).getRepository(NmaUser).findOneByOrFail({ username: 'cy' });
    expect(row).toMatchObject({ totpSecret: null, totpPending: null, recoveryCodes: null });
  });

  test('an admin can reset a lost second factor; that ends the sessions', async () => {
    const adapter = twoFa.get(AdminAuthService).adapter as BuiltinAuthAdapter;
    const session = await signIn({});
    const setup = await post('/account/2fa/setup', session);
    await post('/account/2fa/confirm', session, { code: totpCode(setup.body.secret, clock) });
    const row = await twoFa.get(getDataSourceToken()).getRepository(NmaUser).findOneByOrFail({ username: 'cy' });
    expect((await adapter.getUser(String(row.id)))!.twoFactor).toBe(true);
    await adapter.resetTwoFactor(String(row.id));
    expect((await request(twoFa.getHttpServer()).get('/admin/api/session').set('Cookie', session.cookie)).status).toBe(401);
    expect((await signIn({})).res.status).toBe(200);
  });
});
