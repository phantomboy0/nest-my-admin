import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  type AdminAuthAdapter,
  type AdminModuleOptions,
  type AdminPrincipal,
  type AdminUserRecord,
  type ComputedColumn,
  type ListConfig,
  type ResourceSchema,
  type RoleDefinition,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('cc_category')
class Category {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

@Entity('cc_product')
class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ length: 20 }) sku: string;
  @Column({ type: 'decimal', precision: 10, scale: 2 }) price: string;
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true }) compareAtPrice: string | null;
  @Column({ type: 'simple-enum', enum: ['active', 'inactive', 'draft'], default: 'active' }) status: string;
  @Column({ type: 'int', nullable: true }) categoryId: number | null;
  @ManyToOne(() => Category, { nullable: true }) @JoinColumn({ name: 'categoryId' }) category: Category | null;
  @OneToMany(() => Variant, (variant) => variant.product) variants: Variant[];
  @OneToMany(() => Media, (media) => media.product) media: Media[];
}

@Entity('cc_variant')
class Variant {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int', default: 0 }) stock: number;
  @Column({ default: false }) hidden: boolean;
  @Column({ type: 'int' }) productId: number;
  @ManyToOne(() => Product, (product) => product.variants, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Product;
}

@Entity('cc_media')
class Media {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) image: string;
  @Column({ type: 'int', default: 0 }) sort: number;
  /** No explicit column: the relation property itself is the key. */
  @ManyToOne(() => Product, (product) => product.media, { onDelete: 'CASCADE' }) product: Product;
}

let computeCalls = 0;
const stockBadge = (value: unknown, row: Product) => {
  const stock = Number(value ?? 0);
  // `map` sees the row: a draft is never "in stock".
  if (row.status === 'draft') return { label: { en: 'Draft', fa: 'پیش‌نویس' }, tone: 'neutral' as const };
  return stock === 0 ? { label: { en: 'Out of stock', fa: 'ناموجود' }, tone: 'bad' as const } : stock <= 5 ? { label: { en: 'Low', fa: 'رو به اتمام' }, tone: 'warn' as const } : { label: { en: 'In stock', fa: 'موجود' }, tone: 'ok' as const };
};

@AdminResource(Category, { title: 'name' })
class CategoryAdmin extends AdminResourceBase<Category> {}

@AdminResource(Variant)
class VariantAdmin extends AdminResourceBase<Variant> {
  @AdminScope('shown') shown() {
    return { hidden: false };
  }
}

@AdminResource(Media, { title: 'image' })
class MediaAdmin extends AdminResourceBase<Media> {}

@AdminResource(Product, { title: 'name' })
class ProductAdmin extends AdminResourceBase<Product> {
  list: ListConfig<Product> = {
    columns: ['image', 'title', 'category.name', 'money', 'stock', 'variants', 'active', 'batch'],
    pageSize: 100,
    computed: {
      image: { label: 'Image', kind: 'image', source: { first: 'media', field: 'image', by: 'sort' } },
      title: { label: { en: 'Product', fa: 'محصول' }, kind: 'title', source: 'name', subline: 'sku' },
      money: { label: 'Price', kind: 'money', source: 'price', previous: 'compareAtPrice' },
      stock: { label: 'Stock', kind: 'badge', source: { aggregate: 'sum', relation: 'variants', field: 'stock' }, map: stockBadge as ComputedColumn['map'], sortable: true },
      variants: { label: 'Variants', kind: 'count', source: { aggregate: 'count', relation: 'variants' }, sortable: true },
      active: { label: 'Active', kind: 'toggle', source: { toggle: 'status', on: 'active', off: 'inactive' } },
      batch: {
        label: 'Batch',
        kind: 'count',
        source: {
          compute: async (rows: Product[]) => {
            computeCalls++;
            return Object.fromEntries(rows.map((row) => [String(row.id), row.name.length]));
          },
          fields: ['name'],
        },
      },
    },
  };
}

const users = new Map<string, AdminUserRecord>(
  ['root', 'clerk', 'blind', 'priceless'].map((id) => [id, { id, displayName: id, username: id, isSuperuser: id === 'root', isActive: true }]),
);
const ROLES: RoleDefinition[] = [
  // Sees only the variants that are not hidden: counts and sums follow.
  { name: 'clerk', permissions: ['product.view', 'product.update', 'variant.view', 'media.view', 'category.view'], scopes: { variant: { view: 'shown' } } },
  // No variants at all: the columns over them are cut.
  { name: 'blind', permissions: ['product.view', 'media.view', 'category.view'] },
  // The previous price is hidden: the money column reads it, so it is cut; and no update, so no toggle.
  { name: 'priceless', permissions: ['product.view', 'variant.view', 'media.view', 'category.view'], fields: { product: { compareAtPrice: 'hidden' } } },
];

