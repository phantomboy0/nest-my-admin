// Real-vs-design screenshots for the owner-admin milestone (spec docs/superpowers/specs/2026-10-25-owner-admin-design.md §7).
//
//   bun run design:compare [screenId…] [--base-url <url>]
//
// The real side must be running first:
// - demo: `cd examples/demo-api && bun src/main.ts` (it seeds itself on boot); default base URL http://localhost:3000/admin,
//   signed in as admin / admin-demo-pass.
// - shop-nest: `bun run db:up && bun run start` in ~/Develop/shop-nest (seed once with `bun scripts/seed-design.ts`, Task 15),
//   then `--base-url http://localhost:4000/admin` with NMA_COMPARE_USER / NMA_COMPARE_PASSWORD set to the bootstrap admin
//   from shop-nest's .env (ADMIN_BOOTSTRAP_USERNAME / ADMIN_BOOTSTRAP_PASSWORD).
//
// Output goes to design-compare/ (git-ignored): <id>.png (real on the left, design on the right) and <id>-overlay.png (50%).
// The design pages load React from cdn.jsdelivr.net, so the network is needed for them; their font is served locally.
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(import.meta.dir, '..');
const require = createRequire(join(ROOT, 'examples/demo-api/package.json'));
const { chromium } = require('@playwright/test') as typeof import('@playwright/test');

const DESIGN = join(ROOT, 'docs/superpowers/specs/assets/2026-10-25-owner-admin/design.html');
const OUT = join(ROOT, 'design-compare');
const FONT = join(ROOT, 'node_modules/.bun/@fontsource-variable+vazirmatn@5.3.0/node_modules/@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2');

type Step = { click?: string; hover?: string; press?: string; viewport?: { width: number; height: number } };
type Clip = { x: number; y: number; width: number; height: number };
interface Screen { designId: string; viewport: { width: number; height: number }; theme: 'light' | 'dark'; route: string; crop?: Clip; designCrop?: Clip; setup?: Step[] }

const screens = JSON.parse(await readFile(join(import.meta.dir, 'design-screens.json'), 'utf8')) as Record<string, Screen>;
const ids = JSON.parse(await readFile(join(import.meta.dir, 'design-ids.json'), 'utf8')) as Record<string, string>;

const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base-url');
const baseUrl = (baseIndex >= 0 ? args.splice(baseIndex, 2)[1] : 'http://localhost:3000/admin')!.replace(/\/$/, '');
const wanted = args.length ? args : Object.keys(screens);
for (const id of wanted) if (!screens[id]) throw new Error(`unknown screen ${id}; known: ${Object.keys(screens).join(', ')}`);

/** The design file holds each board as a gzip+base64 HTML page in its bundler manifest. */
async function designPages(): Promise<Map<string, string>> {
  const html = await readFile(DESIGN, 'utf8');
  const manifest = JSON.parse(html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/)![1]!) as Record<string, { data: string; compressed?: boolean; mime: string }>;
  const pages = new Map<string, string>();
  for (const [uuid, entry] of Object.entries(manifest)) {
    const id = ids[uuid.slice(0, 4)];
    if (!id || entry.mime !== 'text/html') continue;
    const bytes = Buffer.from(entry.data, 'base64');
    pages.set(id, (entry.compressed ? gunzipSync(bytes) : bytes).toString('utf8'));
  }
  return pages;
}

const pages = await designPages();
const font = await readFile(FONT);
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
await mkdir(OUT, { recursive: true });

async function shootDesign(screen: Screen): Promise<Buffer> {
  const page = await browser.newPage({ viewport: screen.viewport });
  await page.route('https://fonts.gstatic.com/**', (route) => route.fulfill({ body: font, contentType: 'font/woff2' }));
  await page.setContent(pages.get(screen.designId)!, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const clip = screen.designCrop ?? screen.crop;
  const shot = await page.screenshot({ fullPage: !clip, clip });
  await page.close();
  return shot;
}

async function shootReal(screen: Screen, storage: string): Promise<Buffer> {
  const context = await browser.newContext({ viewport: screen.viewport, storageState: storage });
  await context.addInitScript((theme) => { localStorage.setItem('nma.locale', 'fa'); localStorage.setItem('nma.theme', theme); }, screen.theme);
  const page = await context.newPage();
  await page.goto(baseUrl + screen.route, { waitUntil: 'networkidle' });
  for (const step of screen.setup ?? []) {
    if (step.viewport) await page.setViewportSize(step.viewport);
    if (step.click) await page.locator(step.click).first().click({ timeout: 5000 });
    if (step.hover) await page.locator(step.hover).first().hover({ timeout: 5000 });
    if (step.press) await page.keyboard.press(step.press);
    await page.waitForTimeout(300);
  }
  const shot = await page.screenshot({ fullPage: !screen.crop, clip: screen.crop });
  await context.close();
  return shot;
}

/** Signs in once through the real login page and keeps the session for every screen. */
async function signIn(): Promise<string> {
  const storage = join(OUT, '.auth.json');
  const page = await browser.newPage();
  await page.goto(baseUrl + '/', { waitUntil: 'networkidle' });
  if (await page.locator('input[type="password"]').count()) {
    await page.locator('input[autocomplete="username"], input[name="username"]').first().fill(process.env.NMA_COMPARE_USER ?? 'admin');
    await page.locator('input[type="password"]').first().fill(process.env.NMA_COMPARE_PASSWORD ?? 'admin-demo-pass');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((url) => !url.pathname.includes('/login'));
  }
  await page.context().storageState({ path: storage });
  await page.close();
  return storage;
}

/** Puts both shots on one page (real left, design right) and as a 50% overlay, rendered by the same browser. */
async function compose(id: string, real: Buffer, design: Buffer): Promise<void> {
  const src = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent(`<body style="margin:0;display:flex;gap:24px;background:#888;align-items:flex-start">
    <img src="${src(real)}"><img src="${src(design)}"></body>`);
  await page.screenshot({ path: join(OUT, `${id}.png`), fullPage: true });
  await page.setContent(`<body style="margin:0;position:relative;background:#fff">
    <img src="${src(design)}" style="position:absolute;top:0;left:0"><img src="${src(real)}" style="position:absolute;top:0;left:0;opacity:.5"></body>`);
  await page.screenshot({ path: join(OUT, `${id}-overlay.png`), fullPage: true });
  await page.close();
}

const storage = await signIn();
for (const id of wanted) {
  const screen = screens[id]!;
  if (!pages.has(screen.designId)) throw new Error(`design board ${screen.designId} not found in ${DESIGN}`);
  const [real, design] = [await shootReal(screen, storage), await shootDesign(screen)];
  await compose(id, real, design);
  console.log(`${id}: ${join(OUT, `${id}.png`)}  ${join(OUT, `${id}-overlay.png`)}`);
}
await browser.close();
