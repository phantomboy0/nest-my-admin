import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { BadRequestException, ConflictException, Injectable, Module, type INestApplication } from '@nestjs/common';
import { IsArray, IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, DeleteDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import {
  AdminAction,
  AdminAuth,
  AdminCan,
  AdminField,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  type ActionOutcome,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminPrincipal,
  type AdminUserRecord,
} from '../src/index.js';
import type { ActionSchema, PermissionExplanation, ResourceSchema } from '../src/contract.js';
import { AdminPolicy } from '../src/policy/admin-policy.service.js';
import { buildCatalog } from '../src/policy/catalog.js';
import { knownCodes } from '../src/policy/roles.js';
import { ResourceRegistry } from '../src/registry/resource-registry.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

/** The record actions `_perm.actions` lets run (its names whose value is a label, not false). */
const offered = (actions: Record<string, string | false> | undefined) => Object.entries(actions ?? {}).flatMap(([name, label]) => (label === false ? [] : [name]));

@Entity('act_order')
class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ length: 10 }) ownerId: string;
  @Column({ length: 12, default: 'draft' }) status: string;
  @Column({ type: 'varchar', length: 40, nullable: true }) tracking: string | null;
}

class ShipDto {
  @AdminField({ label: { en: 'Tracking code', fa: 'کد رهگیری' } })
  @IsString()
  @Length(3, 20)
  tracking: string;

  @IsOptional()
  @IsBoolean()
  notify?: boolean = true;
}

/** What the action methods saw, so tests can tell a refused call from one that ran. */
const calls: Array<{ action: string; id?: number; input?: unknown; inTransaction: boolean }> = [];

@AdminResource(Order, { title: 'name' })
class OrderAdmin extends AdminResourceBase<Order> {
  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }

  @AdminAction({ label: { en: 'Mark shipped', fa: 'ارسال شد' }, bulk: true, input: ShipDto, icon: 'truck' })
  async ship(order: Order, input: ShipDto, ctx: AdminContext): Promise<ActionOutcome> {
    calls.push({ action: 'ship', id: order.id, input: { ...input }, inTransaction: ctx.manager !== undefined });
    if (order.status === 'shipped') throw new ConflictException('This order is already shipped');
    await this.repositoryFor(ctx).update(order.id, { status: 'shipped', tracking: input.tracking });
    if (input.tracking === 'EXPLODE') throw new BadRequestException('The courier refused the parcel');
    return { message: { en: 'Shipped', fa: 'ارسال شد' } };
  }
  @AdminCan('ship') notCancelled(order: Order) {
    return order.status !== 'cancelled';
  }

  @AdminAction({ variant: 'destructive', confirm: { en: 'Cancel this order?', fa: 'این سفارش لغو شود؟' } })
  async cancel(order: Order, _input: unknown, ctx: AdminContext): Promise<void> {
    calls.push({ action: 'cancel', id: order.id, inTransaction: ctx.manager !== undefined });
    await this.repositoryFor(ctx).update(order.id, { status: 'cancelled' });
  }
  @AdminCan('cancel') onlyDrafts(order: Order) {
    return order.status === 'draft';
  }

  @AdminAction({ bulk: true, atomic: true, confirm: true })
  async archive(order: Order, _input: unknown, ctx: AdminContext): Promise<ActionOutcome> {
    calls.push({ action: 'archive', id: order.id, inTransaction: ctx.manager !== undefined });
    await this.repositoryFor(ctx).update(order.id, { status: 'archived' });
    return { message: 'Archived' };
  }

  /** Hands the record to someone else: afterwards its old owner cannot see it. */
  @AdminAction()
  async handOver(order: Order, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(order.id, { ownerId: 'u2' });
  }

  @AdminAction({ target: 'resource', label: 'Recount' })
  async recount(input: unknown, ctx: AdminContext): Promise<ActionOutcome> {
    calls.push({ action: 'recount', input, inTransaction: ctx.manager !== undefined });
    return { message: `Counted ${await this.repositoryFor(ctx).count()} orders` };
  }
}

