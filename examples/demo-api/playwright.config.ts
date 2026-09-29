import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
