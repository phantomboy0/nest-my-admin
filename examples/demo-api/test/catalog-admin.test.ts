import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { testDatabase, type TestDatabase } from '../../../packages/core/test/helpers/test-db.js';
import { ProductsService } from '../src/catalog/products.service.js';
import { OrderAdmin } from '../src/sales/order.admin.js';
import { Order } from '../src/sales/order.entity.js';

/** The record actions `_perm.actions` lets run (its names whose value is a label, not false). */
const offered = (actions: Record<string, string | false> | undefined) => Object.entries(actions ?? {}).flatMap(([name, label]) => (label === false ? [] : [name]));

let app: INestApplication;
let db: TestDatabase;
/** Uploads of this run (the demo's own `var/uploads` is never touched). */
const uploads = mkdtempSync(join(tmpdir(), 'nma-demo-test-'));
/** Signed in as the bootstrap superuser; sends the session's CSRF token with every request. */
let agent: ReturnType<typeof request.agent>;
const base = '/admin/api/resources/product';
const post = (body: object) => agent.post(base).send(body);

beforeAll(async () => {
  db = await testDatabase([]); // entities come from the demo's own databaseOptions()
  if (db.url) process.env.DATABASE_URL = db.url;
  process.env.NMA_UPLOAD_DIR = uploads;
  try {
    // Imported here: the module reads NMA_UPLOAD_DIR when it is loaded.
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    agent = request.agent(app.getHttpServer());
    const signedIn = await agent.post('/admin/api/session').send({ username: 'admin', password: 'admin-demo-pass' });
    if (signedIn.status !== 200) throw new Error(`demo sign-in failed: ${signedIn.status} ${JSON.stringify(signedIn.body)}`);
    agent.set('X-CSRF-Token', signedIn.body.csrfToken);
  } catch (error) {
    // a demo that fails to boot must not leave its database behind
    await app?.close().catch(() => undefined);
    delete process.env.DATABASE_URL;
    await db.drop();
    throw error;
  }
});
afterAll(async () => {
  try {
    await app?.close();
  } finally {
    delete process.env.DATABASE_URL;
    delete process.env.NMA_UPLOAD_DIR;
    rmSync(uploads, { recursive: true, force: true });
    await db.drop();
  }
});

