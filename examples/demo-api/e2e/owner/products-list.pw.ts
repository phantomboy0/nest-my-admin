import { expect, test } from '@playwright/test';

/** The products list as the design draws it: computed columns (Task 6). */
test('computed columns: picture, name over SKU, price over the earlier one, stock badge, specs, active switch', async ({ page, isMobile }) => {
  await page.goto('/admin/product');
  if (isMobile) {
    const card = page.getByRole('list', { name: 'Product' }).getByRole('listitem').filter({ hasText: 'Standing desk' });
    await expect(card).toContainText('DEMO-3');
    await expect(card.locator('[data-slot="badge"]').first()).toHaveText('Out of stock');
    await expect(page.getByRole('list', { name: 'Product' }).getByRole('listitem').filter({ hasText: 'Desk lamp' }).locator('s')).toHaveText('29.90');
    return;
  }
  // The picture is drawn inside the product cell (an image right before a title).
  await expect(page.getByRole('columnheader')).toContainText(['Product', 'Category', 'Price', 'Stock', 'Specs', 'Active']);
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(row('Standing desk')).toContainText('DEMO-3');
  await expect(row('Standing desk').locator('[data-tone="bad"]')).toHaveText('Out of stock');
  await expect(row('Brass lamp').locator('[data-tone="warn"]')).toHaveText('Low · 2');
  await expect(row('Notebook').locator('[data-tone="ok"]')).toHaveText('In stock · 200');
  await expect(row('Desk lamp').locator('s')).toHaveText('29.90');

  // The switch writes the status (active ↔ archived) with a PATCH, and the row follows.
  const toggle = row('Notebook').getByRole('switch', { name: 'Active: Notebook' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.reload();
  await expect(row('Notebook').getByRole('switch', { name: 'Active: Notebook' })).toHaveAttribute('aria-checked', 'false');
  await row('Notebook').getByRole('switch', { name: 'Active: Notebook' }).click();
  await expect(row('Notebook').getByRole('switch', { name: 'Active: Notebook' })).toHaveAttribute('aria-checked', 'true');

  // Specs is an aggregate: sortable, both ways.
  await page.getByRole('button', { name: 'Specs' }).click();
  await expect(page).toHaveURL(/sort=specCount/);
  await page.getByRole('button', { name: 'Specs' }).click();
  await expect(page).toHaveURL(/sort=-specCount/);
  await expect(page.getByRole('row').nth(1)).toContainText('Desk lamp'); // the seed gives it the specs
});
