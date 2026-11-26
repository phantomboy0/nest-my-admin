import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, type DataSource, type Relation } from 'typeorm';
import { ADMIN_FILE_ENTITIES, AdminResource, AdminResourceBase, localStorage, type FieldsConfig, type FormConfig, type ResourceSchema } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('ig_product')
class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @OneToMany(() => Picture, (picture) => picture.product) pictures: Picture[];
}

@Entity('ig_picture')
class Picture {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 300, nullable: true }) path: string | null;
  @Column({ length: 120, default: '' }) alt: string;
  @Column({ type: 'int', default: 0 }) sort: number;
  @Column({ type: 'int' }) productId: number;
  @ManyToOne(() => Product, (product) => product.pictures, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Relation<Product>;
}

@AdminResource(Picture, { title: 'alt' })
class PictureAdmin extends AdminResourceBase<Picture> {
  fields: FieldsConfig<Picture> = { path: { widget: 'image', file: { visibility: 'public' } } };
}

@AdminResource(Product, { title: 'name' })
class ProductAdmin extends AdminResourceBase<Product> {
  form: FormConfig = {
    layout: [{ fields: ['name'] }, { section: 'Pictures', inline: PictureAdmin, display: 'gallery', fields: ['path', 'alt'], order: 'sort', max: 10, cards: { markFirst: 'Main picture' } }],
  };
}

@Module({ providers: [PictureAdmin, ProductAdmin] })
class GalleryModule {}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe(`a gallery inline (${TEST_DB})`, () => {
  let app: INestApplication;
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nma-gallery-'));
    app = await createTestApp({ entities: [Product, Picture, ...ADMIN_FILE_ENTITIES], imports: [GalleryModule], admin: { files: { storage: localStorage({ dir }) } } });
  });
  afterAll(async () => {
    await app?.close();
    await rm(dir, { recursive: true, force: true });
  });
  const api = () => request(app.getHttpServer());
  const upload = async () => {
    const res = await api().post('/admin/api/uploads?resource=picture&field=path').set('Content-Type', 'application/octet-stream').set('X-File-Name', 'p.png').send(PNG);
    expect(res.status).toBe(201);
    return res.body.token as string;
  };

  test('the schema names the display and the picture field', async () => {
    const schema = (await api().get('/admin/api/meta/resources/product')).body as ResourceSchema;
    const node = (schema.form.layout ?? []).flatMap((item) => ('inline' in item ? [item] : []))[0];
    expect(node).toMatchObject({ inline: 'picture', display: 'gallery', image: 'path', order: 'sort', markFirst: 'Main picture' });
  });

  test('several pictures uploaded at once are saved as one row each, in the order chosen (the first is the main one)', async () => {
    const [a, b, c] = [await upload(), await upload(), await upload()];
    const res = await api()
      .post('/admin/api/resources/product')
      .send({
        name: 'Chair',
        _inlines: { picture: { create: [{ _key: 'n1', path: { token: a } }, { _key: 'n2', path: { token: b }, alt: 'side' }, { _key: 'n3', path: { token: c } }], order: ['n2', 'n1', 'n3'] } },
      });
    expect(res.status).toBe(201);
    const rows = await app.get<DataSource>(getDataSourceToken()).getRepository(Picture).find({ where: { productId: Number(res.body.id) }, order: { sort: 'ASC' } });
    expect(rows.map((row) => [row.alt, row.sort])).toEqual([['side', 0], ['', 1], ['', 2]]);
    expect(rows.every((row) => typeof row.path === 'string' && row.path.startsWith('picture/path/'))).toBe(true);
  });
});

describe('a gallery inline: boot checks', () => {
  test('a gallery without a single-file image field among its fields does not boot', async () => {
    @AdminResource(Picture, { name: 'bare-picture', title: 'alt' })
    class BarePictureAdmin extends AdminResourceBase<Picture> {}
    @AdminResource(Product, { name: 'bare-product', title: 'name' })
    class BareProductAdmin extends AdminResourceBase<Product> {
      form: FormConfig = { layout: [{ fields: ['name'] }, { inline: BarePictureAdmin, display: 'gallery', fields: ['alt'], order: 'sort' }] };
    }
    @Module({ providers: [BarePictureAdmin, BareProductAdmin] })
    class BareModule {}
    await expect(createTestApp({ entities: [Product, Picture], imports: [BareModule] })).rejects.toThrow('a gallery shows its rows as pictures: list a single-file image field of Picture in fields');
  });
});