/** A composite key and a trash, for the id handling of actions. */
@Entity('act_parcel')
class Parcel {
  @PrimaryColumn({ length: 10 }) depot: string;
  @PrimaryColumn({ type: 'int' }) no: number;
  @Column({ length: 40 }) name: string;
  @Column({ length: 12, default: 'new' }) state: string;
  @DeleteDateColumn() deletedAt: Date | null;
}

class LabelDto {
  @IsArray()
  @IsString({ each: true })
  tags: string[];
}

/** The tags each `label` run was handed, before it added its own. */
const labelled: Array<{ parcel: string; tags: string[] }> = [];

@AdminResource(Parcel, { title: 'name' })
class ParcelAdmin extends AdminResourceBase<Parcel> {
  @AdminAction({ bulk: true, input: LabelDto })
  async label(parcel: Parcel, input: LabelDto, ctx: AdminContext): Promise<void> {
    labelled.push({ parcel: parcel.name, tags: [...input.tags] });
    input.tags.push(parcel.name); // must not reach the next record
    await this.repositoryFor(ctx).update({ depot: parcel.depot, no: parcel.no }, { state: 'labelled' });
    if (parcel.name === 'BOOM') throw new BadRequestException('The printer jammed');
  }

  @AdminAction({ bulk: true, atomic: true })
  async seal(parcel: Parcel, _input: unknown, ctx: AdminContext): Promise<void> {
    calls.push({ action: 'seal', inTransaction: ctx.manager !== undefined });
    await this.repositoryFor(ctx).update({ depot: parcel.depot, no: parcel.no }, { state: 'sealed' });
  }
  @AdminCan('seal') notSealed(parcel: Parcel) {
    return parcel.state !== 'sealed';
  }
}

const users = new Map<string, AdminUserRecord>();
for (const [id, isSuperuser] of [['root', true], ['u1', false], ['u2', false], ['editor', false], ['wild', false], ['shipper', false], ['counter', false], ['blind', false]] as const) {
  users.set(id, { id, displayName: id.toUpperCase(), username: id, isSuperuser, isActive: true });
}
const ROLES_OF: Record<string, string[]> = { u1: ['clerk'], u2: ['clerk'], editor: ['editor'], wild: ['wild'], shipper: ['shipper'], counter: ['counter'], blind: ['blind'] };

@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return ROLES_OF[String(user.id)] ?? [];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [HeaderAuth, OrderAdmin, ParcelAdmin] })
class ActionsModule {}

const ROLES = [
  // Own rows only; every action but `recount`.
  {
    name: 'clerk',
    permissions: ['order.view', 'order.update', 'order.action.ship', 'order.action.cancel', 'order.action.archive', 'order.action.handOver'],
    scopes: { order: { view: 'own', update: 'own' } },
  },
  // Review Focus 2: may view and update, holds no action.
  { name: 'editor', permissions: ['order.view', 'order.update'] },
  { name: 'wild', permissions: ['order.*'] },
  // Holds the action but not `order.update`.
  { name: 'shipper', permissions: ['order.view', 'order.action.ship'] },
  { name: 'counter', permissions: ['order.view', 'order.action.recount'] },
  { name: 'blind', permissions: ['order.action.recount'] },
];

