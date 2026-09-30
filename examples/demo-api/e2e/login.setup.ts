import { expect, test as setup } from '@playwright/test';

/** Signs in once through the real login page; every other project starts from this browser state. */
setup('sign in as the demo superuser', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2F$/);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('admin-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
