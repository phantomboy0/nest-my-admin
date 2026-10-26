import type { Page } from '@playwright/test';

/**
 * The account menu lives in the sidebar's user block (owner-admin design); on phones the sidebar is the drawer, so the
 * drawer opens first. The menu holds the account page, the audit log, language, display and theme, and sign-out.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  // The block renders with the shell; wait for it before deciding whether it is behind the phone drawer.
  await page.locator('[data-user-block]').first().waitFor({ state: 'attached' });
  if (!(await page.locator('[data-user-block]').first().isVisible())) {
    await page.getByRole('button', { name: /^(Menu|منو)$/ }).filter({ visible: true }).click();
  }
  await page.locator('[data-user-block]').filter({ visible: true }).first().click();
}