let app: INestApplication;
const api = (user: string, headers: Record<string, string> = {}) => ({
  get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set(headers),
  post: (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', user).set(headers).send(body),
});
const run = (user: string, action: string, body: object = {}, headers: Record<string, string> = {}) => api(user, headers).post(`/resources/order/actions/${action}`, body);
const order = async (values: { name: string; ownerId?: string; status?: string }): Promise<string> => {
  const res = await api('root').post('/resources/order', { ownerId: 'u1', ...values });
  expect(res.status).toBe(201);
  return res.body._id as string;
};
const stored = async (id: string) => (await api('root').get(`/resources/order/${id}`)).body as { status: string; tracking: string | null; ownerId: string };
const schemaFor = async (user: string, headers: Record<string, string> = {}) => (await api(user, headers).get('/meta/resources/order')).body as ResourceSchema;
const actionNames = (schema: ResourceSchema) => schema.actions.map((action) => action.name);

beforeAll(async () => {
  app = await createTestApp({ imports: [ActionsModule], entities: [Order, Parcel], admin: { auth: AdminAuth.custom(HeaderAuth), roles: ROLES, locales: ['en', 'fa'] } });
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  calls.length = 0;
  labelled.length = 0;
});

describe(`action schema (${TEST_DB})`, () => {
  test('lists every action with its dialog and input form', async () => {
    const schema = await schemaFor('root');
    expect(actionNames(schema)).toEqual(['ship', 'cancel', 'archive', 'handOver', 'recount']);
    const ship: ActionSchema = schema.actions[0]!;
    expect(ship).toEqual({
      name: 'ship',
      label: 'Mark shipped',
      target: 'record',
      bulk: true,
      atomic: false,
      variant: 'default',
      icon: 'truck',
      input: {
        fields: [
          { name: 'tracking', label: 'Tracking code', type: 'string', nullable: false, primary: false, readonly: false, persisted: false },
          { name: 'notify', label: 'Notify', type: 'boolean', nullable: true, primary: false, readonly: false, persisted: false },
        ],
        constraints: { tracking: { minLength: 3, maxLength: 20, required: true }, notify: {} },
        required: ['tracking'],
      },
    });
    expect(schema.actions[1]).toEqual({ name: 'cancel', label: 'Cancel', target: 'record', bulk: false, atomic: false, confirm: 'Cancel this order?', variant: 'destructive' });
    expect(schema.actions[2]).toEqual({ name: 'archive', label: 'Archive', target: 'record', bulk: true, atomic: true, confirm: true, variant: 'default' });
    expect(schema.actions[3]).toEqual({ name: 'handOver', label: 'Hand over', target: 'record', bulk: false, atomic: false, variant: 'default' });
    expect(schema.actions[4]).toEqual({ name: 'recount', label: 'Recount', target: 'resource', bulk: false, atomic: false, variant: 'default' });
  });

  test('labels, questions and input labels follow the request language', async () => {
    const schema = await schemaFor('root', { 'Accept-Language': 'fa' });
    expect(schema.actions[0]!.label).toBe('ارسال شد');
    expect(schema.actions[0]!.input!.fields[0]!.label).toBe('کد رهگیری');
    expect(schema.actions[1]!.confirm).toBe('این سفارش لغو شود؟');
  });

  test('is cut to the actions the user may run (Review Focus 2)', async () => {
    expect(actionNames(await schemaFor('u1'))).toEqual(['ship', 'cancel', 'archive', 'handOver']);
    expect(actionNames(await schemaFor('editor'))).toEqual([]);
    expect(actionNames(await schemaFor('counter'))).toEqual(['recount']);
    // `order.*` covers `order.action.<name>`, like every other code of the resource.
    expect(actionNames(await schemaFor('wild'))).toEqual(['ship', 'cancel', 'archive', 'handOver', 'recount']);
    // A record action also needs `order.update`: it changes records.
    expect(actionNames(await schemaFor('shipper'))).toEqual([]);
  });
});

describe(`running an action on one record (${TEST_DB})`, () => {
  test('answers the reloaded record and the message, inside the write transaction', async () => {
    const id = await order({ name: 'One' });
    const res = await run('u1', 'ship', { ids: [id], input: { tracking: 'TRK-1' } });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Shipped');
    expect(res.body.record).toMatchObject({ _id: id, name: 'One', status: 'shipped', tracking: 'TRK-1' });
    expect(offered(res.body.record._perm.actions)).toEqual(['ship', 'archive', 'handOver']); // no longer a draft: `cancel` is gone
    expect(calls).toEqual([{ action: 'ship', id: Number(id), input: { tracking: 'TRK-1', notify: true }, inTransaction: true }]);
    expect((await run('u1', 'ship', { ids: [id], input: { tracking: 'TRK-2' } }, { 'Accept-Language': 'fa' })).status).toBe(409);
  });

  test('the message follows the request language; an action may return nothing', async () => {
    const id = await order({ name: 'Fa' });
    expect((await run('u1', 'ship', { ids: [id], input: { tracking: 'TRK-9' } }, { 'Accept-Language': 'fa' })).body.message).toBe('ارسال شد');
    const draft = await order({ name: 'Draft' });
    const cancelled = await run('u1', 'cancel', { ids: [draft] });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.message).toBeUndefined();
    expect(cancelled.body.record.status).toBe('cancelled');
  });

  test('a role with view and update but without the action gets 403 (Review Focus 2)', async () => {
    const id = await order({ name: 'Not mine to ship' });
    const res = await run('editor', 'ship', { ids: [id], input: { tracking: 'TRK-1' } });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
    expect((await stored(id)).status).toBe('draft');
    // Holding the action without `order.update` is not enough either.
    expect((await run('shipper', 'ship', { ids: [id], input: { tracking: 'TRK-1' } })).status).toBe(403);
    expect(calls).toEqual([]);
    // `order.*` holds it.
    expect((await run('wild', 'ship', { ids: [id], input: { tracking: 'TRK-1' } })).status).toBe(200);
  });

  test('a record outside the scopes is not found; a rule that says no is 403', async () => {
    const theirs = await order({ name: 'Theirs', ownerId: 'u2' });
    const res = await run('u1', 'ship', { ids: [theirs], input: { tracking: 'TRK-1' } });
    expect(res.status).toBe(404);
    expect((await run('u1', 'ship', { ids: ['999999'], input: { tracking: 'TRK-1' } })).body).toMatchObject({ code: 'NOT_FOUND', message: res.body.message.replace(theirs, '999999') });
    const shipped = await order({ name: 'Shipped', status: 'shipped' });
    const refused = await run('u1', 'cancel', { ids: [shipped] });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
    // Superusers are not above `@AdminCan`: it is a business rule.
    expect((await run('root', 'cancel', { ids: [shipped] })).status).toBe(403);
  });

  test('input errors are 422 with field errors and the method never runs (Review Focus 3)', async () => {
    const id = await order({ name: 'Input' });
    const bad = async (input: unknown) => {
      const res = await run('u1', 'ship', { ids: [id], ...(input === undefined ? {} : { input }) });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION');
      return res.body.fields as Record<string, string[]>;
    };
    expect(Object.keys(await bad({ tracking: 'TRK-1', extra: 1 }))).toEqual(['extra']);
    expect(Object.keys(await bad({ tracking: 42 }))).toEqual(['tracking']);
    expect(Object.keys(await bad({ tracking: 'TRK-1', notify: 'yes' }))).toEqual(['notify']);
    expect(Object.keys(await bad({}))).toEqual(['tracking']);
    expect(Object.keys(await bad(undefined))).toEqual(['tracking']);
    // An action without an input DTO takes no input.
    const res = await run('u1', 'cancel', { ids: [id], input: { reason: 'x' } });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ reason: ['is not a writable field'] });
    expect((await run('u1', 'ship', { ids: [id], input: 'TRK-1' })).status).toBe(400);
    expect(calls).toEqual([]);
    expect((await stored(id)).status).toBe('draft');
  });

  test('a host HttpException passes through, and what the method wrote is rolled back', async () => {
    const id = await order({ name: 'Boom' });
    const res = await run('u1', 'ship', { ids: [id], input: { tracking: 'EXPLODE' } });
    // error-response.ts: host HttpExceptions keep their status and message; 400 is BUSINESS_RULE, 409 is CONFLICT.
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'BUSINESS_RULE', message: 'The courier refused the parcel' });
    expect(await stored(id)).toMatchObject({ status: 'draft', tracking: null });
    const shipped = await order({ name: 'Twice', status: 'shipped' });
    const conflict = await run('u1', 'ship', { ids: [shipped], input: { tracking: 'TRK-1' } });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ code: 'CONFLICT', message: 'This order is already shipped' });
  });

  test('a record the action moved out of the user\'s scopes is answered as null', async () => {
    const id = await order({ name: 'Leaving' });
    const res = await run('u1', 'handOver', { ids: [id] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ record: null });
    expect((await stored(id)).ownerId).toBe('u2');
  });

  test('bad requests', async () => {
    const id = await order({ name: 'Bad' });
    const other = await order({ name: 'Bad 2' });
    expect((await run('u1', 'nope', { ids: [id] })).status).toBe(404);
    expect((await run('u1', 'delete', { ids: [id] })).status).toBe(404);
    const message = { ids: ['must be a list of 1 to 100 record ids'] };
    for (const body of [{}, { ids: [] }, { ids: [1] }, { ids: id }, { ids: Array.from({ length: 101 }, (_, index) => String(index)) }]) {
      const res = await run('u1', 'archive', body);
      expect(res.status).toBe(422);
      expect(res.body.fields).toEqual(message);
    }
    // `cancel` is not a bulk action.
    const several = await run('u1', 'cancel', { ids: [id, other] });
    expect(several.status).toBe(400);
    expect(several.body.code).toBe('BAD_REQUEST');
    expect((await run('u1', 'cancel', { ids: [id], more: true })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test('view-as is read-only', async () => {
    const id = await order({ name: 'Watched' });
    const res = await run('root', 'cancel', { ids: [id] }, { 'X-View-As': 'u1' });
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
    expect((await stored(id)).status).toBe('draft');
    // The schema is the target's: they see what that user may run.
    expect(actionNames(await schemaFor('root', { 'X-View-As': 'editor' }))).toEqual([]);
  });
});

describe(`bulk actions (${TEST_DB}, Review Focus 1)`, () => {
  test('non-atomic: an id out of scope and one a rule refuses fail on their own, the others run', async () => {
    const first = await order({ name: 'B1' });
    const theirs = await order({ name: 'B2', ownerId: 'u2' });
    const cancelled = await order({ name: 'B3', status: 'cancelled' });
    const shipped = await order({ name: 'B4', status: 'shipped' });
    const last = await order({ name: 'B5' });
    const res = await run('u1', 'ship', { ids: [first, theirs, cancelled, shipped, last], input: { tracking: 'TRK-B' } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: [first, last],
      failed: [
        { id: theirs, code: 'NOT_FOUND', message: expect.stringContaining('not found') },
        { id: cancelled, code: 'FORBIDDEN', message: expect.stringContaining('Mark shipped') },
        { id: shipped, code: 'CONFLICT', message: 'This order is already shipped' },
      ],
      message: 'Shipped',
    });
    expect(calls.map((call) => call.id)).toEqual([Number(first), Number(shipped), Number(last)]);
    expect(calls.every((call) => call.inTransaction)).toBe(true);
    expect((await stored(first)).status).toBe('shipped');
    expect((await stored(last)).tracking).toBe('TRK-B');
    expect(await stored(theirs)).toMatchObject({ status: 'draft', tracking: null });
    expect((await stored(cancelled)).status).toBe('cancelled');
  });

  test('atomic: one id out of scope answers 404 and nothing is applied', async () => {
    const first = await order({ name: 'A1' });
    const theirs = await order({ name: 'A2', ownerId: 'u2' });
    const last = await order({ name: 'A3' });
    const res = await run('u1', 'archive', { ids: [first, theirs, last] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    // Every record is checked before any method runs: the refusal does not lean on the rollback.
    expect(calls).toEqual([]);
    for (const id of [first, theirs, last]) expect((await stored(id)).status).toBe('draft');
    const done = await run('u1', 'archive', { ids: [first, last, first] });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ ok: [first, last], failed: [], message: 'Archived' });
    for (const id of [first, last]) expect((await stored(id)).status).toBe('archived');
  });
});

describe(`record ids (${TEST_DB})`, () => {
  let serial = 0;
  const parcel = async (name: string, state = 'new'): Promise<string> => {
    const res = await api('root').post('/resources/parcel', { depot: 'D1', no: ++serial, name, state });
    expect(res.status).toBe(201);
    return res.body._id as string;
  };
  const runParcel = (action: string, body: object) => api('root').post(`/resources/parcel/actions/${action}`, body);
  const stateOf = async (id: string) => (await api('root').get(`/resources/parcel/${encodeURIComponent(id)}`)).body.state as string;

  test('composite keys: single and bulk runs take the encoded id', async () => {
    const one = await parcel('C1');
    const two = await parcel('C2');
    expect(one).toBe(`D1,${serial - 1}`);
    const single = await runParcel('label', { ids: [one], input: { tags: ['a'] } });
    expect(single.status).toBe(200);
    expect(single.body.record).toMatchObject({ _id: one, state: 'labelled' });
    expect((await runParcel('seal', { ids: [one, two] })).body).toEqual({ ok: [one, two], failed: [] });
    expect(await stateOf(two)).toBe('sealed');
    expect((await runParcel('label', { ids: ['D1'], input: { tags: [] } })).status).toBe(404);
  });

  test('two spellings of one id run once, under the first spelling', async () => {
    const id = await order({ name: 'Alias' });
    const other = await order({ name: 'Alias 2' });
    const res = await run('u1', 'archive', { ids: [id, `0${id}`, other, `00${other}`] });
    expect(res.body).toEqual({ ok: [id, other], failed: [], message: 'Archived' });
    expect(calls.map((call) => call.id)).toEqual([Number(id), Number(other)]);
    // One record under two spellings is one record: the single answer, and fine for an action that is not bulk.
    const draft = await order({ name: 'Alias 3' });
    const single = await run('u1', 'cancel', { ids: [`0${draft}`, draft] });
    expect(single.status).toBe(200);
    expect(single.body.record).toMatchObject({ _id: draft, status: 'cancelled' });
    const first = await parcel('A1');
    const no = first.split(',')[1]!;
    expect((await runParcel('label', { ids: [first, `D1,0${no}`, 'D1,x'], input: { tags: [] } })).body).toEqual({
      ok: [first],
      failed: [{ id: 'D1,x', code: 'NOT_FOUND', message: expect.stringContaining('not found') }],
    });
    expect(labelled).toEqual([{ parcel: 'A1', tags: [] }]);
  });

  test('a record in the trash is not found', async () => {
    const binned = await parcel('Binned');
    const kept = await parcel('Kept');
    expect((await api('root').post('/resources/parcel/bulk-delete', { ids: [binned] })).body.ok).toEqual([binned]);
    const single = await runParcel('label', { ids: [binned], input: { tags: [] } });
    expect(single.status).toBe(404);
    expect(single.body.code).toBe('NOT_FOUND');
    expect((await runParcel('label', { ids: [binned, kept], input: { tags: [] } })).body).toEqual({
      ok: [kept],
      failed: [{ id: binned, code: 'NOT_FOUND', message: expect.stringContaining('not found') }],
    });
    expect((await runParcel('seal', { ids: [kept, binned] })).status).toBe(404);
    expect(calls).toEqual([]);
    expect(labelled.map((run) => run.parcel)).toEqual(['Kept']);
  });

  test('each record of a bulk run gets its own input, nested values included', async () => {
    const ids = [await parcel('N1'), await parcel('N2'), await parcel('N3')];
    expect((await runParcel('label', { ids, input: { tags: ['x'] } })).body).toEqual({ ok: ids, failed: [] });
    expect(labelled).toEqual([{ parcel: 'N1', tags: ['x'] }, { parcel: 'N2', tags: ['x'] }, { parcel: 'N3', tags: ['x'] }]);
  });

  // Each record's own transaction, on every driver (the app keeps the default `transactions: true`).
  test('not atomic: a method that writes and then throws is rolled back alone', async () => {
    const before = await parcel('R1');
    const boom = await parcel('BOOM');
    const after = await parcel('R2');
    expect((await runParcel('label', { ids: [before, boom, after], input: { tags: [] } })).body).toEqual({
      ok: [before, after],
      failed: [{ id: boom, code: 'BUSINESS_RULE', message: 'The printer jammed' }],
    });
    expect([await stateOf(before), await stateOf(boom), await stateOf(after)]).toEqual(['labelled', 'new', 'labelled']);
  });

  test('atomic: a record its rule refuses stops the run before any method is called', async () => {
    const open = await parcel('S1');
    const sealed = await parcel('S2', 'sealed');
    const last = await parcel('S3');
    const res = await runParcel('seal', { ids: [open, sealed, last] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(calls).toEqual([]);
    expect([await stateOf(open), await stateOf(last)]).toEqual(['new', 'new']);
  });

  test('names of things every object or resource has are not actions', async () => {
    const id = await order({ name: 'Names' });
    for (const name of ['constructor', 'findMany', '__proto__', 'toString', 'hasOwnProperty', 'own', 'notCancelled']) {
      const res = await run('root', name, { ids: [id] });
      expect(res.status, name).toBe(404);
      expect(res.body.code, name).toBe('NOT_FOUND');
    }
    expect(calls).toEqual([]);
    expect(await stored(id)).toMatchObject({ status: 'draft', ownerId: 'u1' });
  });
});

describe(`_perm.actions (${TEST_DB})`, () => {
  test('lists, per record, the record actions the user may run on it', async () => {
    const draft = await order({ name: 'P-draft' });
    const shipped = await order({ name: 'P-shipped', status: 'shipped' });
    const cancelled = await order({ name: 'P-cancelled', status: 'cancelled' });
    const theirs = await order({ name: 'P-theirs', ownerId: 'u2' });
    const permsOf = async (user: string) => {
      const list = await api(user).get('/resources/order?pageSize=100');
      return Object.fromEntries((list.body.items as Array<{ _id: string; _perm?: { actions?: Record<string, string | false> } }>).map((item) => [item._id, item._perm?.actions && offered(item._perm.actions)]));
    };
    const mine = await permsOf('u1');
    expect(mine[draft]).toEqual(['ship', 'cancel', 'archive', 'handOver']);
    expect(mine[shipped]).toEqual(['ship', 'archive', 'handOver']);
    expect(mine[cancelled]).toEqual(['archive', 'handOver']);
    expect(theirs in mine).toBe(false);
    // The rules apply to superusers too; nobody is offered a button that would answer 403.
    const root = await permsOf('root');
    expect(root[shipped]).toEqual(['ship', 'archive', 'handOver']);
    expect(root[theirs]).toEqual(['ship', 'cancel', 'archive', 'handOver']);
    expect((await permsOf('editor'))[draft]).toEqual([]);
    // Each record action by name: its label where it may run, false where it may not.
    expect((await api('u1').get(`/resources/order/${cancelled}`)).body._perm).toEqual({ update: true, delete: false, actions: { ship: false, cancel: false, archive: 'Archive', handOver: 'Hand over' } });
  });
});

describe(`resource actions (${TEST_DB})`, () => {
  test('run once, without ids, inside a transaction', async () => {
    const res = await run('counter', 'recount', {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: expect.stringMatching(/^Counted \d+ orders$/) });
    expect(calls).toEqual([{ action: 'recount', input: {}, inTransaction: true }]);
  });

  test('refuse ids, and need their own permission', async () => {
    const id = await order({ name: 'R' });
    calls.length = 0;
    const res = await run('counter', 'recount', { ids: [id] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
    expect((await run('u1', 'recount', {})).status).toBe(403);
    // Holding the action without any access to the resource: the resource does not exist for them.
    expect((await run('blind', 'recount', {})).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe(`action permissions in the catalog (${TEST_DB})`, () => {
  test('every action is a permission code roles can name', () => {
    const catalog = buildCatalog(app.get(ResourceRegistry), { permissions: [], rbac: undefined } as never);
    expect(catalog.resources.get('order')!.actions).toEqual(['ship', 'cancel', 'archive', 'handOver', 'recount']);
    expect(knownCodes(catalog)).toEqual(expect.arrayContaining(['order.action.ship', 'order.action.recount']));
  });

  test('the debugger explains them with the code the API enforces with', async () => {
    const explain = async (user: string, record?: string): Promise<Omit<PermissionExplanation, 'user'>> => {
      const entry = app.get(ResourceRegistry).get('order');
      return app.get(AdminPolicy).explain(users.get(user)!, entry, entry.schema, {} as IncomingMessage, 'en', record);
    };
    const cancelled = await order({ name: 'E-cancelled', status: 'cancelled' });
    const clerk = await explain('u1', cancelled);
    expect(clerk.actions.find((action) => action.name === 'ship')).toEqual({ name: 'ship', label: 'Mark shipped', target: 'record', allowed: true, grantedBy: [{ role: 'clerk', pattern: 'order.action.ship' }] });
    expect(clerk.actions.find((action) => action.name === 'recount')).toMatchObject({ allowed: false, grantedBy: [] });
    expect(clerk.record!.actions).toEqual(['archive', 'handOver']);
    expect(offered((await api('u1').get(`/resources/order/${cancelled}`)).body._perm.actions)).toEqual(clerk.record!.actions!);
    // Granted, but a record action also needs `order.update`.
    expect((await explain('shipper')).actions.find((action) => action.name === 'ship')).toEqual({
      name: 'ship', label: 'Mark shipped', target: 'record', allowed: false, needsUpdate: true, grantedBy: [{ role: 'shipper', pattern: 'order.action.ship' }],
    });
    expect((await explain('blind')).actions.find((action) => action.name === 'recount')).toMatchObject({ allowed: false, grantedBy: [{ role: 'blind', pattern: 'order.action.recount' }] });
    expect((await explain('wild')).actions.every((action) => action.allowed && action.grantedBy[0]!.pattern === 'order.*')).toBe(true);
  });
});

describe('boot checks', () => {
  const boot = async (resource: Function, roles: typeof ROLES = [], admin: { transactions?: boolean } = {}) => {
    @Module({ providers: [HeaderAuth, resource as never] })
    class BootModule {}
    const booted = await createTestApp({ imports: [BootModule], entities: [Order], admin: { auth: AdminAuth.custom(HeaderAuth), roles, ...admin } });
    await booted.close();
  };

  test('an action named like a built-in operation fails', async () => {
    @AdminResource(Order, { name: 'bad-order' })
    class CollidingAdmin extends AdminResourceBase<Order> {
      @AdminAction()
      override async delete(): Promise<void> {}
    }
    await expect(boot(CollidingAdmin)).rejects.toThrow('CollidingAdmin: @AdminAction "delete" collides with the built-in delete');
  });

  test('an atomic action needs transactions', async () => {
    await expect(boot(OrderAdmin, [], { transactions: false })).rejects.toThrow(
      'OrderAdmin: @AdminAction "archive" is `atomic`, which needs the admin\'s transactions; they are off (`transactions: false`)',
    );
    @AdminResource(Order, { name: 'loose-order' })
    class LooseAdmin extends AdminResourceBase<Order> {
      @AdminAction({ bulk: true }) async touch(): Promise<void> {}
    }
    await boot(LooseAdmin, [], { transactions: false });
  });

  test('a role naming an action that does not exist fails, with a hint', async () => {
    await expect(boot(OrderAdmin, [{ name: 'typo', permissions: ['order.action.shp'] }])).rejects.toThrow('unknown permission "order.action.shp" (did you mean "order.action.ship"?)');
  });

  test('`action` is not a custom permission name: `order.action.*` belongs to the actions', async () => {
    @AdminResource(Order, { name: 'coded-order', permissions: ['action'] })
    class CodedAdmin extends AdminResourceBase<Order> {}
    await expect(boot(CodedAdmin)).rejects.toThrow('CodedAdmin: permission "action" must be a word');
  });

  test('@AdminCan must name update, delete or a record action', async () => {
    @AdminResource(Order, { name: 'ruled-order' })
    class RuledAdmin extends AdminResourceBase<Order> {
      @AdminAction() async approve(): Promise<void> {}
      @AdminCan('aprove') never() {
        return false;
      }
    }
    await expect(boot(RuledAdmin)).rejects.toThrow('RuledAdmin: @AdminCan("aprove") names no record action (did you mean "approve"?)');
  });
});
