import { describe, expect, test } from 'bun:test';
import {
  Catch, Controller, Get, Injectable, Module, ValidationPipe,
  type ArgumentsHost, type CallHandler, type CanActivate, type ExceptionFilter, type ExecutionContext, type NestInterceptor,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { map } from 'rxjs';
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

@Injectable()
class WrapInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((data: unknown) => ({ data })));
  }
}

@Catch()
class TeapotFilter implements ExceptionFilter {
  catch(_error: unknown, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(418).json({ teapot: true });
  }
}

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

  test('host global interceptors, exception filters and pipes do not apply to the admin', async () => {
    const app = await createTestApp({
      imports: [HostModule],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: WrapInterceptor },
        { provide: APP_FILTER, useClass: TeapotFilter },
        { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }) },
      ],
    });
    const http = app.getHttpServer();
    expect((await request(http).get('/ping')).body).toEqual({ data: 'pong' }); // the host interceptor is active
    const meta = await request(http).get('/admin/api/meta');
    expect(meta.body.schemaVersion).toBe(1); // …but does not wrap admin responses
    const missing = await request(http).get('/admin/api/resources/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND'); // not the host's 418 filter
    expect((await request(http).post('/admin/api/resources/widget').send({ name: 'Piped' })).status).toBe(201);
    await app.close();
  });

  test('host auth middleware errors under the admin path keep their status in the contract (Review Focus 5)', async () => {
    const app = await createTestApp({
      beforeInit: (a) =>
        a.use('/admin/api/resources', (req: { headers: Record<string, unknown> }, _res: unknown, next: (error: unknown) => void) =>
          next(Object.assign(new Error('Login required'), { status: req.headers['x-role'] ? 403 : 401 })),
        ),
    });
    const http = app.getHttpServer();
    const unauthenticated = await request(http).get('/admin/api/resources/widget');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe('UNAUTHENTICATED');
    expect(unauthenticated.body.message).toBe('Login required');
    expect(typeof unauthenticated.body.correlationId).toBe('string');
    const forbidden = await request(http).get('/admin/api/resources/widget').set('x-role', 'viewer');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
    await app.close();
  });
});
