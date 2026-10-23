import { describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { IsOptional, IsString } from 'class-validator';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Column, Entity, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import {
  ADMIN_FILE_ENTITIES,
  AdminFiles,
  AdminResource,
  AdminResourceBase,
  AdminSettingsPage,
  NmaFile,
  localStorage,
  type AdminSettingsSource,
  type FieldsConfig,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';

@Entity('afr_item')
class Item {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) image: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) thumb: string | null;
  @Column({ type: 'varchar', length: 300, nullable: true }) manual: string | null;
}

@AdminResource(Item)
class ItemAdmin extends AdminResourceBase<Item> {
  override fields: FieldsConfig<Item> = {
    image: { widget: 'image', file: { visibility: 'public' } },
    thumb: { widget: 'image', file: { maxBytes: 20 } },
    manual: { widget: 'file' },
  };
}

class LogoDto {
  @IsOptional() @IsString() logo?: string | null;
}

@AdminSettingsPage('look', { form: LogoDto, fields: { logo: { widget: 'image', file: { visibility: 'public' } } } })
class LookPage implements AdminSettingsSource<LogoDto> {
  load() {
    return { logo: null };
  }
  save() {}
}

/** A host service: the admin module is global, so `AdminFiles` is injected like any provider. */
@Injectable()
class Importer {
  constructor(readonly files: AdminFiles) {}
}

@Module({ providers: [ItemAdmin, LookPage, Importer] })
class ImportModule {}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');

interface Booted {
  app: INestApplication;
  files: AdminFiles;
  /** The DataSource of the records. */
  db: DataSource;
  /** The DataSource of `nma_file` (the same one without `files.dataSource`). */
  fileDb: DataSource;
  dir: string;
  close(): Promise<void>;
}

