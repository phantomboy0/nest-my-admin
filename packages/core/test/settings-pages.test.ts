import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { BadRequestException, Injectable, Logger, Module, type INestApplication } from '@nestjs/common';
import { InjectDataSource, getDataSourceToken } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import request, { type Response } from 'supertest';
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Column, Entity, PrimaryColumn, type DataSource } from 'typeorm';
import {
  ADMIN_FILE_ENTITIES,
  AdminAction,
  AdminAuth,
  AdminField,
  AdminFieldError,
  AdminGroup,
  AdminResource,
  AdminResourceBase,
  AdminSettingsPage,
  AdminValidationError,
  NmaFile,
  localStorage,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminFile,
  type AdminPrincipal,
  type AdminSettingsSource,
  type AdminUserRecord,
  type RoleDefinition,
} from '../src/index.js';
import type { MetaResponse, PageResponse } from '../src/contract.js';
import { AdminPolicy } from '../src/policy/admin-policy.service.js';
import { buildCatalog } from '../src/policy/catalog.js';
import { knownCodes } from '../src/policy/roles.js';
import { PageRegistry } from '../src/pages/page-registry.js';
import { ResourceRegistry } from '../src/registry/resource-registry.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

/** A value that must never leave the server: every response body of this file is searched for it at the end. */
const SENTINEL = 'sk_live_SENTINEL_9f3a71c2';
const OLD_SECRET = 'sk_old_SENTINEL_55aa01';

@Entity('sp_setting')
class Setting {
  @PrimaryColumn({ length: 40 }) name: string;
  @Column({ type: 'text' }) value: string;
}

/** A table of the host with a unique column: saving a secret another row holds is a unique violation that quotes it. */
@Entity('sp_vault')
class Vault {
  @PrimaryColumn({ length: 40 }) name: string;
  @Column({ type: 'varchar', length: 80, unique: true }) token: string;
}

/** A domain error of the host, which its `errorMapper` turns into a field error. */
class ProviderError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

class SmtpDto {
  @IsString() @Length(1, 60) host: string;
  @IsOptional() @IsInt() @Min(1) port?: number;
}

class ShopSettingsDto {
  @AdminField({ label: { en: 'Shop name', fa: 'نام فروشگاه' } })
  @IsString()
  @Length(2, 40)
  shopName: string;

  @IsOptional() @IsInt() @Min(0) lowStock?: number;
  @IsOptional() @IsBoolean() open?: boolean;
  @IsOptional() @IsIn(['sandbox', 'live']) mode?: string;
  @IsOptional() @ValidateNested() @Type(() => SmtpDto) smtp?: SmtpDto;
  @IsOptional() @IsString() @Length(8, 64) apiKey?: string | null;
  /** Not optional: clearing it with null must work all the same. Its message would echo what was sent. */
  @IsString() @Length(8, 64, { message: 'the hook secret "$value" is too short or too long' }) webhookSecret: string;
  @IsOptional() @IsString() logo?: string | null;
  @IsOptional() @IsString() about?: string;
}

/** What the page's methods saw, and what they are told to do next. */
const host: {
  saves: Array<{ changes: Record<string, unknown>; inTransaction: boolean }>;
  /** `load()` calls so far in this test. */
  loads: number;
  /** Told which call this is (1 = the first of the test). */
  loadFails?: (call: number) => Error | undefined;
  saveFails?: (changes: Record<string, unknown>) => Error | undefined;
  /** More writes of the host inside `save()`. */
  inSave?: (changes: Record<string, unknown>, ctx: AdminContext) => Promise<void>;
} = { saves: [], loads: 0 };

@AdminSettingsPage('shop', {
  label: { en: 'Shop settings', fa: 'تنظیمات فروشگاه' },
  icon: 'store',
  form: ShopSettingsDto,
  fields: {
    apiKey: { secret: true, help: 'The payment provider key' },
    webhookSecret: { secret: true },
    logo: { widget: 'image', file: { maxBytes: 2000 } },
    about: { widget: 'richtext' },
    mode: { widget: 'radio', enumLabels: { live: { en: 'Live', fa: 'واقعی' } } },
  },
  layout: [{ section: { en: 'General', fa: 'عمومی' }, fields: ['shopName', 'lowStock', 'open', 'mode', 'logo', 'about'] }, { section: 'Integrations', fields: ['smtp', 'apiKey', 'webhookSecret'], columns: 2 }],
})
class ShopSettingsPage implements AdminSettingsSource<ShopSettingsDto> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async load(ctx: AdminContext): Promise<Partial<ShopSettingsDto>> {
    const failure = host.loadFails?.(++host.loads);
    if (failure) throw failure;
    const rows = await (ctx.manager ?? this.dataSource.manager).find(Setting);
    // A key the form does not have: it must never be served.
    return { ...Object.fromEntries(rows.map((row) => [row.name, JSON.parse(row.value)])), internalNote: 'not a field' } as Partial<ShopSettingsDto>;
  }

  async save(changes: Partial<ShopSettingsDto>, ctx: AdminContext): Promise<void> {
    host.saves.push({ changes: { ...changes }, inTransaction: ctx.manager !== undefined });
    const repo = (ctx.manager ?? this.dataSource.manager).getRepository(Setting);
    for (const [name, value] of Object.entries(changes)) {
      // File fields arrive as AdminFiles: the host stores the key.
      const stored = name === 'logo' && value ? (value as unknown as AdminFile).key : value;
      await repo.save({ name, value: JSON.stringify(stored) });
    }
    await host.inSave?.(changes as Record<string, unknown>, ctx);
    const failure = host.saveFails?.(changes as Record<string, unknown>);
    if (failure) throw failure;
  }
}

