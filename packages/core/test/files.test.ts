import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Column, DeleteDateColumn, Entity, In, LessThan, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import {
  ADMIN_FILE_ENTITIES,
  AdminAction,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  AfterSave,
  BeforeSave,
  NmaFile,
  localStorage,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminFile,
  type AdminPrincipal,
  type FieldsConfig,
  type RecordId,
} from '../src/index.js';
import { AdminApiService } from '../src/api/admin-api.service.js';
import { FilesService } from '../src/files/files.service.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('fu_product')
class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) logo: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) manual: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) secretDoc: string | null;
  @Column({ type: 'simple-json', nullable: true }) gallery: string[] | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) frozen: string | null;
  @Column({ type: 'varchar', length: 40, default: '' }) ownerId: string;
}

@AdminResource(Product)
class ProductAdmin extends AdminResourceBase<Product> {
  override fields: FieldsConfig<Product> = {
    logo: { widget: 'image', file: { accept: ['image/*'], maxBytes: 1000, visibility: 'public' } },
    manual: { widget: 'file', file: { accept: ['application/pdf', 'image/*'] } },
    secretDoc: { widget: 'file', restricted: true },
    gallery: { widget: 'image', many: true },
    frozen: { widget: 'file' },
  };

  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }

  /** Lets a test act between resolve() and attach(), where a concurrent write would. */
  @BeforeSave() async pause() {
    await host.beforeSave?.();
  }

  /** Fails the write after the row was saved, so the transaction has something to roll back. */
  @AfterSave() refuseBoom(product: Product) {
    if (product.name === 'boom') throw new Error('boom');
  }
}

@Entity('fu_doc')
class Doc {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) title: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) attachment: string | null;
  @Column({ type: 'simple-json', nullable: true }) pages: string[] | null;
  /** Named like Product's field: an upload for one resource must not pass for the other. */
  @Column({ type: 'varchar', length: 300, nullable: true }) manual: string | null;
  @DeleteDateColumn() deletedAt: Date | null;
}

/** What the host's `update` override was given, and a nested write it makes before failing. */
const host: { dto?: Record<string, unknown>; nested?: (api: AdminApiService, ctx: AdminContext) => Promise<void>; beforeSave?: () => Promise<void> } = {};

/** A host app that routes updates through its own code: it gets `AdminFile`s and stores the keys itself. */
@AdminResource(Doc)
class DocAdmin extends AdminResourceBase<Doc> {
  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }
  override fields: FieldsConfig<Doc> = { attachment: { widget: 'file' }, pages: { widget: 'file', many: true }, manual: { widget: 'file' } };

  override async update(id: RecordId, dto: object, ctx: AdminContext): Promise<Doc> {
    host.dto = { ...dto };
    const values = dto as { title?: string; attachment?: AdminFile | null; pages?: AdminFile[] | null };
    const repo = ctx.manager!.getRepository(Doc);
    const doc = await repo.findOneByOrFail({ id: Number(id) });
    if (values.title !== undefined) doc.title = values.title;
    if (values.attachment !== undefined) doc.attachment = values.attachment?.key ?? null;
    if (values.pages !== undefined) doc.pages = values.pages?.map((page) => page.key) ?? null;
    await repo.save(doc);
    // A write inside a write joins the outer transaction; its file deletions wait for the outer commit.
    if (host.nested) await host.nested(this.moduleRef.get(AdminApiService, { strict: false }), ctx);
    return doc;
  }
}

@Entity('fu_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) body: string;
}
@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}

@Entity('fu_binder')
class Binder {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) cover: string | null;
  @Column({ default: false }) archived: boolean;
}

/**
 * No trash, and a host `delete()` that does not always delete: what is named "archive…" is only flagged and its
 * row stays. `shred` is an action that deletes its record, `rename` one that keeps it.
 */
@AdminResource(Binder)
class BinderAdmin extends AdminResourceBase<Binder> {
  override fields: FieldsConfig<Binder> = { cover: { widget: 'file' } };

  override async delete(id: RecordId, ctx: AdminContext): Promise<void> {
    const binder = (await this.findOne(id, ctx))!;
    if (binder.name.startsWith('archive')) await this.repositoryFor(ctx).update(binder.id, { archived: true });
    else await super.delete(id, ctx);
  }

  /** Not handed the record at all, and it keeps the row. */
  override async purge(id: RecordId, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(Number(id), { archived: true });
  }

  @AdminAction()
  async shred(binder: Binder, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).delete(binder.id);
  }

  @AdminAction()
  async rename(binder: Binder, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(binder.id, { name: `${binder.name} (renamed)` });
  }
}

const users: Record<string, { id: string; displayName: string; isSuperuser: boolean }> = {
  root: { id: 'root', displayName: 'Root', isSuperuser: true },
  editor: { id: 'editor', displayName: 'Editor', isSuperuser: false },
  viewer: { id: 'viewer', displayName: 'Viewer', isSuperuser: false },
  limited: { id: 'limited', displayName: 'Limited', isSuperuser: false },
  other: { id: 'other', displayName: 'Other', isSuperuser: false },
  scoped: { id: 'scoped', displayName: 'Scoped', isSuperuser: false },
  csrf: { id: 'csrf', displayName: 'Csrf', isSuperuser: true },
};

/** `X-User: <id>`; `csrf` demands a CSRF token like a cookie session. */
@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users[String(req.headers['x-user'] ?? '')];
    return user ? { user, ...(user.id === 'csrf' ? { csrfToken: 'tok-123' } : {}) } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return { editor: ['editor'], other: ['editor'], viewer: ['viewer'], limited: ['limited'], scoped: ['scoped'] }[String(user.id)] ?? [];
  }
}

@Module({ providers: [ProductAdmin, NoteAdmin, DocAdmin, BinderAdmin, HeaderAuth] })
class FilesFixtureModule {}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 0x20)]);

