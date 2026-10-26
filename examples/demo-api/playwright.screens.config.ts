import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  use: { trace: 'retain-on-failure' },
  // The configured demo (:3320), and a host that sets none of the 0.4 options (NMA_DEMO_PLAIN=1, :3321): its own
  // baselines (`plain-desktop`, `plain-mobile`) pin what such a host looks like.
  webServer: [3320, 3321].map((port) => ({
    command: 'bun src/main.ts',
    // Uploads go to a directory of this run, never to the demo's own var/uploads.
    env: { PORT: String(port), NMA_UPLOAD_DIR: join(tmpdir(), `nma-screens-uploads-${process.pid}-${port}`), ...(port === 3321 ? { NMA_DEMO_PLAIN: '1' } : {}) },
    url: `http://localhost:${port}/admin/api/meta`,
    reuseExistingServer: false,
    timeout: 60_000,
  })),
  projects: [
    { name: 'setup', testMatch: /screens\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3320' } },
    { name: 'desktop', dependencies: ['setup'], use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3320', storageState: 'e2e/.auth/screens.json' } },
    { name: 'mobile', dependencies: ['setup'], use: { ...devices['Pixel 7'], ...browser, baseURL: 'http://localhost:3320', storageState: 'e2e/.auth/screens.json' } },
    { name: 'plain-setup', testMatch: /screens\.setup\.ts/, use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3321' } },
    { name: 'plain-desktop', dependencies: ['plain-setup'], use: { ...devices['Desktop Chrome'], ...browser, baseURL: 'http://localhost:3321', storageState: 'e2e/.auth/screens-3321.json' } },
    { name: 'plain-mobile', dependencies: ['plain-setup'], use: { ...devices['Pixel 7'], ...browser, baseURL: 'http://localhost:3321', storageState: 'e2e/.auth/screens-3321.json' } },
  ],
});
