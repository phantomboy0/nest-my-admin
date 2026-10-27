import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication, type Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChildEntity, Column, DeleteDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, TableInheritance, type DataSource } from 'typeorm';
import {
  ADMIN_FILE_ENTITIES,
  AdminAuth,
  AdminCan,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  localStorage,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUser,
  type FieldsConfig,
  type FormConfig,
  type LayoutInlineConfig,
  type ListParams,
} from '../src/index.js';
import { ResourceRegistry } from '../src/registry/resource-registry.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

// ── Products: a single-table family (Product, Shirt) with Variants (table) and media (cards, in a tab) ──

@Entity('inl_product')
@TableInheritance({ column: { type: 'varchar', length: 20, name: 'kind' } })
class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
}

@ChildEntity('shirt')
class Shirt extends Product {
  @Column({ type: 'varchar', length: 10, nullable: true }) size: string | null;
}

@Entity('inl_variant')
class Variant {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 30 }) sku: string;
  @Column({ type: 'int', default: 0 }) price: number;
  @Column({ type: 'int', default: 0 }) cost: number;
  @Column({ type: 'int', default: 0 }) sort: number;
  @Column({ default: true }) active: boolean;
  @Column({ default: false }) locked: boolean;
  /** Points at the root of the family: the variants of a Shirt are rows of this table too. */
  @Column({ type: 'int' }) productId: number;
  @ManyToOne(() => Product, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Product;
}

@Entity('inl_media')
class ProductMedia {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60, default: '' }) caption: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) image: string | null;
  @Column({ type: 'int', default: 0 }) sort: number;
  /** No explicit column: the link field is `product`. */
  @ManyToOne(() => Product, { nullable: false, onDelete: 'CASCADE' }) product: Product;
}

@AdminResource(Variant, { title: 'sku' })
class VariantAdmin extends AdminResourceBase<Variant> {
  override fields: FieldsConfig<Variant> = { sku: { readonlyIf: (variant: Variant) => variant.locked } };
  @AdminScope('active') activeOnly() {
    return { active: true };
  }
  @AdminCan('delete') unlocked(variant: Variant) {
    return !variant.locked;
  }
}

@AdminResource(ProductMedia, { title: 'caption' })
class ProductMediaAdmin extends AdminResourceBase<ProductMedia> {
  override fields: FieldsConfig<ProductMedia> = { image: { widget: 'image' } };
}

@AdminResource(Product, { title: 'name' })
class ProductAdmin extends AdminResourceBase<Product> {
  override form: FormConfig = {
    layout: [
      { section: { en: 'Details', fa: 'مشخصات' }, fields: ['name'] },
      { section: { en: 'Variants', fa: 'تنوع‌ها' }, inline: VariantAdmin, display: 'table', order: 'sort', fields: ['sku', 'price', 'cost', 'active'], min: 1, max: 3 },
      { tab: { en: 'Media', fa: 'رسانه' }, sections: [{ inline: ProductMediaAdmin, order: 'sort' }] },
    ],
  };
}

@AdminResource(Shirt, { title: 'name' })
class ShirtAdmin extends AdminResourceBase<Shirt> {
  override form: FormConfig = { layout: [{ fields: ['name', 'size'] }, { inline: VariantAdmin, display: 'table', order: 'sort' }] };
}

// ── Orders: OrderLine has two relations to Order, so the inline names its link ──

@Entity('inl_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) number: string;
}

@Entity('inl_order_line')
class OrderLine {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) orderId: number;
  @ManyToOne(() => Order, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'orderId' }) order: Order;
  @Column({ type: 'int', nullable: true }) returnOfId: number | null;
  @ManyToOne(() => Order, { nullable: true }) @JoinColumn({ name: 'returnOfId' }) returnOf: Order | null;
  @Column({ length: 40 }) product: string;
  @Column({ type: 'int', default: 1 }) qty: number;
  @Column({ type: 'int', default: 0 }) position: number;
}

