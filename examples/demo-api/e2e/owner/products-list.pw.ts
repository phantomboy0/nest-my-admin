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

test('tabs: counts, the active tab from the URL, and a tab that restricts beyond filters', async ({ page }) => {
  await page.goto('/admin/product');
  const tabs = page.getByRole('tablist');
  await expect(tabs.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: /^Active/ })).toContainText(/\d/);
  await tabs.getByRole('tab', { name: /^Active/ }).click();
  await expect(page).toHaveURL(/filter%5Bstatus%5D%5Beq%5D=active/);
  await expect(tabs.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Standing desk', { exact: true }).filter({ visible: true })).toHaveCount(0); // a draft
  // The tab's own filter is the tab, not a chip.
  await expect(page.getByRole('list', { name: 'Active filters' })).toHaveCount(0);
  await tabs.getByRole('tab', { name: /^Out of stock/ }).click();
  await expect(page).toHaveURL(/tab=out/);
  await expect(page).not.toHaveURL(/filter%5Bstatus/);
  await expect(page.getByText('Standing desk', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('Notebook', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await page.goto('/admin/product?filter%5Bstatus%5D%5Beq%5D=archived');
  await expect(tabs.getByRole('tab', { name: /^Inactive/ })).toHaveAttribute('aria-selected', 'true');
});