async function boot(dataSource?: string): Promise<Booted> {
  const dir = await mkdtemp(join(tmpdir(), 'nma-register-'));
  const app = await createTestApp({
    entities: [Item, ...(dataSource ? [] : ADMIN_FILE_ENTITIES)],
    ...(dataSource ? { dataSources: { [dataSource]: [...ADMIN_FILE_ENTITIES] } } : {}),
    imports: [ImportModule],
    admin: { files: { storage: localStorage({ dir }), ...(dataSource ? { dataSource } : {}) } },
  });
  return {
    app,
    files: app.get(Importer).files,
    db: app.get<DataSource>(getDataSourceToken()),
    fileDb: app.get<DataSource>(getDataSourceToken(dataSource)),
    dir,
    async close() {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const stored = (t: Booted, key: string) => existsSync(join(t.dir, key));
const rows = (t: Booted) => t.fileDb.getRepository(NmaFile).find();

for (const dataSource of [undefined, 'media']) {
  describe(`AdminFiles.register / release (${dataSource ? `files.dataSource: '${dataSource}'` : 'default DataSource'})`, () => {
    test('a registered image is an attached file of the record, public like the field, and in _files once the record holds it', async () => {
      const t = await boot(dataSource);
      try {
        const item = await t.db.getRepository(Item).save({ name: 'Lamp' });
        const file = await t.files.register({ resource: 'item', field: 'image', recordId: item.id, body: Readable.from([PNG]), name: 'crm/lamp front.png' });
        expect(file).toMatchObject({ name: 'lamp front.png', contentType: 'image/png', size: PNG.length, isNew: true });
        expect(file.key).toMatch(/^item\/image\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
        expect(stored(t, file.key)).toBe(true);
        const row = await t.fileDb.getRepository(NmaFile).findOneByOrFail({ key: file.key });
        expect([row.status, row.visibility, row.resource, row.field, row.recordId]).toEqual(['attached', 'public', 'item', 'image', String(item.id)]);
        expect(await t.files.publicFile(file.key)).toEqual({ key: file.key, name: 'lamp front.png', contentType: 'image/png', size: PNG.length });

        await t.db.getRepository(Item).update(item.id, { image: file.key });
        const read = await request(t.app.getHttpServer()).get(`/admin/api/resources/item/${item.id}`);
        expect(read.body._files.image).toMatchObject({ key: file.key, name: 'lamp front.png', contentType: 'image/png' });
        // The admin's own lifecycle takes over: removing it in the form releases the file.
        const cleared = await request(t.app.getHttpServer()).patch(`/admin/api/resources/item/${item.id}`).send({ image: null });
        expect(cleared.status).toBe(200);
        expect(await rows(t)).toEqual([]);
        expect(stored(t, file.key)).toBe(false);
      } finally {
        await t.close();
      }
    });

    test('a file the field would refuse is refused, and nothing is stored (Review Focus 5)', async () => {
      const t = await boot(dataSource);
      try {
        const register = (field: string, body: Buffer) => t.files.register({ resource: 'item', field, recordId: 1, body, name: 'x' });
        await expect(register('image', PDF)).rejects.toMatchObject({ status: 422, fields: { image: ['is not an accepted file type'] } });
        await expect(register('thumb', PNG)).rejects.toMatchObject({ status: 422, fields: { thumb: ['is larger than the 20 byte limit'] } });
        expect(await rows(t)).toEqual([]);
        expect(existsSync(join(t.dir, 'item'))).toBe(false);
        // A private file field takes the PDF, as an upload would.
        expect((await register('manual', PDF)).contentType).toBe('application/pdf');
      } finally {
        await t.close();
      }
    });

    test('registered inside a transaction that rolls back: no row, no object (Review Focus 5)', async () => {
      const t = await boot(dataSource);
      try {
        const item = await t.db.getRepository(Item).save({ name: 'Lamp' });
        let key = '';
        await expect(
          t.db.transaction(async (manager) => {
            key = (await t.files.register({ resource: 'item', field: 'image', recordId: item.id, body: PNG, name: 'a.png' }, manager)).key;
            await manager.update(Item, item.id, { image: key });
            throw new Error('the import failed');
          }),
        ).rejects.toThrow('the import failed');
        expect(key).not.toBe('');
        expect(await rows(t)).toEqual([]);
        expect(stored(t, key)).toBe(false);
        expect((await t.db.getRepository(Item).findOneByOrFail({ id: item.id })).image).toBeNull();

        // The same, committed: the row and the object stay.
        const kept = await t.db.transaction(async (manager) => {
          const file = await t.files.register({ resource: 'item', field: 'image', recordId: item.id, body: PNG, name: 'b.png' }, manager);
          await manager.update(Item, item.id, { image: file.key });
          return file.key;
        });
        expect((await rows(t)).map((row) => row.key)).toEqual([kept]);
        expect(stored(t, kept)).toBe(true);
      } finally {
        await t.close();
      }
    });

    test('release: the held key goes (its object after commit); a key of another record is left alone', async () => {
      const t = await boot(dataSource);
      try {
        const [a, b] = await t.db.getRepository(Item).save([{ name: 'A' }, { name: 'B' }]);
        const ofA = await t.files.register({ resource: 'item', field: 'manual', recordId: a!.id, body: PDF, name: 'a.pdf' });
        const ofB = await t.files.register({ resource: 'item', field: 'manual', recordId: b!.id, body: PDF, name: 'b.pdf' });

        await t.files.release({ resource: 'item', field: 'manual', recordId: a!.id, key: ofB.key }); // B's file, named as A's: no-op
        await t.files.release({ resource: 'item', field: 'image', recordId: b!.id, key: ofB.key }); // the wrong field: no-op
        expect((await rows(t)).length).toBe(2);
        expect(stored(t, ofB.key)).toBe(true);

        // Inside a transaction: the object waits for the commit; a rollback keeps both.
        await expect(
          t.db.transaction(async (manager) => {
            await t.files.release({ resource: 'item', field: 'manual', recordId: a!.id, key: ofA.key }, manager);
            throw new Error('changed my mind');
          }),
        ).rejects.toThrow('changed my mind');
        expect((await rows(t)).length).toBe(2);
        expect(stored(t, ofA.key)).toBe(true);

        await t.db.transaction(async (manager) => {
          await t.files.release({ resource: 'item', field: 'manual', recordId: a!.id, key: ofA.key }, manager);
          expect(stored(t, ofA.key)).toBe(true); // not before the commit
        });
        expect((await rows(t)).map((row) => row.key)).toEqual([ofB.key]);
        expect(stored(t, ofA.key)).toBe(false);
      } finally {
        await t.close();
      }
    });

    test('unknown resources and fields, and fields that hold no files, are errors; a settings page is an owner', async () => {
      const t = await boot(dataSource);
      try {
        await expect(t.files.register({ resource: 'nope', field: 'image', recordId: 1, body: PNG, name: 'a.png' })).rejects.toThrow('unknown resource "nope"');
        await expect(t.files.register({ resource: 'item', field: 'nope', recordId: 1, body: PNG, name: 'a.png' })).rejects.toThrow('unknown field "nope"');
        await expect(t.files.register({ resource: 'item', field: 'name', recordId: 1, body: PNG, name: 'a.png' })).rejects.toThrow('is not a file or image field');

        const logo = await t.files.register({ resource: 'page:look', field: 'logo', recordId: 'anything', body: PNG, name: 'logo.png' });
        expect(logo.key).toMatch(/^page\/look\/logo\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/);
        const row = await t.fileDb.getRepository(NmaFile).findOneByOrFail({ key: logo.key });
        expect([row.resource, row.recordId, row.visibility]).toEqual(['page:look', 'page', 'public']);
      } finally {
        await t.close();
      }
    });
  });
}