class NoticeDto {
  @IsString() text: string;
}
/** A second page in a group that has no resource at all. */
@AdminSettingsPage('notices', { form: NoticeDto, group: 'tools' })
class NoticesPage implements AdminSettingsSource<NoticeDto> {
  load() {
    return { text: 'hello' };
  }
  save() {}
}

const users = new Map<string, AdminUserRecord>();
for (const [id, isSuperuser] of [['root', true], ['manager', false], ['viewer', false], ['saver', false], ['wild', false], ['paged', false], ['stars', false], ['nobody', false]] as const) {
  users.set(id, { id, displayName: id.toUpperCase(), username: id, isSuperuser, isActive: true });
}
const ROLES: RoleDefinition[] = [
  { name: 'manager', permissions: ['page.shop', 'page.shop.update'] },
  { name: 'viewer', permissions: ['page.shop'] },
  { name: 'saver', permissions: ['page.shop.update'] },
  { name: 'wild', permissions: ['*'] },
  { name: 'paged', permissions: ['page.*'] },
  // A pattern over every resource: valid (it matches `widget.view`), and never about pages.
  { name: 'stars', permissions: ['*.*'] },
  { name: 'nobody', permissions: ['widget.view'] },
];

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return users.get(String(user.id))?.isSuperuser ? [] : [String(user.id)];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@AdminGroup({ label: { en: 'Configuration', fa: 'پیکربندی' }, order: 5 })
@Module({ providers: [ShopSettingsPage, NoticesPage, HeaderAuth] })
class ConfigModule {}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

let app: INestApplication;
let dir: string;
let db: DataSource;
/** Every answer of this file goes through here: none may contain a secret (each test checks its own, whatever else runs). */
const seen = (res: Response): Response => {
  expect(res.text ?? JSON.stringify(res.body)).not.toContain('SENTINEL');
  return res;
};
const getPage = async (who = 'root', name = 'shop', headers: Record<string, string> = {}) => seen(await request(app.getHttpServer()).get(`/admin/api/pages/${name}`).set('X-User', who).set(headers));
const patch = async (body: unknown, who = 'root', headers: Record<string, string> = {}) =>
  seen(await request(app.getHttpServer()).patch('/admin/api/pages/shop').set('X-User', who).set(headers).send(body as object));
const upload = async (who = 'root', field = 'logo', page = 'shop') =>
  seen(await request(app.getHttpServer()).post(`/admin/api/uploads?resource=page:${page}&field=${field}`).set('X-User', who).set('Content-Type', 'image/png').set('X-File-Name', 'logo.png').send(PNG));
const download = (key: string, who = 'root') => request(app.getHttpServer()).get(`/admin/api/files/${key}`).set('X-User', who);
const storedValues = async (): Promise<Record<string, unknown>> => Object.fromEntries((await db.getRepository(Setting).find()).map((row) => [row.name, JSON.parse(row.value)]));
const put = async (values: Record<string, unknown>) => {
  await db.getRepository(Setting).clear();
  await db.getRepository(Setting).save(Object.entries(values).map(([name, value]) => ({ name, value: JSON.stringify(value) })));
};
const filePath = (key: string) => join(dir, ...key.split('/'));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nma-pages-'));
  app = await createTestApp({
    entities: [Setting, Vault, ...ADMIN_FILE_ENTITIES],
    imports: [ConfigModule],
    admin: {
      auth: AdminAuth.custom(HeaderAuth),
      roles: ROLES,
      locales: ['en', 'fa'],
      files: { storage: localStorage({ dir }), maxBytes: 5000 },
      errorMapper: (error) => (error instanceof ProviderError ? new AdminValidationError({ [error.field]: [error.message] }, 'The provider said no') : undefined),
    },
  });
  db = app.get<DataSource>(getDataSourceToken());
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  host.saves = [];
  host.loads = 0;
  host.loadFails = undefined;
  host.saveFails = undefined;
  host.inSave = undefined;
  await db.getRepository(Vault).clear();
  await put({ shopName: 'Lamp Shop', lowStock: 3, open: true, mode: 'sandbox', smtp: { host: 'mail.test', port: 25 }, apiKey: OLD_SECRET });
});

