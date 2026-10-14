import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, VersionColumn, type DataSource, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import {
  ADMIN_AUDIT_ENTITIES,
  ADMIN_FILE_ENTITIES,
  AdminAuth,
  AdminCan,
  AdminContext,
  AdminFieldError,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  NmaAuditEntry,
  NmaFile,
  localStorage,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUser,
  type FieldsConfig,
  type FormConfig,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

// ── Catalog: products with variants (table, ordered), pictures (cards, a file field) and specs (dependent options) ──

@Entity('inw_category')
class Category {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

@Entity('inw_attribute')
class Attribute {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ type: 'int' }) categoryId: number;
}

@Entity('inw_product')
class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ type: 'int', nullable: true }) categoryId: number | null;
  @ManyToOne(() => Category, { nullable: true }) @JoinColumn({ name: 'categoryId' }) category: Category | null;
  @VersionColumn() version: number;
}

@Entity('inw_variant')
class Variant {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 30 }) sku: string;
  @Column({ type: 'int', default: 0 }) price: number;
  @Column({ type: 'int', default: 0 }) sort: number;
  @Column({ default: true }) active: boolean;
  @Column({ default: false }) locked: boolean;
  @Column({ type: 'int' }) productId: number;
  @ManyToOne(() => Product, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Product;
  @VersionColumn() version: number;
}

@Entity('inw_media')
class Media {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60, default: '' }) caption: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) image: string | null;
  @Column({ type: 'int', default: 0 }) sort: number;
  /** No explicit column: the link field is `product`. */
  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' }) product: Product;
}

@Entity('inw_spec')
class Spec {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) value: string;
  @Column({ type: 'int' }) attributeId: number;
  @ManyToOne(() => Attribute) @JoinColumn({ name: 'attributeId' }) attribute: Attribute;
  @Column({ type: 'int' }) productId: number;
  @ManyToOne(() => Product, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Product;
}

/** The link is required by the DTO: the inline sets it, the client may not. */
class VariantDto {
  @IsString() @Length(1, 30) sku: string;
  @IsInt() @Min(0) price: number;
  @IsOptional() @IsInt() sort?: number;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsInt() productId: number;
}

@AdminResource(Variant, { title: 'sku' })
class VariantAdmin extends AdminResourceBase<Variant> {
  override form: FormConfig = { create: VariantDto };
  override fields: FieldsConfig<Variant> = { sku: { readonlyIf: (variant: Variant) => variant.locked } };
  @AdminScope('active') activeOnly() {
    return { active: true };
  }
  @AdminCan('delete') unlocked(variant: Variant) {
    return !variant.locked;
  }
}

@AdminResource(Media, { name: 'media', title: 'caption' })
class MediaAdmin extends AdminResourceBase<Media> {
  override fields: FieldsConfig<Media> = { image: { widget: 'image' } };
}

@AdminResource(Spec, { name: 'spec', title: 'value' })
class SpecAdmin extends AdminResourceBase<Spec> {
  static seen: Array<Record<string, unknown>> = [];
  override relationOptions(field: string, qb: SelectQueryBuilder<any>, _ctx: AdminContext, values: Record<string, unknown>): SelectQueryBuilder<any> {
    if (field !== 'attributeId') return qb;
    SpecAdmin.seen.push(values);
    const parent = values._parent as { categoryId?: unknown } | undefined;
    return parent?.categoryId != null ? qb.andWhere('option.categoryId = :nmaCategory', { nmaCategory: parent.categoryId }) : qb;
  }
}

@AdminResource(Product, { title: 'name' })
class ProductAdmin extends AdminResourceBase<Product> {
  override form: FormConfig = {
    layout: [
      { section: 'Details', fields: ['name', 'categoryId'] },
      { section: 'Variants', inline: VariantAdmin, display: 'table', order: 'sort', fields: ['sku', 'price', 'active'], max: 6 },
      { section: 'Pictures', inline: MediaAdmin, order: 'sort' },
      { section: 'Specs', inline: SpecAdmin },
    ],
  };
}

// ── Orders: the line resource creates through a host service, on ctx.manager ──

@Entity('inw_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) number: string;
}

@Entity('inw_line')
class Line {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) orderId: number;
  @ManyToOne(() => Order, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'orderId' }) order: Order;
  @Column({ length: 40 }) product: string;
  @Column({ type: 'int', default: 1 }) qty: number;
  @Column({ type: 'int', default: 0 }) position: number;
}

@Injectable()
class LineService {
  readonly managers: EntityManager[] = [];
  async add(dto: Partial<Line>, manager: EntityManager): Promise<Line> {
    this.managers.push(manager);
    const repo = manager.getRepository(Line);
    const saved = await repo.save(repo.create(dto));
    if (dto.product === 'BOOM') throw new AdminFieldError({ product: 'cannot be sold' });
    return saved;
  }
}