@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return user.id === 'root' ? [] : [String(user.id)];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [TestAuth, ProductAdmin, VariantAdmin, MediaAdmin, CategoryAdmin] })
class CatalogModule {}

const queries: string[] = [];
const logger = { logQuery: (query: string) => void queries.push(query), logQueryError: () => undefined, logQuerySlow: () => undefined, logSchemaBuild: () => undefined, logMigration: () => undefined, log: () => undefined };

const ENTITIES = [Category, Product, Variant, Media, ...ADMIN_RBAC_ENTITIES];
async function boot(admin: Partial<AdminModuleOptions> = {}, providers: Function[] = [], log = false): Promise<INestApplication> {
  @Module({ providers: [...providers] as never[] })
  class Extra {}
  return createTestApp({
    imports: [CatalogModule, Extra],
    entities: ENTITIES,
    ...(log ? { dataSource: { logger, logging: ['query'] } } : {}),
    admin: { auth: AdminAuth.custom(TestAuth), rbac: {}, roles: ROLES, locales: ['en', 'fa'], ...admin },
  });
}

let app: INestApplication;
const get = (user: string, path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user);
type Row = { _id: string; name: string; _computed: Record<string, { value: unknown; subline?: unknown; previous?: unknown; label?: string; tone?: string }> };
const rows = async (user: string, query = '') => {
  const res = await get(user, `/resources/product?${query}`);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.items as Row[];
};

beforeAll(async () => {
  app = await boot({}, [], true);
  const ds = app.get<DataSource>(getDataSourceToken());
  const shoes = await ds.getRepository(Category).save({ name: 'Shoes' });
  // 60 products: product i has i % 4 variants of stock i each (one of them hidden when it has 3), and media from i % 3.
  for (let i = 1; i <= 60; i++) {
    const product = await ds.getRepository(Product).save({ name: `P${String(i).padStart(2, '0')}`, sku: `SKU-${i}`, price: '10.00', compareAtPrice: i % 2 ? '12.50' : null, status: i === 7 ? 'draft' : i % 5 ? 'active' : 'inactive', categoryId: i % 2 ? shoes.id : null });
    for (let v = 0; v < i % 4; v++) await ds.getRepository(Variant).save({ productId: product.id, stock: i, hidden: v === 2 });
    for (let m = i % 3; m > 0; m--) await ds.getRepository(Media).save({ product: { id: product.id }, image: `img-${i}-${m}.png`, sort: m });
  }
});
afterAll(async () => {
  await app.close();
});

