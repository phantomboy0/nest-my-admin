import { defineConfig, devices } from '@playwright/test';

// PW_CHANNEL=chrome uses the installed Google Chrome where the Playwright CDN is unreachable.
const channel = process.env.PW_CHANNEL;
const browser = channel ? { channel } : {};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  testIgnore: '**/screens.pw.ts', // the screenshot matrix has its own config (playwright.screens.config.ts)
  workers: 1,
  use: { baseURL: 'http://localhost:3310', trace: 'retain-on-failure' },
  webServer: {
    command: 'bun src/main.ts',
    env: { PORT: '3310' },
    url: 'http://localhost:3310/admin/api/meta',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    // Signs in once; the others reuse its cookie (e2e/.auth is not committed).
    { name: 'setup', testMatch: /login\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...browser } },
    { name: 'desktop', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], ...browser, storageState: 'e2e/.auth/admin.json' } },
    { name: 'mobile', dependencies: ['setup'], use: { ...devices['Pixel 7'], ...browser, storageState: 'e2e/.auth/admin.json' } },
  ],
});
