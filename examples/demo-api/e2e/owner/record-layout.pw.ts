import { expect, test } from '@playwright/test';

/** The design's order page: view mode, the header line, and read-only cards beside the form (Task 9). */
test('an order opens as text with its aside cards, sends no write, and «Edit» brings the inputs', async ({ page, isMobile }) => {
  const res = await page.request.get('/admin/api/resources/order?search=SO-1001');
  const order = (await res.json()).items[0];
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/admin/api/') && request.method() !== 'GET') writes.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`/admin/order/${encodeURIComponent(order._id)}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('SO-1001');
  await expect(page.getByText('Ada Lovelace ·')).toBeVisible(); // the subtitle: customer · created

  // View mode: values, no inputs, no save bar.
  await expect(page.getByRole('textbox', { name: 'Customer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  // The aside: the order's own fields, and the employee who handles it, linked (after the main column on phones).
  const payment = page.getByRole('region', { name: 'Payment' });
  await expect(payment).toContainText('TRK-448120');
  const handler = page.getByRole('region', { name: 'Handled by' });
  await expect(handler).toContainText('Hedy Lamarr');
  await expect(handler).toContainText('Warehouse lead');
  await expect(handler.getByRole('link', { name: 'View' })).toHaveAttribute('href', /\/admin\/employee\/\d+$/);
  if (isMobile) {
    const main = await page.getByRole('region', { name: 'Order' }).boundingBox();
    expect((await payment.boundingBox())!.y).toBeGreaterThan(main!.y);
  }
  expect(writes).toEqual([]);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Customer' })).toHaveValue('Ada Lovelace');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('inline presentation: read-only lines with pictures and totals; picture cards mark the main one and warn about alt text (Task 10)', async ({ page }) => {
  const res = await page.request.get('/admin/api/resources/order?search=SO-1001');
  const order = (await res.json()).items[0];
  await page.goto(`/admin/order/${encodeURIComponent(order._id)}`);
  const lines = page.getByRole('region', { name: 'Lines' });
  await expect(lines.getByRole('columnheader', { name: 'Picture' })).toBeVisible();
  await expect(lines).toContainText('Desk lamp');
  await expect(lines.getByRole('textbox')).toHaveCount(0); // read-only, even after «Edit»
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(lines.getByRole('textbox')).toHaveCount(0);
  await expect(lines.getByRole('button', { name: /^Add/ })).toHaveCount(0);
  const totals = page.getByRole('region', { name: 'Totals' });
  await expect(totals).toContainText('Items');
  await expect(totals).toContainText('2');
  await expect(totals).toContainText('523.90');

  const product = (await (await page.request.get('/admin/api/resources/product?search=Notebook')).json()).items[0];
  await page.goto(`/admin/product/${encodeURIComponent(product._id)}`);
  const pictures = page.getByRole('region', { name: 'More pictures' });
  await pictures.getByRole('button', { name: /^Add/ }).click();
  await expect(pictures.getByText('Main picture')).toBeVisible();
  await expect(pictures.getByText(/No alt text/)).toBeVisible();
  await pictures.getByRole('textbox', { name: 'Caption' }).fill('A notebook');
  await expect(pictures.getByText(/No alt text/)).toHaveCount(0);
});

test('the order’s steps: done with times, the current one «since», the rest ahead (Task 11)', async ({ page }) => {
  const res = await page.request.get('/admin/api/resources/order?search=SO-1001');
  const order = (await res.json()).items[0];
  await page.goto(`/admin/order/${encodeURIComponent(order._id)}`);
  const steps = page.getByRole('region', { name: 'Fulfillment' }).getByRole('listitem');
  await expect(steps).toHaveCount(6);
  await expect(steps.nth(0)).toContainText('Queued');
  await expect(steps.nth(0)).toContainText('10:42');
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(2)).toContainText('since 11:20');
  await expect(steps.nth(3)).toContainText('—');
});