let app: INestApplication;
let dir: string;
let db: DataSource;
const post = (query: string, who = 'root') => request(app.getHttpServer()).post(`/admin/api/uploads?${query}`).set('X-User', who);
const stored = async (): Promise<string[]> => {
  const out: string[] = [];
  const walk = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else out.push(join(path, entry.name));
    }
  };
  await walk(dir);
  return out;
};
const rows = () => db.getRepository(NmaFile).find();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nma-files-'));
  app = await createTestApp({
    entities: [Product, Note, Doc, Binder, ...ADMIN_FILE_ENTITIES],
    imports: [FilesFixtureModule],
    admin: {
      auth: AdminAuth.custom(HeaderAuth),
      files: { storage: localStorage({ dir, publicBaseUrl: 'https://cdn.example.com/f' }), maxBytes: 5000 },
      roles: [
        { name: 'editor', permissions: ['product.create', 'product.update', 'product.view'] },
        { name: 'viewer', permissions: ['product.view'] },
        { name: 'limited', permissions: ['product.create', 'product.view'], fields: { product: { manual: 'readonly' } } },
        { name: 'scoped', permissions: ['product.view'], scopes: { product: { view: 'own' } } },
      ],
    },
  });
  db = app.get<DataSource>(getDataSourceToken());
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('POST /api/uploads', () => {
  test('an image upload answers a token and writes a temp row and the object', async () => {
    const res = await post('resource=product&field=logo').set('Content-Type', 'image/png').set('X-File-Name', encodeURIComponent('لوگو شرکت.png')).send(PNG);
    expect(res.status).toBe(201);
    const { token, name, contentType, size, url } = res.body;
    expect(typeof token).toBe('string');
    expect(name).toBe('لوگو شرکت.png');
    expect(contentType).toBe('image/png');
    expect(size).toBe(PNG.length);
    const row = await db.getRepository(NmaFile).findOneByOrFail({ id: token });
    expect(row).toMatchObject({ resource: 'product', field: 'logo', status: 'temp', recordId: null, visibility: 'public', contentType: 'image/png', size: PNG.length, createdBy: 'root', name: 'لوگو شرکت.png' });
    expect(row.key).toMatch(/^product\/logo\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    expect(url).toBe(`https://cdn.example.com/f/${row.key}`);
    expect((await stored()).some((path) => path.endsWith(row.key.split('/').pop()!))).toBe(true);
  });

  test('private fields answer no url, and the type decides the extension, never the name', async () => {
    const res = await post('resource=product&field=manual').set('Content-Type', 'application/octet-stream').set('X-File-Name', 'manual.exe').send(PDF);
    expect(res.status).toBe(201);
    expect(res.body.contentType).toBe('application/pdf');
    expect(res.body.url).toBeUndefined();
    const row = await db.getRepository(NmaFile).findOneByOrFail({ id: res.body.token });
    expect(row.key.endsWith('.pdf')).toBe(true);
    expect(row.visibility).toBe('private');
  });

  test('a list field takes uploads like a single one, and a missing name gets a default', async () => {
    const res = await post('resource=product&field=gallery').set('Content-Type', 'image/png').send(PNG);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('file.png');
  });

  test('over the limit: 413 and no object or row left', async () => {
    const before = { objects: (await stored()).length, rows: (await rows()).length };
    const res = await post('resource=product&field=logo').set('Content-Type', 'image/png').send(Buffer.concat([PNG, Buffer.alloc(2000)]));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect({ objects: (await stored()).length, rows: (await rows()).length }).toEqual(before);
  });

  test('the module limit applies to fields without their own', async () => {
    const before = (await stored()).length;
    const res = await post('resource=product&field=frozen').set('Content-Type', 'application/pdf').send(Buffer.concat([PDF, Buffer.alloc(6000, 0x20)]));
    expect(res.status).toBe(413);
    expect((await stored()).length).toBe(before);
  });

  test('a sniffed type outside accept: 422 with nothing left (a PDF in an image field)', async () => {
    const before = { objects: (await stored()).length, rows: (await rows()).length };
    const res = await post('resource=product&field=logo').set('Content-Type', 'image/png').set('X-File-Name', 'logo.png').send(PDF);
    expect(res.status).toBe(422);
    expect(res.body.fields.logo).toEqual(['is not an accepted file type']);
    expect({ objects: (await stored()).length, rows: (await rows()).length }).toEqual(before);
  });

  test('evil.png that is really HTML, SVG or JS is refused and leaves nothing', async () => {
    const before = { objects: (await stored()).length, rows: (await rows()).length };
    const disguises = [
      '<!DOCTYPE html><html><body><script>alert(1)</script></body></html>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      'alert(document.cookie)',
      '',
    ];
    for (const body of disguises) {
      for (const field of ['logo', 'frozen']) {
        const res = await post(`resource=product&field=${field}`).set('Content-Type', 'image/png').set('X-File-Name', 'evil.png').send(Buffer.from(body));
        expect(res.status).toBe(422);
      }
    }
    expect({ objects: (await stored()).length, rows: (await rows()).length }).toEqual(before);
  });

  test('text/plain, multipart and form content types are refused with 415', async () => {
    for (const type of ['text/plain', 'text/plain;charset=UTF-8', 'multipart/form-data; boundary=x', 'application/x-www-form-urlencoded']) {
      const res = await post('resource=product&field=logo').set('Content-Type', type).send(PNG);
      expect(res.status).toBe(415);
    }
  });

  test('a body the host JSON parser already read is a clear 400; the same bytes as octet-stream are stored', async () => {
    // Nest's default express.json() reads every application/json body before the admin handler runs: the stream is spent.
    const data = Buffer.from('{"rows":[1,2,3]}\n');
    const before = { objects: (await stored()).length, rows: (await rows()).length };
    const parsed = await post('resource=product&field=frozen').set('Content-Type', 'application/json').set('X-File-Name', 'data.json').send(data);
    expect(parsed.status).toBe(400);
    expect(parsed.body.code).toBe('BAD_REQUEST');
    expect(parsed.body.message).toContain('already read');
    expect(parsed.body.message).toContain('application/octet-stream');
    expect(parsed.body.fields).toBeUndefined();
    expect({ objects: (await stored()).length, rows: (await rows()).length }).toEqual(before);

    const raw = await post('resource=product&field=frozen').set('Content-Type', 'application/octet-stream').set('X-File-Name', 'data.json').send(data);
    expect(raw.status).toBe(201);
    expect(raw.body).toMatchObject({ name: 'data.json', contentType: 'text/plain', size: data.length });
    const row = await db.getRepository(NmaFile).findOneByOrFail({ id: raw.body.token });
    expect(await readFile(join(dir, row.key))).toEqual(data);
  });

  test('users without create/update, or without edit access to the field, get 403', async () => {
    const viewer = await post('resource=product&field=logo', 'viewer').set('Content-Type', 'image/png').send(PNG);
    expect(viewer.status).toBe(403);
    const readonly = await post('resource=product&field=manual', 'limited').set('Content-Type', 'application/pdf').send(PDF);
    expect(readonly.status).toBe(403);
    const restricted = await post('resource=product&field=secretDoc', 'editor').set('Content-Type', 'application/pdf').send(PDF);
    expect(restricted.status).toBe(403);
    const allowed = await post('resource=product&field=secretDoc', 'root').set('Content-Type', 'application/pdf').send(PDF);
    expect(allowed.status).toBe(201);
    const limitedOk = await post('resource=product&field=logo', 'limited').set('Content-Type', 'image/png').send(PNG);
    expect(limitedOk.status).toBe(201);
  });

  test('anonymous requests are 401', async () => {
    const res = await request(app.getHttpServer()).post('/admin/api/uploads?resource=product&field=logo').set('Content-Type', 'image/png').send(PNG);
    expect(res.status).toBe(401);
  });

  test('unknown resource or field is 404; a field that is not a file field is 422; missing params 400', async () => {
    const png = (query: string) => post(query).set('Content-Type', 'image/png').send(PNG);
    expect((await png('resource=nope&field=logo')).status).toBe(404);
    expect((await png('resource=product&field=nope')).status).toBe(404);
    const plain = await png('resource=product&field=name');
    expect(plain.status).toBe(422);
    expect(plain.body.fields.name).toEqual(['is not a file field']);
    expect((await png('resource=note&field=body')).status).toBe(422);
    expect((await png('resource=product')).status).toBe(400);
    expect((await png('field=logo')).status).toBe(400);
  });

  test('CSRF applies as on every write', async () => {
    const without = await post('resource=product&field=logo', 'csrf').set('Content-Type', 'image/png').send(PNG);
    expect(without.status).toBe(403);
    const wrong = await post('resource=product&field=logo', 'csrf').set('X-CSRF-Token', 'nope').set('Content-Type', 'image/png').send(PNG);
    expect(wrong.status).toBe(403);
    const ok = await post('resource=product&field=logo', 'csrf').set('X-CSRF-Token', 'tok-123').set('Content-Type', 'image/png').send(PNG);
    expect(ok.status).toBe(201);
  });

  test('the field schema carries accept, maxBytes and many', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/product').set('X-User', 'root');
    const field = (name: string) => res.body.fields.find((candidate: { name: string }) => candidate.name === name);
    expect(field('logo')).toMatchObject({ widget: 'image', file: { accept: ['image/*'], maxBytes: 1000, many: false } });
    expect(field('manual')).toMatchObject({ widget: 'file', file: { accept: ['application/pdf', 'image/*'], maxBytes: 5000, many: false } });
    expect(field('gallery')).toMatchObject({ widget: 'image', file: { accept: ['image/*'], many: true } });
  });
});

