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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...browser } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...browser } },
  ],
});
