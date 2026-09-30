import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Controller, Get, Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminContext, AdminResource, AdminResourceBase } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

@Injectable()
class Stamp {
  readonly seen: Array<string | undefined> = [];
  note() {
    this.seen.push(AdminContext.current()?.correlationId);
  }
}

@AdminResource(Widget, { name: 'context-widget' })
class ContextWidgetAdmin extends AdminResourceBase<Widget> {
  mismatches = 0;
  lateContext: Array<AdminContext | undefined | 'unset'> = [];
  constructor(private readonly stamp: Stamp) {
    super();
  }

  async create(dto: { name?: string }, ctx: AdminContext) {
    await Bun.sleep(Math.floor(Math.random() * 20));
    if (AdminContext.current() !== ctx) this.mismatches++;
    if (dto.name === 'timer') setTimeout(() => this.lateContext.push(AdminContext.current()), 30);
    this.stamp.note(); // a service with no ctx parameter can still find the request
    return super.create(dto, ctx);
  }
}

@Controller('whoami')
class WhoAmIController {
  @Get()
  who() {
    return { inAdmin: AdminContext.current() !== undefined };
  }
}

@Module({ controllers: [WhoAmIController], providers: [Stamp, ContextWidgetAdmin] })
class ContextModule {}

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({ imports: [ContextModule] });
});
afterAll(async () => {
  await app.close();
});

describe('AdminContext.current()', () => {
  test('concurrent admin requests each see their own context (Review Focus 2)', async () => {
    const http = app.getHttpServer();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => request(http).post('/admin/api/resources/context-widget').send({ name: `W${i}` })),
    );
    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(app.get(ContextWidgetAdmin).mismatches).toBe(0);
    const seen = app.get(Stamp).seen;
    expect(seen).toHaveLength(8);
    expect(seen.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(seen).size).toBe(8);
  });

  test('is undefined in host code outside the admin (Review Focus 3)', async () => {
    const http = app.getHttpServer();
    await request(http).post('/admin/api/resources/context-widget').send({ name: 'before' });
    expect((await request(http).get('/whoami')).body).toEqual({ inAdmin: false });
  });

  test('a timer started during a request does not see its context afterwards', async () => {
    const http = app.getHttpServer();
    const admin = app.get(ContextWidgetAdmin);
    const res = await request(http).post('/admin/api/resources/context-widget').send({ name: 'timer' });
    expect(res.status).toBe(201);
    await Bun.sleep(80);
    expect(admin.lateContext).toEqual([undefined]);
  });
});