/** The link is `restricted`: only roles granted `order-line.field.orderId.view` see it, and so the inline. */
@AdminResource(OrderLine, { title: 'product' })
class OrderLineAdmin extends AdminResourceBase<OrderLine> {
  override fields: FieldsConfig<OrderLine> = { orderId: { restricted: true } };
}

/** Soft-deletable, linked through a lazy relation without an explicit column (link field `order`). */
@Entity('inl_order_note')
class OrderNote {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) text: string;
  @ManyToOne(() => Order, { lazy: true, onDelete: 'CASCADE' }) order: Promise<Order>;
  @DeleteDateColumn() deletedAt: Date | null;
}
@AdminResource(OrderNote, { title: 'text' })
class OrderNoteAdmin extends AdminResourceBase<OrderNote> {}

@AdminResource(Order, { title: 'number' })
class OrderAdmin extends AdminResourceBase<Order> {
  override form: FormConfig = { layout: [{ fields: ['number'] }, { section: 'Lines', inline: OrderLineAdmin, link: 'orderId', order: 'position' }, { inline: OrderNoteAdmin }] };
}

/** Reads the table itself, ignoring scopes and filters but for the link: the inline still keeps other rows out. */
@AdminResource(OrderLine, { name: 'raw-line', title: 'product' })
class RawLineAdmin extends AdminResourceBase<OrderLine> {
  override async findMany(params: ListParams) {
    const orderId = params.filters.find((filter) => filter.field === 'orderId')?.value as number;
    const items = await this.repository.find({ where: { orderId }, order: { position: 'ASC', id: 'ASC' }, take: params.pageSize + 1 });
    return { items: items.slice(0, params.pageSize), total: null, hasMore: items.length > params.pageSize };
  }
  @AdminScope('small') small() {
    return { qty: 1 };
  }
}

@AdminResource(Order, { name: 'raw-order', title: 'number' })
class RawOrderAdmin extends AdminResourceBase<Order> {
  override form: FormConfig = { layout: [{ fields: ['number'] }, { inline: RawLineAdmin, link: 'orderId', order: 'position' }] };
}

/** Ignores every filter, the link included: the inline must still show only this order's lines. */
@AdminResource(OrderLine, { name: 'loose-line', title: 'product' })
class LooseLineAdmin extends AdminResourceBase<OrderLine> {
  override async findMany() {
    const items = await this.repository.find({ order: { position: 'ASC', id: 'ASC' } });
    return { items, total: items.length };
  }
}

@AdminResource(Order, { name: 'loose-order', title: 'number' })
class LooseOrderAdmin extends AdminResourceBase<Order> {
  override form: FormConfig = { layout: [{ fields: ['number'] }, { inline: LooseLineAdmin, link: 'orderId', order: 'position', max: 2 }] };
}

/** A resource without inlines: its answers must not change (0.2.1 shapes). */
@Entity('inl_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) body: string;
}
@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}

const USERS: Record<string, AdminUser> = {
  root: { id: 'root', displayName: 'Root', isSuperuser: true },
  clerk: { id: 'c', displayName: 'Clerk', isSuperuser: false },
  blind: { id: 'b', displayName: 'Blind', isSuperuser: false },
  nolink: { id: 'nl', displayName: 'No link', isSuperuser: false },
  lines: { id: 'l', displayName: 'Lines', isSuperuser: false },
  linesplus: { id: 'lp', displayName: 'Lines plus', isSuperuser: false },
  raw: { id: 'r', displayName: 'Raw', isSuperuser: false },
};
const ROLES_OF: Record<string, string[]> = { clerk: ['clerk'], raw: ['raw'], blind: ['blind'], nolink: ['nolink'], lines: ['lines'], linesplus: ['linesplus'] };

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = USERS[String(req.headers['x-user'] ?? '')];
    return user ? { user } : null;
  }
  resolveRoles(user: AdminUser) {
    return ROLES_OF[Object.entries(USERS).find(([, candidate]) => candidate === user)?.[0] ?? ''] ?? [];
  }
}

