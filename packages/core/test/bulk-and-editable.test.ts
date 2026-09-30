import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ConflictException, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminResource, AdminResourceBase, BeforeDelete } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { SHAPE_ENTITIES, ShapesModule } from './fixtures/shapes.js';
import { createTestApp } from './helpers/create-app.js';

/** Refuses to delete live widgets, like a service rule. */
@AdminResource(Widget, { name: 'guarded-widget' })
class GuardedWidgetAdmin extends AdminResourceBase<Widget> {
  @BeforeDelete() refuseLive(widget: Widget) {
    if (widget.status === 'live') throw new ConflictException('Live widgets cannot be deleted');
  }
}
@Module({ providers: [GuardedWidgetAdmin] })
class GuardedModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());
const create = async (resource: string, body: object) => (await http().post(`/admin/api/resources/${resource}`).send(body)).body._id as string;

beforeAll(async () => {
  app = await createTestApp({ imports: [GuardedModule, ShapesModule], entities: SHAPE_ENTITIES });
});
afterAll(async () => {
  await app.close();
});

describe('bulk delete (Review Focus 1)', () => {
  test('each record on its own: refusals and missing records are reported, the rest deleted', async () => {
    const draft = await create('guarded-widget', { name: 'Draft', status: 'draft' });
    const live = await create('guarded-widget', { name: 'Live', status: 'live' });
    const other = await create('guarded-widget', { name: 'Other', status: 'draft' });
    const res = await http().post('/admin/api/resources/guarded-widget/bulk-delete').send({ ids: [live, draft, '999999', other] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: [draft, other],
      failed: [
        { id: live, code: 'CONFLICT', message: 'Live widgets cannot be deleted' },
        { id: '999999', code: 'NOT_FOUND', message: expect.stringContaining('not found') },
      ],
    });
    expect((await http().get(`/admin/api/resources/guarded-widget/${live}`)).status).toBe(200);
    expect((await http().get(`/admin/api/resources/guarded-widget/${draft}`)).status).toBe(404);
  });

  test('soft-deletable records go to the trash', async () => {
    const shop = await create('shop', { name: 'Binned' });
    expect((await http().post('/admin/api/resources/shop/bulk-delete').send({ ids: [shop] })).body).toEqual({ ok: [shop], failed: [] });
    const trash = await http().get('/admin/api/resources/shop?trashed=only');
    expect(trash.body.items.map((item: { _id: string }) => item._id)).toContain(shop);
  });

  test('bad requests', async () => {
    const bad = async (body: unknown) => (await http().post('/admin/api/resources/guarded-widget/bulk-delete').send(body as object)).body.fields;
    const message = { ids: ['must be a list of 1 to 100 record ids'] };
    expect(await bad({ ids: [] })).toEqual(message);
    expect(await bad({ ids: [1] })).toEqual(message);
    expect(await bad({ ids: Array.from({ length: 101 }, (_, i) => String(i)) })).toEqual(message);
    expect(await bad({})).toEqual(message);
  });
});
