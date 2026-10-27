import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IsString } from 'class-validator';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminAction, AdminResource, AdminResourceBase, type AdminContext, type ResourceSchema } from '../src/index.js';
import { resolveActions } from '../src/decorators/admin-action.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

const STEPS = ['queued', 'confirmed', 'preparing', 'ready', 'shipped'] as const;
const NEXT: Record<string, { en: string; fa: string } | undefined> = {
  queued: { en: 'Confirm', fa: 'تأیید' },
  confirmed: { en: 'Start preparing', fa: 'شروع آماده‌سازی' },
  preparing: { en: 'Move to «ready»', fa: 'انتقال به «آماده ارسال»' },
  ready: { en: 'Ship', fa: 'ارسال' },
};

@Entity('pa_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'simple-enum', enum: [...STEPS], default: 'queued' }) status: string;
}

@AdminResource(Order, { title: 'status' })
class OrderAdmin extends AdminResourceBase<Order> {
  @AdminAction({ primary: true, label: { static: { en: 'Next step', fa: 'مرحله بعد' }, for: (order: Order) => NEXT[order.status] ?? null } })
  async advance(order: Order, _input: unknown, ctx: AdminContext) {
    await ctx.manager!.getRepository(Order).update(order.id, { status: STEPS[STEPS.indexOf(order.status as (typeof STEPS)[number]) + 1] });
  }

  @AdminAction({ label: 'Print' })
  async print() {}
}

@Module({ providers: [OrderAdmin] })
class OrdersModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp({ imports: [OrdersModule], entities: [Order], admin: { locales: ['en', 'fa'] } });
});
afterAll(async () => {
  await app.close();
});

describe(`primary actions with per-record labels (${TEST_DB})`, () => {
  test('the schema marks the primary action and names it with its static label', async () => {
    const schema = (await http().get('/admin/api/meta/resources/order')).body as ResourceSchema;
    expect(schema.actions.find((action) => action.name === 'advance')).toMatchObject({ label: 'Next step', primary: true, target: 'record' });
    expect(schema.actions.find((action) => action.name === 'print')!.primary).toBeUndefined();
  });

  test('each record names the action in the request language; null hides it there', async () => {
    const created = (await http().post('/admin/api/resources/order').send({ status: 'preparing' })).body;
    const fa = await http().get(`/admin/api/resources/order/${created._id}`).set('Accept-Language', 'fa');
    expect(fa.body._perm.actions).toEqual({ advance: 'انتقال به «آماده ارسال»', print: 'Print' });
    const shipped = (await http().post('/admin/api/resources/order').send({ status: 'shipped' })).body;
    expect((await http().get(`/admin/api/resources/order/${shipped._id}`)).body._perm.actions).toEqual({ advance: false, print: 'Print' });
    // And a run there is refused like an unknown action.
    expect((await http().post('/admin/api/resources/order/actions/advance').send({ ids: [shipped._id] })).status).toBe(404);
    const run = await http().post('/admin/api/resources/order/actions/advance').send({ ids: [created._id] });
    expect(run.status).toBe(200);
    expect(run.body.record).toMatchObject({ status: 'ready', _perm: { actions: { advance: 'Ship' } } });
  });

  test('boot refuses two primaries, a primary resource action, a primary with input, and a per-record label without static', () => {
    class Input {
      @IsString() note: string;
    }
    const check = (decorate: (target: Function) => void) => {
      class Admin extends AdminResourceBase<Order> {}
      decorate(Admin);
      return () =>
        resolveActions(Admin, [], (message) => {
          throw new Error(message);
        });
    };
    const define = (target: Function, name: string, options: Parameters<typeof AdminAction>[0]) => {
      target.prototype[name] = async () => undefined;
      AdminAction(options)(target.prototype, name, Object.getOwnPropertyDescriptor(target.prototype, name)!);
    };
    expect(check((target) => (define(target, 'a', { primary: true }), define(target, 'b', { primary: true })))).toThrow('only one action can be `primary` (a, b)');
    expect(check((target) => define(target, 'a', { primary: true, target: 'resource' }))).toThrow('resource actions cannot be primary');
    expect(check((target) => define(target, 'a', { primary: true, input: Input }))).toThrow('takes no `input`');
    expect(check((target) => define(target, 'a', { label: { for: () => 'x' } as never }))).toThrow('a per-record label needs `static`');
  });
});
