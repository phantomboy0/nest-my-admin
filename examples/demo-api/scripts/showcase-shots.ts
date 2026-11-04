/**
 * The README's screenshots (`docs/images/*.png` at the repository root), taken from the showcase shop in the Chrome
 * installed on this machine (Playwright's `chrome` channel: nothing is downloaded).
 *
 *   bun run build
 *   cd examples/demo-api
 *   NMA_DEMO_SHOWCASE=1 NMA_UPLOAD_DIR=$(mktemp -d) PORT=3100 bun src/main.ts &
 *   bun scripts/showcase-shots.ts            # SHOTS_URL=http://localhost:3100 by default
 *
 * The showcase seeds from a fixed seed and dates relative to today, so a run another day shows the same shop.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const base = process.env.SHOTS_URL ?? 'http://localhost:3100';
const out = join(import.meta.dir, '../../../docs/images');
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);

type Shot = {
  name: string;
  locale?: 'en' | 'fa';
  theme?: 'light' | 'dark';
  mobile?: boolean;
  /** Opens the page and brings it to the state to show. */
  run: (page: Page) => Promise<void>;
};

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate('document.fonts.ready');
  await page.waitForTimeout(350); // animations end
}

/** The largest order with this status (the most lines): its page is the most telling. */
async function openOrder(page: Page, status: string, skip = 0): Promise<void> {
  await page.goto(`${base}/admin/order?filter[status][eq]=${status}&sort=-total`);
  await settle(page);
  // The list re-renders once after its first paint (counts and badges arrive): wait for the row, then click it.
  const order = page.getByText(/^SO-\d+$/).filter({ visible: true }).nth(skip); // table rows, or cards on phones
  await order.waitFor();
  await page.waitForTimeout(600);
  await order.click();
  await openFromQuickView(page, 'order');
}

/** A row opens its quick view; the record's own page is `/admin/<resource>/<id>`, with the id the sheet shows. */
async function openFromQuickView(page: Page, resource: string): Promise<void> {
  const sheet = page.getByRole('dialog');
  await Promise.race([sheet.waitFor(), page.waitForURL(new RegExp(`/admin/${resource}/\\d+$`))]);
  if (new RegExp(`/admin/${resource}/\\d+$`).test(page.url())) return settle(page); // a link to the record itself
  const id = (await sheet.innerText()).match(/\bId\s+(\d+)/)?.[1];
  if (!id) throw new Error(`no id in the ${resource} quick view`);
  await page.goto(`${base}/admin/${resource}/${id}`);
  await settle(page);
}

const SHOTS: Shot[] = [
  { name: 'dashboard', run: async (page) => { await page.goto(`${base}/admin`); await settle(page); } },
  { name: 'products', run: async (page) => { await page.goto(`${base}/admin/product`); await settle(page); } },
  { name: 'products-dark', theme: 'dark', run: async (page) => { await page.goto(`${base}/admin/product`); await settle(page); } },
  {
    name: 'filters',
    run: async (page) => {
      await page.goto(`${base}/admin/product?filter[categoryId][eq]=1`);
      await settle(page);
      await page.getByRole('list', { name: 'Filters' }).getByRole('button', { name: 'Status' }).click();
      await settle(page);
    },
  },
  {
    name: 'quick-view',
    run: async (page) => {
      await page.goto(`${base}/admin/product`);
      await settle(page);
      // The name links to the record; the rest of the row opens its quick view.
      const row = page.getByRole('row').filter({ hasText: 'Over-ear headphones' });
      await row.waitFor();
      await page.waitForTimeout(600);
      await row.getByRole('cell').nth(5).click(); // the Specs count
      await settle(page);
    },
  },
  { name: 'order', run: async (page) => { await openOrder(page, 'paid'); } },
  { name: 'order-dark', theme: 'dark', run: async (page) => { await openOrder(page, 'shipped', 1); } },
  {
    name: 'product-form',
    run: async (page) => {
      await page.goto(`${base}/admin/product?search=LO-1002`);
      await settle(page);
      await page.getByText('Brass desk lamp', { exact: true }).filter({ visible: true }).first().click();
      await openFromQuickView(page, 'product');
    },
  },
  {
    name: 'command-palette',
    run: async (page) => {
      await page.goto(`${base}/admin/order`);
      await settle(page);
      await page.keyboard.press('ControlOrMeta+k');
      await page.keyboard.type('lamp', { delay: 40 });
      await settle(page);
    },
  },
  { name: 'rtl', locale: 'fa', run: async (page) => { await page.goto(`${base}/admin`); await settle(page); } },
  { name: 'permissions', run: async (page) => { await page.goto(`${base}/admin/-/roles/catalog-editor`); await settle(page); } },
  {
    // Why the editor may change some products and not others: their role, its scope and the read-only price.
    name: 'debugger',
    run: async (page) => {
      await page.goto(`${base}/admin/-/debugger`);
      await settle(page);
      await page.getByLabel('User').fill('editor');
      await page.getByRole('button', { name: /Demo Editor/ }).click();
      await page.locator('#debug-resource').click();
      await page.getByRole('option', { name: 'Product', exact: true }).click();
      await page.getByRole('button', { name: 'Explain' }).click();
      await settle(page);
    },
  },
  { name: 'settings', run: async (page) => { await page.goto(`${base}/admin/p/shop`); await settle(page); } },
  { name: 'mobile-list', mobile: true, run: async (page) => { await page.goto(`${base}/admin/product`); await settle(page); } },
  { name: 'mobile-order', mobile: true, run: async (page) => { await openOrder(page, 'paid'); } },
];

async function signedIn(browser: Browser): Promise<string> {
  const page = await browser.newPage();
  await page.goto(`${base}/admin/login`);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill(process.env.NMA_DEMO_PASSWORD ?? 'admin-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  const state = join(import.meta.dir, '../e2e/.auth/showcase.json');
  await page.context().storageState({ path: state });
  await page.close();
  return state;
}

const browser = await chromium.launch({ channel: 'chrome' });
const storageState = await signedIn(browser);
for (const shot of SHOTS) {
  if (only.length && !only.includes(shot.name)) continue;
  const context = await browser.newContext({
    storageState,
    ...(shot.mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }),
    colorScheme: shot.theme ?? 'light',
  });
  await context.addInitScript(([locale, theme]) => {
    localStorage.setItem('nma.locale', locale!);
    localStorage.setItem('nma.theme', theme!);
  }, [shot.locale ?? 'en', shot.theme ?? 'light']);
  const page = await context.newPage();
  await shot.run(page);
  await page.screenshot({ path: join(out, `${shot.name}.png`) });
  await context.close();
  console.log(`${shot.name}.png`);
}
await browser.close();
