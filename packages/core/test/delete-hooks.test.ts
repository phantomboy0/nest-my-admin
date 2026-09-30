import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminFieldError, AdminResource, AdminResourceBase, AfterSave, BeforeDelete, BeforeSave, type AdminContext } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

@AdminResource(Widget, { name: 'hooked-widget' })
class HookedWidgetAdmin extends AdminResourceBase<Widget> {
  readonly calls: string[] = [];

  @BeforeSave()
  trimName(dto: { name?: string }, _ctx: AdminContext, mode: string) {
    this.calls.push(`before:${mode}`);
    if (typeof dto.name === 'string') dto.name = dto.name.trim();
  }

  @AfterSave()
  record(entity: Widget, _ctx: AdminContext, mode: string) {
    this.calls.push(`after:${mode}:${entity.id}`);
  }

  @BeforeDelete()
  keepLiveWidgets(entity: Widget) {
    if (entity.status === 'live') throw new AdminFieldError({ status: 'live widgets cannot be deleted' });
  }
}

@Module({ providers: [HookedWidgetAdmin] })
class HookedModule {}

const plain = '/admin/api/resources/widget';
const hooked = '/admin/api/resources/hooked-widget';
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp({ imports: [HookedModule] });
});
afterAll(async () => {
  await app.close();
});

describe('delete', () => {
  test('removes the record and answers 204 with no body; no JSON content type needed', async () => {
    const { id } = (await request(app.getHttpServer()).post(plain).send({ name: 'Temp' })).body;
    const res = await request(app.getHttpServer()).delete(`${plain}/${id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await request(app.getHttpServer()).get(`${plain}/${id}`)).status).toBe(404);
  });

  test('missing and impossible ids are 404', async () => {
    expect((await request(app.getHttpServer()).delete(`${plain}/99999`)).status).toBe(404);
    expect((await request(app.getHttpServer()).delete(`${plain}/abc`)).status).toBe(404);
  });
});

describe('hooks', () => {
  test('beforeSave can normalise the dto; afterSave sees the saved entity', async () => {
    const admin = app.get(HookedWidgetAdmin);
    const created = await request(app.getHttpServer()).post(hooked).send({ name: '  Spaced  ' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Spaced');
    await request(app.getHttpServer()).patch(`${hooked}/${created.body.id}`).send({ name: ' Renamed ' });
    expect(admin.calls).toEqual(['before:create', `after:create:${created.body.id}`, 'before:update', `after:update:${created.body.id}`]);
    expect((await request(app.getHttpServer()).get(`${hooked}/${created.body.id}`)).body.name).toBe('Renamed');
  });

  test('beforeDelete can veto with a field error', async () => {
    const live = (await request(app.getHttpServer()).post(hooked).send({ name: 'Live', status: 'live' })).body;
    const refused = await request(app.getHttpServer()).delete(`${hooked}/${live.id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.fields).toEqual({ status: ['live widgets cannot be deleted'] });
    const draft = (await request(app.getHttpServer()).post(hooked).send({ name: 'Draft' })).body;
    expect((await request(app.getHttpServer()).delete(`${hooked}/${draft.id}`)).status).toBe(204);
  });
});
