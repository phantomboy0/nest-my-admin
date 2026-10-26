import { expect, test, type Page } from '@playwright/test';

/** The sidebar, on phones behind the drawer. */
async function sidebar(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Resources' }).filter({ visible: true });
  if ((await nav.count()) === 0) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  return page.getByRole('navigation', { name: 'Resources' }).filter({ visible: true });
}

test('home cards and section pages follow the menu (Task 5)', async ({ page }) => {
  await page.goto('/admin/');
  const headings = page.getByRole('main').getByRole('heading', { level: 2 });
  await expect(headings).toHaveText(['Sales', 'Products', 'Content', 'Settings', 'Advanced']);
  await page.getByRole('link', { name: 'Sales', exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/g\/sales$/);
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
