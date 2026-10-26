import { expect, test as setup } from '@playwright/test';

/** Signs in once through the real login page; every other project starts from this browser state. */
setup('sign in as the demo superuser', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/login\?next=%2F$/);
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('admin-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Demo shop' })).toBeVisible();
  // One state per demo (the plain one on :3310 and the configured one on :3311).
  const port = new URL(page.url()).port;
  await page.context().storageState({ path: port === '3310' ? 'e2e/.auth/admin.json' : `e2e/.auth/admin-${port}.json` });
});
