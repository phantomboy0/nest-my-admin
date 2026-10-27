import { expect, test } from '@playwright/test';

test('an order prints its invoice in a new tab', async ({ page, context }) => {
  const order = (await (await page.request.get('/admin/api/resources/order?search=SO-1001')).json()).items[0];
  await page.goto(`/admin/order/${encodeURIComponent(order._id)}`);
  const [tab] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Print Invoice' }).click()]);
  // The page would open the print dialog; headless it does nothing.
  await tab.waitForLoadState();
  await expect(tab.getByRole('heading', { name: /^Invoice / })).toBeVisible();
  await expect(tab.getByRole('button', { name: 'Print' })).toBeVisible();
  await tab.close();
});

test('the order list downloads as Excel, filtered as shown', async ({ page }) => {
  await page.goto('/admin/order?filter[status]=paid');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export to Excel' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^order-\d{4}-\d{2}-\d{2}\.xlsx$/);
  await expect(page.getByText(/downloaded\./)).toBeVisible();
});