@Module({ providers: [HeaderAuth, VariantAdmin, ProductMediaAdmin, ProductAdmin, ShirtAdmin, OrderLineAdmin, OrderNoteAdmin, OrderAdmin, RawLineAdmin, RawOrderAdmin, LooseLineAdmin, LooseOrderAdmin, NoteAdmin] })
class InlinesModule {}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ENTITIES = [Product, Shirt, Variant, ProductMedia, Order, OrderLine, OrderNote, Note];

let app: INestApplication;
let dir: string;
let selects = 0;
const logger = {
  logQuery: (query: string) => {
    if (/^\s*SELECT/i.test(query)) selects++;
  },
  logQueryError: () => undefined,
  logQuerySlow: () => undefined,
  logSchemaBuild: () => undefined,
  logMigration: () => undefined,
  log: () => undefined,
};
const as = (user: string) => ({
  get: (path: string, locale = 'en') => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set('Accept-Language', locale),
  post: (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', user).send(body),
});
const root = as('root');
const ids: Record<string, number> = {};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nma-inlines-'));
  app = await createTestApp({
    imports: [InlinesModule],
    entities: [...ENTITIES, ...ADMIN_FILE_ENTITIES],
    dataSource: { logger, logging: ['query'] },
    admin: {
      auth: AdminAuth.custom(HeaderAuth),
      locales: ['en', 'fa'],
      files: { storage: localStorage({ dir }) },
      roles: [
        { name: 'clerk', permissions: ['product.view', 'shirt.view', 'variant.view', 'variant.update', 'order.view'], fields: { variant: { cost: 'hidden' } }, scopes: { variant: { view: 'active' } } },
        { name: 'raw', permissions: ['raw-order.view', 'raw-line.view'], scopes: { 'raw-line': { view: 'small' } } },
        { name: 'blind', permissions: ['product.view', 'variant.view'], fields: { variant: { sort: 'hidden' } } },
        { name: 'nolink', permissions: ['product.view', 'variant.view'], fields: { variant: { productId: 'hidden' } } },
        { name: 'lines', permissions: ['order.view', 'order-line.view'] },
        { name: 'linesplus', permissions: ['order.view', 'order-line.view', 'order-line.field.orderId.view'] },
      ],
    },
  });
  const db = app.get<DataSource>(getDataSourceToken());
  const [chair, table, empty, desk] = await db.getRepository(Product).save([{ name: 'Chair' }, { name: 'Table' }, { name: 'Empty' }, { name: 'Desk' }]);
  const shirt = await db.getRepository(Shirt).save({ name: 'Tee', size: 'M' });
  Object.assign(ids, { chair: chair!.id, table: table!.id, empty: empty!.id, desk: desk!.id, shirt: shirt.id });
  // Saved out of order: rows come back by `sort`, then by id.
  await db.getRepository(Variant).save([
    { sku: 'C-3', sort: 2, productId: chair!.id, cost: 30 },
    { sku: 'C-1', sort: 0, productId: chair!.id, cost: 10, locked: true },
    { sku: 'C-2b', sort: 1, productId: chair!.id, cost: 22, active: false },
    { sku: 'C-2a', sort: 1, productId: chair!.id, cost: 21 },
    { sku: 'C-4', sort: 3, productId: chair!.id, cost: 40 },
    { sku: 'T-1', sort: 0, productId: table!.id, cost: 5 },
    { sku: 'S-1', sort: 0, productId: shirt.id, cost: 7 },
    { sku: 'D-1', sort: 0, productId: desk!.id },
    { sku: 'D-2', sort: 1, productId: desk!.id },
    { sku: 'D-3', sort: 2, productId: desk!.id, locked: true },
  ]);
  const order = await db.getRepository(Order).save({ number: 'O-1' });
  const other = await db.getRepository(Order).save({ number: 'O-2' });
  Object.assign(ids, { order: order.id, other: other.id });
  await db.getRepository(OrderLine).save([
    { orderId: order.id, product: 'Pen', qty: 1, position: 1 },
    { orderId: order.id, product: 'Ink', qty: 3, position: 0 },
    { orderId: order.id, product: 'Pad', qty: 1, position: 2, returnOfId: other.id },
    { orderId: other.id, product: 'Cup', qty: 1, position: 0 },
  ]);
  const notes = db.getRepository(OrderNote);
  const note = (text: string, of: Order) => Object.assign(new OrderNote(), { text, order: Promise.resolve(of) });
  const [, gone] = await notes.save([note('Gift wrap', order), note('Rush', order), note('Fragile', other)]);
  await notes.softDelete(gone!.id);
  // Pictures through the files lifecycle, so the media rows carry `_files`.
  const picture = async (caption: string, product: number, sort = 0) => {
    const upload = await request(app.getHttpServer()).post('/admin/api/uploads?resource=product-media&field=image').set('X-User', 'root').set('Content-Type', 'image/png').send(PNG);
    expect(upload.status).toBe(201);
    const media = await root.post('/resources/product-media', { caption, product, sort, image: { token: upload.body.token } });
    expect(media.status).toBe(201);
  };
  await picture('Front', chair!.id);
  await picture('Side', table!.id);
  await picture('Top', desk!.id, 0);
  await picture('Back', desk!.id, 1);
});

