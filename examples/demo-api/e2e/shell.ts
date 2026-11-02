import { expect, type Locator, type Page } from '@playwright/test';

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

/** Picks `value` in the dashboard's dropdown (a button and a list, not a native select): opens it unless it is open (an inline cell edit opens it at once). */
export async function choose(select: Locator, value: string): Promise<void> {
  // An open list hides the rest of the page from the accessibility tree, so `select` is only looked up while closed.
  const list = select.page().getByRole('listbox');
  if (!(await list.isVisible())) await select.click();
  await list.locator(`[role="option"][data-value="${value}"]`).click();
  await expect(list).toBeHidden();
}

/** The value a dashboard dropdown shows (`data-value`; none when nothing is chosen). */
export async function expectChosen(select: Locator, value: string): Promise<void> {
  if (value === '') await expect(select).not.toHaveAttribute('data-value', /.+/);
  else await expect(select).toHaveAttribute('data-value', value);
}
