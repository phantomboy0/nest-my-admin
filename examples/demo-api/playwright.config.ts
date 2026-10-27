import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// PW_CHANNEL=chrome uses the installed Google Chrome where the Playwright CDN is unreachable.
const channel = process.env.PW_CHANNEL;
const browser = channel ? { channel } : {};

/** One demo process; each keeps its own in-memory database. */
const server = (port: number, env: Record<string, string> = {}) => ({
  command: 'bun src/main.ts',
  // Uploads go to a directory of this run, never to the demo's own var/uploads.
  env: { PORT: String(port), NMA_LOGIN_ATTEMPTS_PER_MINUTE: '200', NMA_UPLOAD_DIR: join(tmpdir(), `nma-e2e-uploads-${process.pid}-${port}`), ...env },
  url: `http://localhost:${port}/admin/api/meta`,
  reuseExistingServer: false,
  timeout: 60_000,
});

/**
 * Two demos: the existing suites run against a host that sets none of the owner-admin options (NMA_DEMO_PLAIN=1,
 * :3310), so its behaviour stays pinned; e2e/owner/ tests the new features on the configured demo (:3311).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  testIgnore: '**/screens.pw.ts', // the screenshot matrix has its own config (playwright.screens.config.ts)
  workers: 1,
  use: { trace: 'retain-on-failure' },
  webServer: [server(3310, { NMA_DEMO_PLAIN: '1' }), server(3311)],
  projects: [
    // Signs in once; the others reuse its cookie (e2e/.auth is not committed).
    { name: 'setup', testMatch: /login\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3310' } },
    { name: 'desktop', dependencies: ['setup'], testIgnore: ['**/owner/**', '**/screens.pw.ts'], use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3310', storageState: 'e2e/.auth/admin.json' } },
    { name: 'mobile', dependencies: ['setup'], testIgnore: ['**/owner/**', '**/screens.pw.ts'], use: { ...devices['Pixel 7'], ...browser, baseURL: 'http://localhost:3310', storageState: 'e2e/.auth/admin.json' } },
    { name: 'owner-setup', testMatch: /login\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3311' } },
    { name: 'owner-desktop', dependencies: ['owner-setup'], testMatch: '**/owner/*.pw.ts', use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3311', storageState: 'e2e/.auth/admin-3311.json' } },
    { name: 'owner-mobile', dependencies: ['owner-setup'], testMatch: '**/owner/*.pw.ts', use: { ...devices['Pixel 7'], ...browser, baseURL: 'http://localhost:3311', storageState: 'e2e/.auth/admin-3311.json' } },
  ],
});