describe(`GET /api/pages/:name (${TEST_DB})`, () => {
  test('answers the schema, the values without secrets, and which secrets are set', async () => {
    const res = await getPage();
    expect(res.status).toBe(200);
    const { schema, values, secrets, files } = res.body as PageResponse;
    expect(schema).toMatchObject({ name: 'shop', label: 'Shop settings', icon: 'store', readonly: false, required: ['shopName', 'webhookSecret'] });
    expect(schema.fields.map((field) => field.name)).toEqual(['shopName', 'lowStock', 'open', 'mode', 'smtp', 'apiKey', 'webhookSecret', 'logo', 'about']);
    const field = (name: string) => schema.fields.find((candidate) => candidate.name === name)!;
    expect(field('shopName')).toMatchObject({ label: 'Shop name', type: 'string' });
    expect(field('lowStock')).toMatchObject({ type: 'number', integer: true });
    expect(field('open').type).toBe('boolean');
    expect(field('mode')).toMatchObject({ type: 'enum', enumValues: ['sandbox', 'live'], widget: 'radio', enumLabels: { live: 'Live' } });
    expect(field('smtp')).toMatchObject({ type: 'object' });
    expect(field('smtp').fields!.map((child) => child.name)).toEqual(['host', 'port']);
    expect(field('apiKey')).toMatchObject({ secret: true, help: 'The payment provider key' });
    expect(field('webhookSecret').secret).toBe(true);
    expect(field('shopName').secret).toBeUndefined();
    expect(field('logo')).toMatchObject({ widget: 'image', file: { accept: ['image/*'], maxBytes: 2000, many: false } });
    expect(schema.constraints.shopName).toEqual({ required: true, minLength: 2, maxLength: 40 });
    expect(schema.constraints['smtp.host']).toMatchObject({ required: true, maxLength: 60 });
    expect(schema.layout).toEqual([
      { title: 'General', fields: ['shopName', 'lowStock', 'open', 'mode', 'logo', 'about'], columns: 1 },
      { title: 'Integrations', fields: ['smtp', 'apiKey', 'webhookSecret'], columns: 2 },
    ]);

    // Every field that is not a secret, null when nothing is stored; nothing the form does not have.
    expect(values).toEqual({ shopName: 'Lamp Shop', lowStock: 3, open: true, mode: 'sandbox', smtp: { host: 'mail.test', port: 25 }, logo: null, about: null });
    expect(secrets).toEqual({ apiKey: true, webhookSecret: false });
    expect(files).toEqual({});
    expect(Object.keys(res.body).sort()).toEqual(['files', 'schema', 'secrets', 'values']);
  });

  test('labels follow Accept-Language', async () => {
    const res = seen(await request(app.getHttpServer()).get('/admin/api/pages/shop').set('X-User', 'root').set('Accept-Language', 'fa'));
    expect(res.body.schema.label).toBe('تنظیمات فروشگاه');
    expect(res.body.schema.fields[0].label).toBe('نام فروشگاه');
    expect(res.body.schema.layout[0].title).toBe('عمومی');
  });

  test('an empty or missing secret is reported as not set', async () => {
    await put({ shopName: 'S', apiKey: '', webhookSecret: null });
    expect((await getPage()).body.secrets).toEqual({ apiKey: false, webhookSecret: false });
  });

  // About the response only: what load() throws outside a save is logged as thrown (core does not know the secrets yet).
  test('load() throwing answers a 500 with a correlation id and nothing else (Review Focus 5)', async () => {
    host.loadFails = () => new Error(`the vault is down, key was ${SENTINEL}`);
    const res = await getPage();
    expect(res.status).toBe(500);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'correlationId', 'message']);
    expect(res.body).toMatchObject({ code: 'INTERNAL', message: 'Internal error' });
    expect(typeof res.body.correlationId).toBe('string');
  });

  test('an unknown page is a 404', async () => {
    const res = await getPage('root', 'nope');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Unknown page "nope"');
  });
});

