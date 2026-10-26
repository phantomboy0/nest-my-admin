import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUserRecord,
  type FormConfig,
  type ListConfig,
  type ResourceSchema,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('rl_customer')
class Customer {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ length: 20 }) phone: string;
}

@Entity('rl_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) number: string;
  @Column({ type: 'simple-enum', enum: ['queued', 'paid'], default: 'queued' }) status: string;
  @Column({ type: 'int', default: 0 }) total: number;
  @Column({ length: 200, default: '' }) notes: string;
  @Column({ type: 'int', nullable: true }) customerId: number | null;
  @ManyToOne(() => Customer, { nullable: true }) @JoinColumn({ name: 'customerId' }) customer: Customer | null;
  @OneToMany(() => Line, (line) => line.order) lines: Line[];
}

@Entity('rl_line')
class Line {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) orderId: number;
  @ManyToOne(() => Order, (order) => order.lines) @JoinColumn({ name: 'orderId' }) order: Relation<Order>;
}

@AdminResource(Customer, { title: 'name' })
class CustomerAdmin extends AdminResourceBase<Customer> {}

@AdminResource(Line)
class LineAdmin extends AdminResourceBase<Line> {}

@AdminResource(Order, { title: 'number' })
class OrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = { computed: { lines: { label: 'Items', kind: 'count', source: { aggregate: 'count', relation: 'lines' } } } };
  form: FormConfig = {
    mode: 'view',
    layout: {
      main: [{ section: 'Order', fields: ['number', 'notes'] }],
      aside: [
        { title: { en: 'Payment', fa: 'پرداخت' }, icon: 'credit-card', fields: ['status', 'total'] },
        { title: 'Customer', fields: { relation: 'customerId', fields: ['name', 'phone'] }, link: true },
      ],
    },
    header: { badges: ['status'], subtitle: ['number', { computed: 'lines' }] },
  };
}

const users = new Map<string, AdminUserRecord>(['root', 'clerk', 'nameOnly'].map((id) => [id, { id, displayName: id, username: id, isSuperuser: id === 'root', isActive: true }]));
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

@Module({ providers: [TestAuth, OrderAdmin, CustomerAdmin, LineAdmin] })
class ShopModule {}

let app: INestApplication;
const get = (user: string, path: string, locale = 'en') => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set('Accept-Language', locale);
let orderId: string;

beforeAll(async () => {
  app = await createTestApp({
    imports: [ShopModule],
    entities: [Customer, Order, Line, ...ADMIN_RBAC_ENTITIES],
    admin: {
      auth: AdminAuth.custom(TestAuth),
      rbac: {},
      locales: ['en', 'fa'],
      roles: [
        // No customers, no total.
        { name: 'clerk', permissions: ['order.view', 'line.view'], fields: { order: { total: 'hidden' } } },
        // Customers, without their phone.
        { name: 'nameOnly', permissions: ['order.view', 'customer.view', 'line.view'], fields: { customer: { phone: 'hidden' } } },
      ],
    },
  });
  const post = (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', 'root').send(body);
  const customer = (await post('/resources/customer', { name: 'Sara', phone: '0912' })).body;
  const order = (await post('/resources/order', { number: '#1042', status: 'paid', total: 3668, customerId: customer.id })).body;
  orderId = order._id;
  for (let i = 0; i < 3; i++) await post('/resources/line', { orderId: order.id });
});
afterAll(async () => {
  await app.close();
});

describe(`record layout (${TEST_DB})`, () => {
  test('the schema: main sections, aside cards (localized), view mode and the header', async () => {
    const schema = (await get('root', '/meta/resources/order', 'fa')).body as ResourceSchema;
    expect(schema.form.layout!.map((node) => ('fields' in node ? node.fields : []))).toEqual([['number', 'notes']]);
    expect(schema.form.aside).toEqual([
      { title: 'پرداخت', icon: 'credit-card', fields: ['status', 'total'] },
      { title: 'Customer', fields: ['name', 'phone'], relation: { field: 'customerId', resource: 'customer', link: true } },
    ]);
    expect(schema.form.mode).toBe('view');
    expect(schema.form.header).toEqual({ badges: ['status'], subtitle: [{ field: 'number' }, { computed: 'lines' }] });
  });

  test('a record carries its relation cards (_aside) and its header’s computed values (_computed)', async () => {
    const record = (await get('root', `/resources/order/${orderId}`)).body;
    expect(record._aside).toEqual({ '1': { _id: expect.any(String), _title: 'Sara', name: 'Sara', phone: '0912' } });
    expect(record._computed).toEqual({ lines: { value: 3 } });
  });

  test('aside cards, their fields and the header are cut by permission', async () => {
    const clerk = (await get('clerk', '/meta/resources/order')).body as ResourceSchema;
    expect(clerk.form.aside).toEqual([{ title: 'Payment', icon: 'credit-card', fields: ['status'] }]);
    expect((await get('clerk', `/resources/order/${orderId}`)).body._aside).toBeUndefined();
    const nameOnly = (await get('nameOnly', '/meta/resources/order')).body as ResourceSchema;
    expect(nameOnly.form.aside![1]).toMatchObject({ fields: ['name'] });
    expect((await get('nameOnly', `/resources/order/${orderId}`)).body._aside).toEqual({ '1': { _id: expect.any(String), _title: 'Sara', name: 'Sara' } });
  });

  test('boot refuses unknown fields, a relation that is not to-one, and fields the related resource does not have', async () => {
    const boot = async (form: FormConfig) => {
      @AdminResource(Order, { name: 'bad-order' })
      class BadAdmin extends AdminResourceBase<Order> {
        form = form;
      }
      @Module({ providers: [BadAdmin, CustomerAdmin, LineAdmin] })
      class BadModule {}
      return createTestApp({ imports: [BadModule], entities: [Customer, Order, Line] });
    };
    await expect(boot({ layout: { main: [], aside: [{ title: 'X', fields: ['nope'] }] } })).rejects.toThrow('form.layout.aside[0]: unknown field "nope" on Order');
    await expect(boot({ layout: { main: [], aside: [{ title: 'X', fields: { relation: 'number', fields: ['name'] } }] } })).rejects.toThrow('"number" is not a to-one relation field of Order');
    await expect(boot({ layout: { main: [], aside: [{ title: 'X', fields: { relation: 'customerId', fields: ['email'] } }] } })).rejects.toThrow('unknown field "email" on customer');
    await expect(boot({ header: { subtitle: [{ computed: 'nope' }] } })).rejects.toThrow('form.header.subtitle: "nope" is not a list.computed column');
  });
});