afterAll(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

const skus = (rows: Array<{ sku: string }>) => rows.map((row) => row.sku);

describe(`inline declarations at boot (${TEST_DB})`, () => {
  test('the registry resolves each inline: child, link field, order, min, max, display, fields', () => {
    const registry = app.get(ResourceRegistry);
    const [variants, media] = registry.get('product').inlines;
    expect(variants).toMatchObject({ name: 'variant', link: 'productId', order: 'sort', min: 1, max: 3, display: 'table', fields: ['sku', 'price', 'cost', 'active'] });
    expect(variants!.child).toBe(registry.get('variant'));
    // Defaults: cards, max 100, the child's update fields without the link.
    expect(media).toMatchObject({ name: 'product-media', link: 'product', order: 'sort', max: 100, display: 'cards', fields: ['caption', 'image', 'sort'] });
    expect(media!.min).toBeUndefined();
    const [lines] = registry.get('order').inlines;
    expect(lines).toMatchObject({ name: 'order-line', link: 'orderId', order: 'position' });
    expect(lines!.fields).toEqual(['returnOfId', 'product', 'qty', 'position']);
    // A child of a single-table family may list children that point at its root.
    expect(registry.get('shirt').inlines[0]).toMatchObject({ name: 'variant', link: 'productId' });
    expect(registry.get('note').inlines).toEqual([]);
  });
});

describe(`the parent's schema (${TEST_DB})`, () => {
  test('inline nodes sit in the layout, with the child schema in `inlines`', async () => {
    const res = await root.get('/meta/resources/product');
    expect(res.status).toBe(200);
    expect(res.body.form.layout).toEqual([
      { title: 'Details', fields: ['name'], columns: 1 },
      { inline: 'variant', label: 'Variants', display: 'table', fields: ['sku', 'price', 'cost', 'active'], order: 'sort', min: 1, max: 3, link: 'productId' },
      { tab: 'Media', sections: [{ inline: 'product-media', label: 'Product media', display: 'cards', fields: ['caption', 'image', 'sort'], order: 'sort', max: 100, link: 'product' }] },
    ]);
    expect(Object.keys(res.body.inlines).sort()).toEqual(['product-media', 'variant']);
    const variant = res.body.inlines.variant;
    expect(variant.name).toBe('variant');
    expect(variant.fields.map((field: { name: string }) => field.name)).toContain('cost');
    expect(variant.permissions).toEqual({ create: true, update: true, delete: true, purge: true });
    expect(res.body.inlines['product-media'].fields.find((field: { name: string }) => field.name === 'image').widget).toBe('image');
  });

  test('labels are localized like any schema', async () => {
    const res = await root.get('/meta/resources/product', 'fa');
    expect(res.body.form.layout[1].label).toBe('تنوع‌ها');
    expect(res.body.form.layout[2].tab).toBe('رسانه');
  });

  test("the child schema is cut for the user, and an inline whose child they cannot view is gone (tab and all)", async () => {
    const res = await as('clerk').get('/meta/resources/product');
    expect(res.status).toBe(200);
    expect(res.body.form.layout).toEqual([
      { title: 'Details', fields: ['name'], columns: 1 },
      { inline: 'variant', label: 'Variants', display: 'table', fields: ['sku', 'price', 'active'], order: 'sort', min: 1, max: 3, link: 'productId' },
    ]);
    expect(Object.keys(res.body.inlines)).toEqual(['variant']);
    const variant = res.body.inlines.variant;
    expect(variant.fields.map((field: { name: string }) => field.name)).not.toContain('cost');
    expect(variant.permissions).toEqual({ create: false, update: true, delete: false, purge: false });
    expect(variant.form.create).toEqual([]);
  });

  test('the registry keeps the resolved layout for host code', () => {
    const layout = app.get(ResourceRegistry).get('order').schema.form.layout;
    expect(layout?.[1]).toEqual({ inline: 'order-line', label: 'Lines', display: 'cards', fields: ['returnOfId', 'product', 'qty', 'position'], order: 'position', max: 100, link: 'orderId' });
  });
});

describe(`_inlines on GET (${TEST_DB})`, () => {
  test("only this parent's children, by `order` then id, as full child records", async () => {
    const res = await root.get(`/resources/order/${ids.order}`);
    expect(res.status).toBe(200);
    const lines = res.body._inlines['order-line'];
    expect(lines.rows.map((row: { product: string }) => row.product)).toEqual(['Ink', 'Pen', 'Pad']);
    expect(lines).toMatchObject({ total: 3, truncated: false });
    const line = lines.rows[2];
    const alone = (await root.get(`/resources/order-line/${line._id}`)).body;
    expect(line).toEqual(alone); // the same record the child's own endpoint answers
    expect(line.returnOfId).toEqual({ id: ids.other, title: 'O-2' });
  });

  test('`_perm`, `_readonly` and `_files` come with each row', async () => {
    const res = await root.get(`/resources/product/${ids.chair}`);
    const variants = res.body._inlines.variant;
    expect(skus(variants.rows)).toEqual(['C-1', 'C-2b', 'C-2a']); // C-2b and C-2a share a `sort`: by id
    expect(variants.rows[0]).toMatchObject({ _id: expect.any(String), _title: 'C-1', cost: 10, _perm: { update: true, delete: false }, _readonly: ['sku'] });
    expect(variants.rows[1]._perm).toEqual({ update: true, delete: true });
    expect(variants.rows[1]._readonly).toBeUndefined();
    const media = res.body._inlines['product-media'];
    expect(media.rows).toHaveLength(1);
    expect(media.rows[0]).toMatchObject({ caption: 'Front', _files: { image: { contentType: 'image/png', size: PNG.length } } });
  });

  test('past `max`: `max` rows, the full `total`, and `truncated`', async () => {
    const variants = (await root.get(`/resources/product/${ids.chair}`)).body._inlines.variant;
    expect(variants).toMatchObject({ total: 5, truncated: true });
    expect(variants.rows).toHaveLength(3);
    const table = (await root.get(`/resources/product/${ids.table}`)).body._inlines;
    expect(table.variant).toMatchObject({ total: 1, truncated: false });
    expect(skus(table.variant.rows)).toEqual(['T-1']);
    expect(table['product-media'].rows.map((row: { caption: string }) => row.caption)).toEqual(['Side']);
    expect((await root.get(`/resources/product/${ids.empty}`)).body._inlines).toEqual({ variant: { rows: [], total: 0, truncated: false }, 'product-media': { rows: [], total: 0, truncated: false } });
  });

  test("rows are field-cut and scope-filtered by the child's rules; `total` counts only what the user may see", async () => {
    const res = await as('clerk').get(`/resources/product/${ids.chair}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body._inlines)).toEqual(['variant']); // no product-media.view
    const variants = res.body._inlines.variant;
    expect(skus(variants.rows)).toEqual(['C-1', 'C-2a', 'C-3']); // C-2b is inactive
    expect(variants).toMatchObject({ total: 4, truncated: true });
    for (const row of variants.rows) expect(row).not.toHaveProperty('cost');
    expect(variants.rows[1]._perm).toEqual({ update: true, delete: false });
  });

  test('an `order` field the user cannot see neither orders their rows nor reaches their schema', async () => {
    const blind = as('blind');
    const layout = (await blind.get('/meta/resources/product')).body.form.layout;
    expect(layout[1]).toEqual({ inline: 'variant', label: 'Variants', display: 'table', fields: ['sku', 'price', 'cost', 'active'], min: 1, max: 3, link: 'productId' });
    const variants = (await blind.get(`/resources/product/${ids.chair}`)).body._inlines.variant;
    expect(skus(variants.rows)).toEqual(['C-3', 'C-1', 'C-2b']); // by id, as saved
    expect(variants.rows[0]).not.toHaveProperty('sort');
  });

  test('a child of a single-table family lists the children of its own records', async () => {
    const res = await as('clerk').get(`/resources/shirt/${ids.shirt}`);
    expect(skus(res.body._inlines.variant.rows)).toEqual(['S-1']);
  });

  test('a child whose findMany ignores scopes still shows only rows in scope', async () => {
    const res = await as('raw').get(`/resources/raw-order/${ids.order}`);
    expect(res.status).toBe(200);
    expect(res.body._inlines['raw-line'].rows.map((row: { product: string }) => row.product)).toEqual(['Pen', 'Pad']); // Ink has qty 3
  });

  test('the number of queries is constant in the number of rows (references and files in one lookup per inline)', async () => {
    selects = 0;
    await root.get(`/resources/product/${ids.table}`); // 1 variant, 1 picture
    const few = selects;
    selects = 0;
    const desk = await root.get(`/resources/product/${ids.desk}`); // 3 variants, 2 pictures, each with a file
    expect(desk.body._inlines.variant.rows).toHaveLength(3);
    expect(desk.body._inlines['product-media'].rows.map((row: { _files: { image: unknown } }) => typeof row._files.image)).toEqual(['object', 'object']);
    expect(selects).toBe(few);
    selects = 0;
    await root.get(`/resources/order/${ids.order}`);
    const lines = selects;
    selects = 0;
    await root.get(`/resources/order/${ids.other}`);
    expect(selects).toBe(lines);
  });

  test('a hidden link field hides the inline: no layout node, no child schema, no `_inlines`', async () => {
    const schema = (await as('nolink').get('/meta/resources/product')).body;
    expect(schema.form.layout).toEqual([{ title: 'Details', fields: ['name'], columns: 1 }]);
    expect(schema).not.toHaveProperty('inlines');
    const record = await as('nolink').get(`/resources/product/${ids.chair}`);
    expect(record.status).toBe(200);
    expect(record.body).not.toHaveProperty('_inlines');
    // The child's own list refuses to filter on it, as before.
    expect((await as('nolink').get(`/resources/variant?filter[productId][eq]=${ids.chair}`)).status).toBe(422);
  });

  test('a restricted link field hides the inline unless the role is granted it', async () => {
    const lines = await as('lines').get(`/resources/order/${ids.order}`);
    expect(lines.status).toBe(200);
    expect(lines.body).not.toHaveProperty('_inlines');
    expect((await as('lines').get('/meta/resources/order')).body.form.layout.map((node: { inline?: string }) => node.inline ?? 'section')).toEqual(['section']);
    const plus = await as('linesplus').get(`/resources/order/${ids.order}`);
    expect(Object.keys(plus.body._inlines)).toEqual(['order-line']);
    expect(plus.body._inlines['order-line'].total).toBe(3);
  });

  test('a child findMany that ignores the link filter still shows only this parent\'s children', async () => {
    const lines = (await root.get(`/resources/loose-order/${ids.order}`)).body._inlines['loose-line'];
    expect(lines.rows.map((row: { product: string }) => row.product)).toEqual(['Ink', 'Pen']); // Cup is the other order's
    expect(lines).toMatchObject({ total: 3, truncated: true });
    const other = (await root.get(`/resources/loose-order/${ids.other}`)).body._inlines['loose-line'];
    expect(other).toMatchObject({ total: 1, truncated: false });
    expect(other.rows.map((row: { product: string }) => row.product)).toEqual(['Cup']);
  });

  test('soft-deleted children are left out, and a lazy relation links them', async () => {
    const notes = (await root.get(`/resources/order/${ids.order}`)).body._inlines['order-note'];
    expect(notes.rows.map((row: { text: string }) => row.text)).toEqual(['Gift wrap']);
    expect(notes).toMatchObject({ total: 1, truncated: false });
    expect(notes.rows[0].order).toEqual({ id: ids.order, title: 'O-1' });
  });

  test('lists and the child endpoints are unchanged: no `_inlines` on list rows', async () => {
    const list = await root.get('/resources/product');
    expect(list.status).toBe(200);
    for (const item of list.body.items) expect(item).not.toHaveProperty('_inlines');
  });
});

describe(`a resource without inlines (${TEST_DB})`, () => {
  test('answers exactly as in 0.2.1', async () => {
    const created = await root.post('/resources/note', { body: 'Hello' });
    expect(created.status).toBe(201);
    const record = await root.get(`/resources/note/${created.body._id}`);
    expect(record.body).toEqual({ _id: String(created.body.id), id: created.body.id, body: 'Hello', _title: `#${created.body.id}` });
    const schema = (await root.get('/meta/resources/note')).body;
    // `prints` (0.5) is the one key added since: an empty list for a resource without print templates.
    expect(Object.keys(schema).sort()).toEqual(['actions', 'creatable', 'fields', 'form', 'group', 'label', 'list', 'name', 'permissions', 'primaryKeys', 'prints', 'related', 'softDelete']);
    expect(Object.keys(schema.form).sort()).toEqual(['constraints', 'create', 'readonly', 'requiredOnCreate', 'update']);
  });
});

// ── Boot checks ──

@Entity('inl_lonely')
class Lonely {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) name: string;
}
@AdminResource(Lonely)
class LonelyAdmin extends AdminResourceBase<Lonely> {}

/** Points at Shirt, a child of the family: it cannot be listed under any Product. */
@Entity('inl_sticker')
class Sticker {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => Shirt) shirt: Shirt;
}
@AdminResource(Sticker)
class StickerAdmin extends AdminResourceBase<Sticker> {}

