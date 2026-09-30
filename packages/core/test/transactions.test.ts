import { afterEach, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AdminContext, AdminFieldError, AdminResource, AdminResourceBase, AfterSave } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

@AdminResource(Widget, { name: 'strict-widget' })
class StrictWidgetAdmin extends AdminResourceBase<Widget> {
  @AfterSave()
  async refuse(entity: Widget) {
    await Bun.sleep(10); // keeps the transaction open so concurrent requests overlap
    if (entity.name === 'explode') throw new AdminFieldError({ name: 'rejected after saving' });
  }
}

@AdminResource(Widget, { name: 'pair-widget' })
class PairWidgetAdmin extends AdminResourceBase<Widget> {
  sawManagerOnRead: boolean | undefined;

  // A host-style override that writes two rows through ctx.manager, then fails.
  async create(dto: { name?: string }, ctx: AdminContext) {
    const repo = ctx.manager!.getRepository(Widget);
    const first = await repo.save(repo.create({ name: `${dto.name}-a` }));
    await repo.save(repo.create({ name: `${dto.name}-b` }));
    if (dto.name === 'fail') throw new AdminFieldError({ name: 'second step failed' });
    return first;
  }

  async findMany(params: Parameters<AdminResourceBase<Widget>['findMany']>[0], ctx: AdminContext) {
    this.sawManagerOnRead = ctx.manager !== undefined;
    return super.findMany(params, ctx);
  }
}

@AdminResource(Widget, { name: 'own-repo-widget' })
class OwnRepoWidgetAdmin extends AdminResourceBase<Widget> {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  // A service that ignores ctx.manager and uses its own repository must still work.
  async create(dto: { name?: string }) {
    return this.dataSource.getRepository(Widget).save({ name: dto.name ?? 'own' });
  }
}

@Module({ providers: [StrictWidgetAdmin, PairWidgetAdmin, OwnRepoWidgetAdmin] })
class TxModule {}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const count = async (http: unknown) => (await request(http as never).get('/admin/api/resources/widget')).body.total as number;

describe('transactions', () => {
  test('a throwing @AfterSave rolls the create back (Review Focus 1)', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    const res = await request(http).post('/admin/api/resources/strict-widget').send({ name: 'explode' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ name: ['rejected after saving'] });
    expect(await count(http)).toBe(0);
    expect((await request(http).post('/admin/api/resources/strict-widget').send({ name: 'fine' })).status).toBe(201);
    expect(await count(http)).toBe(1);
  });

  test('a throwing @AfterSave rolls the update back too', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    const { id } = (await request(http).post('/admin/api/resources/strict-widget').send({ name: 'keep' })).body;
    const res = await request(http).patch(`/admin/api/resources/strict-widget/${id}`).send({ name: 'explode' });
    expect(res.status).toBe(422);
    expect((await request(http).get(`/admin/api/resources/widget/${id}`)).body.name).toBe('keep');
  });

  test('host code writing through ctx.manager commits or rolls back as one unit', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    expect((await request(http).post('/admin/api/resources/pair-widget').send({ name: 'fail' })).status).toBe(422);
    expect(await count(http)).toBe(0);
    expect((await request(http).post('/admin/api/resources/pair-widget').send({ name: 'ok' })).status).toBe(201);
    expect(await count(http)).toBe(2);
  });

  test('reads get no transaction manager', async () => {
    app = await createTestApp({ imports: [TxModule] });
    await request(app.getHttpServer()).get('/admin/api/resources/pair-widget');
    expect(app.get(PairWidgetAdmin).sawManagerOnRead).toBe(false);
  });

  test('a service that ignores ctx.manager still works', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const res = await request(app.getHttpServer()).post('/admin/api/resources/own-repo-widget').send({ name: 'mine' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('mine');
  });

  test('transactions: false turns the wrapper off', async () => {
    app = await createTestApp({ imports: [TxModule], admin: { transactions: false } });
    const http = app.getHttpServer();
    expect((await request(http).post('/admin/api/resources/strict-widget').send({ name: 'explode' })).status).toBe(422);
    expect(await count(http)).toBe(1); // saved before the hook threw, nothing rolled it back
  });

  test('concurrent writes do not interleave transactions (single-connection drivers)', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    const post = (name: string) => request(http).post('/admin/api/resources/strict-widget').send({ name });
    const [bad, good] = await Promise.all([post('explode'), post('fine')]);
    expect(bad.status).toBe(422);
    expect(good.status).toBe(201);
    const list = (await request(http).get('/admin/api/resources/widget')).body;
    expect(list.total).toBe(1);
    expect(list.items[0].name).toBe('fine');
  });

  test('a burst of mixed concurrent writes persists exactly the successful ones', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    (http as import('node:http').Server).setMaxListeners(30); // supertest attaches listeners per concurrent request
    const responses = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        request(http).post('/admin/api/resources/strict-widget').send({ name: i % 3 === 0 ? 'explode' : `ok${i}` }),
      ),
    );
    const created = responses.filter((res) => res.status === 201).length;
    expect(responses.every((res) => res.status === 201 || res.status === 422)).toBe(true);
    expect(created).toBe(6);
    expect(await count(http)).toBe(created);
  });
});
