import { expect, test } from '@playwright/test';

/** Couriers are an @AdminSource: rows from a (pretend) provider, not a table. The pages work as on any resource. */
test('a source resource: list, search, filter, create, edit, action, delete', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the table is the desktop list');
  await page.goto('/admin/courier');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Couriers');
  const row = (name: string) => page.getByRole('row').filter({ hasText: name });
  await expect(row('Tipax')).toContainText('TPX');
  await expect(row('DHL Express')).toContainText('International');

  // Search runs through findMany.
  await page.getByLabel('Search', { exact: true }).fill('chap');
  await page.getByLabel('Search', { exact: true }).press('Enter');
  await expect(row('Chapar')).toBeVisible();
  await expect(row('Tipax')).toHaveCount(0);
  await page.getByLabel('Search', { exact: true }).fill('');
  await page.getByLabel('Search', { exact: true }).press('Enter');
  await expect(row('Tipax')).toBeVisible();

  // New: the create form, then the record page.
  await page.getByRole('link', { name: 'New' }).click();
  await page.getByLabel('Code').fill('snp');
  await page.getByLabel('Name').fill('Snapp Box');
  await page.getByLabel('Zone').selectOption('domestic');
  await page.getByLabel('Price per kg').fill('30000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/courier$/);
  await expect(row('Snapp Box')).toContainText('SNP');
  await row('Snapp Box').getByRole('link', { name: 'SNP' }).click();
  await expect(page).toHaveURL(/\/admin\/courier\/SNP$/);

  // A record action reads the row.
  await page.getByRole('button', { name: 'Quote' }).click();
  await page.getByRole('dialog').getByLabel('Weight (kg)').fill('3');
  await page.getByRole('dialog').getByRole('button', { name: 'Quote' }).click();
  await expect(page.getByText('Snapp Box: 90,000 for 3 kg')).toBeVisible();
  // Its speed is a dropdown the provider fills when the dialog opens (choices).
  await page.getByRole('button', { name: 'Quote' }).click();
  await page.getByRole('dialog').getByLabel('Weight (kg)').fill('3');
  const speed = page.getByRole('dialog').getByLabel('Speed');
  await expect(speed).toHaveValue('standard');
  await expect(speed.getByRole('option', { name: 'Express (×2)' })).toBeAttached();
  await speed.selectOption('express');
  await page.getByRole('dialog').getByRole('button', { name: 'Quote' }).click();
  await expect(page.getByText('Snapp Box: 180,000 for 3 kg (express)')).toBeVisible();

  // Edit, through update().
  await page.goto('/admin/courier/SNP');
  await page.getByLabel('Name').fill('Snapp Box Express');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/admin/courier');
  await expect(row('Snapp Box Express')).toContainText('SNP');

  // Delete, through delete().
  await page.goto('/admin/courier/SNP');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page).toHaveURL(/\/admin\/courier$/);
  await expect(row('Snapp Box')).toHaveCount(0);
});
