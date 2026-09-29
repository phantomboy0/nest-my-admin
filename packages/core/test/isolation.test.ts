import { describe, expect, test } from 'bun:test';
import { Controller, Get, Injectable, Module, type CanActivate } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

@Injectable()
class DenyAllGuard implements CanActivate {
  canActivate() {
    return false;
  }
}

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return 'pong';
  }
}

@Module({ controllers: [PingController] })
class HostModule {}

describe('isolation from the host app (spec D12)', () => {
  test('host global guards and global prefix do not apply to the admin', async () => {
    const app = await createTestApp({
      imports: [HostModule],
      providers: [{ provide: APP_GUARD, useClass: DenyAllGuard }],
      beforeInit: (a) => a.setGlobalPrefix('api'),
    });
    const http = app.getHttpServer();
    expect((await request(http).get('/api/ping')).status).toBe(403);
    expect((await request(http).get('/admin/api/meta')).status).toBe(200);
    expect((await request(http).get('/api/admin/api/meta')).status).toBe(404);
    await app.close();
  });

  test('a custom mount path moves both the API and the UI', async () => {
    const app = await createTestApp({ admin: { path: '/backoffice/' } });
    const http = app.getHttpServer();
    expect((await request(http).get('/backoffice/api/meta')).status).toBe(200);
    expect((await request(http).get('/admin/api/meta')).status).toBe(404);
    expect((await request(http).get('/backoffice/widget')).text).toContain('<base href="/backoffice/">');
    await app.close();
  });
});
