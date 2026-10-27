import { expect, test } from '@playwright/test';

/** The dashboard (Task 13): the admin's home in the configured demo. */
test('widgets of every type load for the period in the URL; a period change refetches them all', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sales', exact: true })).toContainText('Toman');
  await expect(page.getByRole('region', { name: 'Sales by day' }).getByRole('img')).toBeVisible();
  const latest = page.getByRole('region', { name: 'Latest orders' });
  await expect(latest.getByRole('row')).toHaveCount(6); // header + 5 seeded orders
  await expect(latest.getByRole('link', { name: 'View all' })).toHaveAttribute('href', /\/admin\/order$/);
  await expect(page.getByRole('region', { name: 'This month’s sales goal' })).toContainText('%');
  await expect(page.getByRole('region', { name: 'To restock' }).getByRole('link')).toHaveCount(2);

  const loads: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/dashboard\/[^?]+\?/.test(request.url())) loads.push(new URL(request.url()).searchParams.get('period')!);
  });
  await page.getByRole('tab', { name: 'Month' }).click();
  await expect(page).toHaveURL(/period=month/);
  await expect.poll(() => loads.filter((period) => period === 'month').length).toBe(7);
});

test('a widget that fails shows its own error; the others load', async ({ page }) => {
  await page.route(/\/api\/dashboard\/orders\?/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"code":"INTERNAL","message":"down"}' }));
  await page.goto('/admin/');
  await expect(page.getByRole('region', { name: 'Orders', exact: true }).getByRole('alert')).toContainText('could not load');
  await expect(page.getByRole('region', { name: 'Sales', exact: true })).toContainText('Toman');
});

test('without a widget to see, the home page lists the menu’s sections', async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('editor');
  await page.getByLabel('Password').fill('editor-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText(['Sales', 'Products', 'Settings']);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toHaveCount(0);
  await context.close();
});
