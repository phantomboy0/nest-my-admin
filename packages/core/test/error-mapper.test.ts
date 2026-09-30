import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminError, AdminResource, AdminResourceBase, AfterSave } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

class InsufficientFunds extends Error {}
class MapperBoom extends Error {}

@AdminResource(Widget, { name: 'after-widget' })
class AfterWidgetAdmin extends AdminResourceBase<Widget> {
  @AfterSave()
  check(entity: Widget) {
    if (entity.name === 'poor') throw new InsufficientFunds('after save');
    if (entity.name === 'boom') throw new MapperBoom('mapper will throw');
  }
}

@AdminResource(Widget, { name: 'domain-widget' })
class DomainWidgetAdmin extends AdminResourceBase<Widget> {
  async create(): Promise<Widget> {
    throw new InsufficientFunds('balance too low');
  }
}

@Module({ providers: [DomainWidgetAdmin, AfterWidgetAdmin] })
class DomainModule {}

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({
    imports: [DomainModule],
    admin: {
      errorMapper: (error) => {
        if (error instanceof MapperBoom) throw new Error('mapper bug');
        return error instanceof InsufficientFunds ? new AdminError('BUSINESS_RULE', 402, `Payment needed: ${error.message}`) : undefined;
      },
    },
  });
});
afterAll(async () => {
  await app.close();
});

test('forRoot({ errorMapper }) answers domain exceptions in the contract', async () => {
  const res = await request(app.getHttpServer()).post('/admin/api/resources/domain-widget').send({ name: 'x' });
  expect(res.status).toBe(402);
  expect(res.body.code).toBe('BUSINESS_RULE');
  expect(res.body.message).toBe('Payment needed: balance too low');
  expect(typeof res.body.correlationId).toBe('string');
});

const total = async () => (await request(app.getHttpServer()).get('/admin/api/resources/after-widget')).body.total as number;

test('a mapped @AfterSave error answers in the contract and rolls the create back', async () => {
  const before = await total();
  const res = await request(app.getHttpServer()).post('/admin/api/resources/after-widget').send({ name: 'poor' });
  expect(res.status).toBe(402);
  expect(res.body.message).toBe('Payment needed: after save');
  expect(await total()).toBe(before);
});

test('a write still succeeds after a request whose errorMapper threw', async () => {
  const failed = await request(app.getHttpServer()).post('/admin/api/resources/after-widget').send({ name: 'boom' });
  expect(failed.status).toBe(500);
  expect(failed.body.code).toBe('INTERNAL');
  const ok = await request(app.getHttpServer()).post('/admin/api/resources/after-widget').send({ name: 'fine' });
  expect(ok.status).toBe(201);
});