@AdminResource(Line, { name: 'line', title: 'product' })
class LineAdmin extends AdminResourceBase<Line> {
  constructor(private readonly lines: LineService) {
    super();
  }
  override create(dto: object, ctx: AdminContext): Promise<Line> {
    return this.lines.add(dto as Partial<Line>, ctx.manager!);
  }
}

@AdminResource(Order, { title: 'number' })
class OrderAdmin extends AdminResourceBase<Order> {
  override form: FormConfig = { layout: [{ fields: ['number'] }, { inline: LineAdmin, display: 'table', order: 'position', min: 1, max: 4 }] };
}

/** A resource without inlines: its writes must not change. */
@Entity('inw_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) body: string;
}
@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}

const USERS: Record<string, AdminUser> = {
  root: { id: 'root', displayName: 'Root', isSuperuser: true },
  clerk: { id: 'clerk', displayName: 'Clerk', isSuperuser: false },
  fixed: { id: 'fixed', displayName: 'Fixed', isSuperuser: false },
  nolink: { id: 'nolink', displayName: 'No link', isSuperuser: false },
  csrf: { id: 'csrf', displayName: 'Careful', isSuperuser: true },
};

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = USERS[String(req.headers['x-user'] ?? '')];
    if (!user) return null;
    return user.id === 'csrf' ? { user, csrfToken: 'token-1' } : { user };
  }
  resolveRoles(user: AdminUser) {
    return user.isSuperuser ? [] : [String(user.id)];
  }
  async getUser(id: string) {
    return USERS[id] ?? null;
  }
}

@Module({ providers: [HeaderAuth, LineService, VariantAdmin, MediaAdmin, SpecAdmin, ProductAdmin, LineAdmin, OrderAdmin, NoteAdmin] })
class InlinesModule {}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ENTITIES = [Category, Attribute, Product, Variant, Media, Spec, Order, Line, Note];

let app: INestApplication;
let db: DataSource;
let dir: string;

const as = (user: string) => {
  const http = () => app.getHttpServer();
  return {
    get: (path: string) => request(http()).get(`/admin/api${path}`).set('X-User', user),
    post: (path: string, body: object) => request(http()).post(`/admin/api${path}`).set('X-User', user).send(body),
    patch: (path: string, body: object, version?: number) => {
      const req = request(http()).patch(`/admin/api${path}`).set('X-User', user);
      return (version === undefined ? req : req.set('If-Match', `"${version}"`)).send(body);
    },
  };
};
const root = as('root');
const cats: Record<string, number> = {};
const attrs: Record<string, number> = {};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nma-inlines-write-'));
  app = await createTestApp({
    imports: [InlinesModule],
    entities: [...ENTITIES, ...ADMIN_FILE_ENTITIES, ...ADMIN_AUDIT_ENTITIES],
    admin: {
      auth: AdminAuth.custom(HeaderAuth),
      audit: {},
      files: { storage: localStorage({ dir }) },
      roles: [
        {
          name: 'clerk',
          permissions: ['product.view', 'product.create', 'product.update', 'variant.view', 'variant.create', 'variant.update'],
          scopes: { variant: { view: 'active' } },
        },
        { name: 'fixed', permissions: ['product.view', 'product.update', 'variant.view', 'variant.create', 'variant.update', 'variant.delete'], fields: { variant: { sort: 'readonly' } } },
        { name: 'nolink', permissions: ['product.view', 'product.update', 'variant.view', 'variant.create', 'variant.update', 'variant.delete'], fields: { variant: { productId: 'hidden' } } },
      ],
    },
  });
  db = app.get<DataSource>(getDataSourceToken());
  const [chairs, tables] = await db.getRepository(Category).save([{ name: 'Chairs' }, { name: 'Tables' }]);
  Object.assign(cats, { chairs: chairs!.id, tables: tables!.id });
  const [seat, legs] = await db.getRepository(Attribute).save([
    { name: 'Seat', categoryId: chairs!.id },
    { name: 'Legs', categoryId: tables!.id },
  ]);
  Object.assign(attrs, { seat: seat!.id, legs: legs!.id });
});

