import { describe, expect, test } from 'bun:test';
import { Controller, Get, Injectable, Module, NotFoundException, Param, Res, StreamableFile, type INestApplication } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { getDataSourceToken } from '@nestjs/typeorm';
import { IsOptional, IsString } from 'class-validator';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Column, Entity, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import {
  ADMIN_FILE_ENTITIES,
  AdminFiles,
  AdminResource,
  AdminResourceBase,
  AdminSettingsPage,
  NmaFile,
  localStorage,
  type AdminFile,
  type AdminSettingsSource,
  type AdminStorage,
  type FieldsConfig,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';

@Entity('af_asset')
class Asset {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) image: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) contract: string | null;
}

@AdminResource(Asset)
class AssetAdmin extends AdminResourceBase<Asset> {
  override fields: FieldsConfig<Asset> = {
    image: { widget: 'image', file: { accept: ['image/*'], visibility: 'public' } },
    contract: { widget: 'file' }, // private, the default
  };
}

class BrandingDto {
  @IsOptional() @IsString() logo?: string | null;
}
const branding: { logo?: string | null } = {};

@AdminSettingsPage('branding', { form: BrandingDto, fields: { logo: { widget: 'image', file: { accept: ['image/*'], visibility: 'public' } } } })
class BrandingPage implements AdminSettingsSource<BrandingDto> {
  load() {
    return { logo: branding.logo ?? null };
  }
  save(changes: Partial<BrandingDto>) {
    if (changes.logo !== undefined) branding.logo = (changes.logo as unknown as AdminFile | null)?.key ?? null;
  }
}

/** A host service as the README shows it: the admin module is global, so `AdminFiles` is injected like any provider. */
@Injectable()
class MediaService {
  constructor(readonly files: AdminFiles) {}
}

/** The README's "Serving public files yourself" controller. */
@Controller('media')
class MediaController {
  constructor(private readonly files: AdminFiles) {}

  @Get('*key')
  async serve(@Param('key') key: string | string[], @Res({ passthrough: true }) res: ServerResponse): Promise<StreamableFile> {
    const file = await this.files.openPublic(Array.isArray(key) ? key.join('/') : key);
    if (!file) throw new NotFoundException();
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(file.body);
  }
}

@Module({ providers: [AssetAdmin, BrandingPage, MediaService], controllers: [MediaController] })
class MediaModule {}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const read = async (body: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
};

interface Booted {
  app: INestApplication;
  files: AdminFiles;
  db: DataSource;
  dir: string;
  /** Keys the storage was asked for (`get`) since the last `reads.length = 0`. */
  reads: string[];
  upload(resource: string, field: string, name?: string): Promise<{ token: string; key: string }>;
  close(): Promise<void>;
}