describe(`PATCH /api/pages/:name (${TEST_DB})`, () => {
  test('saves only the keys that were sent, inside a transaction, and answers like GET', async () => {
    const res = await patch({ lowStock: 9, smtp: { host: 'smtp.example.com' } });
    expect(res.status).toBe(200);
    expect(host.saves).toEqual([{ changes: { lowStock: 9, smtp: { host: 'smtp.example.com' } }, inTransaction: true }]);
    expect(Object.keys(res.body).sort()).toEqual(['files', 'schema', 'secrets', 'values']);
    expect(res.body.values).toMatchObject({ shopName: 'Lamp Shop', lowStock: 9, smtp: { host: 'smtp.example.com' }, open: true });
    expect(res.body.secrets).toEqual({ apiKey: true, webhookSecret: false });
    expect(await storedValues()).toMatchObject({ shopName: 'Lamp Shop', lowStock: 9, apiKey: OLD_SECRET });
  });

  test('a secret is replaced by a new value, which is never answered', async () => {
    const res = await patch({ apiKey: SENTINEL, webhookSecret: `${SENTINEL}-hook` });
    expect(res.status).toBe(200);
    expect(host.saves[0]!.changes).toEqual({ apiKey: SENTINEL, webhookSecret: `${SENTINEL}-hook` });
    expect(res.body.values.apiKey).toBeUndefined();
    expect(res.body.values.webhookSecret).toBeUndefined();
    expect(res.body.secrets).toEqual({ apiKey: true, webhookSecret: true });
    expect((await storedValues()).apiKey).toBe(SENTINEL);
    expect(res.text).not.toContain('SENTINEL');
  });

  test('null clears a secret, even one the DTO requires', async () => {
    await put({ shopName: 'S', apiKey: SENTINEL, webhookSecret: `${SENTINEL}-hook` });
    const res = await patch({ apiKey: null, webhookSecret: null });
    expect(res.status).toBe(200);
    expect(host.saves[0]!.changes).toEqual({ apiKey: null, webhookSecret: null });
    expect(res.body.secrets).toEqual({ apiKey: false, webhookSecret: false });
    expect(await storedValues()).toMatchObject({ apiKey: null, webhookSecret: null });
  });

  test('a secret that is not sent is left alone', async () => {
    await put({ shopName: 'S', apiKey: SENTINEL });
    const res = await patch({ shopName: 'Renamed' });
    expect(res.status).toBe(200);
    expect(host.saves[0]!.changes).toEqual({ shopName: 'Renamed' });
    expect(res.body.secrets.apiKey).toBe(true);
    expect((await storedValues()).apiKey).toBe(SENTINEL);
  });

  test('an empty string for a secret is refused and changes nothing (Review Focus 4)', async () => {
    await put({ shopName: 'S', apiKey: SENTINEL });
    const res = await patch({ shopName: 'Other', apiKey: '' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.fields).toEqual({ apiKey: ['must not be empty: send null to clear it, or leave it out to keep it'] });
    expect(host.saves).toEqual([]);
    expect(await storedValues()).toMatchObject({ shopName: 'S', apiKey: SENTINEL });
  });

  test('a secret is validated by the DTO, and a message that would echo it is replaced', async () => {
    const short = await patch({ apiKey: 'short' });
    expect(short.status).toBe(422);
    expect(short.body.fields.apiKey).toEqual(['apiKey must be longer than or equal to 8 characters']);
    const wrong = await patch({ apiKey: 12345678 });
    expect(wrong.status).toBe(422);
    expect(Object.keys(wrong.body.fields)).toEqual(['apiKey']);
    // The DTO's own message uses `$value`: it is replaced whole, however short the value is.
    const echoed = await patch({ webhookSecret: 'hunter2' });
    expect(echoed.status).toBe(422);
    expect(echoed.body.fields).toEqual({ webhookSecret: ['is not valid'] });
    expect(echoed.text).not.toContain('hunter2');
    expect(host.saves).toEqual([]);
  });

  test('wrong types, unknown keys and nested errors are a 422 before save() runs', async () => {
    const res = await patch({ shopName: 'x', lowStock: -1, mode: 'prod', smtp: { host: '', port: 0 }, nope: 1 });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ nope: ['is not a writable field'] });
    const typed = await patch({ shopName: 'x', lowStock: -1, mode: 'prod', smtp: { port: 0 } });
    expect(typed.status).toBe(422);
    expect(Object.keys(typed.body.fields).sort()).toEqual(['lowStock', 'mode', 'shopName', 'smtp.port']);
    expect((await patch([])).status).toBe(400);
    expect(host.saves).toEqual([]);
  });

  test('a required field that is not sent does not fail a partial save', async () => {
    await put({});
    expect((await patch({ open: false })).status).toBe(200);
  });

  test('AdminFieldError from save() is a 422 on that field, and the transaction rolls back (Review Focus 5)', async () => {
    host.saveFails = () => new AdminFieldError({ shopName: 'is taken by another shop' });
    const res = await patch({ shopName: 'Taken' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION', fields: { shopName: ['is taken by another shop'] } });
    // save() wrote through ctx.manager before failing.
    expect((await storedValues()).shopName).toBe('Lamp Shop');
  });

  test('a host error that names a secret is scrubbed, in the answer and in the log', async () => {
    const logged = spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      host.saveFails = (changes) => new AdminFieldError({ apiKey: `the provider refused "${String(changes.apiKey)}"` }, `Could not use ${String(changes.apiKey)}`);
      const refused = await patch({ apiKey: SENTINEL });
      expect(refused.status).toBe(422);
      expect(refused.body.fields.apiKey).toEqual(['the provider refused "***"']);
      expect(refused.body.message).toBe('Could not use ***');

      host.saveFails = (changes) => new BadRequestException(`Bad key ${String(changes.apiKey)}`);
      const bad = await patch({ apiKey: SENTINEL });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toBe('Bad key ***');

      // The stored secret is scrubbed too, and so is what is logged for a 500.
      host.saveFails = (changes) => new Error(`exploded replacing ${OLD_SECRET} by ${String(changes.apiKey)}`);
      const crashed = await patch({ apiKey: SENTINEL });
      expect(crashed.status).toBe(500);
      expect(Object.keys(crashed.body).sort()).toEqual(['code', 'correlationId', 'message']);
      const lines = logged.mock.calls.map((call) => call.map(String).join(' ')).join('\n');
      expect(lines).toContain('exploded replacing *** by ***');
      expect(lines).not.toContain('SENTINEL');
    } finally {
      logged.mockRestore();
    }
    expect((await storedValues()).apiKey).toBe(OLD_SECRET);
  });

  test("a host error keeps its class when scrubbed, so the host's errorMapper still maps it", async () => {
    const logged = spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      host.saveFails = (changes) => new ProviderError(`key ${String(changes.apiKey)} is revoked (${encodeURIComponent(`${SENTINEL} x`)}, ${JSON.stringify(`${SENTINEL}"`)})`, 'apiKey');
      const res = await patch({ apiKey: SENTINEL });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'VALIDATION', message: 'The provider said no', fields: { apiKey: ['key *** is revoked (***%20x, "***\\"")'] } });
      // Escaped forms of a secret with characters that JSON and URLs escape.
      const odd = 'p@ss "word"/1';
      host.saveFails = () => new ProviderError(`saw ${JSON.stringify(odd)} and ${encodeURIComponent(odd)}`, 'apiKey');
      const escaped = await request(app.getHttpServer()).patch('/admin/api/pages/shop').set('X-User', 'root').send({ apiKey: odd });
      expect(escaped.body.fields).toEqual({ apiKey: ['saw "***" and ***'] });
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  test('a unique violation that quotes the secret is still the mapped conflict, without the value', async () => {
    await db.getRepository(Vault).save({ name: 'taken', token: SENTINEL });
    host.inSave = async (changes, ctx) => void (await ctx.manager!.getRepository(Vault).insert({ name: 'mine', token: String(changes.apiKey) }));
    const logged = spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const res = await patch({ apiKey: SENTINEL });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'A record with this value already exists' });
      // MySQL names the unique index, not the column, and a page has no resource whose `dbNames` would translate it;
      // Postgres and SQLite name the column.
      expect(res.body.fields).toEqual(TEST_DB === 'mysql' ? undefined : { token: ['already exists'] });
      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
    expect((await storedValues()).apiKey).toBe(OLD_SECRET);
    expect(await db.getRepository(Vault).count()).toBe(1);
  });

  test('save() succeeding and the load() after it throwing: a 500, everything rolled back, the upload not attached', async () => {
    const sent = await upload();
    host.loadFails = (call) => (call === 2 ? new Error('the read replica is behind') : undefined);
    const res = await patch({ shopName: 'Half saved', logo: { token: sent.body.token } });
    expect(res.status).toBe(500);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'correlationId', 'message']);
    expect(host.saves).toHaveLength(1);
    expect(host.loads).toBe(2);
    // save() wrote through ctx.manager, so its rows went with the transaction.
    expect(await storedValues()).toMatchObject({ shopName: 'Lamp Shop' });
    expect((await storedValues()).logo).toBeUndefined();
    expect(await db.getRepository(NmaFile).findOneByOrFail({ id: sent.body.token })).toMatchObject({ status: 'temp', recordId: null });
    expect(await db.getRepository(NmaFile).countBy({ resource: 'page:shop', status: 'attached' })).toBe(0);
  });

  test('rich text goes through the sanitizer', async () => {
    const res = await patch({ about: '<p>Hello</p><script>alert(1)</script>' });
    expect(res.status).toBe(200);
    expect(host.saves[0]!.changes).toEqual({ about: '<p>Hello</p>' });
    expect(res.body.values.about).toBe('<p>Hello</p>');
  });
});