afterAll(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

/** A product with variants, saved directly (sort = position in the list). */
async function seed(name: string, skus: string[], extra: Partial<Variant>[] = []): Promise<{ id: number; variants: Variant[] }> {
  const product = await db.getRepository(Product).save({ name });
  const variants = await db.getRepository(Variant).save(skus.map((sku, index) => ({ sku, price: 10, sort: index, productId: product.id, ...extra[index] })));
  return { id: product.id, variants };
}
const variantsOf = async (productId: number) => db.getRepository(Variant).find({ where: { productId }, order: { sort: 'ASC', id: 'ASC' } });
const entries = async (event: string) => (await db.getRepository(NmaAuditEntry).find({ where: { event } })).sort((a, b) => Number(a.id) - Number(b.id));
const upload = async (resource: string, field: string) => {
  const res = await request(app.getHttpServer()).post(`/admin/api/uploads?resource=${resource}&field=${field}`).set('X-User', 'root').set('Content-Type', 'image/png').send(PNG);
  expect(res.status).toBe(201);
  return res.body as { token: string };
};

describe(`creating a parent with its children (${TEST_DB})`, () => {
  test('one POST stores the parent and every child, links them, orders them 0..n-1, audits each child with meta.parent', async () => {
    const before = (await entries('variant.created')).length;
    const res = await root.post('/resources/product', {
      name: 'Armchair',
      _inlines: {
        variant: {
          create: [
            { _key: 'a', sku: 'AR-1', price: 100 },
            { _key: 'b', sku: 'AR-2', price: 200 },
            { _key: 'c', sku: 'AR-3', price: 300 },
          ],
          order: ['b', 'a', 'c'],
        },
      },
    });
    expect(res.status).toBe(201);
    const id = Number(res.body.id);
    const stored = await variantsOf(id);
    expect(stored.map((variant) => [variant.sku, variant.sort, variant.productId])).toEqual([
      ['AR-2', 0, id],
      ['AR-1', 1, id],
      ['AR-3', 2, id],
    ]);
    // The answer carries `_inlines` as GET does, after the save.
    expect(res.body._inlines.variant.rows.map((row: { sku: string }) => row.sku)).toEqual(['AR-2', 'AR-1', 'AR-3']);
    expect(res.body._inlines.variant).toMatchObject({ total: 3, truncated: false });
    expect(Object.keys(res.body._inlines).sort()).toEqual(['media', 'spec', 'variant']);
    const created = (await entries('variant.created')).slice(before);
    expect(created).toHaveLength(3);
    for (const entry of created) expect(entry.meta?.parent).toEqual({ resource: 'product', recordId: String(id) });
    expect((await entries('product.created')).at(-1)?.recordId).toBe(String(id));
    // The child's History shows its parent (the parent's History listing children is for later).
    const history = await root.get(`/resources/variant/${stored[0]!.id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.entries[0].meta).toEqual({ parent: { resource: 'product', recordId: String(id) } });
  });

  test('without `order`, creates keep the value they were given and the answer lists them', async () => {
    const res = await root.post('/resources/product', { name: 'Stool', _inlines: { variant: { create: [{ _key: 'x', sku: 'ST-1', price: 5, sort: 7 }] } } });
    expect(res.status).toBe(201);
    expect((await variantsOf(Number(res.body.id))).map((variant) => [variant.sku, variant.sort])).toEqual([['ST-1', 7]]);
  });

  test('`update` or `delete` on a parent that is being created is 404: it has no children yet', async () => {
    const { variants } = await seed('Donor', ['DN-1']);
    const count = await db.getRepository(Product).count();
    const update = await root.post('/resources/product', { name: 'Thief', _inlines: { variant: { update: [{ _id: String(variants[0]!.id), price: 1 }] } } });
    expect(update.status).toBe(404);
    const remove = await root.post('/resources/product', { name: 'Thief', _inlines: { variant: { delete: [String(variants[0]!.id)] } } });
    expect(remove.status).toBe(404);
    expect(await db.getRepository(Product).count()).toBe(count);
  });

  test('`min` applies to a new parent whatever the payload says: an order needs a line', async () => {
    const none = await root.post('/resources/order', { number: 'O-0' });
    expect(none.status).toBe(422);
    expect(none.body.fields).toEqual({ '_inlines.line': [expect.stringContaining('at least 1')] });
    const one = await root.post('/resources/order', { number: 'O-1', _inlines: { line: { create: [{ _key: 'n', product: 'Pen' }], order: ['n'] } } });
    expect(one.status).toBe(201);
    expect(one.body._inlines.line.rows.map((row: { product: string; position: number }) => [row.product, row.position])).toEqual([['Pen', 0]]);
  });
});

describe(`updating a parent's children (${TEST_DB})`, () => {
  test('change one, delete one, add one and reorder: stored exactly; another parent untouched', async () => {
    const { id, variants } = await seed('Bench', ['BE-1', 'BE-2', 'BE-3']);
    const other = await seed('Other', ['OT-1', 'OT-2']);
    const [one, two, three] = variants.map((variant) => String(variant.id));
    const res = await root.patch(`/resources/product/${id}`, {
      name: 'Bench XL',
      _inlines: { variant: { update: [{ _id: one, price: 55 }], delete: [two], create: [{ _key: 'new', sku: 'BE-4', price: 40 }], order: ['new', three, one] } },
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bench XL');
    const stored = await variantsOf(id);
    expect(stored.map((variant) => [variant.sku, variant.sort, variant.price])).toEqual([
      ['BE-4', 0, 40],
      ['BE-3', 1, 10],
      ['BE-1', 2, 55],
    ]);
    expect(res.body._inlines.variant.rows.map((row: { sku: string }) => row.sku)).toEqual(['BE-4', 'BE-3', 'BE-1']);
    expect((await variantsOf(other.id)).map((variant) => [variant.sku, variant.sort, variant.price])).toEqual([
      ['OT-1', 0, 10],
      ['OT-2', 1, 10],
    ]);
    const deleted = (await entries('variant.deleted')).at(-1)!;
    expect(deleted).toMatchObject({ recordId: two, meta: { deleted: true, parent: { resource: 'product', recordId: String(id) } } });
    const updated = (await entries('variant.updated')).filter((entry) => entry.recordId === one).at(-1)!;
    expect(updated.meta?.parent).toEqual({ resource: 'product', recordId: String(id) });
  });

  test('an inline-only save checks If-Match, does not bump the parent version and writes no parent entry (ruling 3)', async () => {
    const { id, variants } = await seed('Shelf', ['SH-1']);
    const version = (await db.getRepository(Product).findOneByOrFail({ id })).version;
    const productEntries = (await entries('product.updated')).length;
    const stale = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { update: [{ _id: String(variants[0]!.id), price: 99 }] } } }, version + 1);
    expect(stale.status).toBe(409);
    expect((await variantsOf(id))[0]!.price).toBe(10);
    const res = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { update: [{ _id: String(variants[0]!.id), price: 99 }] } } }, version);
    expect(res.status).toBe(200);
    expect((await variantsOf(id))[0]!.price).toBe(99);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).version).toBe(version);
    expect(res.body.version).toBe(version);
    expect((await entries('product.updated')).length).toBe(productEntries);
  });

  test('a child @VersionColumn: `_version` in an update entry, a stale one is 409 naming the row', async () => {
    const { id, variants } = await seed('Lamp', ['LA-1']);
    const row = String(variants[0]!.id);
    const version = variants[0]!.version;
    const stale = await root.patch(`/resources/product/${id}`, { name: 'Lamp 2', _inlines: { variant: { update: [{ _id: row, _version: version + 1, price: 1 }] } } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
    expect(Object.keys(stale.body.fields)).toEqual([`_inlines.variant.update.${row}`]);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Lamp');
    const fresh = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { update: [{ _id: row, _version: version, price: 1 }] } } });
    expect(fresh.status).toBe(200);
    const bad = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { update: [{ _id: row, _version: 'x', price: 1 }] } } });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.fields)).toEqual([`_inlines.variant.update.${row}._version`]);
  });
});

