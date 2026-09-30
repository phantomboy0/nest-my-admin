import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminError, AdminResource, AdminResourceBase } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

class InsufficientFunds extends Error {}

@AdminResource(Widget, { name: 'domain-widget' })
class DomainWidgetAdmin extends AdminResourceBase<Widget> {
  async create(): Promise<Widget> {
    throw new InsufficientFunds('balance too low');
  }
}

@Module({ providers: [DomainWidgetAdmin] })
class DomainModule {}

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({
    imports: [DomainModule],
    admin: {
      errorMapper: (error) =>
        error instanceof InsufficientFunds ? new AdminError('BUSINESS_RULE', 402, `Payment needed: ${error.message}`) : undefined,
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