describe(`page permissions (${TEST_DB})`, () => {
  test('`page.shop` without `.update`: GET works read-only, PATCH is a 403', async () => {
    const res = await getPage('viewer');
    expect(res.status).toBe(200);
    expect(res.body.schema.readonly).toBe(true);
    expect(res.body.values.shopName).toBe('Lamp Shop');
    expect(res.body.values.apiKey).toBeUndefined();
    const refused = await patch({ shopName: 'Mine now' }, 'viewer');
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN', message: 'You may not change Shop settings' });
    expect(host.saves).toEqual([]);
  });

  test('without `page.shop`: 404 on GET and PATCH, and the page is not in meta', async () => {
    const res = await getPage('nobody');
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Unknown page "shop"');
    expect((await patch({ shopName: 'Mine now' }, 'nobody')).status).toBe(404);
    expect(host.saves).toEqual([]);
    const meta = seen(await request(app.getHttpServer()).get('/admin/api/meta').set('X-User', 'nobody')).body as MetaResponse;
    expect(meta.groups.flatMap((group) => group.pages)).toEqual([]);
    expect(meta.groups.map((group) => group.key)).toEqual(['widgets']);
  });

  test('whoever may save a page may see it; `*` and `page.*` cover pages', async () => {
    expect((await getPage('saver')).body.schema.readonly).toBe(false);
    expect((await patch({ open: false }, 'saver')).status).toBe(200);
    for (const who of ['wild', 'paged', 'manager']) {
      expect((await getPage(who)).status).toBe(200);
      expect((await patch({ open: true }, who)).status).toBe(200);
    }
    // Patterns that start with `*` are about resources: `*.*` reaches every resource and no page.
    expect((await getPage('stars')).status).toBe(404);
    expect((await patch({ open: true }, 'stars')).status).toBe(404);
    expect((await upload('stars')).status).toBe(404);
    expect(seen(await request(app.getHttpServer()).get('/admin/api/resources/widget').set('X-User', 'stars')).status).toBe(200);
    expect((seen(await request(app.getHttpServer()).get('/admin/api/meta').set('X-User', 'stars')).body as MetaResponse).groups.flatMap((group) => group.pages)).toEqual([]);
    // `page.*` is about pages only.
    expect(seen(await request(app.getHttpServer()).get('/admin/api/resources/widget').set('X-User', 'paged')).status).toBe(404);
  });

  test('meta lists the pages a user may view, in groups that may have no resource', async () => {
    const meta = seen(await request(app.getHttpServer()).get('/admin/api/meta').set('X-User', 'root').set('Accept-Language', 'fa')).body as MetaResponse;
    const config = meta.groups.find((group) => group.key === 'config')!;
    expect(config).toEqual({ key: 'config', label: 'پیکربندی', resources: [], pages: [{ name: 'shop', label: 'تنظیمات فروشگاه', icon: 'store' }] });
    expect(meta.groups.find((group) => group.key === 'tools')).toEqual({ key: 'tools', label: 'Tools', resources: [], pages: [{ name: 'notices', label: 'Notices' }] });
    expect(meta.groups.find((group) => group.key === 'widgets')!.pages).toEqual([]);
    expect(meta.groups[0]!.key).toBe('config'); // order: 5

    const forViewer = seen(await request(app.getHttpServer()).get('/admin/api/meta').set('X-User', 'viewer')).body as MetaResponse;
    expect(forViewer.groups.map((group) => [group.key, group.pages.map((page) => page.name)])).toEqual([['config', ['shop']]]);
  });

  test('view-as: GET shows the page as that user sees it, PATCH is a 403', async () => {
    const asViewer = await getPage('root', 'shop', { 'X-View-As': 'viewer' });
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.schema.readonly).toBe(true);
    // Even as someone who may save: nothing can be changed while viewing as another user.
    expect((await getPage('root', 'shop', { 'X-View-As': 'manager' })).body.schema.readonly).toBe(true);
    expect((await getPage('root', 'shop', { 'X-View-As': 'nobody' })).status).toBe(404);
    const res = await patch({ shopName: 'Changed' }, 'root', { 'X-View-As': 'manager' });
    expect(res.status).toBe(403);
    expect(host.saves).toEqual([]);
    const sent = await upload('root');
    expect(sent.status).toBe(201);
    expect(seen(await request(app.getHttpServer()).post('/admin/api/uploads?resource=page:shop&field=logo').set('X-User', 'root').set('X-View-As', 'manager').set('Content-Type', 'image/png').send(PNG)).status).toBe(403);
  });
});