describe(`Review Focus 1: only this parent's children, inside the user's scopes (${TEST_DB})`, () => {
  test("another parent's child in update, delete or order is 404 for the whole save, nothing applied", async () => {
    const mine = await seed('Mine', ['MI-1']);
    const theirs = await seed('Theirs', ['TH-1']);
    const foreign = String(theirs.variants[0]!.id);
    const own = String(mine.variants[0]!.id);
    for (const changes of [{ update: [{ _id: foreign, price: 1 }] }, { delete: [foreign] }, { order: [own, foreign] }, { update: [{ _id: '999999', price: 1 }] }, { delete: ['not-a-number'] }]) {
      const res = await root.patch(`/resources/product/${mine.id}`, { name: 'Changed', _inlines: { variant: { ...changes, create: [{ _key: 'n', sku: 'MI-NEW', price: 1 }] } } });
      expect(res.status).toBe(404);
    }
    expect((await db.getRepository(Product).findOneByOrFail({ id: mine.id })).name).toBe('Mine');
    expect((await variantsOf(mine.id)).map((variant) => variant.sku)).toEqual(['MI-1']);
    expect((await variantsOf(theirs.id)).map((variant) => [variant.sku, variant.price])).toEqual([['TH-1', 10]]);
  });

  test('a child outside the user\'s view scope is 404 for the whole save', async () => {
    const { id, variants } = await seed('Scoped', ['SC-1', 'SC-2'], [{}, { active: false }]);
    const hidden = String(variants[1]!.id);
    const res = await as('clerk').patch(`/resources/product/${id}`, { name: 'Scoped 2', _inlines: { variant: { update: [{ _id: hidden, price: 1 }] } } });
    expect(res.status).toBe(404);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Scoped');
    // The order list is the rows the user sees: the hidden one is neither named nor moved.
    const visible = String(variants[0]!.id);
    const ok = await as('clerk').patch(`/resources/product/${id}`, { _inlines: { variant: { create: [{ _key: 'n', sku: 'SC-3', price: 1 }], order: ['n', visible] } } });
    expect(ok.status).toBe(200);
    const stored = await db.getRepository(Variant).find({ where: { productId: id }, order: { id: 'ASC' } });
    expect(stored.map((variant) => [variant.sku, variant.sort])).toEqual([
      ['SC-1', 1],
      ['SC-2', 1],
      ['SC-3', 0],
    ]);
    expect(ok.body._inlines.variant.rows.map((row: { sku: string }) => row.sku)).toEqual(['SC-3', 'SC-1']);
  });
});

