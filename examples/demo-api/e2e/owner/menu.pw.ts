import { expect, test, type Page } from '@playwright/test';

/** The sidebar, on phones behind the drawer. */
async function sidebar(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Resources' }).filter({ visible: true });
  if ((await nav.count()) === 0) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  return page.getByRole('navigation', { name: 'Resources' }).filter({ visible: true });
}

test('section pages follow the menu (Task 5; the home cards are in dashboard.pw.ts: the admin’s home is the dashboard)', async ({ page }) => {
  await page.goto('/admin/g/sales');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sales');
  await expect(page.getByRole('main').getByRole('link')).toHaveText([/^Order/, /^Invoice/]);
  // Order lines are edited on their order: no card, no section.
  await page.goto('/admin/g/advanced');
  await expect(page.getByRole('main').getByRole('link')).toHaveText([/^Order status log/, /^Employee/]);
});

test('the sidebar opens the section you are in, shows badges, and a one-item section is a link', async ({ page }) => {
  await page.goto('/admin/product');
  const nav = await sidebar(page);
  await expect(nav.getByRole('button', { name: 'Collapse Products' })).toHaveAttribute('aria-expanded', 'true');
  await expect(nav.getByRole('button', { name: 'Expand Sales' })).toHaveAttribute('aria-expanded', 'false');
  // Low stock (≤ 5): the seed has two such products.
  await expect(nav.getByRole('link', { name: /^Product/ })).toContainText(/\d/);
  await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('href', /\/admin\/p\/shop$/);
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', /\/admin\/?$/);
});

test('the palette offers records, actions and places, never a nav: false resource', async ({ page }) => {
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Search and go to' }).click();
  const palette = page.getByRole('dialog', { name: 'Search and go to' });
  await expect(palette.getByRole('group', { name: 'Actions' })).toContainText('Toggle theme');
  await expect(palette.getByRole('group', { name: 'Go to' })).toContainText('Sales');
  await palette.getByRole('combobox').fill('order line');
  await expect(palette.getByRole('option', { name: /Order line/ })).toHaveCount(0);
  await palette.getByRole('combobox').fill('theme');
  await palette.getByRole('combobox').press('Enter');
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('the order header: the primary next step names itself, runs in one click, and is gone when there is none (Task 8)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the header row is the same on phones');
  const res = await page.request.get('/admin/api/resources/order?filter%5Bstatus%5D%5Beq%5D=draft&pageSize=1');
  const draft = (await res.json()).items[0];
  await page.goto(`/admin/order/${encodeURIComponent(draft._id)}`);
  const next = page.getByRole('button', { name: 'Move to «paid»' });
  await expect(next).toBeVisible();
  // Last in the header row, and filled (the primary look).
  await expect(page.getByRole('group', { name: 'Actions' }).getByRole('button').last()).toHaveText(/Move to «paid»/);
  await next.click();
  await expect(page.getByRole('button', { name: 'Move to «shipped»' })).toBeVisible();
});

test('a session that ends mid-use: sign in again and land on the page asked for, not under /admin/admin', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const signIn = async () => {
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('admin-demo-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();
  };
  await page.goto('/admin/product');
  await signIn();
  await expect(page).toHaveURL(/\/admin\/product$/);
  // The server forgets the session (a restart does): the next request is refused.
  await context.clearCookies();
  await page.goto('/admin/category');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fcategory$/);
  await signIn();
  await expect(page).toHaveURL(/\/admin\/category$/);
  await context.close();
});

test('the collapsed sidebar’s flyout marks only the current page', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the rail is a desktop sidebar');
  await page.goto('/admin/category');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await page.getByRole('button', { name: 'Products', exact: true }).hover();
  const flyout = page.locator('[data-radix-popper-content-wrapper]');
  await expect(flyout.getByRole('link')).toHaveCount(5);
  await expect(flyout.locator('a[aria-current="page"]')).toHaveText('Category');
  for (const className of await flyout.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('class') ?? ''))) expect(className).not.toContain('=>');
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
});
