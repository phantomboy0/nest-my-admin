import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Column, Entity, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import { ADMIN_FILE_ENTITIES, AdminAuth, AdminResource, AdminResourceBase, AdminScope, AfterSave, NmaFile, localStorage, type AdminAuthAdapter, type AdminContext, type AdminPrincipal, type FieldsConfig } from '../src/index.js';
import { richTextLoader } from '../src/files/rich-text.js';
import { FilesService } from '../src/files/files.service.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('rt_post')
class Post {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) title: string;
  @Column({ type: 'text', nullable: true }) body: string | null;
  @Column({ type: 'text', nullable: true }) teaser: string | null;
  @Column({ type: 'varchar', length: 40, default: '' }) ownerId: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) cover: string | null;
}

@AdminResource(Post)
class PostAdmin extends AdminResourceBase<Post> {
  override fields: FieldsConfig<Post> = {
    body: { widget: 'richtext' },
    teaser: { widget: 'richtext', restricted: true, file: { visibility: 'public', maxBytes: 3000 } },
    cover: { widget: 'image' },
  };
  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
  /** Fails the write after the row was saved, so the transaction has something to roll back. */
  @AfterSave() refuseBoom(post: Post) {
    if (post.title === 'boom') throw new Error('boom');
  }
}

const users: Record<string, { id: string; displayName: string; isSuperuser: boolean }> = Object.fromEntries(
  ['root', 'editor', 'other', 'viewer', 'scoped'].map((id) => [id, { id, displayName: id, isSuperuser: id === 'root' }]),
);

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users[String(req.headers['x-user'] ?? '')];
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return { editor: ['editor'], other: ['editor'], viewer: ['viewer'], scoped: ['scoped'] }[String(user.id)] ?? [];
  }
}

@Module({ providers: [PostAdmin, HeaderAuth] })
class RichFixtureModule {}

const roles = [
  { name: 'editor', permissions: ['post.create', 'post.update', 'post.view'] },
  { name: 'viewer', permissions: ['post.view'] },
  { name: 'scoped', permissions: ['post.view'], scopes: { post: { view: 'own' } } },
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 0x20)]);