describe(`Review Focus 2: one failing child entry fails the whole save (${TEST_DB})`, () => {
  test('the 3rd of 5 creates fails validation: 422 on its path, no parent change, no child stored, the upload stays temp', async () => {
    const { id } = await seed('Desk', ['DE-1']);
    const picture = await upload('media', 'image');
    const creates = [1, 2, 3, 4, 5].map((n) => ({ _key: `k${n}`, sku: `DE-N${n}`, price: n === 3 ? -1 : n }));
    const res = await root.patch(`/resources/product/${id}`, {
      name: 'Desk 2',
      _inlines: { variant: { create: creates }, media: { create: [{ _key: 'p', caption: 'Front', image: { token: picture.token } }] } },
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields)).toEqual(['_inlines.variant.create.2.price']);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Desk');
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['DE-1']);
    expect(await db.getRepository(NmaFile).findOneByOrFail({ id: picture.token })).toMatchObject({ status: 'temp', recordId: null });
  });

  test('a failure after some children were written rolls back everything, uploads included', async () => {
    const { id } = await seed('Chair', ['CH-1']);
    const picture = await upload('media', 'image');
    // Media comes before specs in the layout: the picture is attached, then the spec's attribute is refused.
    const res = await root.patch(`/resources/product/${id}`, {
      name: 'Chair 2',
      categoryId: cats.chairs,
      _inlines: {
        variant: { create: [{ _key: 'n', sku: 'CH-2', price: 1 }] },
        media: { create: [{ _key: 'p', caption: 'Front', image: { token: picture.token } }] },
        spec: { create: [{ _key: 's', value: '4', attributeId: attrs.legs }] },
      },
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields)).toEqual(['_inlines.spec.create.0.attributeId']);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Chair');
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['CH-1']);
    expect(await db.getRepository(Media).count({ where: { product: { id } } })).toBe(0);
    expect(await db.getRepository(NmaFile).findOneByOrFail({ id: picture.token })).toMatchObject({ status: 'temp', recordId: null });
  });

  test("a child host override runs inside the parent's transaction: its throw rolls back the parent and the earlier lines", async () => {
    const order = await root.post('/resources/order', { number: 'O-10', _inlines: { line: { create: [{ _key: 'a', product: 'Pen' }], order: ['a'] } } });
    expect(order.status).toBe(201);
    const id = Number(order.body.id);
    const service = app.get(LineService);
    service.managers.length = 0;
    const res = await root.patch(`/resources/order/${id}`, {
      number: 'O-11',
      _inlines: { line: { create: [{ _key: 'b', product: 'Ink' }, { _key: 'c', product: 'BOOM' }] } },
    });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ '_inlines.line.create.1.product': ['cannot be sold'] });
    expect(service.managers).toHaveLength(2);
    expect(new Set(service.managers).size).toBe(1); // one transaction for both
    expect((await db.getRepository(Order).findOneByOrFail({ id })).number).toBe('O-10');
    expect((await db.getRepository(Line).find({ where: { orderId: id } })).map((line) => line.product)).toEqual(['Pen']);
  });
});

