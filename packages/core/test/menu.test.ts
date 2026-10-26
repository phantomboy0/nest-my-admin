import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { IsOptional, IsString } from 'class-validator';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  AdminSettingsPage,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminModuleOptions,
  type AdminPrincipal,
  type AdminSettingsSource,
  type AdminUserRecord,
  type FormConfig,
  type ListConfig,
  type MenuBadges,
  type MetaResponse,
  type RoleDefinition,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('menu_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) status: string;
  @Column({ length: 20 }) ownerId: string;
  @Column({ type: 'int', default: 0 }) margin: number;
}

@Entity('menu_order_line')
class OrderLine {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) item: string;
  @Column({ type: 'int' }) orderId: number;
  @ManyToOne(() => Order, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'orderId' }) order: Order;
}

@Entity('menu_ticket')
class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) state: string;
}

@Entity('menu_log')
class Log {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) line: string;
}

@AdminResource(OrderLine, { title: 'item' })
class OrderLineAdmin extends AdminResourceBase<OrderLine> {}

@AdminResource(Order, { title: 'status' })
class OrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = { filters: ['status', 'margin'] };
  override form: FormConfig = { layout: [{ fields: ['status', 'ownerId', 'margin'] }, { inline: OrderLineAdmin, display: 'table' }] };
  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
}

@AdminResource(Ticket, { title: 'state' })
class TicketAdmin extends AdminResourceBase<Ticket> {
  list: ListConfig<Ticket> = { filters: ['state'] };
}

@AdminResource(Log, { title: 'line' })
class LogAdmin extends AdminResourceBase<Log> {}

class LookDto {
  @IsOptional() @IsString() banner?: string;
}

@AdminSettingsPage('look', { form: LookDto })
class LookPage implements AdminSettingsSource<LookDto> {
  async load(): Promise<Partial<LookDto>> {
    return {};
  }
  async save(): Promise<void> {}
}

const users = new Map<string, AdminUserRecord>([
  ['root', { id: 'root', displayName: 'Root', username: 'root', isSuperuser: true, isActive: true }],
  ['clerk', { id: 'clerk', displayName: 'Clerk', username: 'clerk', isSuperuser: false, isActive: true }],
]);
const ROLES: RoleDefinition[] = [
  // Own orders only, no margin, no tickets, no logs, no page.
  { name: 'clerk', permissions: ['order.view'], fields: { order: { margin: 'hidden' } }, scopes: { order: { view: 'own' } } },
];

@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return user.id === 'clerk' ? ['clerk'] : [];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [TestAuth, OrderAdmin, OrderLineAdmin, TicketAdmin, LogAdmin, LookPage] })
class MenuModule {}

const MENU: NonNullable<AdminModuleOptions['menu']> = {
  sections: [
    {
      key: 'sales',
      label: { en: 'Sales', fa: 'فروش' },
      icon: 'shopping-cart',
      items: [
        { resource: 'order', badge: { 'filter[status][eq]': 'pending' } },
        { href: 'https://shop.example/', label: { en: 'Storefront', fa: 'فروشگاه' } },
      ],
    },
    { key: 'support', label: { en: 'Support', fa: 'پشتیبانی' }, icon: 'message-circle', items: [{ resource: 'ticket', badge: { 'filter[state][eq]': 'open' } }] },
    { key: 'settings', label: { en: 'Settings', fa: 'تنظیمات' }, icon: 'settings', items: [{ page: 'look' }] },
  ],
  advanced: { label: { en: 'Advanced', fa: 'پیشرفته' } },
};

async function boot(admin: Partial<AdminModuleOptions>): Promise<INestApplication> {
  return createTestApp({
    imports: [MenuModule],
    entities: [Order, OrderLine, Ticket, Log, ...ADMIN_RBAC_ENTITIES],
    admin: { auth: AdminAuth.custom(TestAuth), rbac: {}, roles: ROLES, locales: ['en', 'fa'], ...admin },
  });
}

