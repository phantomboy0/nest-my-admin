import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectRuntime, resolveStaticFile } from './ui-assets.js';

const root = fileURLToPath(new URL('../../test/fixtures/ui-dist', import.meta.url));
const runtime = { basePath: '/admin', apiBase: '/admin/api', title: 'Shop' };

describe('injectRuntime', () => {
  test('adds <base> and window.__NMA__ right after <head>', () => {
    const html = injectRuntime('<html><head lang="x"><title>t</title></head></html>', runtime);
    expect(html).toBe(
      '<html><head lang="x"><base href="/admin/"><script>window.__NMA__={"basePath":"/admin","apiBase":"/admin/api","title":"Shop"}</script><title>t</title></head></html>',
    );
  });

  test('escapes values that could close the script tag', () => {
    const html = injectRuntime('<head></head>', { ...runtime, title: '</script><script>alert(1)</script>' });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
  });

  test('fails loudly when index.html has no <head>', () => {
    expect(() => injectRuntime('<body></body>', runtime)).toThrow('has no <head>');
  });
});

describe('resolveStaticFile', () => {
  test('finds files inside the dist directory', () => {
    expect(resolveStaticFile(root, '/assets/app.js')).toBe(join(root, 'assets/app.js'));
  });

  test('never serves index.html raw, directories, or files outside the root', () => {
    expect(resolveStaticFile(root, '/index.html')).toBeUndefined();
    expect(resolveStaticFile(root, '/assets')).toBeUndefined();
    expect(resolveStaticFile(root, '/../ui-dist-secret.txt')).toBeUndefined();
    expect(resolveStaticFile(root, '/..%2f..%2fwidgets.ts')).toBeUndefined();
    expect(resolveStaticFile(root, '/%E0%A4%A')).toBeUndefined();
    expect(resolveStaticFile(root, '/assets/app.js%00.png')).toBeUndefined();
  });
});