describe(`Review Focus 3: the child's own permissions (${TEST_DB})`, () => {
  test('product.update without variant.delete: a crafted delete is 403 and nothing is applied', async () => {
    const { id, variants } = await seed('Sofa', ['SO-1', 'SO-2']);
    const res = await as('clerk').patch(`/resources/product/${id}`, { name: 'Sofa 2', _inlines: { variant: { delete: [String(variants[1]!.id)], update: [{ _id: String(variants[0]!.id), price: 3 }] } } });
    expect(res.status).toBe(403);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Sofa');
    expect((await variantsOf(id)).map((variant) => [variant.sku, variant.price])).toEqual([
      ['SO-1', 10],
      ['SO-2', 10],
    ]);
    // The schema says so too: the UI offers no remove.
    expect((await as('clerk').get('/meta/resources/product')).body.inlines.variant.permissions.delete).toBe(false);
  });

  test('@AdminCan on a child row, field rules and read-only rows apply as on the child endpoint', async () => {
    const { id, variants } = await seed('Bed', ['BD-1', 'BD-2'], [{ locked: true }, {}]);
    const locked = String(variants[0]!.id);
    const remove = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { delete: [locked] } } });
    expect(remove.status).toBe(403);
    const readonly = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { update: [{ _id: locked, sku: 'BD-X' }] } } });
    expect(readonly.status).toBe(422);
    expect(Object.keys(readonly.body.fields)).toEqual([`_inlines.variant.update.${locked}.sku`]);
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['BD-1', 'BD-2']);
  });

  test('ruling 4: `order` needs the right to update the order field; without it the whole save is 403', async () => {
    const { id, variants } = await seed('Rack', ['RA-1', 'RA-2']);
    const [a, b] = variants.map((variant) => String(variant.id));
    const res = await as('fixed').patch(`/resources/product/${id}`, { name: 'Rack 2', _inlines: { variant: { order: [b, a] } } });
    expect(res.status).toBe(403);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Rack');
    const allowed = await as('clerk').patch(`/resources/product/${id}`, { _inlines: { variant: { order: [b, a] } } });
    expect(allowed.status).toBe(200);
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['RA-2', 'RA-1']);
  });

  test('a user who cannot see the link field cannot use the inline: refused like a child they cannot view, nothing applied', async () => {
    const { id, variants } = await seed('Stool', ['ST-1']);
    const res = await as('nolink').patch(`/resources/product/${id}`, { name: 'Stool 2', _inlines: { variant: { create: [{ _key: 'n', sku: 'ST-2', price: 1 }], delete: [String(variants[0]!.id)] } } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields)).toEqual(['_inlines.variant']);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Stool');
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['ST-1']);
    // A save without `_inlines` works, and its answer carries no inline the user may not see.
    const plain = await as('nolink').patch(`/resources/product/${id}`, { name: 'Stool 3' });
    expect(plain.status).toBe(200);
    expect(plain.body._inlines ?? {}).not.toHaveProperty('variant');
  });

  test('a hidden or read-only child field in an entry is 403 FORBIDDEN_FIELDS on its path', async () => {
    const { id } = await seed('Crate', ['CR-1']);
    const res = await as('fixed').patch(`/resources/product/${id}`, { _inlines: { variant: { create: [{ _key: 'n', sku: 'CR-2', price: 1, sort: 4 }] } } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_FIELDS');
    expect(Object.keys(res.body.fields)).toEqual(['_inlines.variant.create.0.sort']);
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['CR-1']);
  });
});

describe(`the link, the order list, min and max (${TEST_DB})`, () => {
  test('a link sent by the client is 422; an update cannot move a child to another parent', async () => {
    const { id, variants } = await seed('Link', ['LI-1']);
    const other = await seed('Elsewhere', []);
    const create = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { create: [{ _key: 'n', sku: 'LI-2', price: 1, productId: id }] } } });
    expect(create.status).toBe(422);
    expect(Object.keys(create.body.fields)).toEqual(['_inlines.variant.create.0.productId']);
    const row = String(variants[0]!.id);
    const update = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { update: [{ _id: row, productId: other.id }] } } });
    expect(update.status).toBe(422);
    expect(Object.keys(update.body.fields)).toEqual([`_inlines.variant.update.${row}.productId`]);
    // An implicit link (`product`) is refused the same way.
    const media = await root.patch(`/resources/product/${id}`, { _inlines: { media: { create: [{ _key: 'm', caption: 'x', product: other.id }] } } });
    expect(media.status).toBe(422);
    expect(Object.keys(media.body.fields)).toEqual(['_inlines.media.create.0.product']);
    expect((await variantsOf(other.id))).toEqual([]);
  });

  test('`order` must list exactly the rows that will exist: a missing row or a duplicate is 422; a name that is no row of this parent is 404', async () => {
    const { id, variants } = await seed('Order list', ['OL-1', 'OL-2']);
    const [a, b] = variants.map((variant) => String(variant.id));
    for (const order of [[a], [a, a, b]]) {
      const res = await root.patch(`/resources/product/${id}`, { name: 'Moved', _inlines: { variant: { order } } });
      expect(res.status).toBe(422);
      expect(Object.keys(res.body.fields)).toEqual(['_inlines.variant']);
    }
    // `_id`s and new rows' `_key`s share the list: an unknown name may be either, so it is answered like a foreign id.
    for (const order of [[a, b, 'ghost'], [a, b, 'n']]) {
      const res = await root.patch(`/resources/product/${id}`, { name: 'Moved', _inlines: { variant: { order } } });
      expect(res.status).toBe(404);
    }
    // A deleted row is no longer in the list.
    const deleted = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { delete: [b], order: [a, b] } } });
    expect(deleted.status).toBe(422);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Order list');
    expect((await variantsOf(id)).map((variant) => [variant.sku, variant.sort])).toEqual([
      ['OL-1', 0],
      ['OL-2', 1],
    ]);
    // An inline without `order` takes none.
    const spec = await root.patch(`/resources/product/${id}`, { _inlines: { spec: { order: [] } } });
    expect(spec.status).toBe(422);
    expect(Object.keys(spec.body.fields)).toEqual(['_inlines.spec.order']);
    // With `order`, the entries do not set the order field themselves.
    const both = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { update: [{ _id: a, sort: 5 }], order: [b, a] } } });
    expect(both.status).toBe(422);
    expect(Object.keys(both.body.fields)).toEqual([`_inlines.variant.update.${a}.sort`]);
  });

  test('`min` and `max` on the resulting count are 422 on `_inlines.<child>`', async () => {
    const order = await root.post('/resources/order', { number: 'O-20', _inlines: { line: { create: [{ _key: 'a', product: 'Pen' }, { _key: 'b', product: 'Ink' }] } } });
    expect(order.status).toBe(201);
    const [pen, ink] = order.body._inlines.line.rows.map((row: { _id: string }) => row._id);
    const empty = await root.patch(`/resources/order/${order.body.id}`, { _inlines: { line: { delete: [pen, ink] } } });
    expect(empty.status).toBe(422);
    expect(empty.body.fields).toEqual({ '_inlines.line': [expect.stringContaining('at least 1')] });
    const full = await root.patch(`/resources/order/${order.body.id}`, { _inlines: { line: { create: [1, 2, 3].map((n) => ({ _key: `n${n}`, product: `P${n}` })) } } });
    expect(full.status).toBe(422);
    expect(full.body.fields).toEqual({ '_inlines.line': [expect.stringContaining('at most 4')] });
    // A swap that keeps the count inside the bounds is fine.
    const swap = await root.patch(`/resources/order/${order.body.id}`, { _inlines: { line: { delete: [pen], create: [{ _key: 'c', product: 'Cup' }] } } });
    expect(swap.status).toBe(200);
    expect(swap.body._inlines.line.rows.map((row: { product: string }) => row.product).sort()).toEqual(['Cup', 'Ink']);
  });
});

