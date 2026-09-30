import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

describe('UI serving', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp({ admin: { title: 'Shop' } }); });
  afterAll(async () => { await app.close(); });

  test('serves index.html with base href and runtime config', async () => {
    for (const path of ['/admin', '/admin/']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('<base href="/admin/">');
      expect(res.text).toContain('<script type="application/json" id="nma-config">{"basePath":"/admin","apiBase":"/admin/api","title":"Shop","locale":"en","locales":["en"],"branding":{}}</script>');
    }
  });

  test('has no executable inline script, so a strict CSP (helmet default) still lets the UI boot', async () => {
    const res = await request(app.getHttpServer()).get('/admin');
    const inline = [...res.text.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/gi)];
    expect(inline.length).toBeGreaterThan(0);
    for (const [, attrs] of inline) expect(attrs).toContain('type="application/json"');
  });

  test('deep links get index.html so a refresh works', async () => {
    const res = await request(app.getHttpServer()).get('/admin/widget/5');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<base href="/admin/">');
  });

  test('serves hashed assets with long-lived caching and 404s missing ones', async () => {
    const asset = await request(app.getHttpServer()).get('/admin/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(app.getHttpServer()).get('/admin/assets/missing.js')).status).toBe(404);
  });

  test('path traversal never escapes the dist directory', async () => {
    const res = await request(app.getHttpServer()).get('/admin/..%2f..%2f..%2fpackage.json');
    expect(res.text).not.toContain('"devDependencies"');
    expect((await request(app.getHttpServer()).get('/admin/assets/..%2f..%2f..%2fpackage.json')).status).toBe(404);
  });

  test('HEAD has headers but no body; non-GET UI requests fall through to the host', async () => {
    const head = await request(app.getHttpServer()).head('/admin');
    expect(head.status).toBe(200);
    expect(head.text ?? '').toBe('');
    expect((await request(app.getHttpServer()).post('/admin/widget').send({})).status).toBe(404);
  });
});

describe('UI serving edge cases', () => {
  test('a title cannot break out of the config script', async () => {
    const app = await createTestApp({ admin: { title: '</script><script>alert(1)</script>' } });
    const res = await request(app.getHttpServer()).get('/admin');
    expect(res.text).not.toContain('</script><script>alert(1)');
    await app.close();
  });

  test('a missing UI build shows a helpful page instead of crashing', async () => {
    const app = await createTestApp({ admin: { uiDistPath: '/definitely/not/here' } });
    const res = await request(app.getHttpServer()).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Admin UI assets not found');
    await app.close();
  });
});
