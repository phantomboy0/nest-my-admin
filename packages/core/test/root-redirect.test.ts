import { describe, expect, test } from 'bun:test';
import { Controller, Get, Module, Post } from '@nestjs/common';
import request from 'supertest';
import { resolveAdminOptions } from '../src/options.js';
import { createTestApp } from './helpers/create-app.js';

@Controller()
class RootController {
  @Get()
  home() {
    return { host: 'home' };
  }
}
@Module({ controllers: [RootController] })
class RootModule {}

@Controller()
class OtherController {
  @Get('ping')
  ping() {
    return { pong: true };
  }
  @Post()
  posted() {
    return { posted: true };
  }
}
@Module({ controllers: [OtherController] })
class OtherModule {}

describe('rootRedirect', () => {
  test('off by default: the bare address stays a 404', async () => {
    const app = await createTestApp();
    expect((await request(app.getHttpServer()).get('/')).status).toBe(404);
    await app.close();
  });

  test('on: GET and HEAD of the bare address go to the admin, query or not', async () => {
    const app = await createTestApp({ admin: { rootRedirect: true } });
    const http = app.getHttpServer();
    for (const answer of [await request(http).get('/'), await request(http).head('/'), await request(http).get('/?from=mail')]) {
      expect(answer.status).toBe(302);
      expect(answer.headers.location).toBe('/admin/');
    }
    expect((await request(http).get('/admin/')).status).toBe(200);
    await app.close();
  });

  test('it follows a custom path, and the old one is gone', async () => {
    const app = await createTestApp({ admin: { path: '/backoffice/', rootRedirect: true } });
    const http = app.getHttpServer();
    expect((await request(http).get('/')).headers.location).toBe('/backoffice/');
    expect((await request(http).get('/backoffice/widget')).text).toContain('<base href="/backoffice/">');
    expect((await request(http).get('/admin/')).status).toBe(404);
    await app.close();
  });

  test('a route of the host’s own at the root keeps answering', async () => {
    const app = await createTestApp({ imports: [RootModule], admin: { rootRedirect: true } });
    const answer = await request(app.getHttpServer()).get('/');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ host: 'home' });
    await app.close();
  });

  test('every other address and method keeps its own answer', async () => {
    const app = await createTestApp({ imports: [OtherModule], admin: { rootRedirect: true } });
    const http = app.getHttpServer();
    expect((await request(http).get('/ping')).body).toEqual({ pong: true });
    expect((await request(http).get('/nothing-here')).status).toBe(404);
    expect((await request(http).post('/')).body).toEqual({ posted: true });
    expect((await request(http).get('/')).status).toBe(302);
    await app.close();
  });

  test('a value that is not a boolean refuses to boot', () => {
    expect(() => resolveAdminOptions({ rootRedirect: 'yes' as unknown as boolean })).toThrow('`rootRedirect` must be true or false');
  });
});