/** An admin with files on `dataSource` (the default one when omitted), over a storage that records its reads. */
async function boot(dataSource?: string): Promise<Booted> {
  const dir = await mkdtemp(join(tmpdir(), 'nma-admin-files-'));
  const inner = localStorage({ dir });
  const reads: string[] = [];
  const storage: AdminStorage = {
    put: (key, body, info) => inner.put(key, body, info),
    get: (key) => {
      reads.push(key);
      return inner.get(key);
    },
    delete: (key) => inner.delete(key),
    publicUrl: (key) => inner.publicUrl(key),
  };
  const app = await createTestApp({
    entities: [Asset, ...(dataSource ? [] : ADMIN_FILE_ENTITIES)],
    ...(dataSource ? { dataSources: { [dataSource]: [...ADMIN_FILE_ENTITIES] } } : {}),
    imports: [MediaModule],
    admin: { files: { storage, ...(dataSource ? { dataSource } : {}) } },
  });
  const db = app.get<DataSource>(getDataSourceToken(dataSource));
  return {
    app,
    files: app.get(MediaService).files,
    db,
    dir,
    reads,
    async upload(resource, field, name = 'pixel.png') {
      const res = await request(app.getHttpServer()).post(`/admin/api/uploads?resource=${resource}&field=${field}`).set('Content-Type', 'application/octet-stream').set('X-File-Name', name).send(PNG);
      expect(res.status).toBe(201);
      const token = res.body.token as string;
      return { token, key: (await db.getRepository(NmaFile).findOneByOrFail({ id: token })).key };
    },
    async close() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const create = async (t: Booted, body: object) => {
  const res = await request(t.app.getHttpServer()).post('/admin/api/resources/asset').send(body);
  expect(res.status).toBe(201);
  return res.body;
};

for (const dataSource of [undefined, 'media']) {
  describe(`AdminFiles (${dataSource ? `files.dataSource: '${dataSource}'` : 'default DataSource'})`, () => {
    test('a public, attached file: its facts, then its bytes', async () => {
      const t = await boot(dataSource);
      try {
        const image = await t.upload('asset', 'image', 'Front cover.png');
        await create(t, { name: 'a', image: { token: image.token } });
        t.reads.length = 0;

        expect(await t.files.publicFile(image.key)).toEqual({ key: image.key, name: 'Front cover.png', contentType: 'image/png', size: PNG.length });
        expect(t.reads).toEqual([]); // the facts come from the table alone

        const opened = (await t.files.openPublic(image.key))!;
        expect({ contentType: opened.contentType, size: opened.size, name: opened.name }).toEqual({ contentType: 'image/png', size: PNG.length, name: 'Front cover.png' });
        expect((await read(opened.body)).equals(PNG)).toBe(true);
        expect(t.reads).toEqual([image.key]);
      } finally {
        await t.close();
      }
    });

    test('private, unsaved, unknown and malformed keys are null, and the storage is not read', async () => {
      const t = await boot(dataSource);
      try {
        const contract = await t.upload('asset', 'contract');
        await create(t, { name: 'b', contract: { token: contract.token } });
        const temp = await t.upload('asset', 'image'); // public field, but no record took it
        const row = await t.db.getRepository(NmaFile).findOneByOrFail({ key: contract.key });
        expect([row.visibility, row.status]).toEqual(['private', 'attached']);
        expect((await t.db.getRepository(NmaFile).findOneByOrFail({ key: temp.key })).status).toBe('temp');
        t.reads.length = 0;

        const refused: unknown[] = [
          contract.key,
          temp.key,
          'asset/image/2026/01/00000000-0000-4000-8000-000000000000.png',
          '',
          '../etc/passwd',
          'asset/image/../../secret.png',
          `${contract.key}/..`,
          '/etc/passwd',
          'asset//image.png',
          'asset\\image.png',
          'asset/image\u0000.png',
          '%2e%2e/%2e%2e/etc/passwd',
          'a'.repeat(2000),
          undefined,
          null,
          42,
          { key: contract.key },
          [contract.key],
        ];
        for (const key of refused) {
          expect(await t.files.publicFile(key as string)).toBeNull();
          expect(await t.files.openPublic(key as string)).toBeNull();
        }
        expect(t.reads).toEqual([]);
      } finally {
        await t.close();
      }
    });

    test('a file whose object is gone from the storage: still a public file, but nothing to open', async () => {
      const t = await boot(dataSource);
      try {
        const image = await t.upload('asset', 'image');
        await create(t, { name: 'c', image: { token: image.token } });
        await rm(join(t.dir, image.key));
        expect(existsSync(join(t.dir, image.key))).toBe(false);
        expect(await t.files.publicFile(image.key)).toMatchObject({ key: image.key });
        expect(await t.files.openPublic(image.key)).toBeNull();
      } finally {
        await t.close();
      }
    });

    test('a file a record let go of is public no more', async () => {
      const t = await boot(dataSource);
      try {
        const image = await t.upload('asset', 'image');
        const record = await create(t, { name: 'd', image: { token: image.token } });
        expect(await t.files.publicFile(image.key)).not.toBeNull();
        expect((await request(t.app.getHttpServer()).patch(`/admin/api/resources/asset/${record._id}`).send({ image: null })).status).toBe(200);
        expect(await t.files.publicFile(image.key)).toBeNull();
        expect(await t.files.openPublic(image.key)).toBeNull();
      } finally {
        await t.close();
      }
    });
  });
}

describe("a host's own route for public files (the README's controller)", () => {
  test('serves a public file to anyone, and nothing else', async () => {
    const t = await boot();
    try {
      const image = await t.upload('asset', 'image');
      const contract = await t.upload('asset', 'contract');
      await create(t, { name: 'e', image: { token: image.token }, contract: { token: contract.token } });
      const http = request(t.app.getHttpServer());

      const served = await http.get(`/media/${image.key}`).buffer(true).parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['content-length']).toBe(String(PNG.length));
      expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect((served.body as Buffer).equals(PNG)).toBe(true);

      t.reads.length = 0;
      for (const path of [`/media/${contract.key}`, '/media/asset/image/2026/01/none.png', '/media/..%2F..%2Fetc%2Fpasswd', `/media/asset/%2E%2E/${image.key}`, `/media/${image.key}%00`]) {
        expect([path, (await http.get(path)).status]).toEqual([path, 404]);
      }
      expect(t.reads).toEqual([]);
    } finally {
      await t.close();
    }
  });
});

describe('the files of a settings page', () => {
  test('are uploaded for `page:<name>` and stored under `page/<name>/<field>/<yyyy>/<mm>/<uuid><ext>`', async () => {
    const t = await boot();
    try {
      branding.logo = undefined;
      const before = new Date();
      const logo = await t.upload('page:branding', 'logo', 'logo.png');
      const after = new Date();
      // Stored keys exist in host databases and storages: this format must not change.
      const match = /^page\/branding\/logo\/(\d{4})\/(\d{2})\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/.exec(logo.key);
      expect(match).not.toBeNull();
      const month = (date: Date) => `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`; // UTC
      expect([month(before), month(after)]).toContain(`${match![1]}/${match![2]}`);
      expect(existsSync(join(t.dir, logo.key))).toBe(true);

      const saved = await request(t.app.getHttpServer()).patch('/admin/api/pages/branding').send({ logo: { token: logo.token } });
      expect(saved.status).toBe(200);
      expect(saved.body.values.logo).toBe(logo.key);
      const row = await t.db.getRepository(NmaFile).findOneByOrFail({ key: logo.key });
      // The owner is written with a colon, the key with a slash.
      expect({ resource: row.resource, field: row.field, recordId: row.recordId, status: row.status, visibility: row.visibility }).toEqual({ resource: 'page:branding', field: 'logo', recordId: 'page', status: 'attached', visibility: 'public' });
      // A page's public file is served to a storefront like a record's.
      expect(await t.files.publicFile(logo.key)).toEqual({ key: logo.key, name: 'logo.png', contentType: 'image/png', size: PNG.length });
    } finally {
      await t.close();
    }
  });

  test('a resource file keeps `<resource>/<field>/<yyyy>/<mm>/<uuid><ext>`', async () => {
    const t = await boot();
    try {
      expect((await t.upload('asset', 'image')).key).toMatch(/^asset\/image\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
    } finally {
      await t.close();
    }
  });
});

describe('AdminFiles without `files`', () => {
  test('is injected all the same, says so, and refuses to answer', async () => {
    const app = await createTestApp({ entities: [Asset], imports: [MediaModule] });
    try {
      const files = app.get(MediaService).files;
      expect(files).toBe(app.get(AdminFiles));
      expect(files.enabled).toBe(false);
      const message = 'nest-my-admin: AdminFiles needs `files` in AdminModule.forRoot() (a storage, and ADMIN_FILE_ENTITIES in the DataSource)';
      await expect(files.publicFile('asset/image/2026/01/x.png')).rejects.toThrow(message);
      await expect(files.openPublic('asset/image/2026/01/x.png')).rejects.toThrow(message);
    } finally {
      await app.close();
    }
  });

  test('with `files` it is enabled', async () => {
    const t = await boot();
    try {
      expect(t.files.enabled).toBe(true);
    } finally {
      await t.close();
    }
  });
});