describe(`computed list columns (${TEST_DB})`, () => {
  test('a page runs a constant number of queries, whatever its size (no N+1)', async () => {
    queries.length = 0;
    await rows('root', 'pageSize=5');
    const small = queries.length;
    queries.length = 0;
    await rows('root', 'pageSize=50');
    expect(queries.length).toBe(small);
  });

  test('compute is called once per page', async () => {
    computeCalls = 0;
    const page = await rows('root', 'pageSize=50');
    expect(computeCalls).toBe(1);
    expect(page.find((row) => row.name === 'P50')!._computed.batch).toEqual({ value: 3 }); // newest first: P60 … P11
  });

  test('values: first row, path, title with subline, money with previous, aggregate, count, toggle, mapped badge', async () => {
    const byName = new Map((await rows('root', 'pageSize=100')).map((row) => [row.name, row._computed]));
    const p05 = byName.get('P05')!;
    expect(p05.image).toEqual({ value: 'img-5-1.png' }); // lowest `sort` first
    expect(p05.title).toEqual({ value: 'P05', subline: 'SKU-5' });
    expect(p05.money).toEqual({ value: '10.00', previous: '12.50' });
    expect(p05.variants).toEqual({ value: 1 });
    expect(p05.active).toEqual({ value: false }); // inactive (5 % 5 === 0)
    expect(byName.get('P03')!.image).toEqual({ value: null }); // no media
    expect(byName.get('P04')!.variants).toEqual({ value: 0 });
    // Badges: 0 → out of stock (bad), 1..5 → low (warn), > 5 → in stock (ok); a draft maps to its own label.
    expect(byName.get('P04')!.stock).toMatchObject({ label: 'Out of stock', tone: 'bad' });
    expect(byName.get('P01')!.stock).toMatchObject({ value: 1, label: 'Low', tone: 'warn' });
    expect(byName.get('P10')!.stock).toMatchObject({ label: 'In stock', tone: 'ok' });
    expect(byName.get('P07')!.stock).toMatchObject({ label: 'Draft', tone: 'neutral' });
    const schema = (await get('root', '/meta/resources/product')).body as ResourceSchema;
    expect(schema.list.computed!.active).toEqual({ label: 'Active', kind: 'toggle', sortable: false, toggle: { field: 'status', on: 'active', off: 'inactive' } });
    expect((await get('root', '/meta/resources/product').set('Accept-Language', 'fa')).body.list.computed.title.label).toBe('محصول');
  });

  test('aggregate and first columns sort both ways, with the primary key breaking ties; others refuse', async () => {
    const ascending = await rows('root', 'sort=variants&pageSize=100');
    const counts = ascending.map((row) => row._computed.variants!.value as number);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    const zeros = ascending.filter((row) => row._computed.variants!.value === 0).map((row) => Number(row._id));
    expect(zeros).toEqual([...zeros].sort((a, b) => a - b));
    const descending = (await rows('root', 'sort=-variants&pageSize=100')).map((row) => row._computed.variants!.value as number);
    expect(descending).toEqual([...descending].sort((a, b) => b - a));
    expect((await rows('root', 'sort=-stock&pageSize=3')).map((row) => row.name)).toEqual(['P59', 'P55', 'P51']); // 3 variants × stock i
    expect((await get('root', '/resources/product?sort=title')).status).toBe(422);
    expect((await get('root', '/resources/product?sort=batch')).status).toBe(422);
  });

  test('the toggle writes its enum values through a normal PATCH', async () => {
    const p02 = (await rows('root', 'pageSize=100')).find((row) => row.name === 'P02')!;
    expect(p02._computed.active!.value).toBe(true);
    expect((await request(app.getHttpServer()).patch(`/admin/api/resources/product/${p02._id}`).set('X-User', 'root').send({ status: 'inactive' })).status).toBe(200);
    expect((await rows('root', 'pageSize=100')).find((row) => row.name === 'P02')!._computed.active!.value).toBe(false);
  });

  test('aggregates count only the rows the viewer sees', async () => {
    const p03 = (await rows('clerk', 'pageSize=100')).find((row) => row.name === 'P03')!;
    expect(p03._computed.variants!.value).toBe(2); // the third is hidden from clerks
    expect(p03._computed.stock!.value).toBe(6);
    expect((await rows('root', 'pageSize=100')).find((row) => row.name === 'P03')!._computed.variants!.value).toBe(3);
  });

  test('a column whose relation or field is hidden is absent from the schema and from _computed', async () => {
    const blind = (await get('blind', '/meta/resources/product')).body as ResourceSchema;
    expect(Object.keys(blind.list.computed!).sort()).toEqual(['active', 'batch', 'image', 'money', 'title']);
    expect(blind.list.columns).not.toContain('variants');
    expect(blind.list.sortable).not.toContain('variants');
    expect(Object.keys((await rows('blind'))[0]!._computed).sort()).toEqual(['active', 'batch', 'image', 'money', 'title']);
    expect((await get('blind', '/resources/product?sort=variants')).status).toBe(422);
    const priceless = (await get('priceless', '/meta/resources/product')).body as ResourceSchema;
    expect(priceless.list.computed!.money).toBeUndefined();
    expect(priceless.list.computed!.active!.toggle).toBeUndefined(); // no update: nothing to write
    expect((await rows('priceless'))[0]!._computed.money).toBeUndefined();
  });

  test('boot refuses columns that do not hold', async () => {
    const bad = async (computed: Record<string, ComputedColumn>, columns = Object.keys(computed)) => {
      @AdminResource(Product, { name: 'bad-product' })
      class BadAdmin extends AdminResourceBase<Product> {
        list: ListConfig<Product> = { columns, computed };
      }
      return boot({}, [BadAdmin]);
    };
    await expect(bad({ x: { label: 'X', kind: 'count', source: { aggregate: 'count', relation: 'category' } } })).rejects.toThrow('list.computed.x.source: "category" is not a one-to-many relation');
    await expect(bad({ x: { label: 'X', kind: 'count', source: 'name', sortable: true } })).rejects.toThrow('list.computed.x: only aggregate and first sources can be sortable');
    await expect(bad({ x: { label: 'X', kind: 'toggle', source: { toggle: 'status', on: 'on', off: 'inactive' } } })).rejects.toThrow('list.computed.x.source: "on" is not one of active, inactive, draft');
    await expect(bad({ x: { label: 'X', kind: 'count', source: { first: 'media', field: 'nope', by: 'sort' } } })).rejects.toThrow('list.computed.x.source: unknown field "nope" on Media');
    await expect(bad({ name: { label: 'X', kind: 'count', source: 'sku' } })).rejects.toThrow('list.computed.name: the name is a field');
  });
});