describe('product admin (service-first)', () => {
  test('the form comes from the DTOs', async () => {
    const res = await agent.get('/admin/api/meta/resources/product');
    expect(res.body.form).toMatchObject({
      create: ['name', 'slug', 'sku', 'price', 'compareAtPrice', 'cost', 'stock', 'status', 'releasedOn', 'categoryId', 'tags', 'image', 'gallery'],
      update: ['name', 'slug', 'price', 'compareAtPrice', 'cost', 'stock', 'status', 'releasedOn', 'categoryId', 'tags', 'image', 'gallery'],
      requiredOnCreate: ['name', 'sku', 'price'],
    });
    expect(res.body.form.constraints.create.name).toEqual({ required: true, minLength: 1, maxLength: 120 });
    expect(res.body.form.constraints.create.sku).toMatchObject({ required: true, pattern: { source: '^[A-Za-z0-9-]{2,40}$', flags: '', message: 'sku must be 2-40 letters, digits or dashes' } });
    expect(res.body.form.constraints.create.stock).toEqual({ integer: true, min: 0 });
    expect(res.body.form.constraints.create.status).toEqual({ oneOf: ['draft', 'active', 'archived'] });
  });

  test('create runs ProductsService and decimals stay strings even on SQLite', async () => {
    const res = await post({ name: 'Lamp', sku: 'lamp-1', price: '19.9', stock: 4, status: 'active' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Lamp', sku: 'LAMP-1', price: '19.90', stock: 4, status: 'active' });
    const read = await agent.get(`${base}/${res.body.id}`);
    expect(read.body.price).toBe('19.90');
  });

  test('uploaded pictures reach the service as files and are stored as keys', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = async (field: string) => (await agent.post(`/admin/api/uploads?resource=product&field=${field}`).set('Content-Type', 'image/png').set('X-File-Name', 'lamp.png').send(png)).body as { token: string };
    const [image, first, second] = [await upload('image'), await upload('gallery'), await upload('gallery')];
    const created = await post({ name: 'Pictured', sku: 'pic-1', price: '5', image: { token: image.token }, gallery: [{ token: first.token }, { token: second.token }] });
    expect(created.status).toBe(201);
    expect(created.body.image).toMatch(/^product\/image\/.+\.png$/);
    expect(created.body._files.image).toMatchObject({ name: 'lamp.png', contentType: 'image/png', url: `/admin/api/files/${created.body.image}` });
    const [one, two] = created.body.gallery as string[];
    // The list is replaced, not merged: the second picture first, the first one gone.
    const updated = await agent.patch(`${base}/${created.body.id}`).send({ gallery: [{ key: two }], image: null });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ image: null, gallery: [two] });
    expect((await agent.get(`/admin/api/files/${two}`)).status).toBe(200);
    expect((await agent.get(`/admin/api/files/${one}`)).status).toBe(404);
  });

  test('a rule enforced by the service surfaces as BUSINESS_RULE', async () => {
    const res = await post({ name: 'Ghost', sku: 'ghost-1', price: '5', status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'BUSINESS_RULE', message: 'Active products need stock' });
  });

  test('DTO validation errors are reported per field', async () => {
    const res = await post({ name: '', sku: 'ok-1', price: 'abc' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['name', 'price']);
    expect(res.body.fields.price[0]).toContain('decimal');
  });

  test('fields outside the DTO are rejected', async () => {
    const res = await post({ name: 'Sneaky', sku: 'sneaky-1', price: '1', createdAt: '2020-01-01' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ createdAt: ['is not a writable field'] });
  });

  test('a duplicate unique value is a 409 on that field, not a 500', async () => {
    expect((await post({ name: 'One', sku: 'dup-1', price: '1' })).status).toBe(201);
    const res = await post({ name: 'Two', sku: 'dup-1', price: '1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', fields: { sku: ['already exists'] } });
  });

  test('update uses the update DTO and the service', async () => {
    const { body } = await post({ name: 'Mug', sku: 'mug-1', price: '8' });
    const res = await agent.patch(`${base}/${body.id}`).send({ stock: 9 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stock: 9, sku: 'MUG-1' });
    const sku = await agent.patch(`${base}/${body.id}`).send({ sku: 'NEW' });
    expect(sku.status).toBe(422);
  });

  test('archived products are locked except their status (readonlyIf)', async () => {
    const { body } = await post({ name: 'Old', sku: 'old-1', price: '2' });
    const archived = await agent.patch(`${base}/${body.id}`).send({ status: 'archived' });
    expect(archived.body._readonly).toEqual(['name', 'slug', 'cost', 'price', 'compareAtPrice', 'stock', 'releasedOn', 'categoryId', 'tags', 'image', 'gallery']);
    const res = await agent.patch(`${base}/${body.id}`).send({ name: 'Renamed', price: '1' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION', fields: { name: ['is read-only'], price: ['is read-only'] } });
    const back = await agent.patch(`${base}/${body.id}`).send({ status: 'draft' });
    expect(back.status).toBe(200);
    expect(back.body._readonly).toBeUndefined();
  });

  test('service exceptions keep their meaning (archived → CONFLICT)', async () => {
    // Called directly, the service still refuses: the admin lock above is on top of it, not instead of it.
    const { body } = await post({ name: 'Older', sku: 'old-2', price: '2', status: 'archived' });
    const service = app.get(ProductsService);
    await expect(service.update(body.id, { name: 'Renamed' })).rejects.toThrow('Archived products are read-only');
  });

  test('filters and search narrow the list', async () => {
    await post({ name: 'Filter lamp', sku: 'flt-1', price: '12', stock: 3, status: 'active' });
    await post({ name: 'Filter mug', sku: 'flt-2', price: '30', status: 'draft' });
    const byStatus = await agent.get(`${base}?filter[status][eq]=draft&search=filter`);
    expect(byStatus.body.items.map((p: { sku: string }) => p.sku)).toEqual(['FLT-2']);
    const byPrice = await agent.get(`${base}?filter[price][between]=10,20&search=flt`);
    expect(byPrice.body.items.map((p: { sku: string }) => p.sku)).toEqual(['FLT-1']);
    const bad = await agent.get(`${base}?filter[sku][eq]=x`);
    expect(bad.status).toBe(422);
    expect(bad.body.fields).toEqual({ 'filter[sku][eq]': ['cannot filter by "sku"'] });
  });

  test('delete goes through the service, which refuses active products', async () => {
    const draft = (await post({ name: 'Doomed', sku: 'del-1', price: '1' })).body;
    expect((await agent.delete(`${base}/${draft.id}`)).status).toBe(204);
    const active = (await post({ name: 'Keeper', sku: 'del-2', price: '1', stock: 1, status: 'active' })).body;
    const refused = await agent.delete(`${base}/${active.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'CONFLICT', message: 'Active products cannot be deleted; archive them first' });
  });
});

describe('categories and tags (relations)', () => {
  const http = () => agent;
  const create = async (resource: string, name: string) => (await http().post(`/admin/api/resources/${resource}`).send({ name })).body.id as number;

  test('products take a category and tags by id; the service saves them', async () => {
    const office = await create('category', 'Office');
    const [sale, gift] = [await create('tag', 'Sale'), await create('tag', 'Gift')];
    const res = await post({ name: 'Stapler', sku: 'rel-1', price: '4', categoryId: office, tags: [sale, gift] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ categoryId: { id: office, title: 'Office' }, _title: 'Stapler' });
    expect(res.body.tags.map((tag: { title: string }) => tag.title)).toEqual(['Sale', 'Gift']);

    const listed = await http().get(`${base}?filter[categoryId][eq]=${office}&filter[tags][in]=${gift}`);
    expect(listed.body.items.map((p: { sku: string }) => p.sku)).toEqual(['REL-1']);
    const searched = await http().get(`${base}?search=offi`);
    expect(searched.body.items.map((p: { sku: string }) => p.sku)).toEqual(['REL-1']);

    const cleared = await http().patch(`${base}/${res.body.id}`).send({ categoryId: null, tags: [] });
    expect(cleared.body).toMatchObject({ categoryId: null, tags: [] });
  });

  test('a missing category is a 422 on categoryId', async () => {
    const res = await post({ name: 'Ghost', sku: 'rel-2', price: '1', categoryId: 999999 });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ categoryId: ['does not exist'] });
  });

  test('a category that products use cannot be deleted', async () => {
    const used = await create('category', 'Used');
    await post({ name: 'User', sku: 'rel-3', price: '1', categoryId: used });
    const res = await http().delete(`/admin/api/resources/category/${used}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'Other records still refer to this record' });
  });
});

describe('versions, trash and nested fields', () => {
  const http = () => agent;

  test('a stale save is a 409 carrying the product as it is now', async () => {
    const { body } = await post({ name: 'Shared', sku: 'ver-1', price: '5' });
    expect((await http().patch(`${base}/${body._id}`).set('If-Match', `"${body.version}"`).send({ stock: 2 })).status).toBe(200);
    const stale = await http().patch(`${base}/${body._id}`).set('If-Match', `"${body.version}"`).send({ name: 'Mine' });
    expect(stale.status).toBe(409);
    expect(stale.body.current).toMatchObject({ name: 'Shared', stock: 2, version: body.version + 1 });
  });

  test('deleting moves a product to the trash, where it can be restored', async () => {
    const { body } = await post({ name: 'Trashable', sku: 'bin-1', price: '1' });
    expect((await http().delete(`${base}/${body._id}`)).status).toBe(204);
    expect((await http().get(`${base}/${body._id}`)).status).toBe(404);
    const trash = await http().get(`${base}?trashed=only`);
    expect(trash.body.items.map((p: { sku: string }) => p.sku)).toContain('BIN-1');
    expect((await http().post(`${base}/${body._id}/restore`).send({})).body).toMatchObject({ sku: 'BIN-1', deletedAt: null });
  });

  test('a supplier contact is a nested group', async () => {
    const res = await http().post('/admin/api/resources/supplier').send({ name: 'Acme', contact: { email: 'a@acme.test', phone: null } });
    expect(res.status).toBe(201);
    expect(res.body.contact).toEqual({ email: 'a@acme.test', phone: null });
    const list = await http().get('/admin/api/resources/supplier?search=acme.test');
    expect(list.body.items[0]).toMatchObject({ name: 'Acme', 'contact.email': 'a@acme.test' });
  });
});

describe('lists at scale', () => {
  const http = () => agent;

  test('the stock log pages with a cursor and does not count', async () => {
    for (let i = 0; i < 12; i++) {
      const product = (await post({ name: `Logged ${i}`, sku: `log-${i}`, price: '1' })).body;
      await http().post('/admin/api/resources/stock-move').send({ productId: product.id, delta: 1, reason: `r${i}` });
    }
    const first = await http().get('/admin/api/resources/stock-move');
    expect(first.body).toMatchObject({ total: null, hasMore: true });
    expect(first.body.items).toHaveLength(10);
    const second = await http().get(`/admin/api/resources/stock-move?after=${encodeURIComponent(first.body.nextCursor)}`);
    expect(second.body.items[0].id).toBeLessThan(first.body.items[9].id);
  });

  test('products are counted exactly while the table is small', async () => {
    const res = await http().get(base);
    expect(res.body.estimated).toBeUndefined();
    expect(typeof res.body.total).toBe('number');
  });

  test('a category lists its products as related', async () => {
    const schema = (await http().get('/admin/api/meta/resources/category')).body;
    expect(schema.related).toEqual([{ label: 'Product', resource: 'product', field: 'categoryId', operator: 'eq' }]);
  });
});

describe('sign-in', () => {
  test('the admin API is closed without a session', async () => {
    expect((await request(app.getHttpServer()).get('/admin/api/meta')).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/admin/api/session').send({ username: 'admin', password: 'wrong-password' })).status).toBe(401);
  });
});

describe('the catalog-editor role (editor)', () => {
  let editor: ReturnType<typeof request.agent>;
  beforeAll(async () => {
    const { seedUsers } = await import('../src/seed.js');
    await seedUsers(app);
    editor = request.agent(app.getHttpServer());
    const signedIn = await editor.post('/admin/api/session').send({ username: 'editor', password: 'editor-demo-pass' });
    expect(signedIn.status).toBe(200);
    editor.set('X-CSRF-Token', signedIn.body.csrfToken);
  });

  test('sees the catalog without suppliers, and no cost', async () => {
    const meta = (await editor.get('/admin/api/meta')).body;
    const names = meta.groups.flatMap((group: { resources: Array<{ name: string }> }) => group.resources.map((resource) => resource.name)).sort();
    // No articles, no invoices; order lines are edited on their order (an inline child: `nav: false`).
    expect(names).toEqual(['category', 'order', 'product', 'stock-move', 'tag']);
    expect(meta.groups.flatMap((group: { pages: Array<{ name: string }> }) => group.pages.map((page) => page.name))).toEqual(['shop']);
    const schema = (await editor.get('/admin/api/meta/resources/product')).body;
    expect(schema.list.columns).not.toContain('cost');
    expect(schema.permissions).toEqual({ create: false, update: true, delete: false, purge: false });
    expect(schema.form.readonly).toContain('price');
  });

  test('updates drafts only; price is read-only; cost cannot be written', async () => {
    const draft = (await post({ name: 'Draft for editor', sku: 'ed-1', price: '5', cost: '2' })).body;
    const active = (await post({ name: 'Active for editor', sku: 'ed-2', price: '5', stock: 1, status: 'active' })).body;
    expect((await editor.patch(`${base}/${draft._id}`).send({ name: 'Renamed draft' })).status).toBe(200);
    expect((await editor.patch(`${base}/${active._id}`).send({ name: 'Renamed active' })).status).toBe(404);
    expect((await editor.patch(`${base}/${draft._id}`).send({ price: '9' })).body).toMatchObject({ code: 'FORBIDDEN_FIELDS', fields: { price: ['is read-only for you'] } });
    expect((await editor.patch(`${base}/${draft._id}`).send({ cost: '1' })).body).toMatchObject({ code: 'FORBIDDEN_FIELDS', fields: { cost: ['is not available'] } });
    expect((await editor.get(`${base}/${draft._id}`)).body).not.toHaveProperty('cost');
    expect((await editor.delete(`${base}/${draft._id}`)).status).toBe(403);
    expect((await editor.post(base).send({ name: 'New', sku: 'ed-3', price: '1' })).status).toBe(403);
  });

  test('ships orders but may not cancel or mark them paid; reads the shop settings without saving them', async () => {
    const orders = '/admin/api/resources/order';
    const schema = (await editor.get('/admin/api/meta/resources/order')).body;
    expect(schema.actions.map((action: { name: string }) => action.name)).toEqual(['ship']);
    const draft = (await agent.post(orders).send({ number: 'ED-ORDER-1', customer: 'Ada', total: '5.00' })).body;
    expect(offered((await editor.get(`${orders}/${draft._id}`)).body._perm.actions)).toEqual(['ship']);
    for (const action of ['cancel', 'markPaid', 'cancelStaleDrafts']) {
      expect((await editor.post(`${orders}/actions/${action}`).send(action === 'cancelStaleDrafts' ? {} : { ids: [draft._id] })).status).toBe(403);
    }
    expect((await agent.post(`${orders}/actions/markPaid`).send({ ids: [draft._id] })).status).toBe(200);
    const shipped = await editor.post(`${orders}/actions/ship`).send({ ids: [draft._id], input: { tracking: 'TRK-EDITOR' } });
    expect(shipped.body).toMatchObject({ message: 'Shipped', record: { status: 'shipped', tracking: 'TRK-EDITOR' } });

    const page = await editor.get('/admin/api/pages/shop');
    expect(page.status).toBe(200);
    expect(page.body.schema.readonly).toBe(true);
    expect((await editor.patch('/admin/api/pages/shop').send({ shopName: 'Not mine' })).status).toBe(403);
  });

  test('the audit log: a salary is recorded as changed without values; the editor reads histories but not the audit page', async () => {
    const employees = '/admin/api/resources/employee';
    const created = (await agent.post(employees).send({ name: 'Audited Person', position: 'Tester', salary: '5123.00' })).body;
    expect((await agent.patch(`${employees}/${created._id}`).send({ salary: '6789.00', position: 'Lead' })).status).toBe(200);
    const history = await agent.get(`${employees}/${created._id}/history`);
    expect(history.status).toBe(200);
    expect(history.body.entries.map((entry: { event: string }) => entry.event)).toEqual(['employee.updated', 'employee.created']);
    expect(history.body.entries[0].changes).toEqual([
      { field: 'position', before: 'Tester', after: 'Lead' },
      { field: 'salary', changed: true },
    ]);
    // The create entry holds no salary either (a search of the whole answer for the digits could hit a correlation id).
    expect(history.body.entries[1].changes.find((change: { field: string }) => change.field === 'salary')).toEqual({ field: 'salary', changed: true });
    for (const entry of history.body.entries) expect(JSON.stringify(entry.changes)).not.toMatch(/5123|6789/);
    // The record itself still shows the salary to whoever may view employees.
    expect((await agent.get(`${employees}/${created._id}`)).body.salary).toBe('6789.00');

    expect((await agent.get('/admin/api/session')).body.audit).toEqual({ enabled: true, view: true });
    expect((await editor.get('/admin/api/session')).body.audit).toEqual({ enabled: true, view: false });
    expect((await editor.get('/admin/api/audit')).status).toBe(403);
    expect((await editor.get(`${employees}/${created._id}/history`)).status).toBe(404);
    const order = (await agent.post('/admin/api/resources/order').send({ number: 'ED-AUDIT-1', customer: 'Ada', total: '5.00' })).body;
    const theirs = await editor.get(`/admin/api/resources/order/${order._id}/history`);
    expect(theirs.body.entries.map((entry: { event: string }) => entry.event)).toEqual(['order.created']);
    const all = await agent.get('/admin/api/audit?resource=employee');
    expect(all.body.entries.length).toBeGreaterThanOrEqual(2);
  });
});

describe('orders (actions)', () => {
  const orders = '/admin/api/resources/order';
  const make = async (number: string) => (await agent.post(orders).send({ number, customer: 'Grace', total: '12.50' })).body as { _id: string };
  const run = (action: string, body: object) => agent.post(`${orders}/actions/${action}`).send(body);

  test('status and tracking code are changed by actions only', async () => {
    const schema = (await agent.get('/admin/api/meta/resources/order')).body;
    expect(schema.form).toMatchObject({ create: ['number', 'customer', 'total'], update: ['customer', 'total'] });
    expect(schema.actions.map((action: { name: string; target: string; bulk: boolean }) => [action.name, action.target, action.bulk])).toEqual([
      ['markPaid', 'record', false],
      ['ship', 'record', true],
      ['cancel', 'record', false],
      ['advanceNext', 'record', false],
      ['cancelStaleDrafts', 'resource', false],
    ]);
    const order = await make('ACT-1');
    expect((await agent.patch(`${orders}/${order._id}`).send({ status: 'shipped' })).status).toBe(422);
  });

  test('rules take actions away from records; the method says why it refuses', async () => {
    const order = await make('ACT-2');
    expect(offered((await agent.get(`${orders}/${order._id}`)).body._perm.actions)).toEqual(['markPaid', 'ship', 'cancel', 'advanceNext']);
    // Not paid yet: the host's refusal, with its message.
    const early = await run('ship', { ids: [order._id], input: { tracking: 'TRK-EARLY' } });
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ code: 'CONFLICT', message: 'Order ACT-2 is not paid yet: mark it paid first' });
    const paid = (await run('markPaid', { ids: [order._id] })).body;
    expect(paid).toMatchObject({ message: 'Order ACT-2 is paid', record: { status: 'paid' } });
    expect(offered(paid.record._perm.actions)).toEqual(['ship', 'advanceNext']);
    expect((await run('cancel', { ids: [order._id] })).status).toBe(403); // drafts only
    expect((await run('ship', { ids: [order._id], input: { tracking: 'x' } })).body).toMatchObject({ code: 'VALIDATION', fields: { tracking: expect.any(Array) } });
    const shipped = (await run('ship', { ids: [order._id], input: { tracking: 'TRK-2' } })).body.record;
    expect(shipped).toMatchObject({ status: 'shipped', tracking: 'TRK-2' });
    expect(offered(shipped._perm.actions)).toEqual([]);
  });

  test('a selection is shipped record by record', async () => {
    const paid = [await make('ACT-3'), await make('ACT-4')];
    const draft = await make('ACT-5');
    for (const order of paid) await run('markPaid', { ids: [order._id] });
    const result = await run('ship', { ids: [paid[0]!._id, draft._id, paid[1]!._id], input: { tracking: 'TRK-BULK' } });
    expect(result.body).toEqual({
      ok: [paid[0]!._id, paid[1]!._id],
      failed: [{ id: draft._id, code: 'CONFLICT', message: 'Order ACT-5 is not paid yet: mark it paid first' }],
      message: 'Shipped',
    });
  });

  test('the toolbar action runs without records and uses its default', async () => {
    expect((await run('cancelStaleDrafts', {})).body).toEqual({ message: 'No draft is older than 30 days' });
    expect((await run('cancelStaleDrafts', { input: { olderThanDays: 0 } })).status).toBe(422);
  });

  test('the toolbar action stays inside the row restrictions of query(): a restricted user only cancels their own drafts', async () => {
    const admin = app.get(OrderAdmin);
    const repository = app.get<Repository<Order>>(getRepositoryToken(Order));
    const mine = await make('STALE-MINE');
    const theirs = await make('STALE-THEIRS');
    const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await repository.update({ number: 'STALE-MINE' }, { customer: 'Mine', createdAt: longAgo });
    await repository.update({ number: 'STALE-THEIRS' }, { createdAt: longAgo });
    // What a host's `query()` override does: this user sees only their own orders.
    const restricted: OrderAdmin['query'] = (qb) => qb.andWhere(`${qb.alias}.customer = :mine`, { mine: 'Mine' });
    Object.defineProperty(admin, 'query', { value: restricted, configurable: true });
    try {
      expect((await agent.get(`${orders}/${theirs._id}`)).status).toBe(404);
      expect((await run('cancelStaleDrafts', { input: { olderThanDays: 90 } })).body).toEqual({ message: '1 stale drafts cancelled' });
    } finally {
      delete (admin as { query?: unknown }).query;
    }
    expect((await agent.get(`${orders}/${mine._id}`)).body.status).toBe('cancelled');
    expect((await agent.get(`${orders}/${theirs._id}`)).body.status).toBe('draft');
    // Unrestricted, the other one goes too.
    expect((await run('cancelStaleDrafts', { input: { olderThanDays: 90 } })).body).toEqual({ message: '1 stale drafts cancelled' });
    expect((await agent.get(`${orders}/${theirs._id}`)).body.status).toBe('cancelled');
  });
});