const TEXT = Buffer.from('plain notes, nothing else\n');
const json = (who = 'root') => ({
  get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', who),
  post: (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', who).send(body),
  patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/admin/api${path}`).set('X-User', who).send(body),
});
/** Uploads `body` to a field and answers the token with the stored key. */
const upload = async (field: string, body: Buffer = PNG, who = 'root', resource = 'product', name = 'a file'): Promise<{ token: string; key: string }> => {
  const res = await post(`resource=${resource}&field=${field}`, who).set('Content-Type', 'application/octet-stream').set('X-File-Name', encodeURIComponent(name)).send(body);
  expect(res.status).toBe(201);
  const row = await db.getRepository(NmaFile).findOneByOrFail({ id: res.body.token });
  return { token: res.body.token, key: row.key };
};
const has = (key: string) => existsSync(join(dir, key));
const rowOf = (key: string) => db.getRepository(NmaFile).findOneBy({ key });
const download = (key: string, who = 'root') => request(app.getHttpServer()).get(`/admin/api/files/${key}`).set('X-User', who).responseType('blob');

describe(`file fields in writes and reads (${TEST_DB})`, () => {
  test('create with a token: the column holds the key, the row is attached to the record, _files carries the ref', async () => {
    const logo = await upload('logo', PNG, 'root', 'product', 'logo.png');
    const res = await json().post('/resources/product', { name: 'With logo', logo: { token: logo.token } });
    expect(res.status).toBe(201);
    expect(res.body.logo).toBe(logo.key);
    expect(res.body._files).toEqual({ logo: { key: logo.key, name: 'logo.png', contentType: 'image/png', size: PNG.length, url: `https://cdn.example.com/f/${logo.key}` } });
    expect(await rowOf(logo.key)).toMatchObject({ status: 'attached', recordId: res.body._id, resource: 'product', field: 'logo' });
    expect((await db.getRepository(Product).findOneByOrFail({ id: Number(res.body._id) })).logo).toBe(logo.key);
    // Lists and the detail read carry the same ref; private files link to the admin's download route.
    const manual = await upload('manual', PDF);
    const patched = await json().patch(`/resources/product/${res.body._id}`, { manual: { token: manual.token } });
    expect(patched.body._files.manual.url).toBe(`/admin/api/files/${manual.key}`);
    const listed = (await json().get('/resources/product')).body.items.find((item: { _id: string }) => item._id === res.body._id);
    expect(listed._files.logo.key).toBe(logo.key);
    expect((await json().get(`/resources/product/${res.body._id}`)).body._files.manual.key).toBe(manual.key);
  });

  test('replacing a file deletes the old object and row, after the write', async () => {
    const first = await upload('manual', PDF);
    const created = await json().post('/resources/product', { name: 'Replace', manual: { token: first.token } });
    const second = await upload('manual', PDF);
    const res = await json().patch(`/resources/product/${created.body._id}`, { manual: { token: second.token } });
    expect(res.status).toBe(200);
    expect(res.body.manual).toBe(second.key);
    expect(has(first.key)).toBe(false);
    expect(await rowOf(first.key)).toBeNull();
    expect(has(second.key)).toBe(true);
    expect(await rowOf(second.key)).toMatchObject({ status: 'attached', recordId: created.body._id });
    // Sending the key back keeps the file.
    const kept = await json().patch(`/resources/product/${created.body._id}`, { name: 'Kept', manual: { key: second.key } });
    expect(kept.status).toBe(200);
    expect(kept.body.manual).toBe(second.key);
    expect(has(second.key)).toBe(true);
  });

  test('a write that rolls back keeps the old file, and the new upload stays temp (Review Focus 4)', async () => {
    const old = await upload('manual', PDF);
    const created = await json().post('/resources/product', { name: 'Rollback', manual: { token: old.token } });
    const id = created.body._id as string;
    const fresh = await upload('manual', PDF);
    const replaced = await json().patch(`/resources/product/${id}`, { name: 'boom', manual: { token: fresh.token } });
    expect(replaced.status).toBe(500);
    const cleared = await json().patch(`/resources/product/${id}`, { name: 'boom', manual: null });
    expect(cleared.status).toBe(500);
    expect(has(old.key)).toBe(true);
    expect(await rowOf(old.key)).toMatchObject({ status: 'attached', recordId: id });
    expect(has(fresh.key)).toBe(true);
    expect(await rowOf(fresh.key)).toMatchObject({ status: 'temp', recordId: null });
    expect((await json().get(`/resources/product/${id}`)).body.manual).toBe(old.key);
    // The upload is still good for a later write.
    expect((await json().patch(`/resources/product/${id}`, { manual: { token: fresh.token } })).status).toBe(200);
    expect(has(old.key)).toBe(false);
  });

  test('null clears the field and deletes the object', async () => {
    const manual = await upload('manual', PDF);
    const created = await json().post('/resources/product', { name: 'Clear', manual: { token: manual.token } });
    const res = await json().patch(`/resources/product/${created.body._id}`, { manual: null });
    expect(res.status).toBe(200);
    expect(res.body.manual).toBeNull();
    expect(res.body._files).toEqual({});
    expect(has(manual.key)).toBe(false);
    expect(await rowOf(manual.key)).toBeNull();
  });

  test('many: add, keep and remove in one PATCH', async () => {
    const [a, b, c] = [await upload('gallery'), await upload('gallery'), await upload('gallery')];
    const created = await json().post('/resources/product', { name: 'Gallery', gallery: [{ token: a!.token }, { token: b!.token }] });
    expect(created.status).toBe(201);
    expect(created.body.gallery).toEqual([a!.key, b!.key]);
    const res = await json().patch(`/resources/product/${created.body._id}`, { gallery: [{ key: b!.key }, { token: c!.token }] });
    expect(res.status).toBe(200);
    expect(res.body.gallery).toEqual([b!.key, c!.key]);
    expect(res.body._files.gallery.map((ref: { key: string }) => ref.key)).toEqual([b!.key, c!.key]);
    expect(res.body._files.gallery[1]).toMatchObject({ contentType: 'image/png', size: PNG.length, url: `/admin/api/files/${c!.key}` });
    expect([has(a!.key), has(b!.key), has(c!.key)]).toEqual([false, true, true]);
    expect(await rowOf(a!.key)).toBeNull();
    expect(await rowOf(c!.key)).toMatchObject({ status: 'attached', recordId: created.body._id });
    const emptied = await json().patch(`/resources/product/${created.body._id}`, { gallery: [] });
    expect(emptied.body.gallery).toEqual([]);
    expect(emptied.body._files.gallery).toEqual([]);
    expect([has(b!.key), has(c!.key)]).toEqual([false, false]);
  });

  test("a token the write did not issue to this user, for this field, is 422 and stays temp (Review Focus 1)", async () => {
    const target = (await json().post('/resources/product', { name: 'Target' })).body._id as string;
    const invalid = async (res: request.Response, field: string) => {
      expect(res.status).toBe(422);
      expect(res.body.fields[field]).toEqual(['is not a valid upload']);
    };
    // Another user's upload (the superuser's, and a peer's).
    const roots = await upload('logo', PNG, 'root');
    await invalid(await json('editor').post('/resources/product', { name: 'Steal', logo: { token: roots.token } }), 'logo');
    await invalid(await json('editor').patch(`/resources/product/${target}`, { logo: { token: roots.token } }), 'logo');
    const peers = await upload('logo', PNG, 'other');
    await invalid(await json('editor').patch(`/resources/product/${target}`, { logo: { token: peers.token } }), 'logo');
    await invalid(await json('root').patch(`/resources/product/${target}`, { logo: { token: peers.token } }), 'logo');
    // Another field's upload, in a single and in a list field.
    await invalid(await json().patch(`/resources/product/${target}`, { manual: { token: roots.token } }), 'manual');
    await invalid(await json().patch(`/resources/product/${target}`, { gallery: [{ token: roots.token }] }), 'gallery');
    // Another resource's upload, to a field of the same name.
    const docs = await upload('manual', PDF, 'root', 'doc');
    await invalid(await json().patch(`/resources/product/${target}`, { manual: { token: docs.token } }), 'manual');
    // An expired upload.
    const expired = await upload('logo');
    await db.getRepository(NmaFile).update({ id: expired.token }, { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    await invalid(await json().patch(`/resources/product/${target}`, { logo: { token: expired.token } }), 'logo');
    // Unknown, repeated and already attached tokens.
    await invalid(await json().patch(`/resources/product/${target}`, { logo: { token: '00000000-0000-4000-8000-000000000000' } }), 'logo');
    const twice = await upload('gallery');
    await invalid(await json().patch(`/resources/product/${target}`, { gallery: [{ token: twice.token }, { token: twice.token }] }), 'gallery');
    const used = await upload('logo');
    expect((await json().post('/resources/product', { name: 'Uses it', logo: { token: used.token } })).status).toBe(201);
    await invalid(await json().patch(`/resources/product/${target}`, { logo: { token: used.token } }), 'logo');

    for (const { key } of [roots, peers, docs, expired, twice]) {
      expect(await rowOf(key)).toMatchObject({ status: 'temp', recordId: null });
      expect(has(key)).toBe(true);
    }
    const stored = await db.getRepository(Product).findOneByOrFail({ id: Number(target) });
    expect([stored.logo, stored.manual, stored.gallery]).toEqual([null, null, null]);
    expect(await db.getRepository(Product).countBy({ name: 'Steal' })).toBe(0);
  });

  test('a retried write (its answer was lost) may send the token it already attached: it is a keep', async () => {
    // Single field, default update.
    const logo = await upload('logo', PNG, 'editor');
    const id = (await json('editor').post('/resources/product', { name: 'Retry' })).body._id as string;
    const first = await json('editor').patch(`/resources/product/${id}`, { name: 'Retry 1', logo: { token: logo.token } });
    expect(first.status).toBe(200);
    const again = await json('editor').patch(`/resources/product/${id}`, { name: 'Retry 1', logo: { token: logo.token } });
    expect(again.status).toBe(200);
    expect(again.body.logo).toBe(logo.key);
    expect(again.body._files.logo.key).toBe(logo.key);
    expect(await rowOf(logo.key)).toMatchObject({ status: 'attached', recordId: id, field: 'logo' });
    expect(has(logo.key)).toBe(true);
    expect(await db.getRepository(NmaFile).countBy({ key: logo.key })).toBe(1);

    // A list: the retry keeps both, in the order sent, next to a key.
    const [a, b] = [await upload('gallery', PNG, 'editor'), await upload('gallery', PNG, 'editor')];
    expect((await json('editor').patch(`/resources/product/${id}`, { gallery: [{ token: a.token }, { token: b.token }] })).status).toBe(200);
    const list = await json('editor').patch(`/resources/product/${id}`, { gallery: [{ token: b.token }, { key: a.key }] });
    expect(list.status).toBe(200);
    expect(list.body.gallery).toEqual([b.key, a.key]);
    expect([has(a.key), has(b.key)]).toEqual([true, true]);

    // A host update override gets it as a kept file, not a new one.
    const page = await upload('attachment', PDF, 'root', 'doc');
    const doc = (await json().post('/resources/doc', { title: 'Retry doc' })).body._id as string;
    expect((await json().patch(`/resources/doc/${doc}`, { attachment: { token: page.token } })).status).toBe(200);
    expect((host.dto!.attachment as AdminFile).isNew).toBe(true);
    expect((await json().patch(`/resources/doc/${doc}`, { attachment: { token: page.token } })).status).toBe(200);
    expect(host.dto!.attachment).toMatchObject({ key: page.key, isNew: false });
    expect(await rowOf(page.key)).toMatchObject({ status: 'attached', recordId: doc });
  });

  test('an attached token is still refused for another record, field, resource or user, and once the record let it go', async () => {
    const invalid = async (res: request.Response, field: string) => {
      expect(res.status).toBe(422);
      expect(res.body.fields[field]).toEqual(['is not a valid upload']);
    };
    const manual = await upload('manual', PDF, 'editor');
    const owner = (await json('editor').post('/resources/product', { name: 'Owner of retry', manual: { token: manual.token } })).body._id as string;
    const otherRecord = (await json('editor').post('/resources/product', { name: 'Other record' })).body._id as string;
    // Another record (an update, and a create: a retried create is a new record).
    await invalid(await json('editor').patch(`/resources/product/${otherRecord}`, { manual: { token: manual.token } }), 'manual');
    await invalid(await json('editor').post('/resources/product', { name: 'Again', manual: { token: manual.token } }), 'manual');
    // Another field of the same record.
    await invalid(await json('editor').patch(`/resources/product/${owner}`, { frozen: { token: manual.token } }), 'frozen');
    await invalid(await json('editor').patch(`/resources/product/${owner}`, { gallery: [{ token: manual.token }] }), 'gallery');
    // Another user, on the very record (a peer and the superuser).
    await invalid(await json('other').patch(`/resources/product/${owner}`, { manual: { token: manual.token } }), 'manual');
    await invalid(await json('root').patch(`/resources/product/${owner}`, { manual: { token: manual.token } }), 'manual');
    // Another resource with a field of the same name, and a record with the same id.
    const doc = (await json().post('/resources/doc', { title: 'Same name' })).body._id as string;
    await db.getRepository(NmaFile).update({ key: manual.key }, { createdBy: 'root' });
    await db.getRepository(NmaFile).update({ key: manual.key }, { recordId: doc });
    await invalid(await json().patch(`/resources/doc/${doc}`, { manual: { token: manual.token } }), 'manual');
    await db.getRepository(NmaFile).update({ key: manual.key }, { createdBy: 'editor', recordId: owner });
    // The same token twice, or next to its own key.
    const page = await upload('gallery', PNG, 'editor');
    expect((await json('editor').patch(`/resources/product/${owner}`, { gallery: [{ token: page.token }] })).status).toBe(200);
    await invalid(await json('editor').patch(`/resources/product/${owner}`, { gallery: [{ token: page.token }, { token: page.token }] }), 'gallery');
    expect((await json('editor').patch(`/resources/product/${owner}`, { gallery: [{ token: page.token }, { key: page.key }] })).status).toBe(422);

    expect(await rowOf(manual.key)).toMatchObject({ status: 'attached', recordId: owner, field: 'manual' });
    expect((await db.getRepository(Product).findOneByOrFail({ id: Number(otherRecord) })).manual).toBeNull();
    expect((await db.getRepository(Product).findOneByOrFail({ id: Number(owner) })).frozen).toBeNull();
    expect(await db.getRepository(Product).countBy({ name: 'Again' })).toBe(0);

    // The record held it once, but no longer: the token is spent.
    expect((await json('editor').patch(`/resources/product/${owner}`, { manual: null })).status).toBe(200);
    await invalid(await json('editor').patch(`/resources/product/${owner}`, { manual: { token: manual.token } }), 'manual');
  });

  test('a key that is not on this record, and values of the wrong shape, are 422', async () => {
    const mine = await upload('manual', PDF);
    const owner = (await json().post('/resources/product', { name: 'Owner', manual: { token: mine.token } })).body._id as string;
    const thief = (await json().post('/resources/product', { name: 'Thief' })).body._id as string;
    const stolen = await json().patch(`/resources/product/${thief}`, { manual: { key: mine.key } });
    expect(stolen.status).toBe(422);
    expect(stolen.body.fields.manual).toEqual(['is not a file of this record']);
    const onCreate = await json().post('/resources/product', { name: 'Thief 2', manual: { key: mine.key } });
    expect(onCreate.status).toBe(422);
    // A key of this record, but of another field.
    const crossField = await json().patch(`/resources/product/${owner}`, { frozen: { key: mine.key } });
    expect(crossField.status).toBe(422);
    const list = await json().patch(`/resources/product/${thief}`, { gallery: [{ key: mine.key }] });
    expect(list.status).toBe(422);
    expect((await db.getRepository(Product).findOneByOrFail({ id: Number(thief) })).manual).toBeNull();
    expect(await rowOf(mine.key)).toMatchObject({ status: 'attached', recordId: owner });

    for (const [body, message] of [
      [{ manual: mine.key }, 'must be an uploaded file'],
      [{ manual: { token: 5 } }, 'must be an uploaded file'],
      [{ manual: { token: mine.token, key: mine.key } }, 'must be an uploaded file'],
      [{ manual: [{ key: mine.key }] }, 'must be an uploaded file'],
      [{ gallery: { key: mine.key } }, 'must be a list of uploaded files'],
      [{ gallery: [mine.key] }, 'must be a list of uploaded files'],
    ] as const) {
      const res = await json().patch(`/resources/product/${owner}`, body);
      expect(res.status).toBe(422);
      expect(Object.values(res.body.fields)).toEqual([[message]]);
    }
  });

  test('a host update override receives AdminFile objects', async () => {
    const created = await json().post('/resources/doc', { title: 'Doc' });
    expect(created.status).toBe(201);
    const id = created.body._id as string;
    const attachment = await upload('attachment', PDF, 'root', 'doc', 'contract.pdf');
    const page = await upload('pages', PNG, 'root', 'doc');
    const first = await json().patch(`/resources/doc/${id}`, { attachment: { token: attachment.token }, pages: [{ token: page.token }] });
    expect(first.status).toBe(200);
    expect(host.dto!.attachment).toEqual({ key: attachment.key, name: 'contract.pdf', contentType: 'application/pdf', size: PDF.length, url: `/admin/api/files/${attachment.key}`, isNew: true });
    expect(first.body.attachment).toBe(attachment.key);
    expect(await rowOf(attachment.key)).toMatchObject({ status: 'attached', recordId: id });
    const more = await upload('pages', PNG, 'root', 'doc');
    const second = await json().patch(`/resources/doc/${id}`, { attachment: null, pages: [{ key: page.key }, { token: more.token }] });
    expect(second.status).toBe(200);
    expect(host.dto!.attachment).toBeNull();
    expect((host.dto!.pages as AdminFile[]).map((file) => [file.key, file.isNew])).toEqual([[page.key, false], [more.key, true]]);
    expect(second.body.pages).toEqual([page.key, more.key]);
    expect(has(attachment.key)).toBe(false);
  });

  test('a nested write deletes its files only after the outer transaction commits, and never when it rolls back (Review Focus 4)', async () => {
    const manual = await upload('manual', PDF);
    const product = (await json().post('/resources/product', { name: 'Nested', manual: { token: manual.token } })).body._id as string;
    const doc = (await json().post('/resources/doc', { title: 'Outer' })).body._id as string;
    try {
      host.nested = async (api, ctx) => {
        await api.update('product', product, { manual: null }, ctx);
        throw new Error('outer write failed');
      };
      expect((await json().patch(`/resources/doc/${doc}`, { title: 'fails' })).status).toBe(500);
      expect(has(manual.key)).toBe(true);
      expect(await rowOf(manual.key)).toMatchObject({ status: 'attached', recordId: product });
      expect((await json().get(`/resources/product/${product}`)).body.manual).toBe(manual.key);
      host.nested = async (api, ctx) => void (await api.update('product', product, { manual: null }, ctx));
      expect((await json().patch(`/resources/doc/${doc}`, { title: 'works' })).status).toBe(200);
      expect(has(manual.key)).toBe(false);
      expect(await rowOf(manual.key)).toBeNull();
    } finally {
      host.nested = undefined;
    }
  });
});

describe(`GET /api/files/*key (${TEST_DB})`, () => {
  let id: string;
  let manual: { token: string; key: string };
  let secret: { token: string; key: string };
  let notes: { token: string; key: string };

  beforeAll(async () => {
    manual = await upload('manual', PDF, 'root', 'product', 'راهنما.pdf');
    secret = await upload('secretDoc', PDF);
    notes = await upload('frozen', TEXT, 'root', 'product', 'notes.txt');
    const created = await json().post('/resources/product', { name: 'Downloads', ownerId: 'someone-else', manual: { token: manual.token }, secretDoc: { token: secret.token }, frozen: { token: notes.token } });
    expect(created.status).toBe(201);
    id = created.body._id;
  });

  test('someone who may view the record gets the bytes, with headers that keep the browser from running them', async () => {
    const res = await download(manual.key, 'viewer');
    expect(res.status).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-length']).toBe(String(PDF.length));
    expect(res.headers['content-disposition']).toBe(`inline; filename*=UTF-8''${encodeURIComponent('راهنما.pdf')}`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['cache-control']).toBe('private, no-store');
    // Anything but an image or a pdf is a download.
    const text = await download(notes.key, 'viewer');
    expect(text.status).toBe(200);
    expect(text.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(text.headers['content-disposition']).toBe(`attachment; filename*=UTF-8''notes.txt`);
    expect((text.body as Buffer).toString()).toBe(TEXT.toString());
  });

  test('out of scope, a hidden field and an unknown key are the same 404 (Review Focus 3)', async () => {
    const missing = await download('product/manual/2026/01/00000000-0000-4000-8000-000000000000.pdf', 'scoped');
    const outOfScope = await download(manual.key, 'scoped');
    const hidden = await download(secret.key, 'viewer');
    expect((await download(manual.key, 'nobody-signed-in')).status).toBe(401);
    for (const res of [missing, outOfScope, hidden]) {
      expect(res.status).toBe(404);
      const body = JSON.parse((res.body as Buffer).toString());
      expect({ code: body.code, message: body.message }).toEqual({ code: 'NOT_FOUND', message: 'File not found' });
    }
    expect((await download(secret.key, 'root')).status).toBe(200);
    // The record itself shows the viewer neither the key nor the ref of the hidden field.
    const seen = (await json('viewer').get(`/resources/product/${id}`)).body;
    expect(Object.keys(seen._files).sort()).toEqual(['frozen', 'manual']);
    expect(seen.secretDoc).toBeUndefined();
    expect(Object.keys((await json('root').get(`/resources/product/${id}`)).body._files).sort()).toEqual(['frozen', 'manual', 'secretDoc']);
    // In scope, the same user gets the file.
    await db.getRepository(Product).update({ id: Number(id) }, { ownerId: 'scoped' });
    expect((await download(manual.key, 'scoped')).status).toBe(200);
    await db.getRepository(Product).update({ id: Number(id) }, { ownerId: 'someone-else' });
    expect((await download(manual.key, 'scoped')).status).toBe(404);
  });

  test('uploads nobody saved, replaced files and other shapes of key are 404', async () => {
    const temp = await upload('manual', PDF);
    // Unsaved: only the uploader may preview it (rich-text.test.ts covers the rest).
    expect((await download(temp.key, 'editor')).status).toBe(404);
    expect((await download(temp.key)).status).toBe(200);
    expect((await download('..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await download('nope')).status).toBe(404);
    // A user without the resource at all.
    const doc = (await json().post('/resources/doc', { title: 'Private' })).body._id as string;
    const attachment = await upload('attachment', PDF, 'root', 'doc');
    await json().patch(`/resources/doc/${doc}`, { attachment: { token: attachment.token } });
    expect((await download(attachment.key, 'root')).status).toBe(200);
    expect((await download(attachment.key, 'viewer')).status).toBe(404);
    // Once the record lets go of a file, its URL is dead.
    await json().patch(`/resources/product/${id}`, { frozen: null });
    expect((await download(notes.key)).status).toBe(404);
  });
});

describe(`files of deleted records (${TEST_DB})`, () => {
  const del = (path: string, who = 'root') => request(app.getHttpServer()).delete(`/admin/api${path}`).set('X-User', who);
  const productWithFiles = async (name: string) => {
    const [manual, a, b] = [await upload('manual', PDF), await upload('gallery'), await upload('gallery')];
    const created = await json().post('/resources/product', { name, manual: { token: manual.token }, gallery: [{ token: a!.token }, { token: b!.token }] });
    expect(created.status).toBe(201);
    return { id: created.body._id as string, keys: [manual!.key, a!.key, b!.key] };
  };
  const left = async (keys: string[]) => ({ objects: keys.filter(has).length, rows: await db.getRepository(NmaFile).countBy({ key: In(keys) }) });

  test('a hard delete removes the rows and the objects of that record only', async () => {
    const gone = await productWithFiles('Delete me');
    const stays = await productWithFiles('Keep me');
    expect((await del(`/resources/product/${gone.id}`)).status).toBe(204);
    expect(await left(gone.keys)).toEqual({ objects: 0, rows: 0 });
    expect(await left(stays.keys)).toEqual({ objects: 3, rows: 3 });
    // Bulk delete goes the same way.
    const bulk = await json().post('/resources/product/bulk-delete', { ids: [stays.id] });
    expect(bulk.body.ok).toEqual([stays.id]);
    expect(await left(stays.keys)).toEqual({ objects: 0, rows: 0 });
  });

  const binderWithCover = async (name: string) => {
    const cover = await upload('cover', PDF, 'root', 'binder');
    const created = await json().post('/resources/binder', { name, cover: { token: cover.token } });
    expect(created.status).toBe(201);
    return { id: created.body._id as string, keys: [cover.key] };
  };

  test('a host delete() that keeps the row (an archive flag) keeps its files: rows, objects and the download', async () => {
    const binder = await binderWithCover('archive me');
    expect((await del(`/resources/binder/${binder.id}`)).status).toBe(204);
    // The record is still there, so its file is too: releasing it would leave a key that points at nothing.
    const kept = await json().get(`/resources/binder/${binder.id}`);
    expect(kept.status).toBe(200);
    expect(kept.body.archived).toBe(true);
    expect(kept.body._files.cover.key).toBe(binder.keys[0]);
    expect(await left(binder.keys)).toEqual({ objects: 1, rows: 1 });
    expect((await rowOf(binder.keys[0]!))?.status).toBe('attached');
    expect((await download(binder.keys[0]!)).status).toBe(200);
    // Bulk delete goes the same way.
    const bulk = await json().post('/resources/binder/bulk-delete', { ids: [binder.id] });
    expect(bulk.body.ok).toEqual([binder.id]);
    expect(await left(binder.keys)).toEqual({ objects: 1, rows: 1 });
  });

  test('the same host delete() releases the files when it really deletes', async () => {
    const binder = await binderWithCover('delete me');
    expect((await del(`/resources/binder/${binder.id}`)).status).toBe(204);
    expect((await json().get(`/resources/binder/${binder.id}`)).status).toBe(404);
    expect(await left(binder.keys)).toEqual({ objects: 0, rows: 0 });
  });

  test('an action that deletes its record takes the files with it; one that keeps the record keeps them', async () => {
    const binder = await binderWithCover('act on me');
    const renamed = await json().post('/resources/binder/actions/rename', { ids: [binder.id] });
    expect(renamed.status).toBe(200);
    expect(await left(binder.keys)).toEqual({ objects: 1, rows: 1 });
    expect((await download(binder.keys[0]!)).status).toBe(200);
    const shredded = await json().post('/resources/binder/actions/shred', { ids: [binder.id] });
    expect(shredded.status).toBe(200);
    expect((await json().get(`/resources/binder/${binder.id}`)).status).toBe(404);
    expect(await left(binder.keys)).toEqual({ objects: 0, rows: 0 });
  });

  test('a purge always releases the files, whatever the host purge() leaves', async () => {
    const binder = await binderWithCover('purge me');
    expect((await del(`/resources/binder/${binder.id}?purge=true`)).status).toBe(204);
    expect(await left(binder.keys)).toEqual({ objects: 0, rows: 0 });
  });

  test('a delete that rolls back keeps the files', async () => {
    const product = await productWithFiles('Survivor');
    const doc = (await json().post('/resources/doc', { title: 'Outer delete' })).body._id as string;
    try {
      host.nested = async (api, ctx) => {
        await api.remove('product', product.id, ctx);
        throw new Error('outer write failed');
      };
      expect((await json().patch(`/resources/doc/${doc}`, { title: 'fails' })).status).toBe(500);
    } finally {
      host.nested = undefined;
    }
    expect(await left(product.keys)).toEqual({ objects: 3, rows: 3 });
    expect((await json().get(`/resources/product/${product.id}`)).status).toBe(200);
    expect((await download(product.keys[0]!)).status).toBe(200);
  });

  test('the trash keeps the files, restore brings them back, purge removes them', async () => {
    const doc = (await json().post('/resources/doc', { title: 'Trash' })).body._id as string;
    const attachment = await upload('attachment', PDF, 'root', 'doc');
    const page = await upload('pages', PNG, 'root', 'doc');
    expect((await json().patch(`/resources/doc/${doc}`, { attachment: { token: attachment.token }, pages: [{ token: page.token }] })).status).toBe(200);
    const keys = [attachment.key, page.key];
    expect((await del(`/resources/doc/${doc}`)).status).toBe(204);
    expect(await left(keys)).toEqual({ objects: 2, rows: 2 });
    expect((await download(attachment.key)).status).toBe(404); // the record is in the trash
    const restored = await json().post(`/resources/doc/${doc}/restore`, {});
    expect(restored.status).toBe(200);
    expect(restored.body._files.attachment.key).toBe(attachment.key);
    expect((await download(attachment.key)).status).toBe(200);
    expect((await del(`/resources/doc/${doc}`)).status).toBe(204);
    expect((await del(`/resources/doc/${doc}?purge=true`)).status).toBe(204);
    expect(await left(keys)).toEqual({ objects: 0, rows: 0 });
  });
});

describe(`cleanup (${TEST_DB})`, () => {
  test('the sweep deletes temp uploads older than 24 hours with their objects, and keeps the rest', async () => {
    const [stale, recent, kept] = [await upload('manual', PDF), await upload('manual', PDF), await upload('manual', PDF)];
    expect((await json().post('/resources/product', { name: 'Old but attached', manual: { token: kept!.token } })).status).toBe(201);
    const old = new Date(Date.now() - 25 * 3_600_000);
    await db.getRepository(NmaFile).update({ id: stale!.token }, { createdAt: old });
    await db.getRepository(NmaFile).update({ id: kept!.token }, { createdAt: old });
    const removed = await app.get(FilesService).sweep();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect([has(stale!.key), has(recent!.key), has(kept!.key)]).toEqual([false, true, true]);
    expect(await rowOf(stale!.key)).toBeNull();
    expect(await rowOf(recent!.key)).toMatchObject({ status: 'temp' });
    expect(await rowOf(kept!.key)).toMatchObject({ status: 'attached' });
    expect(await db.getRepository(NmaFile).countBy({ status: 'temp', createdAt: LessThan(new Date(Date.now() - 24 * 3_600_000)) })).toBe(0);
  });
});

describe(`nma_file on another DataSource (${TEST_DB})`, () => {
  test('uploads are attached before the record commits, removals follow it, a rollback gives the upload back', async () => {
    const otherDir = await mkdtemp(join(tmpdir(), 'nma-files-other-'));
    const other = await createTestApp({
      entities: [Product, Note, Doc, Binder],
      dataSources: { files: [...ADMIN_FILE_ENTITIES] },
      imports: [FilesFixtureModule],
      admin: { auth: AdminAuth.custom(HeaderAuth), files: { storage: localStorage({ dir: otherDir }), dataSource: 'files' }, roles: [{ name: 'editor', permissions: ['product.*'] }, { name: 'viewer', permissions: [] }, { name: 'limited', permissions: [] }, { name: 'scoped', permissions: [] }] },
    });
    try {
      const files = other.get<DataSource>(getDataSourceToken('files')).getRepository(NmaFile);
      const send = async () => {
        const res = await request(other.getHttpServer()).post('/admin/api/uploads?resource=product&field=manual').set('X-User', 'root').set('Content-Type', 'application/pdf').send(PDF);
        return { token: res.body.token as string, key: (await files.findOneByOrFail({ id: res.body.token })).key };
      };
      const first = await send();
      const created = await request(other.getHttpServer()).post('/admin/api/resources/product').set('X-User', 'root').send({ name: 'Elsewhere', manual: { token: first.token } });
      expect(created.status).toBe(201);
      expect(created.body._files.manual.key).toBe(first.key);
      expect(await files.findOneBy({ key: first.key })).toMatchObject({ status: 'attached', recordId: created.body._id });
      const second = await send();
      const failed = await request(other.getHttpServer()).patch(`/admin/api/resources/product/${created.body._id}`).set('X-User', 'root').send({ name: 'boom', manual: { token: second.token } });
      expect(failed.status).toBe(500);
      expect(await files.findOneBy({ key: second.key })).toMatchObject({ status: 'temp', recordId: null });
      expect(existsSync(join(otherDir, first.key))).toBe(true);
      const replaced = await request(other.getHttpServer()).patch(`/admin/api/resources/product/${created.body._id}`).set('X-User', 'root').send({ manual: { token: second.token } });
      expect(replaced.status).toBe(200);
      expect(await files.findOneBy({ key: first.key })).toBeNull();
      expect(existsSync(join(otherDir, first.key))).toBe(false);
      expect(await files.findOneBy({ key: second.key })).toMatchObject({ status: 'attached', recordId: created.body._id });
      expect((await request(other.getHttpServer()).get(`/admin/api/files/${second.key}`).set('X-User', 'root')).status).toBe(200);

      // One upload submitted twice: exactly one record gets it, the other write is refused whole.
      const once = await send();
      const submit = () => request(other.getHttpServer()).post('/admin/api/resources/product').set('X-User', 'root').send({ name: 'Twice', manual: { token: once.token } });
      const answers = await Promise.all([submit(), submit()]);
      expect(answers.map((res) => res.status).sort()).toEqual([201, 422]);
      const refused = answers.find((res) => res.status === 422)!;
      expect(refused.body.fields.manual).toEqual(['is not a valid upload']);
      const holders = await other.get<DataSource>(getDataSourceToken()).getRepository(Product).findBy({ manual: once.key });
      expect(holders.length).toBe(1);
      expect(await files.findOneBy({ key: once.key })).toMatchObject({ status: 'attached', recordId: String(holders[0]!.id) });

      // The same race, made certain: another write takes the upload after this one resolved it and before it attaches.
      const raced = await send();
      try {
        host.beforeSave = async () => void (await files.update({ id: raced.token }, { status: 'attached', recordId: '999999' }));
        const loser = await request(other.getHttpServer()).post('/admin/api/resources/product').set('X-User', 'root').send({ name: 'Raced', manual: { token: raced.token } });
        expect(loser.status).toBe(422);
        expect(loser.body.fields.manual).toEqual(['is not a valid upload']);
      } finally {
        host.beforeSave = undefined;
      }
      expect(await other.get<DataSource>(getDataSourceToken()).getRepository(Product).countBy({ name: 'Raced' })).toBe(0);
      expect(await files.findOneBy({ key: raced.key })).toMatchObject({ status: 'attached', recordId: '999999' }); // the winner keeps it

      // A rollback after the upload was attached (on the files' own connection) turns it back into temp.
      const third = await send();
      const doc = await request(other.getHttpServer()).post('/admin/api/resources/doc').set('X-User', 'root').send({ title: 'Outer' });
      let attachedInside: NmaFile | null = null;
      try {
        host.nested = async (api, ctx) => {
          await api.update('product', created.body._id, { manual: { token: third.token } }, ctx);
          attachedInside = await files.findOneBy({ key: third.key });
          throw new Error('outer write failed');
        };
        const rolledBack = await request(other.getHttpServer()).patch(`/admin/api/resources/doc/${doc.body._id}`).set('X-User', 'root').send({ title: 'fails' });
        expect(rolledBack.status).toBe(500);
      } finally {
        host.nested = undefined;
      }
      expect(attachedInside).toMatchObject({ status: 'attached', recordId: created.body._id });
      expect(await files.findOneBy({ key: third.key })).toMatchObject({ status: 'temp', recordId: null });
      expect(await files.findOneBy({ key: second.key })).toMatchObject({ status: 'attached' });
      expect(existsSync(join(otherDir, second.key))).toBe(true);
      const retried = await request(other.getHttpServer()).patch(`/admin/api/resources/product/${created.body._id}`).set('X-User', 'root').send({ manual: { token: third.token } });
      expect(retried.status).toBe(200);

      // A hard delete takes the files along, after the record commits.
      expect((await request(other.getHttpServer()).delete(`/admin/api/resources/product/${created.body._id}`).set('X-User', 'root')).status).toBe(204);
      expect(await files.findOneBy({ key: third.key })).toBeNull();
      expect(existsSync(join(otherDir, third.key))).toBe(false);

      // A host delete() that keeps the row keeps the files here too, where the rows would go after the commit.
      const coverUpload = await request(other.getHttpServer()).post('/admin/api/uploads?resource=binder&field=cover').set('X-User', 'root').set('Content-Type', 'application/pdf').send(PDF);
      const cover = (await files.findOneByOrFail({ id: coverUpload.body.token })).key;
      const binder = await request(other.getHttpServer()).post('/admin/api/resources/binder').set('X-User', 'root').send({ name: 'archive elsewhere', cover: { token: coverUpload.body.token } });
      expect(binder.status).toBe(201);
      expect((await request(other.getHttpServer()).delete(`/admin/api/resources/binder/${binder.body._id}`).set('X-User', 'root')).status).toBe(204);
      expect(await files.findOneBy({ key: cover })).toMatchObject({ status: 'attached', recordId: binder.body._id });
      expect(existsSync(join(otherDir, cover))).toBe(true);
      expect((await request(other.getHttpServer()).get(`/admin/api/files/${cover}`).set('X-User', 'root')).status).toBe(200);
    } finally {
      await other.close();
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});

describe('without `files`', () => {
  test('/api/uploads answers 404 and the rest works', async () => {
    const plain = await createTestApp({ entities: [Note], imports: [FilesFixtureModule].slice(0, 0) });
    try {
      const res = await request(plain.getHttpServer()).post('/admin/api/uploads?resource=widget&field=name').set('Content-Type', 'image/png').send(PNG);
      expect(res.status).toBe(404);
      expect((await request(plain.getHttpServer()).get('/admin/api/meta')).status).toBe(200);
    } finally {
      await plain.close();
    }
  });
});

describe('boot checks', () => {
  test('files without NmaFile in the entities fails with a hint', async () => {
    await expect(createTestApp({ admin: { files: { storage: localStorage({ dir }) } } })).rejects.toThrow('add ADMIN_FILE_ENTITIES');
  });
  test('a widget that does not fit fails at boot', async () => {
    @Entity('fu_bad')
    class Bad {
      @PrimaryGeneratedColumn() id: number;
      @Column({ default: 0 }) count: number;
    }
    @AdminResource(Bad)
    class BadAdmin extends AdminResourceBase<Bad> {
      override fields: FieldsConfig<Bad> = { count: { widget: 'file' } };
    }
    @Module({ providers: [BadAdmin] })
    class BadModule {}
    await expect(createTestApp({ entities: [Bad], imports: [BadModule] })).rejects.toThrow('the "file" widget does not fit number fields');
  });
  test('a limit the nma_file.size column (int) cannot hold fails at boot', async () => {
    await expect(createTestApp({ entities: [...ADMIN_FILE_ENTITIES], admin: { files: { storage: localStorage({ dir }), maxBytes: 2_147_483_648 } } })).rejects.toThrow('files.maxBytes must be at most 2147483647 bytes');
    @Entity('fu_big')
    class Big {
      @PrimaryGeneratedColumn() id: number;
      @Column({ type: 'varchar', length: 300, nullable: true }) video: string | null;
    }
    @AdminResource(Big)
    class BigAdmin extends AdminResourceBase<Big> {
      override fields: FieldsConfig<Big> = { video: { widget: 'file', file: { maxBytes: 5_000_000_000 } } };
    }
    @Module({ providers: [BigAdmin] })
    class BigModule {}
    await expect(createTestApp({ entities: [Big], imports: [BigModule] })).rejects.toThrow('fields.video.file.maxBytes: must be at most 2147483647 bytes');
  });
  test('file and image fields cannot be edited in a list cell', async () => {
    @Entity('fu_cell')
    class Cell {
      @PrimaryGeneratedColumn() id: number;
      @Column({ type: 'varchar', length: 300, nullable: true }) logo: string | null;
    }
    @AdminResource(Cell)
    class CellAdmin extends AdminResourceBase<Cell> {
      override fields: FieldsConfig<Cell> = { logo: { widget: 'image' } };
      override list = { editable: ['logo' as const] };
    }
    @Module({ providers: [CellAdmin] })
    class CellModule {}
    await expect(createTestApp({ entities: [Cell], imports: [CellModule] })).rejects.toThrow('list.editable: "logo" is an image field and cannot be edited in a cell');
  });
});