let app: INestApplication;
let dir: string;
let db: DataSource;
const call = (target?: INestApplication) => {
  const server = () => (target ?? app).getHttpServer();
  return {
  get: (path: string, who = 'root') => request(server()).get(`/admin/api${path}`).set('X-User', who),
  post: (path: string, body: object, who = 'root') => request(server()).post(`/admin/api${path}`).set('X-User', who).send(body),
  patch: (path: string, body: object, who = 'root') => request(server()).patch(`/admin/api${path}`).set('X-User', who).send(body),
  delete: (path: string, who = 'root') => request(server()).delete(`/admin/api${path}`).set('X-User', who),
  upload: (field: string, body: Buffer, who = 'root', type = 'image/png') =>
    request(server()).post(`/admin/api/uploads?resource=post&field=${field}`).set('X-User', who).set('Content-Type', type).send(body),
  };
};
const api = call();
const srcOf = (key: string) => `/admin/api/files/${key}`;
const img = (key: string) => `<img src="${srcOf(key)}" alt="pic" />`;
/** Uploads an editor image and answers its key. */
async function editorImage(field = 'body', who = 'root', body = PNG): Promise<{ token: string; key: string }> {
  const res = await api.upload(field, body, who);
  expect(res.status).toBe(201);
  const row = await db.getRepository(NmaFile).findOneByOrFail({ id: res.body.token });
  return { token: res.body.token, key: row.key };
}
const has = (key: string) => existsSync(join(dir, key));
const rowOf = (key: string) => db.getRepository(NmaFile).findOneBy({ key });
const download = (key: string, who = 'root') => request(app.getHttpServer()).get(`/admin/api/files/${key}`).set('X-User', who).responseType('blob');
const create = async (body: string, extra: object = {}, who = 'root') => {
  const res = await api.post('/resources/post', { title: 't', body, ...extra }, who);
  expect(res.status).toBe(201);
  return res.body as { _id: string; body: string };
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nma-rt-'));
  app = await createTestApp({
    entities: [Post, ...ADMIN_FILE_ENTITIES],
    imports: [RichFixtureModule],
    admin: { auth: AdminAuth.custom(HeaderAuth), files: { storage: localStorage({ dir }), maxBytes: 5000 }, roles },
  });
  db = app.get<DataSource>(getDataSourceToken());
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe(`rich text is sanitized on write (${TEST_DB})`, () => {
  test('editor markup is kept on create and update, links get rel', async () => {
    const html = '<h2>Title</h2><p>Hello <strong>bold</strong> <a href="https://example.com/a">link</a></p><ul><li>one</li></ul>';
    const created = await create(html);
    expect(created.body).toBe('<h2>Title</h2><p>Hello <strong>bold</strong> <a href="https://example.com/a" rel="noopener noreferrer nofollow">link</a></p><ul><li>one</li></ul>');
    const updated = await api.patch(`/resources/post/${created._id}`, { body: '<p onclick="x()">changed</p>' });
    expect(updated.status).toBe(200);
    expect(updated.body.body).toBe('<p>changed</p>');
    expect((await db.getRepository(Post).findOneByOrFail({ id: Number(created._id) })).body).toBe('<p>changed</p>');
  });

  test('Review Focus 5: every payload is stripped before it is stored', async () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      `<img src="${srcOf('post/body/a.png')}" onerror="alert(1)">`,
      '<a href="javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<p>a</p><script>alert(1)</script>',
      '<style>body{display:none}</style><p>a</p>',
      '<iframe src="https://evil.example"></iframe>',
      '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
      '<img src="data:image/png;base64,AAAA">',
    ];
    const bad = /javascript:|data:|onerror|<script|<style|<iframe|alert\(/i;
    for (const payload of payloads) {
      const created = await create(payload);
      expect(created.body).not.toMatch(bad);
      expect((await db.getRepository(Post).findOneByOrFail({ id: Number(created._id) })).body).not.toMatch(bad);
      const updated = await api.patch(`/resources/post/${created._id}`, { body: `<p>x</p>${payload}` });
      expect(updated.body.body).not.toMatch(bad);
    }
  });

  test('null clears the field, a non-string is a 422', async () => {
    const created = await create('<p>x</p>');
    expect((await api.patch(`/resources/post/${created._id}`, { body: null })).body.body).toBeNull();
    const res = await api.patch(`/resources/post/${created._id}`, { body: 5 });
    expect(res.status).toBe(422);
    expect(res.body.fields.body).toEqual(['must be text']);
  });

  test('the schema says the editor can upload images, and how big', async () => {
    const res = await call().get('/meta/resources/post');
    const field = (name: string) => res.body.fields.find((candidate: { name: string }) => candidate.name === name);
    expect(field('body')).toMatchObject({ widget: 'richtext', richtext: { images: true, maxBytes: 5000 } });
    expect(field('body').file).toBeUndefined();
    expect(field('teaser')).toMatchObject({ richtext: { images: true, maxBytes: 3000 } });
  });
});

