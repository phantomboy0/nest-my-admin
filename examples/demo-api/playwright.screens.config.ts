import { defineConfig, devices } from '@playwright/test';

// Screenshot matrix (spec §13): desktop/mobile × en/fa × light/dark, on a fresh demo database so the data never
// differs. `bun run e2e:screens -- --update-snapshots` rewrites the baselines after a deliberate UI change.
// PW_CHANNEL=chrome uses installed Chrome; PW_EXECUTABLE_PATH points at another Chromium build.
const channel = process.env.PW_CHANNEL;
const executablePath = process.env.PW_EXECUTABLE_PATH;
const browser = { ...(channel ? { channel } : {}), ...(executablePath ? { launchOptions: { executablePath } } : {}) };

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/screens.pw.ts',
  workers: 1,
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  use: { baseURL: 'http://localhost:3320', trace: 'retain-on-failure' },
  webServer: {
    command: 'bun src/main.ts',
    env: { PORT: '3320' },
    url: 'http://localhost:3320/admin/api/meta',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'setup', testMatch: /screens\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...browser } },
    { name: 'desktop', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], ...browser, storageState: 'e2e/.auth/screens.json' } },
    { name: 'mobile', dependencies: ['setup'], use: { ...devices['Pixel 7'], ...browser, storageState: 'e2e/.auth/screens.json' } },
  ],
});
