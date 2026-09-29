import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, chmodSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { injectRuntime, resolveStaticFile, UiAssets } from './ui-assets.js';

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

describe('UiAssets', () => {
  test('handles file read errors gracefully without crashing', async () => {
    // Skip if running as root (can't test chmod 000)
    if (process.getuid?.() === 0) {
      return;
    }

    // Create a temp directory with a file
    const tempDir = mkdtempSync(join(tmpdir(), 'ui-test-'));
    const assetFile = join(tempDir, 'test.js');
    writeFileSync(assetFile, 'console.log("test")');

    const ui = new UiAssets(tempDir, runtime);
    let uncaughtError: Error | undefined;
    const errorListener = (err: Error) => {
      uncaughtError = err;
    };
    process.on('uncaughtException', errorListener);

    try {
      // Create a real HTTP server
      const server = createServer((req, res) => {
        ui.serve('/test.js', req, res);
      });

      await new Promise<void>((resolve, reject) => {
        server.listen(0, async () => {
          try {
            const addr = server.address();
            const port = typeof addr === 'object' ? addr?.port : 0;

            // Make the file unreadable (chmod 000)
            chmodSync(assetFile, 0o000);

            // Make a request - the pipeline will fail on read and destroy the response
            const response = await fetch(`http://localhost:${port}/test.js`, { method: 'GET' });
            // The response may be incomplete due to stream error, but should not crash
            expect(response.status).toBeGreaterThanOrEqual(200);

            resolve();
          } catch (e) {
            reject(e);
          } finally {
            // Restore permissions for cleanup
            try {
              chmodSync(assetFile, 0o644);
            } catch {
              // Ignore
            }
            server.close();
          }
        });
      });

      // Verify no uncaught exception occurred
      expect(uncaughtError).toBeUndefined();
    } finally {
      process.off('uncaughtException', errorListener);
      try {
        chmodSync(assetFile, 0o644);
        unlinkSync(assetFile);
      } catch {
        // Ignore
      }
      try {
        rmSync(tempDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
  });
});