describe(`editor images (${TEST_DB})`, () => {
  test('an uploaded image, referenced and saved, is attached and downloadable by a viewer of the record', async () => {
    const image = await editorImage();
    expect(await rowOf(image.key)).toMatchObject({ status: 'temp', field: 'body', resource: 'post', visibility: 'private', contentType: 'image/png' });
    const created = await create(`<p>look</p>${img(image.key)}`);
    expect(created.body).toBe(`<p>look</p>${img(image.key)}`);
    expect(await rowOf(image.key)).toMatchObject({ status: 'attached', recordId: created._id, field: 'body' });
    const res = await download(image.key, 'viewer');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect((res.body as Buffer).equals(PNG)).toBe(true);
    // Nobody without view on the resource.
    expect((await download(image.key, 'nobody')).status).toBe(401);
  });

  test('out of scope and a hidden field are the same 404 as a missing key', async () => {
    const image = await editorImage();
    const hiddenImage = await editorImage('teaser');
    const created = await create(`${img(image.key)}`, { teaser: img(hiddenImage.key), ownerId: 'someone' });
    expect((await download(image.key, 'viewer')).status).toBe(200);
    expect((await download(image.key, 'scoped')).status).toBe(404);
    expect((await download(hiddenImage.key, 'viewer')).status).toBe(404);
    expect((await download(hiddenImage.key, 'root')).status).toBe(200);
    const missing = await download('post/body/2026/01/00000000-0000-4000-8000-000000000000.png', 'scoped');
    const shape = (res: { body: Buffer }) => {
      const { code, message } = JSON.parse(res.body.toString());
      return { code, message };
    };
    expect(shape(await download(image.key, 'scoped'))).toEqual(shape(missing));
    await db.getRepository(Post).update({ id: Number(created._id) }, { ownerId: 'scoped' });
    expect((await download(image.key, 'scoped')).status).toBe(200);
  });

  test('the image is not downloadable once the HTML no longer references it, and its object goes after commit', async () => {
    const keep = await editorImage();
    const drop = await editorImage();
    const created = await create(`${img(keep.key)}${img(drop.key)}`);
    expect(has(drop.key)).toBe(true);
    const res = await api.patch(`/resources/post/${created._id}`, { body: img(keep.key) });
    expect(res.status).toBe(200);
    expect(has(drop.key)).toBe(false);
    expect(await rowOf(drop.key)).toBeNull();
    expect((await download(drop.key)).status).toBe(404);
    expect(has(keep.key)).toBe(true);
    // Clearing the field removes the rest.
    await api.patch(`/resources/post/${created._id}`, { body: null });
    expect(has(keep.key)).toBe(false);
    expect(await rowOf(keep.key)).toBeNull();
  });

  test('a PATCH that leaves the field out touches its images', async () => {
    const image = await editorImage();
    const created = await create(img(image.key));
    await api.patch(`/resources/post/${created._id}`, { title: 'renamed' });
    expect(has(image.key)).toBe(true);
    expect(await rowOf(image.key)).toMatchObject({ status: 'attached' });
  });

  test('a failed write leaves the removed image and keeps the new upload temp', async () => {
    const old = await editorImage();
    const fresh = await editorImage();
    const created = await create(img(old.key));
    const res = await api.patch(`/resources/post/${created._id}`, { title: 'boom', body: img(fresh.key) });
    expect(res.status).toBe(500);
    expect(has(old.key)).toBe(true);
    expect(await rowOf(old.key)).toMatchObject({ status: 'attached' });
    expect(await rowOf(fresh.key)).toMatchObject({ status: 'temp', recordId: null });
  });

  test("another user's unsaved upload and another record's image are stripped, not rejected", async () => {
    const theirs = await editorImage('body', 'other');
    const first = await editorImage();
    const owner = await create(img(first.key));
    const mixed = `<p>a</p>${img(theirs.key)}${img(first.key)}<p>b</p>`;
    const created = await create(mixed, {}, 'editor');
    expect(created.body).toBe('<p>a</p><p>b</p>');
    expect(await rowOf(theirs.key)).toMatchObject({ status: 'temp', recordId: null });
    expect(await rowOf(first.key)).toMatchObject({ status: 'attached', recordId: owner._id });
    const updated = await api.patch(`/resources/post/${created._id}`, { body: `${img(theirs.key)}${img(first.key)}` }, 'editor');
    expect(updated.status).toBe(200);
    expect(updated.body.body).toBe('');
    // The other record still has its image.
    expect((await download(first.key)).status).toBe(200);
    expect((await api.get(`/resources/post/${owner._id}`)).body.body).toBe(img(first.key));
  });

  test('an image of another field, an unknown key and a foreign URL are stripped', async () => {
    const other = await editorImage('teaser');
    const res = await api.post('/resources/post', {
      title: 't',
      body: `${img(other.key)}${img('post/body/2026/01/00000000-0000-4000-8000-000000000000.png')}<img src="https://evil.example/x.png"><img src="${srcOf('x.png')}?a=1">`,
    });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('');
    expect(await rowOf(other.key)).toMatchObject({ status: 'temp' });
  });

  test('an old upload (over 24 hours) is stripped', async () => {
    const image = await editorImage();
    await db.getRepository(NmaFile).update({ key: image.key }, { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    expect((await create(img(image.key))).body).toBe('');
  });

  test('the same image twice in one HTML is one file', async () => {
    const image = await editorImage();
    const created = await create(`${img(image.key)}<p>x</p>${img(image.key)}`);
    expect(created.body).toBe(`${img(image.key)}<p>x</p>${img(image.key)}`);
    expect(await rowOf(image.key)).toMatchObject({ status: 'attached', recordId: created._id });
  });

  test('deleting the record deletes its images', async () => {
    const image = await editorImage();
    const created = await create(img(image.key));
    expect((await api.delete(`/resources/post/${created._id}`)).status).toBe(204);
    expect(has(image.key)).toBe(false);
    expect(await rowOf(image.key)).toBeNull();
  });

  test('a stored image survives an update that sends the HTML back (kept by URL)', async () => {
    const image = await editorImage();
    const created = await create(img(image.key));
    const res = await api.patch(`/resources/post/${created._id}`, { body: `<p>more</p>${created.body}` });
    expect(res.body.body).toBe(`<p>more</p>${img(image.key)}`);
    expect(has(image.key)).toBe(true);
  });

  test('a file-field key put in the HTML is not an editor image', async () => {
    const cover = await api.upload('cover', PNG);
    const coverKey = (await db.getRepository(NmaFile).findOneByOrFail({ id: cover.body.token })).key;
    const created = await create('<p>x</p>', { cover: { token: cover.body.token } });
    const res = await api.patch(`/resources/post/${created._id}`, { body: img(coverKey) });
    expect(res.body.body).toBe('');
    // ... and dropping the image from HTML written by the host never deletes it.
    await db.getRepository(Post).update({ id: Number(created._id) }, { body: img(coverKey) });
    await api.patch(`/resources/post/${created._id}`, { body: '<p>y</p>' });
    expect(has(coverKey)).toBe(true);
  });
});

describe(`uploads from the editor (${TEST_DB})`, () => {
  test('a non-image upload to a richtext field is a 422 and leaves nothing', async () => {
    const before = await db.getRepository(NmaFile).count();
    const res = await api.upload('body', PDF, 'root', 'application/pdf');
    expect(res.status).toBe(422);
    expect(res.body.fields.body).toEqual(['is not an accepted file type']);
    expect(await db.getRepository(NmaFile).count()).toBe(before);
  });

  test('the response carries the URL to put in the HTML: the download route, or the public URL', async () => {
    const res = await api.upload('body', PNG);
    const key = (await db.getRepository(NmaFile).findOneByOrFail({ id: res.body.token })).key;
    expect(res.body.url).toBe(srcOf(key));
    const created = await create(`<img src="${res.body.url}">`);
    expect(created.body).toContain(res.body.url);
    expect(await rowOf(key)).toMatchObject({ status: 'attached' });
  });

  test('the field config sets maxBytes and visibility', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(3500)]);
    expect((await api.upload('teaser', big)).status).toBe(413);
    expect((await api.upload('body', big)).status).toBe(201);
    const res = await api.upload('teaser', PNG);
    expect(res.status).toBe(201);
    expect(await db.getRepository(NmaFile).findOneByOrFail({ id: res.body.token })).toMatchObject({ visibility: 'public' });
  });

  test('a hidden richtext field cannot be uploaded to; a viewer cannot upload at all', async () => {
    expect((await api.upload('teaser', PNG, 'editor')).status).toBe(403);
    expect((await api.upload('body', PNG, 'viewer')).status).toBe(403);
  });

  test('the uploader previews the unsaved image; nobody else can', async () => {
    const image = await editorImage('body', 'editor');
    const mine = await download(image.key, 'editor');
    expect(mine.status).toBe(200);
    expect((mine.body as Buffer).equals(PNG)).toBe(true);
    expect((await download(image.key, 'other')).status).toBe(404);
    expect((await download(image.key, 'root')).status).toBe(404);
    expect((await download(image.key, 'viewer')).status).toBe(404);
    await db.getRepository(NmaFile).update({ key: image.key }, { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    expect((await download(image.key, 'editor')).status).toBe(404);
  });
});

describe('configurations', () => {
  const open = async (admin: object, fn: (app: INestApplication, db: DataSource) => Promise<void>) => {
    const local = await createTestApp({ entities: [Post, ...ADMIN_FILE_ENTITIES], imports: [RichFixtureModule], admin: { auth: AdminAuth.custom(HeaderAuth), roles, ...admin } });
    try {
      await fn(local, local.get<DataSource>(getDataSourceToken()));
    } finally {
      await local.close();
    }
  };

  test('without files the HTML is sanitized and every image is stripped, and the editor is told it cannot upload', async () => {
    await open({}, async (local) => {
      const res = await call(local).post('/resources/post', { title: 't', body: `<p>a</p>${img('post/body/x.png')}<img src="https://cdn.example/x.png">` });
      expect(res.status).toBe(201);
      expect(res.body.body).toBe('<p>a</p>');
      const schema = await call(local).get('/meta/resources/post');
      expect(schema.body.fields.find((f: { name: string }) => f.name === 'body').richtext).toMatchObject({ images: false });
      expect((await call(local).upload('body', PNG)).status).toBe(404);
    });
  });

  test('a host sanitizeHtml replaces the default (and its output is what is stored)', async () => {
    const seen: string[] = [];
    await open({ files: { storage: localStorage({ dir }), sanitizeHtml: (html: string) => (seen.push(html), html.toUpperCase().replace(/<SCRIPT[^]*SCRIPT>/g, '')) } }, async (local) => {
      const res = await call(local).post('/resources/post', { title: 't', body: '<p onclick="x()">a</p><script>1</script>' });
      expect(res.body.body).toBe('<P ONCLICK="X()">A</P>');
      expect(seen).toEqual(['<p onclick="x()">a</p><script>1</script>']);
    });
  });

  test('a host sanitizeHtml needs no sanitize-html package', async () => {
    const original = richTextLoader.import;
    richTextLoader.import = () => Promise.reject(new Error('Cannot find module'));
    try {
      await open({ files: { storage: localStorage({ dir }), sanitizeHtml: (html: string) => html } }, async () => undefined);
    } finally {
      richTextLoader.import = original;
    }
  });

  test('a richtext field without the sanitize-html package fails at boot with the install hint', async () => {
    const original = richTextLoader.import;
    richTextLoader.import = () => Promise.reject(Object.assign(new Error("Cannot find package 'sanitize-html'"), { code: 'ERR_MODULE_NOT_FOUND' }));
    try {
      await expect(open({}, async () => undefined)).rejects.toThrow(/"sanitize-html".*npm install sanitize-html/s);
    } finally {
      richTextLoader.import = original;
    }
  });

  test('an app without richtext fields never loads the package', async () => {
    @Entity('rt_plain')
    class Plain {
      @PrimaryGeneratedColumn() id: number;
      @Column({ default: '' }) name: string;
    }
    @AdminResource(Plain)
    class PlainAdmin extends AdminResourceBase<Plain> {}
    @Module({ providers: [PlainAdmin] })
    class PlainModule {}
    const original = richTextLoader.import;
    richTextLoader.import = () => Promise.reject(new Error('must not load'));
    try {
      const local = await createTestApp({ entities: [Plain], imports: [PlainModule] });
      await local.close();
    } finally {
      richTextLoader.import = original;
    }
  });

  test('richtext on a nested field is refused at boot (it is not a field of the resource)', async () => {
    @Entity('rt_nested')
    class Nested {
      @PrimaryGeneratedColumn() id: number;
      @Column({ type: 'simple-json', nullable: true }) meta: { note: string } | null;
    }
    @AdminResource(Nested)
    class NestedAdmin extends AdminResourceBase<Nested> {
      override fields: FieldsConfig<Nested> = { 'meta.note': { widget: 'richtext' } } as never;
    }
    @Module({ providers: [NestedAdmin] })
    class NestedModule {}
    await expect(createTestApp({ entities: [Nested], imports: [NestedModule] })).rejects.toThrow(/unknown field "meta.note"/);
  });

  test('richtext does not fit a number column', async () => {
    @Entity('rt_num')
    class Num {
      @PrimaryGeneratedColumn() id: number;
      @Column({ type: 'int', default: 0 }) qty: number;
    }
    @AdminResource(Num)
    class NumAdmin extends AdminResourceBase<Num> {
      override fields: FieldsConfig<Num> = { qty: { widget: 'richtext' } };
    }
    @Module({ providers: [NumAdmin] })
    class NumModule {}
    await expect(createTestApp({ entities: [Num], imports: [NumModule] })).rejects.toThrow('the "richtext" widget does not fit number fields');
  });

  test('accept on a richtext field is refused at boot', async () => {
    @Entity('rt_acc')
    class Acc {
      @PrimaryGeneratedColumn() id: number;
      @Column({ type: 'varchar', length: 100, default: '' }) body: string;
    }
    @AdminResource(Acc)
    class AccAdmin extends AdminResourceBase<Acc> {
      override fields: FieldsConfig<Acc> = { body: { widget: 'richtext', file: { accept: ['application/pdf'] } } };
    }
    @Module({ providers: [AccAdmin] })
    class AccModule {}
    await expect(createTestApp({ entities: [Acc], imports: [AccModule] })).rejects.toThrow('always image/*');
  });
});

test('FilesService exposes the sanitizer to the write path', () => {
  expect(app.get(FilesService).sanitizeHtml('<p>a</p><script>x</script>')).toBe('<p>a</p>');
});