describe(`page permissions in the catalog (${TEST_DB})`, () => {
  test('every page has a view code and a save code roles can name', () => {
    const catalog = buildCatalog(app.get(ResourceRegistry), { permissions: [], rbac: undefined } as never, app.get(PageRegistry).list().map((page) => page.name));
    expect(catalog.pages).toEqual(['shop', 'notices']);
    expect(knownCodes(catalog)).toEqual(expect.arrayContaining(['page.shop', 'page.shop.update', 'page.notices', 'page.notices.update']));
  });

  test('the debugger explains pages with the code the API enforces with', async () => {
    const explain = async (user: string) => {
      const entry = app.get(ResourceRegistry).get('widget');
      return (await app.get(AdminPolicy).explain(users.get(user)!, entry, entry.schema, {} as IncomingMessage, 'fa')).pages;
    };
    expect(await explain('viewer')).toEqual([
      { name: 'shop', label: 'تنظیمات فروشگاه', view: true, update: false, grantedBy: [{ role: 'viewer', pattern: 'page.shop', code: 'page.shop' }] },
      { name: 'notices', label: 'Notices', view: false, update: false, grantedBy: [] },
    ]);
    expect((await explain('saver'))[0]).toMatchObject({ view: true, update: true, grantedBy: [{ role: 'saver', pattern: 'page.shop.update', code: 'page.shop.update' }] });
    expect((await explain('paged'))[1]).toMatchObject({
      view: true,
      update: true,
      grantedBy: [
        { role: 'paged', pattern: 'page.*', code: 'page.notices' },
        { role: 'paged', pattern: 'page.*', code: 'page.notices.update' },
      ],
    });
    expect((await explain('root')).every((page) => page.view && page.update && page.grantedBy.length === 0)).toBe(true);
    // What it says is what the API does.
    expect(await explain('stars')).toEqual([
      { name: 'shop', label: 'تنظیمات فروشگاه', view: false, update: false, grantedBy: [] },
      { name: 'notices', label: 'Notices', view: false, update: false, grantedBy: [] },
    ]);
    for (const who of ['viewer', 'saver', 'paged', 'nobody', 'manager', 'stars']) {
      const shop = (await explain(who))[0]!;
      expect((await getPage(who)).status).toBe(shop.view ? 200 : 404);
      expect((await patch({ open: true }, who)).status).toBe(shop.update ? 200 : shop.view ? 403 : 404);
    }
  });
});

describe(`files of a page (${TEST_DB})`, () => {
  const rowOf = (token: string) => db.getRepository(NmaFile).findOneByOrFail({ id: token });

  test('an image is uploaded to `page:<name>`, saved, served and replaced', async () => {
    const first = await upload('manager');
    expect(first.status).toBe(201);
    const row = await rowOf(first.body.token);
    expect(row).toMatchObject({ resource: 'page:shop', field: 'logo', status: 'temp', recordId: null, createdBy: 'manager' });
    expect(row.key).toMatch(/^page\/shop\/logo\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);

    const saved = await patch({ logo: { token: first.body.token } }, 'manager');
    expect(saved.status).toBe(200);
    // save() gets the same AdminFile a resource would.
    expect(host.saves[0]!.changes.logo).toMatchObject({ key: row.key, name: 'logo.png', contentType: 'image/png', size: PNG.length, isNew: true });
    expect(saved.body.values.logo).toBe(row.key);
    expect(saved.body.files.logo).toEqual({ key: row.key, name: 'logo.png', contentType: 'image/png', size: PNG.length, url: `/admin/api/files/${row.key}` });
    expect(await rowOf(first.body.token)).toMatchObject({ status: 'attached', recordId: 'page' });
    expect((await getPage('viewer')).body.files.logo.key).toBe(row.key);

    // Whoever may view the page may fetch it; everyone else gets the 404 of a key that does not exist.
    const served = await download(row.key, 'viewer');
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    const refused = await download(row.key, 'nobody');
    const missing = await download('page/shop/logo/2026/01/nope.png', 'nobody');
    expect(refused.status).toBe(404);
    expect(refused.body.message).toBe(missing.body.message);

    // Keeping it by key changes nothing; a new upload replaces it and the old object goes after the commit.
    expect((await patch({ logo: { key: row.key }, open: true }, 'manager')).status).toBe(200);
    expect(existsSync(filePath(row.key))).toBe(true);
    const second = await upload('manager');
    const next = await rowOf(second.body.token);
    expect((await patch({ logo: { token: second.body.token } }, 'manager')).status).toBe(200);
    expect(await db.getRepository(NmaFile).findOneBy({ key: row.key })).toBeNull();
    expect(existsSync(filePath(row.key))).toBe(false);
    expect((await download(row.key)).status).toBe(404);
    expect((await download(next.key)).status).toBe(200);

    // null removes it.
    const cleared = await patch({ logo: null }, 'manager');
    expect(cleared.body.values.logo).toBeNull();
    expect(cleared.body.files).toEqual({});
    expect(existsSync(filePath(next.key))).toBe(false);
  });

  test('a failed save keeps the old file and gives the upload back', async () => {
    const first = await upload();
    const row = await rowOf(first.body.token);
    expect((await patch({ logo: { token: first.body.token } })).status).toBe(200);
    const second = await upload();
    host.saveFails = () => new AdminFieldError({ shopName: 'no' });
    expect((await patch({ logo: { token: second.body.token } })).status).toBe(422);
    expect(await rowOf(first.body.token)).toMatchObject({ status: 'attached' });
    expect(await rowOf(second.body.token)).toMatchObject({ status: 'temp', recordId: null });
    expect(existsSync(filePath(row.key))).toBe(true);
    expect((await storedValues()).logo).toBe(row.key);
  });

  test('uploads need the page and its `.update`; the field must be a file field of the page', async () => {
    const forbidden = await upload('viewer');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.message).toBe('You may not change Shop settings');
    const hidden = await upload('nobody');
    expect(hidden.status).toBe(404);
    expect(hidden.body.message).toBe('Unknown page "shop"');
    expect((await upload('root', 'logo', 'nope')).status).toBe(404);
    expect((await upload('root', 'nope')).status).toBe(404);
    const notFile = await upload('root', 'shopName');
    expect(notFile.status).toBe(422);
    expect(notFile.body.fields).toEqual({ shopName: ['is not a file field'] });
  });

  test("another user's upload, a resource's upload and a foreign key are refused", async () => {
    const theirs = await upload('manager');
    const res = await patch({ logo: { token: theirs.body.token } }, 'root');
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ logo: ['is not a valid upload'] });
    expect((await patch({ logo: { key: 'page/shop/logo/2026/01/other.png' } })).body.fields).toEqual({ logo: ['is not a file of this record'] });
    expect((await patch({ logo: 'page/shop/logo/2026/01/other.png' })).status).toBe(422);
    expect(host.saves).toEqual([]);
  });

  test('an unsaved upload is shown only to its uploader, while they may still save the page', async () => {
    const mine = await upload('manager');
    const row = await rowOf(mine.body.token);
    expect((await download(row.key, 'manager')).status).toBe(200);
    expect((await download(row.key, 'root')).status).toBe(404);
    expect((await download(row.key, 'viewer')).status).toBe(404);
  });
});

