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

@Entity('ip_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) number: string;
  @Column({ type: 'int', default: 0 }) total: number;
  @OneToMany(() => Line, (line) => line.order) lines: Line[];
}

@Entity('ip_line')
class Line {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) sku: string;
  @Column({ type: 'int', default: 0 }) position: number;
  @Column({ type: 'int' }) orderId: number;
  @ManyToOne(() => Order, (order) => order.lines, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'orderId' }) order: Relation<Order>;
}

let computeCalls = 0;

@AdminResource(Line, { title: 'sku' })
class LineAdmin extends AdminResourceBase<Line> {
  list: ListConfig<Line> = {
    computed: {
      code: {
        label: 'Code',
        kind: 'title',
        source: {
          compute: async (rows: Line[]) => {
            computeCalls++;
            return Object.fromEntries(rows.map((row) => [String(row.id), row.sku.toLowerCase()]));
          },
          fields: ['sku'],
        },
      },
    },
  };
}

@AdminResource(Order, { title: 'number' })
class OrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = { computed: { lineCount: { label: 'Items', kind: 'count', source: { aggregate: 'count', relation: 'lines' } } } };
  form: FormConfig = {
    layout: [
      { fields: ['number', 'total'] },
      { inline: LineAdmin, display: 'table', fields: ['sku'], order: 'position', readonly: true, computed: ['code'] },
      { section: 'Totals', summary: [{ label: { en: 'Total', fa: 'جمع' }, value: 'total' }, { label: 'Items', value: { computed: 'lineCount' } }] },
    ],
  };
}

const users = new Map<string, AdminUserRecord>(['root', 'noSku'].map((id) => [id, { id, displayName: id, username: id, isSuperuser: id === 'root', isActive: true }]));
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

@Module({ providers: [TestAuth, OrderAdmin, LineAdmin] })
class ShopModule {}

let app: INestApplication;
const api = (user = 'root') => ({
  get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user),
  post: (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', user).send(body),
  patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/admin/api${path}`).set('X-User', user).send(body),
});
let orderId: string;

beforeAll(async () => {
  app = await createTestApp({
    imports: [ShopModule],
    entities: [Order, Line, ...ADMIN_RBAC_ENTITIES],
    admin: {
      auth: AdminAuth.custom(TestAuth),
      rbac: {},
      // The SKU is hidden: the computed column that reads it is not theirs.
      roles: [{ name: 'noSku', permissions: ['order.view', 'line.view'], fields: { line: { sku: 'hidden' } } }],
    },
  });
  const order = (await api().post('/resources/order', { number: '#1', total: 90 })).body;
  orderId = order._id;
  for (const [index, sku] of ['A-1', 'B-2', 'C-3'].entries()) await api().post('/resources/line', { sku, position: index, orderId: order.id });
});
afterAll(async () => {
  await app.close();
});

describe(`inline presentation (${TEST_DB})`, () => {
  test('the schema: a read-only inline with its computed columns, and a summary', async () => {
    const schema = (await api().get('/meta/resources/order')).body as ResourceSchema;
    expect(schema.form.layout![1]).toMatchObject({ inline: 'line', readonly: true, computed: ['code'] });
    expect(schema.form.layout![2]).toEqual({ title: 'Totals', summary: [{ label: 'Total', value: { field: 'total' } }, { label: 'Items', value: { computed: 'lineCount' } }] });
  });

  test('inline rows carry their computed cells, one batch per parent; the summary’s computed values come along', async () => {
    computeCalls = 0;
    const record = (await api().get(`/resources/order/${orderId}`)).body;
    expect(computeCalls).toBe(1);
    expect(record._inlines.line.rows.map((row: { _computed: { code: { value: string } } }) => row._computed.code.value)).toEqual(['a-1', 'b-2', 'c-3']);
    expect(record._computed).toEqual({ lineCount: { value: 3 } });
  });

  test('a read-only inline refuses writes through its parent (422); its rows still read', async () => {
    const res = await api().patch(`/resources/order/${orderId}`, { _inlines: { line: { create: [{ _key: 'new-1', sku: 'X-9' }] } } });
    expect(res.status).toBe(422);
    expect(res.body.fields['_inlines.line']).toEqual(['Line rows are read-only here']);
    expect((await api().get(`/resources/order/${orderId}`)).body._inlines.line.rows).toHaveLength(3);
  });

  test('a computed column reading a field the viewer cannot see is cut from the inline and its rows', async () => {
    const schema = (await api('noSku').get('/meta/resources/order')).body as ResourceSchema;
    expect(schema.form.layout![1]).toMatchObject({ inline: 'line', computed: [] });
    const rows = (await api('noSku').get(`/resources/order/${orderId}`)).body._inlines.line.rows;
    expect(rows.every((row: { _computed?: unknown }) => row._computed === undefined)).toBe(true);
  });

  test('boot refuses an unknown computed key on an inline and an unknown summary value', async () => {
    const boot = async (form: FormConfig) => {
      @AdminResource(Order, { name: 'bad-order' })
      class BadAdmin extends AdminResourceBase<Order> {
        list: ListConfig<Order> = {};
        form = form;
      }
      @Module({ providers: [BadAdmin, LineAdmin] })
      class BadModule {}
      return createTestApp({ imports: [BadModule], entities: [Order, Line] });
    };
    await expect(boot({ layout: [{ inline: LineAdmin, display: 'table', computed: ['nope'] }] })).rejects.toThrow('computed: "nope" is not a list.computed column of Line');
    await expect(boot({ layout: [{ summary: [{ label: 'X', value: 'nope' }] }] })).rejects.toThrow('form.layout summary: unknown field "nope"');
    await expect(boot({ layout: [{ summary: [{ label: 'X', value: { computed: 'nope' } }] }] })).rejects.toThrow('"nope" is not a list.computed column');
  });
});
