import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type DataSource, type Relation } from 'typeorm';
import {
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUserRecord,
  type FieldsConfig,
  type ResourceSchema,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

const STEPS = ['queued', 'confirmed', 'preparing', 'ready', 'cancelled'] as const;

@Entity('st_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) number: string;
  @Column({ type: 'simple-enum', enum: [...STEPS], default: 'queued' }) fulfillment: string;
}

@Entity('st_log')
class Log {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) orderId: number;
  @ManyToOne(() => Order, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'orderId' }) order: Relation<Order>;
  @Column({ length: 20 }) field: string;
  @Column({ length: 20 }) value: string;
  @Column({ type: TEST_DB === 'postgres' ? 'timestamptz' : 'datetime' }) at: Date;
}

@AdminResource(Log)
class LogAdmin extends AdminResourceBase<Log> {}

@AdminResource(Order, { title: 'number' })
class OrderAdmin extends AdminResourceBase<Order> {
  fields: FieldsConfig<Order> = {
    fulfillment: { widget: 'stepper', exclude: ['cancelled'], history: { inline: LogAdmin, value: 'value', at: 'at', where: { field: 'fulfillment' } } },
  };
}

const users = new Map<string, AdminUserRecord>(['root', 'noTimes'].map((id) => [id, { id, displayName: id, username: id, isSuperuser: id === 'root', isActive: true }]));
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

@Module({ providers: [TestAuth, OrderAdmin, LogAdmin] })
class ShopModule {}

let app: INestApplication;
const get = (user: string, path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user);
let orderId: string;

beforeAll(async () => {
  app = await createTestApp({
    imports: [ShopModule],
    entities: [Order, Log, ...ADMIN_RBAC_ENTITIES],
    admin: {
      auth: AdminAuth.custom(TestAuth),
      rbac: {},
      // The log's times are hidden: no «reached at» for them.
      roles: [{ name: 'noTimes', permissions: ['order.view', 'log.view'], fields: { log: { at: 'hidden' } } }],
    },
  });
  const ds = app.get<DataSource>(getDataSourceToken());
  const order = await ds.getRepository(Order).save({ number: '#1', fulfillment: 'preparing' });
  orderId = String(order.id);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 10, minute));
  await ds.getRepository(Log).save([
    { orderId: order.id, field: 'fulfillment', value: 'queued', at: at(42) },
    { orderId: order.id, field: 'fulfillment', value: 'confirmed', at: at(45) },
    // Confirmed again later: the latest time counts.
    { orderId: order.id, field: 'fulfillment', value: 'confirmed', at: at(50) },
    { orderId: order.id, field: 'fulfillment', value: 'preparing', at: at(55) },
    // Another field's change in the same log: not a step of this one.
    { orderId: order.id, field: 'payment', value: 'ready', at: at(58) },
  ]);
});
afterAll(async () => {
  await app.close();
});

describe(`stepper (${TEST_DB})`, () => {
  test('the schema: the steps in order without the excluded values, and a history', async () => {
    const schema = (await get('root', '/meta/resources/order')).body as ResourceSchema;
    expect(schema.fields.find((field) => field.name === 'fulfillment')).toMatchObject({ widget: 'stepper', steps: { values: ['queued', 'confirmed', 'preparing', 'ready'], exclude: ['cancelled'], history: true } });
  });

  test('_steps: the latest time each value was reached, for this field only', async () => {
    const record = (await get('root', `/resources/order/${orderId}`)).body;
    expect(record._steps).toEqual({ queued: '2026-10-25T10:42:00.000Z', confirmed: '2026-10-25T10:50:00.000Z', preparing: '2026-10-25T10:55:00.000Z' });
  });

  test('without the log’s time field, no times', async () => {
    expect((await get('noTimes', `/resources/order/${orderId}`)).body._steps).toBeUndefined();
  });

  test('boot refuses the stepper on a non-enum field and steps that are not values', async () => {
    const boot = async (fields: FieldsConfig<Order>) => {
      @AdminResource(Order, { name: 'bad-order' })
      class BadAdmin extends AdminResourceBase<Order> {
        fields = fields;
      }
      @Module({ providers: [BadAdmin, LogAdmin] })
      class BadModule {}
      return createTestApp({ imports: [BadModule], entities: [Order, Log] });
    };
    await expect(boot({ number: { widget: 'stepper' } })).rejects.toThrow('the "stepper" widget does not fit string fields');
    await expect(boot({ fulfillment: { widget: 'stepper', steps: ['queued', 'shipped'] } })).rejects.toThrow('fields.fulfillment.steps: "shipped" is not one of');
    await expect(boot({ fulfillment: { widget: 'badge', exclude: ['cancelled'] } })).rejects.toThrow('steps, exclude and history go with the stepper widget');
  });
});