describe(`the shape of _inlines (${TEST_DB})`, () => {
  test('malformed payloads are 422 before any write', async () => {
    const { id, variants } = await seed('Shape', ['SP-1']);
    const row = String(variants[0]!.id);
    const cases: Array<[unknown, string]> = [
      [[], '_inlines'],
      [{ nope: {} }, '_inlines.nope'],
      [{ variant: [] }, '_inlines.variant'],
      [{ variant: { create: {} } }, '_inlines.variant.create'],
      [{ variant: { create: [1] } }, '_inlines.variant.create.0'],
      [{ variant: { create: [{ sku: 'X', price: 1 }] } }, '_inlines.variant.create.0._key'],
      [{ variant: { create: [{ _key: 'a', sku: 'X', price: 1 }, { _key: 'a', sku: 'Y', price: 1 }] } }, '_inlines.variant.create.1._key'],
      [{ variant: { create: [{ _key: 'a', sku: 'X', price: 1, _inlines: {} }] } }, '_inlines.variant.create.0._inlines'],
      [{ variant: { update: [{ price: 1 }] } }, '_inlines.variant.update.0._id'],
      [{ variant: { update: [{ _id: row, price: 1 }, { _id: row, price: 2 }] } }, '_inlines.variant'],
      [{ variant: { update: [{ _id: row, price: 1 }], delete: [row] } }, '_inlines.variant'],
      [{ variant: { delete: [1] } }, '_inlines.variant.delete'],
      [{ variant: { extra: [] } }, '_inlines.variant.extra'],
    ];
    for (const [inlines, path] of cases) {
      const res = await root.patch(`/resources/product/${id}`, { name: 'Broken', _inlines: inlines });
      expect({ status: res.status, fields: Object.keys(res.body.fields ?? {}) }).toEqual({ status: 422, fields: [path] });
    }
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Shape');
  });

  test('over 500 entries in one inline is 422 before any write', async () => {
    const { id } = await seed('Many', []);
    const creates = Array.from({ length: 501 }, (_, n) => ({ _key: `k${n}`, sku: `M-${n}`, price: 1 }));
    const res = await root.patch(`/resources/product/${id}`, { name: 'Many 2', _inlines: { variant: { create: creates } } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields)).toEqual(['_inlines.variant']);
    expect((await db.getRepository(Product).findOneByOrFail({ id })).name).toBe('Many');
  });

  test('a resource without inlines refuses `_inlines` as before: an unknown field', async () => {
    const res = await root.post('/resources/note', { body: 'x', _inlines: {} });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ _inlines: ['is not a writable field'] });
  });
});

describe(`files in a child (${TEST_DB})`, () => {
  test('a token in a create entry is attached to the new CHILD record', async () => {
    const { id } = await seed('Gallery', []);
    const picture = await upload('media', 'image');
    const res = await root.patch(`/resources/product/${id}`, { _inlines: { media: { create: [{ _key: 'p', caption: 'Front', image: { token: picture.token } }], order: ['p'] } } });
    expect(res.status).toBe(200);
    const [media] = res.body._inlines.media.rows;
    const file = await db.getRepository(NmaFile).findOneByOrFail({ id: picture.token });
    expect(file).toMatchObject({ status: 'attached', resource: 'media', field: 'image', recordId: media._id });
    expect(media.image).toBe(file.key);
    expect(media._files.image).toMatchObject({ key: file.key, contentType: 'image/png' });
  });
});