@Entity('inl_line_note')
class LineNote {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) lineId: number;
  @ManyToOne(() => OrderLine) @JoinColumn({ name: 'lineId' }) line: OrderLine;
}
@AdminResource(LineNote)
class LineNoteAdmin extends AdminResourceBase<LineNote> {}
@AdminResource(OrderLine, { name: 'noted-line' })
class NotedLineAdmin extends AdminResourceBase<OrderLine> {
  override form: FormConfig = { layout: [{ fields: ['product'] }, { inline: LineNoteAdmin }] };
}

@Entity('inl_pair')
class Pair {
  @PrimaryColumn({ type: 'int' }) left: number;
  @PrimaryColumn({ type: 'int' }) right: number;
}
@Entity('inl_pair_item')
class PairItem {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => Pair) pair: Pair;
}
@AdminResource(PairItem)
class PairItemAdmin extends AdminResourceBase<PairItem> {}

/** Lines of another DataSource. */
@AdminResource(OrderLine, { name: 'far-line', dataSource: 'far' })
class FarLineAdmin extends AdminResourceBase<OrderLine> {}

/** A parent resource of `entity` whose layout holds `node`. */
function parentWith(entity: Function, node: LayoutInlineConfig): Provider {
  @AdminResource(entity, { name: 'bad-parent' })
  class BadParentAdmin extends AdminResourceBase {
    override form: FormConfig = { layout: [node] };
  }
  return BadParentAdmin;
}
const boot = (entity: Function, node: LayoutInlineConfig, providers: Provider[]) =>
  createTestApp({ entities: [Product, Shirt, Order, OrderLine, Lonely, Sticker, LineNote, Pair, PairItem], providers: [...providers, parentWith(entity, node)] });