describe('boot checks', () => {
  const boot = async (providers: Function[], roles: RoleDefinition[] = [], admin: Record<string, unknown> = {}) => {
    @Module({ providers: [HeaderAuth, ...(providers as never[])] })
    class BootModule {}
    const booted = await createTestApp({ imports: [BootModule], entities: [Setting], admin: { auth: AdminAuth.custom(HeaderAuth), roles, ...admin } });
    await booted.close();
  };
  const page = (name: string, options: Record<string, unknown> = {}, form: Function = NoticeDto) => {
    @AdminSettingsPage(name, { form, ...options } as never)
    class BootPage {
      load() {
        return {};
      }
      save() {}
    }
    return BootPage;
  };

  test('`secret` on a resource field fails', async () => {
    @AdminResource(Setting, { name: 'secret-setting' })
    class SecretAdmin extends AdminResourceBase<Setting> {
      override fields = { value: { secret: true } };
    }
    await expect(boot([SecretAdmin])).rejects.toThrow('SecretAdmin: fields.value: `secret` is for the fields of a settings page (@AdminSettingsPage)');
  });

  test('`secret` on an action input fails', async () => {
    class TokenDto {
      @AdminField({ secret: true }) @IsString() token: string;
    }
    @AdminResource(Setting, { name: 'acting-setting' })
    class ActingAdmin extends AdminResourceBase<Setting> {
      @AdminAction({ input: TokenDto }) async rotate(): Promise<void> {}
    }
    await expect(boot([ActingAdmin])).rejects.toThrow('ActingAdmin: @AdminAction "rotate": input TokenDto: fields.token: `secret` is for the fields of a settings page (@AdminSettingsPage)');
  });

  test('a secret must be a plain text field', async () => {
    await expect(boot([page('numbers', { fields: { lowStock: { secret: true } } }, ShopSettingsDto)])).rejects.toThrow('BootPage: fields.lowStock: a `secret` field must be text, got number');
    await expect(boot([page('logos', { fields: { logo: { secret: true, widget: 'image' } } }, ShopSettingsDto)])).rejects.toThrow('BootPage: fields.logo: a `secret` field cannot use the "image" widget');
    // Options exist only for the page's own fields: a secret inside a group would be served.
    class CredentialsDto {
      @AdminField({ secret: true }) @IsString() password: string;
    }
    class MailDto {
      @ValidateNested() @Type(() => CredentialsDto) credentials: CredentialsDto;
    }
    await expect(boot([page('mail', {}, MailDto)])).rejects.toThrow('BootPage: fields.credentials: a `secret` field cannot be inside a group (CredentialsDto.password); make it a field of the page itself');
  });

  test('page names: no dots or colons, no reserved word, no resource name, no duplicate', async () => {
    await expect(boot([page('shop.payments')])).rejects.toThrow('BootPage: the page name "shop.payments" must be letters, digits, - and _');
    await expect(boot([page('shop:eu')])).rejects.toThrow('BootPage: the page name "shop:eu" must be letters, digits, - and _');
    await expect(boot([page('update')])).rejects.toThrow('BootPage: the page name "update" is reserved');
    await expect(boot([page('widget')])).rejects.toThrow('BootPage: the page name "widget" is the name of a resource (WidgetAdmin)');
    await expect(boot([page('twice'), page('twice')])).rejects.toThrow('Duplicate settings page name "twice"');
    // `setting.export` and `page.export` would read alike in roles.
    @AdminResource(Setting, { permissions: ['export'] })
    class CodedAdmin extends AdminResourceBase<Setting> {}
    await expect(boot([CodedAdmin, page('export')])).rejects.toThrow('BootPage: the page name "export" is a custom permission of a resource (CodedAdmin: setting.export); give the page another name');
  });

  test('a page needs a form, load() and save(); its fields and layout are checked', async () => {
    await expect(boot([page('formless', { form: undefined })])).rejects.toThrow('BootPage: @AdminSettingsPage needs `form`: a DTO class');
    @AdminSettingsPage('lazy', { form: NoticeDto })
    class LazyPage {
      load() {
        return {};
      }
    }
    await expect(boot([LazyPage])).rejects.toThrow('LazyPage: a settings page needs load(ctx) and save(changes, ctx) methods');
    await expect(boot([page('typo', { fields: { txt: { label: 'T' } } })])).rejects.toThrow('BootPage: fields: unknown field "txt" (did you mean "text"?)');
    await expect(boot([page('laid', { layout: [{ fields: ['text', 'nope'] }] })])).rejects.toThrow('BootPage: form.layout: "nope" is not on the form');
    await expect(boot([page('locked', { fields: { text: { restricted: true } } })])).rejects.toThrow('BootPage: fields.text: `restricted` is not supported on settings pages');
    await expect(boot([page('album', { fields: { logo: { widget: 'image', many: true } } }, ShopSettingsDto)])).rejects.toThrow('BootPage: fields.logo: list file fields (`many`) are not supported on settings pages yet');
  });

  test('a group named by key takes the label of the module with that key, whichever is discovered first', async () => {
    @AdminSettingsPage('keyed', { form: NoticeDto, group: 'settings' })
    class KeyedPage {
      load() {
        return {};
      }
      save() {}
    }
    @Module({ providers: [KeyedPage] })
    class KeyedModule {}
    @AdminSettingsPage('housed', { form: NoticeDto })
    class HousedPage {
      load() {
        return {};
      }
      save() {}
    }
    @AdminGroup({ key: 'settings', label: 'Preferences', order: 1 })
    @Module({ providers: [HousedPage] })
    class PreferencesModule {}
    @Module({ providers: [HeaderAuth] })
    class AuthModule {}
    for (const imports of [[KeyedModule, PreferencesModule], [PreferencesModule, KeyedModule]]) {
      const ordered = await createTestApp({ imports: [AuthModule, ...imports], admin: { auth: AdminAuth.custom(HeaderAuth) } });
      try {
        const meta = (await request(ordered.getHttpServer()).get('/admin/api/meta').set('X-User', 'root')).body as MetaResponse;
        expect(meta.groups[0]).toMatchObject({ key: 'settings', label: 'Preferences' });
        expect(meta.groups[0]!.pages.map((item) => item.name).sort()).toEqual(['housed', 'keyed']);
      } finally {
        await ordered.close();
      }
    }
  });

  test('roles are checked against the page codes', async () => {
    await expect(boot([page('billing')], [{ name: 'typo', permissions: ['page.biling'] }])).rejects.toThrow('unknown permission "page.biling" (did you mean "page.billing"?)');
    await boot([page('billing')], [{ name: 'ok', permissions: ['page.billing', 'page.billing.update', 'page.*', 'page.*.update'] }]);
    // A pattern starting with `*` matches no page code, so one that could match nothing else is unknown.
    await expect(boot([page('billing')], [{ name: 'stars', permissions: ['*.billing'] }])).rejects.toThrow('unknown permission "*.billing"');
    await expect(boot([page('billing')], [{ name: 'stars', permissions: ['*.*.update'] }])).rejects.toThrow('unknown permission "*.*.update"');
    await boot([page('billing')], [{ name: 'stars', permissions: ['*.*', '*.view', '*'] }]);
    // Without any page there is no page code.
    await expect(boot([], [{ name: 'early', permissions: ['page.*'] }])).rejects.toThrow('unknown permission "page.*"');
  });

  test('a resource named "page" or a global permission cannot share a code with a page', async () => {
    @AdminResource(Setting, { name: 'page' })
    class PageAdmin extends AdminResourceBase<Setting> {}
    await expect(boot([PageAdmin, page('billing')])).rejects.toThrow(
      'PageAdmin: a resource cannot be named "page" in an admin with settings pages: their permission codes are page.<name>, the prefix of this resource\'s codes. ' +
        "Rename the resource, for example @AdminResource(Setting, { name: 'content-page' })",
    );
    // Whichever is declared first.
    await expect(boot([page('billing'), PageAdmin])).rejects.toThrow('PageAdmin: a resource cannot be named "page" in an admin with settings pages');
  });

  test('without settings pages, a resource named "page" works as before', async () => {
    @AdminResource(Setting, { name: 'page', permissions: ['publish'] })
    class PageAdmin extends AdminResourceBase<Setting> {}
    @Module({ providers: [HeaderAuth, PageAdmin] })
    class CmsModule {}
    const roles: RoleDefinition[] = [
      { name: 'viewer', permissions: ['*.view'] },
      { name: 'paged', permissions: ['page.*'] },
      { name: 'manager', permissions: ['page.view', 'page.update', 'page.publish'] },
    ];
    const cms = await createTestApp({ imports: [CmsModule], entities: [Setting], admin: { auth: AdminAuth.custom(HeaderAuth), roles } });
    try {
      const as = (who: string) => request(cms.getHttpServer()).get('/admin/api/meta/resources/page').set('X-User', who);
      expect((await as('viewer')).body.permissions).toMatchObject({ update: false });
      expect((await as('paged')).body.permissions).toMatchObject({ create: true, update: true, delete: true });
      expect((await as('manager')).body.permissions).toMatchObject({ create: false, update: true });
      expect((await as('nobody')).status).toBe(404);
      const created = await request(cms.getHttpServer()).post('/admin/api/resources/page').set('X-User', 'paged').send({ name: 'home', value: 'Welcome' });
      expect(created.status).toBe(201);
      expect((await request(cms.getHttpServer()).get('/admin/api/resources/page').set('X-User', 'viewer')).body.items).toHaveLength(1);
      // Uploads for `page:<name>` have nothing to find here.
      expect((await request(cms.getHttpServer()).get('/admin/api/pages/page').set('X-User', 'root')).status).toBe(404);
    } finally {
      await cms.close();
    }
    await expect(boot([page('billing')], [], { permissions: ['page.billing'] })).rejects.toThrow('nest-my-admin: the permission "page.billing" is the code of a settings page');
  });

  test('pages work with transactions off', async () => {
    const saved: unknown[] = [];
    @AdminSettingsPage('loose', { form: NoticeDto })
    class LoosePage {
      load() {
        return { text: 'a' };
      }
      save(changes: object, ctx: AdminContext) {
        saved.push([changes, ctx.manager !== undefined]);
      }
    }
    @Module({ providers: [HeaderAuth, LoosePage] })
    class LooseModule {}
    const loose = await createTestApp({ imports: [LooseModule], admin: { auth: AdminAuth.custom(HeaderAuth), transactions: false } });
    try {
      const res = await request(loose.getHttpServer()).patch('/admin/api/pages/loose').set('X-User', 'root').send({ text: 'b' });
      expect(res.status).toBe(200);
      expect(saved).toEqual([[{ text: 'b' }, true]]); // a write always gets a manager since 0.7
    } finally {
      await loose.close();
    }
  });
});
