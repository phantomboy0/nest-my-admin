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

describe("the page is in the admin's default locale", () => {
  const TITLE = { fa: 'مدیریت فروشگاه', en: 'Shop admin' };
  const open = async (admin: Record<string, unknown>, headers: Record<string, string> = {}, path = '/admin/') => {
    const app = await createTestApp({ admin });
    try {
      return await request(app.getHttpServer()).get(path).set(headers);
    } finally {
      await app.close();
    }
  };
  const htmlTag = (text: string) => /<html[^>]*>/.exec(text)![0];
  const titles = (text: string) => [...text.matchAll(/<title>([^]*?)<\/title>/g)].map((match) => match[1]);

  test('default locale fa: lang, dir and the Persian title', async () => {
    const res = await open({ locale: 'fa', locales: ['fa', 'en'], title: TITLE });
    expect(htmlTag(res.text)).toBe('<html lang="fa" dir="rtl">');
    expect(titles(res.text)).toEqual(['مدیریت فروشگاه']);
    expect(res.headers['content-language']).toBe('fa');
    expect(res.headers['vary']).toBeUndefined(); // one page for everyone
    expect(res.headers['cache-control']).toBe('no-cache');
    // The UI boots from the same default (or the reader's saved choice, which the server cannot see).
    expect(res.text).toContain('"title":"مدیریت فروشگاه","locale":"fa","locales":["fa","en"]');
  });

  test('Accept-Language does not change the page: the UI starts in the default locale, so the page is in it', async () => {
    // A Persian admin opened in an English browser runs in Persian (until the reader switches), so it is served so.
    const fa = { locale: 'fa', locales: ['fa', 'en'], title: TITLE };
    for (const [language, path] of [['en', '/admin/'], ['en-GB,en;q=0.9', '/admin/widget/5'], ['de', '/admin/']] as const) {
      const res = await open(fa, { 'Accept-Language': language }, path);
      expect(htmlTag(res.text)).toBe('<html lang="fa" dir="rtl">');
      expect(titles(res.text)).toEqual(['مدیریت فروشگاه']);
      expect(res.headers['content-language']).toBe('fa');
      expect(res.headers['vary']).toBeUndefined();
    }
    // And an English admin that also offers Persian keeps its English page for a Persian browser.
    const en = await open({ locale: 'en', locales: ['en', 'fa'], title: TITLE }, { 'Accept-Language': 'fa-IR,fa;q=0.9' });
    expect(htmlTag(en.text)).toBe('<html lang="en" dir="ltr">');
    expect(titles(en.text)).toEqual(['Shop admin']);
    expect(en.headers['content-language']).toBe('en');
  });

  test('a HEAD request has the same headers', async () => {
    const app = await createTestApp({ admin: { locale: 'fa', locales: ['fa', 'en'], title: TITLE } });
    const head = await request(app.getHttpServer()).head('/admin/').set('Accept-Language', 'en');
    await app.close();
    expect(head.headers['content-language']).toBe('fa');
    expect(head.headers['vary']).toBeUndefined();
  });

  test("a Vary header the host's middleware set is left alone", async () => {
    const app = await createTestApp({
      admin: { locale: 'fa', locales: ['fa', 'en'], title: TITLE },
      beforeInit: (host) => {
        host.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
          res.setHeader('Vary', 'Origin');
          next();
        });
      },
    });
    const res = await request(app.getHttpServer()).get('/admin/').set('Accept-Language', 'en');
    await app.close();
    expect(res.headers['vary']).toBe('Origin');
  });

  test('the title is escaped', async () => {
    const res = await open({ title: 'Tom & <b>Jerry</b> "Co" </title><script>alert(1)</script>' });
    expect(titles(res.text)).toEqual(['Tom &amp; &lt;b&gt;Jerry&lt;/b&gt; &quot;Co&quot; &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;']);
    expect(res.text).not.toContain('<script>alert(1)');
  });

  test('without a title the page is called Admin', async () => {
    const res = await open({});
    expect(htmlTag(res.text)).toBe('<html lang="en" dir="ltr">');
    expect(titles(res.text)).toEqual(['Admin']);
    expect(res.headers['content-language']).toBe('en');
  });

  test('static files carry no language', async () => {
    const app = await createTestApp({ admin: { locale: 'fa' } });
    const asset = await request(app.getHttpServer()).get('/admin/assets/app.js');
    await app.close();
    expect(asset.headers['content-language']).toBeUndefined();
    expect(asset.headers['vary']).toBeUndefined();
  });
});

describe('UI texts through translate', () => {
  const config = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="nma-config">(.*?)<\/script>/)![1]!);

  test('translate rewords UI texts in the served config', async () => {
    const app = await createTestApp({ admin: { locale: 'fa', locales: ['fa', 'en'], translate: ({ key, locale }) => (key === 'ui.form.save' && locale === 'fa' ? 'ثبت' : undefined) } });
    try {
      const html = (await request(app.getHttpServer()).get('/admin/')).text;
      expect(config(html).messages).toEqual({ fa: { 'form.save': 'ثبت' } });
    } finally {
      await app.close();
    }
  });

  test('without rewordings the config has no messages', async () => {
    const app = await createTestApp({ admin: { translate: () => undefined } });
    try {
      expect('messages' in config((await request(app.getHttpServer()).get('/admin/')).text)).toBe(false);
    } finally {
      await app.close();
    }
  });

  test('a placeholder mismatch fails boot', async () => {
    await expect(createTestApp({ admin: { translate: ({ key }) => (key === 'ui.form.add' ? 'Add' : undefined) } })).rejects.toThrow('translate: ui.form.add (en) must keep the placeholders {name}');
  });
});