describe(`Review Focus 4: dependent options see the parent's values (${TEST_DB})`, () => {
  test('the picker: `?parent=` and `values._parent` narrow the options by the unsaved parent form', async () => {
    SpecAdmin.seen.length = 0;
    const values = encodeURIComponent(JSON.stringify({ value: '4', _parent: { name: 'New', categoryId: cats.chairs } }));
    const res = await root.get(`/resources/spec/fields/attributeId/options?values=${values}&parent=product`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual(['Seat']);
    expect(SpecAdmin.seen.at(-1)).toEqual({ value: '4', _parent: { _resource: 'product', name: 'New', categoryId: cats.chairs } });
    const all = await root.get('/resources/spec/fields/attributeId/options');
    expect(all.body.items.map((item: { title: string }) => item.title).sort()).toEqual(['Legs', 'Seat']);
  });

  test('the picker refuses a `parent` that does not inline the child, and `_parent` without `parent`', async () => {
    const values = encodeURIComponent(JSON.stringify({ _parent: { categoryId: cats.chairs } }));
    expect((await root.get(`/resources/spec/fields/attributeId/options?values=${values}`)).status).toBe(422);
    expect((await root.get(`/resources/spec/fields/attributeId/options?values=${values}&parent=order`)).status).toBe(422);
    expect((await root.get(`/resources/spec/fields/attributeId/options?values=${values}&parent=nothing`)).status).toBe(422);
  });

  test("on save: the parent's values (body over stored) decide, so an excluded option is 422 and an allowed one is stored", async () => {
    const created = await root.post('/resources/product', { name: 'Throne', categoryId: cats.chairs, _inlines: { spec: { create: [{ _key: 's', value: 'soft', attributeId: attrs.legs }] } } });
    expect(created.status).toBe(422);
    expect(Object.keys(created.body.fields)).toEqual(['_inlines.spec.create.0.attributeId']);
    SpecAdmin.seen.length = 0;
    const ok = await root.post('/resources/product', { name: 'Throne', categoryId: cats.chairs, _inlines: { spec: { create: [{ _key: 's', value: 'soft', attributeId: attrs.seat }] } } });
    expect(ok.status).toBe(201);
    expect(SpecAdmin.seen.at(-1)?._parent).toMatchObject({ _resource: 'product', name: 'Throne', categoryId: cats.chairs });
    // The category changes in the same request: the spec is checked against the new one.
    const id = ok.body.id;
    const moved = await root.patch(`/resources/product/${id}`, { categoryId: cats.tables, _inlines: { spec: { create: [{ _key: 't', value: '4', attributeId: attrs.legs }] } } });
    expect(moved.status).toBe(200);
    expect(moved.body._inlines.spec.rows.map((row: { value: string }) => row.value).sort()).toEqual(['4', 'soft']);
    // Stored values apply when the body does not change them.
    const stored = await root.patch(`/resources/product/${id}`, { _inlines: { spec: { create: [{ _key: 'u', value: 'x', attributeId: attrs.seat }] } } });
    expect(stored.status).toBe(422);
  });
});

describe(`view-as and CSRF (${TEST_DB})`, () => {
  test('viewing as another user, a save with inlines is 403', async () => {
    const { id } = await seed('Viewed', ['VI-1']);
    const res = await root.patch(`/resources/product/${id}`, { _inlines: { variant: { create: [{ _key: 'n', sku: 'VI-2', price: 1 }] } } }).set('X-View-As', 'clerk');
    expect(res.status).toBe(403);
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['VI-1']);
  });

  test('CSRF is checked as for any write', async () => {
    const { id } = await seed('Guarded', ['GU-1']);
    const body = { _inlines: { variant: { create: [{ _key: 'n', sku: 'GU-2', price: 1 }] } } };
    const without = await as('csrf').patch(`/resources/product/${id}`, body);
    expect(without.status).toBe(403);
    expect((await variantsOf(id)).map((variant) => variant.sku)).toEqual(['GU-1']);
    const withToken = await as('csrf').patch(`/resources/product/${id}`, body).set('X-CSRF-Token', 'token-1');
    expect(withToken.status).toBe(200);
  });
});

describe('inlines need transactions', () => {
  test('`transactions: false` with an inline declared fails at boot', async () => {
    @Module({ providers: [LineService, LineAdmin, OrderAdmin] })
    class OrdersOnly {}
    await expect(createTestApp({ imports: [OrdersOnly], entities: [Order, Line], admin: { transactions: false } })).rejects.toThrow(/transactions/);
  });
});