describe('shop settings (a settings page)', () => {
  const url = '/admin/api/pages/shop';
  const KEY = 'sk_test_demo_4242424242';

  test('values are saved key by key; the payment key is write-only', async () => {
    const { seedSettings } = await import('../src/seed.js');
    await seedSettings(app);
    const before = (await agent.get(url)).body;
    expect(before.values).toMatchObject({ shopName: 'Demo shop', lowStockThreshold: 5, logo: null });
    expect(before.secrets).toEqual({ paymentApiKey: false });
    expect(before.schema.fields.find((field: { name: string }) => field.name === 'paymentApiKey')).toMatchObject({ secret: true });

    const saved = await agent.patch(url).send({ lowStockThreshold: 9, paymentApiKey: KEY });
    expect(saved.status).toBe(200);
    expect(saved.body.values).toMatchObject({ shopName: 'Demo shop', lowStockThreshold: 9 });
    expect(saved.body.secrets).toEqual({ paymentApiKey: true });
    expect(JSON.stringify(saved.body)).not.toContain(KEY);
    expect(JSON.stringify((await agent.get(url)).body)).not.toContain(KEY);
    // The secret is where `save()` put it; another save without the key leaves it alone.
    expect((await agent.patch(url).send({ maintenance: true })).body.secrets).toEqual({ paymentApiKey: true });
    expect((await agent.patch(url).send({ paymentApiKey: '' })).status).toBe(422);
    expect((await agent.patch(url).send({ paymentApiKey: null })).body.secrets).toEqual({ paymentApiKey: false });
  });

  test("the page's own refusal names the field, never the value", async () => {
    const refused = await agent.patch(url).send({ paymentApiKey: 'pk_wrong_kind_of_key_123' });
    expect(refused.status).toBe(422);
    expect(refused.body.fields).toEqual({ paymentApiKey: ['must start with sk_'] });
    expect(JSON.stringify(refused.body)).not.toContain('pk_wrong_kind_of_key_123');
  });

  test('a logo is uploaded for the page, stored by its key, and cleared to null', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = await agent.post('/admin/api/uploads?resource=page:shop&field=logo').set('Content-Type', 'image/png').set('X-File-Name', 'logo.png').send(png);
    expect(upload.status).toBe(201);
    const saved = (await agent.patch(url).send({ logo: { token: upload.body.token } })).body;
    expect(saved.values.logo).toMatch(/^page\/shop\/logo\//);
    expect(saved.files.logo).toMatchObject({ name: 'logo.png', key: saved.values.logo });
    expect((await agent.get(`/admin/api/files/${saved.values.logo}`)).status).toBe(200);
    const cleared = (await agent.patch(url).send({ logo: null })).body;
    expect(cleared.values.logo).toBeNull();
    expect(cleared.files).toEqual({});
    expect((await agent.get(`/admin/api/files/${saved.values.logo}`)).status).toBe(404);
  });
});
