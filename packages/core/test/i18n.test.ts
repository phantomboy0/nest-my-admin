import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminGroup, AdminResource, AdminResourceBase } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { Customer, ORDER_ENTITIES, Order, Tag } from './fixtures/orders.js';

@AdminResource(Customer, { label: { en: 'Customers', fa: 'مشتریان' } })
class CustomerAdmin extends AdminResourceBase<Customer> {}

@AdminResource(Order, { label: { en: 'Orders', fa: 'سفارش‌ها' } })
class OrderAdmin extends AdminResourceBase<Order> {}

/** English only: Persian falls back to it. */
@AdminResource(Tag, { label: 'Tags' })
class TagAdmin extends AdminResourceBase<Tag> {}

@AdminGroup({ label: { en: 'Sales', fa: 'فروش' }, icon: 'cart' })
@Module({ providers: [CustomerAdmin, OrderAdmin, TagAdmin] })
class SalesModule {}

let app: INestApplication;
const get = (path: string, language?: string) => {
  const req = request(app.getHttpServer()).get(path);
  return language ? req.set('Accept-Language', language) : req;
};

beforeAll(async () => {
  app = await createTestApp({
    imports: [SalesModule],
    entities: ORDER_ENTITIES,
    admin: { title: { en: 'Shop', fa: 'فروشگاه' }, locale: 'en', locales: ['en', 'fa'], branding: { primaryColor: '#0f766e', radius: '0.25rem' } },
  });
});
afterAll(async () => {
  await app.close();
});

describe('labels per language (Review Focus 1, 3)', () => {
  test('meta follows Accept-Language and says so', async () => {
    const fa = await get('/admin/api/meta', 'fa-IR,fa;q=0.9');
    expect(fa.headers['content-language']).toBe('fa');
    expect(fa.headers.vary).toContain('Accept-Language');
    expect(fa.body).toMatchObject({ title: 'فروشگاه', locale: 'fa', locales: ['en', 'fa'] });
    const sales = fa.body.groups.find((group: { key: string }) => group.key === 'sales');
    expect(sales.label).toBe('فروش');
    expect(sales.resources.map((resource: { label: string }) => resource.label).sort()).toEqual(['Tags', 'سفارش‌ها', 'مشتریان'].sort());

    const en = await get('/admin/api/meta');
    expect(en.body).toMatchObject({ title: 'Shop', locale: 'en' });
    expect(en.body.groups.find((group: { key: string }) => group.key === 'sales').label).toBe('Sales');
    expect((await get('/admin/api/meta', 'de')).body.locale).toBe('en');
  });

  test('schemas follow it too, related list labels included', async () => {
    const fa = (await get('/admin/api/meta/resources/customer', 'fa')).body;
    expect(fa.label).toBe('مشتریان');
    expect(fa.related.map((related: { label: string }) => related.label)).toEqual(['سفارش‌ها (Customer)', 'سفارش‌ها (Seller)']);
    expect((await get('/admin/api/meta/resources/customer', 'en')).body.label).toBe('Customers');
  });

  test('the page carries locales and branding', async () => {
    const html = (await get('/admin/')).text;
    expect(html).toContain('"title":"Shop","locale":"en","locales":["en","fa"],"branding":{"primaryColor":"#0f766e","radius":"0.25rem"}');
  });
});
