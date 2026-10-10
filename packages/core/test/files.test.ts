import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Column, Entity, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import {
  ADMIN_FILE_ENTITIES,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  NmaFile,
  localStorage,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type FieldsConfig,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';

@Entity('fu_product')
class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) logo: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) manual: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) secretDoc: string | null;
  @Column({ type: 'simple-json', nullable: true }) gallery: string[] | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) frozen: string | null;
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
}

@Entity('fu_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) body: string;
}
@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}

const users: Record<string, { id: string; displayName: string; isSuperuser: boolean }> = {
  root: { id: 'root', displayName: 'Root', isSuperuser: true },
  editor: { id: 'editor', displayName: 'Editor', isSuperuser: false },
  viewer: { id: 'viewer', displayName: 'Viewer', isSuperuser: false },
  limited: { id: 'limited', displayName: 'Limited', isSuperuser: false },
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
    return { editor: ['editor'], viewer: ['viewer'], limited: ['limited'] }[String(user.id)] ?? [];
  }
}

@Module({ providers: [ProductAdmin, NoteAdmin, HeaderAuth] })
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
    entities: [Product, Note, ...ADMIN_FILE_ENTITIES],
    imports: [FilesFixtureModule],
    admin: {
      auth: AdminAuth.custom(HeaderAuth),
      files: { storage: localStorage({ dir, publicBaseUrl: 'https://cdn.example.com/f' }), maxBytes: 5000 },
      roles: [
        { name: 'editor', permissions: ['product.create', 'product.update', 'product.view'] },
        { name: 'viewer', permissions: ['product.view'] },
        { name: 'limited', permissions: ['product.create', 'product.view'], fields: { product: { manual: 'readonly' } } },
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
});
