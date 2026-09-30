import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, unlinkSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { injectRuntime, resolveStaticFile, UiAssets } from './ui-assets.js';

const root = fileURLToPath(new URL('../../test/fixtures/ui-dist', import.meta.url));
const runtime = { basePath: '/admin', apiBase: '/admin/api', title: 'Shop', locale: 'en', locales: ['en'], branding: {} };

describe('injectRuntime', () => {
  test('adds <base> and the JSON config right after <head>', () => {
    const html = injectRuntime('<html><head lang="x"><title>t</title></head></html>', runtime);
    expect(html).toBe(
      '<html><head lang="x"><base href="/admin/"><script type="application/json" id="nma-config">{"basePath":"/admin","apiBase":"/admin/api","title":"Shop","locale":"en","locales":["en"],"branding":{}}</script><title>t</title></head></html>',
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

describe('UiAssets', () => {
  test.skipIf(process.getuid?.() === 0)('handles file read errors gracefully without crashing', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ui-test-'));
    const assetFile = join(tempDir, 'test.js');
    const fileContent = 'console.log("test")';
    writeFileSync(assetFile, fileContent);

    const ui = new UiAssets(tempDir, runtime);
    let uncaughtError: Error | undefined;
    const errorListener = (err: Error) => {
      uncaughtError = err;
    };
    process.on('uncaughtException', errorListener);

    try {
      // Make the file unreadable (chmod 000)
      chmodSync(assetFile, 0o000);

      // Assert that the file is actually unreadable
      expect(() => readFileSync(assetFile)).toThrow();

      // Create a real HTTP server
      const server = createServer((req, res) => {
        ui.serve('/test.js', req, res);
      });

      // Wait for server to listen
      const listenPromise = new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === 'object' ? addr?.port ?? 0 : 0;
          resolve(port);
        });
      });

      const port = await listenPromise;

      // Make a request - the pipeline will fail on read and destroy the response
      const response = await fetch(`http://localhost:${port}/test.js`, { method: 'GET' });

      // Assert that response body is not the file contents
      const body = await response.text();
      expect(body).not.toBe(fileContent);
      // Body should be empty or truncated due to read error
      expect(body.length).toBeLessThan(fileContent.length);

      server.close();

      // Verify no uncaught exception occurred
      expect(uncaughtError).toBeUndefined();
    } finally {
      process.off('uncaughtException', errorListener);
      chmodSync(assetFile, 0o644);
      rmSync(tempDir, { recursive: true });
    }
  });

  test('responds with 404 when file vanishes between resolve and serve', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ui-test-'));
    const assetFile = join(tempDir, 'assets', 'vanish.js');

    // Create assets directory and file
    mkdirSync(join(tempDir, 'assets'), { recursive: true });
    writeFileSync(assetFile, 'console.log("vanish")');

    const ui = new UiAssets(tempDir, runtime);

    try {
      // Resolve the file first (verify it exists)
      const resolved = resolveStaticFile(tempDir, '/assets/vanish.js');
      expect(resolved).toBe(assetFile);

      // Delete the file
      unlinkSync(assetFile);

      // Now try to serve it - should get 404
      let responseCode: number = 0;

      const server = createServer((req, res) => {
        ui.serve('/assets/vanish.js', req, res);
      });

      const listenPromise = new Promise<number>((resolve) => {
        server.listen(0, () => {
          const addr = server.address();
          const port = typeof addr === 'object' ? addr?.port ?? 0 : 0;
          resolve(port);
        });
      });

      const port = await listenPromise;

      // Capture the response status code
      const response = await fetch(`http://localhost:${port}/assets/vanish.js`, { method: 'GET' });
      responseCode = response.status;

      expect(responseCode).toBe(404);

      server.close();
    } finally {
      rmSync(tempDir, { recursive: true });
    }
  });
});