describe(`boot errors (${TEST_DB})`, () => {
  test('a child without a to-one relation to the parent', async () => {
    await expect(boot(Order, { inline: LonelyAdmin }, [LonelyAdmin])).rejects.toThrow(
      'BadParentAdmin: form.layout inline LonelyAdmin: Lonely has no many-to-one or owning one-to-one relation to Order',
    );
  });

  test('a child pointing at a kind of the parent (not the parent or its root) is refused', async () => {
    await expect(boot(Product, { inline: StickerAdmin }, [StickerAdmin])).rejects.toThrow('Sticker has no many-to-one or owning one-to-one relation to Product');
  });

  test('two candidate links without `link`, and a `link` that is not one of them', async () => {
    await expect(boot(Order, { inline: OrderLineAdmin }, [OrderLineAdmin])).rejects.toThrow(
      'OrderLine has several relations to Order (orderId, returnOfId); name the one that links it with `link`',
    );
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'qty' }, [OrderLineAdmin])).rejects.toThrow('link: "qty" is not a relation of OrderLine to Order (use orderId or returnOfId)');
  });

  test('`order` naming a field that is not a number', async () => {
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'orderId', order: 'product' }, [OrderLineAdmin])).rejects.toThrow('order: "product" is not a number field of OrderLine');
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'orderId', order: 'nope' }, [OrderLineAdmin])).rejects.toThrow('order: "nope" is not a number field of OrderLine');
  });

  test('an inline inside an inline', async () => {
    await expect(boot(Order, { inline: NotedLineAdmin, link: 'orderId' }, [LineNoteAdmin, NotedLineAdmin])).rejects.toThrow(
      'NotedLineAdmin declares inlines itself; inlines are one level deep',
    );
  });

  test('`max` over 500, and `min` over `max`', async () => {
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'orderId', max: 501 }, [OrderLineAdmin])).rejects.toThrow('max: must be an integer from 1 to 500');
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'orderId', min: 5, max: 4 }, [OrderLineAdmin])).rejects.toThrow('min: must be an integer from 0 to max (4)');
  });

  test('`fields` naming the link or a field the child form does not have', async () => {
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'orderId', fields: ['orderId', 'qty'] }, [OrderLineAdmin])).rejects.toThrow('fields: "orderId" is the link field; the inline sets it');
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'orderId', fields: ['qtty'] }, [OrderLineAdmin])).rejects.toThrow('fields: "qtty" is not on the OrderLine form (did you mean "qty"?)');
  });

  test('a parent with a composite primary key', async () => {
    await expect(boot(Pair, { inline: PairItemAdmin }, [PairItemAdmin])).rejects.toThrow('BadParentAdmin: form.layout inline PairItemAdmin: inlines need a parent with a single-column primary key');
  });

  test('a child on another DataSource', async () => {
    await expect(createTestApp({ entities: [Order, OrderLine], dataSources: { far: [Order, OrderLine] }, providers: [FarLineAdmin, parentWith(Order, { inline: FarLineAdmin, link: 'orderId' })] })).rejects.toThrow(
      'form.layout inline FarLineAdmin: FarLineAdmin is on another DataSource; a parent and its inlines are saved in one transaction',
    );
  });

  test('a class that is not a registered resource, and one child twice', async () => {
    await expect(boot(Order, { inline: OrderLineAdmin, link: 'orderId' }, [])).rejects.toThrow('inline OrderLineAdmin: not a registered admin resource (add it to a module\'s providers)');
    const twice = parentTwice();
    await expect(createTestApp({ entities: [Order, OrderLine], providers: [OrderLineAdmin, twice] })).rejects.toThrow('inline OrderLineAdmin is placed twice');
  });
});

function parentTwice(): Provider {
  @AdminResource(Order, { name: 'twice' })
  class TwiceAdmin extends AdminResourceBase<Order> {
    override form: FormConfig = { layout: [{ inline: OrderLineAdmin, link: 'orderId' }, { tab: 'Again', sections: [{ inline: OrderLineAdmin, link: 'returnOfId' }] }] };
  }
  return TwiceAdmin;
}