let app: INestApplication;
const get = (user: string, path: string, locale = 'en') => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set('Accept-Language', locale);
const post = (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', 'root').send(body);

beforeAll(async () => {
  app = await boot({ menu: MENU });
  for (const [status, ownerId] of [['pending', 'clerk'], ['pending', 'other'], ['pending', 'other'], ['paid', 'clerk']]) {
    expect((await post('/resources/order', { status, ownerId })).status).toBe(201);
  }
  for (const state of ['open', 'open', 'closed']) expect((await post('/resources/ticket', { state })).status).toBe(201);
});
afterAll(async () => {
  await app.close();
});

describe(`curated menu (${TEST_DB})`, () => {
  test('comes back in the declared order, in the request language', async () => {
    const meta = (await get('root', '/meta', 'fa')).body as MetaResponse;
    expect(meta.menu!.sections.map((section) => section.key)).toEqual(['sales', 'support', 'settings']);
    expect(meta.menu!.sections[0]).toMatchObject({ key: 'sales', label: 'فروش', icon: 'shopping-cart' });
    expect(meta.menu!.sections[0]!.items).toEqual([
      { kind: 'resource', resource: 'order', label: 'Order', creatable: true, searchable: true, badge: true },
      { kind: 'link', href: 'https://shop.example/', label: 'فروشگاه' },
    ]);
    expect(meta.menu!.sections[2]!.items).toEqual([{ kind: 'page', page: 'look', label: 'Look' }]);
  });

  test('items the viewer cannot reach are cut, and so is a section left empty', async () => {
    const meta = (await get('clerk', '/meta')).body as MetaResponse;
    expect(meta.menu!.sections.map((section) => section.key)).toEqual(['sales']);
    expect(meta.menu!.sections[0]!.items.map((item) => item.kind)).toEqual(['resource', 'link']);
  });

  test('unplaced resources land in «advanced», collapsed; nav: false ones do not', async () => {
    const meta = (await get('root', '/meta')).body as MetaResponse;
    expect(meta.menu!.advanced).toMatchObject({ key: 'advanced', label: 'Advanced' });
    // `widget` comes with every test app; order-line is an inline child (nav: false).
    expect(meta.menu!.advanced.items.map((item) => (item.kind === 'resource' ? item.resource : item.kind))).toEqual(['widget', 'log']);
    expect((await get('clerk', '/meta')).body.menu.advanced.items).toEqual([]);
  });

  test('a badge counts only the rows inside the viewer’s scope', async () => {
    const root = (await get('root', '/menu/badges')).body as MenuBadges;
    expect(root).toEqual({ 'sales.order': { count: 3, estimate: false }, 'support.ticket': { count: 2, estimate: false } });
    const clerk = (await get('clerk', '/menu/badges')).body as MenuBadges;
    expect(clerk).toEqual({ 'sales.order': { count: 1, estimate: false } });
    expect((await request(app.getHttpServer()).get('/admin/api/menu/badges')).status).toBe(401);
  });

  test('a badge filtering on a field the viewer cannot see is left out, never counted', async () => {
    const hidden = await boot({ menu: { sections: [{ key: 'sales', label: 'Sales', icon: 'shopping-cart', items: [{ resource: 'order', badge: { 'filter[margin][gt]': '0' } }] }] } });
    try {
      expect((await request(hidden.getHttpServer()).get('/admin/api/menu/badges').set('X-User', 'root')).body).toEqual({ 'sales.order': { count: 0, estimate: false } });
      expect((await request(hidden.getHttpServer()).get('/admin/api/menu/badges').set('X-User', 'clerk')).body).toEqual({});
    } finally {
      await hidden.close();
    }
  });

  test('boot refuses an unknown badge filter, an unknown resource or page, and a nav: false resource', async () => {
    const section = (items: NonNullable<AdminModuleOptions['menu']>['sections'][number]['items']) => ({ menu: { sections: [{ key: 's', label: 'S', icon: 'box', items }] } });
    await expect(boot(section([{ resource: 'order', badge: { 'filter[ownerId][eq]': 'x' } }]))).rejects.toThrow('menu.sections.s: badge of order: filter[ownerId]');
    await expect(boot(section([{ resource: 'invoice' }]))).rejects.toThrow('menu.sections.s: unknown resource "invoice"');
    await expect(boot(section([{ page: 'nope' }]))).rejects.toThrow('menu.sections.s: unknown settings page "nope"');
    await expect(boot(section([{ resource: 'order-line' }]))).rejects.toThrow('menu.sections.s: order-line has no navigation entry (nav: false)');
    await expect(boot(section([{ href: 'javascript:alert(1)', label: 'x' }]))).rejects.toThrow('menu.sections.s: href must be an http(s) URL or a relative path');
  });

  test('without a menu, meta is what it was', async () => {
    const plain = await boot({});
    try {
      const meta = (await request(plain.getHttpServer()).get('/admin/api/meta').set('X-User', 'root')).body as MetaResponse;
      expect(meta).toEqual({
        schemaVersion: 1,
        title: 'Admin',
        locale: 'en',
        locales: ['en', 'fa'],
        groups: [
          { key: 'widgets', label: 'Inventory', icon: 'boxes', resources: [{ name: 'widget', label: 'Widget', creatable: true, searchable: true }], pages: [] },
          {
            key: 'menu',
            label: 'Menu',
            resources: [
              { name: 'log', label: 'Log', creatable: true, searchable: true },
              { name: 'order', label: 'Order', creatable: true, searchable: true },
              { name: 'ticket', label: 'Ticket', creatable: true, searchable: true },
            ],
            pages: [{ name: 'look', label: 'Look' }],
          },
        ],
      });
      expect((await request(plain.getHttpServer()).get('/admin/api/menu/badges').set('X-User', 'root')).body).toEqual({});
    } finally {
      await plain.close();
    }
  });
});
