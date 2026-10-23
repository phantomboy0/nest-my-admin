import { expect, test, type Browser, type Page } from '@playwright/test';

/** The session's CSRF token as a header, for writes through `page.request` (it shares the signed-in cookie). */
async function csrf(page: Page): Promise<Record<string, string>> {
  const session = await (await page.request.get('/admin/api/session')).json();
  return { 'X-CSRF-Token': session.csrfToken };
}

/** An order made through the API (a draft; `paid` runs the Mark paid action on it); returns its id. */
async function makeOrder(page: Page, number: string, status: 'draft' | 'paid' = 'draft'): Promise<string> {
  const headers = await csrf(page);
  const created = await page.request.post('/admin/api/resources/order', { data: { number, customer: 'Playwright', total: '10.00' }, headers });
  expect(created.status()).toBe(201);
  const id = String((await created.json())._id);
  if (status === 'paid') {
    const paid = await page.request.post('/admin/api/resources/order/actions/markPaid', { data: { ids: [id] }, headers });
    expect(paid.status()).toBe(200);
  }
  return id;
}

const order = async (page: Page, id: string) => (await page.request.get(`/admin/api/resources/order/${id}`)).json();

/** Orders are made as the superuser, also for tests that then sign in as someone else. */
async function asAdmin<T>(browser: Browser, baseURL: string | undefined, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL, storageState: 'e2e/.auth/admin.json' });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

test('two orders are shipped from the list selection; the one that cannot be is reported (M4-2)', async ({ page, isMobile }, testInfo) => {
  const prefix = `SHIP-${testInfo.project.name.toUpperCase()}`;
  const first = await makeOrder(page, `${prefix}-1`, 'paid');
  const second = await makeOrder(page, `${prefix}-2`, 'paid');
  const unpaid = await makeOrder(page, `${prefix}-3`);

  await page.goto(`/admin/order?search=${prefix}`);
  if (isMobile) await page.getByRole('button', { name: 'Select', exact: true }).click();
  for (const suffix of [1, 2, 3]) await page.getByLabel(`Select ${prefix}-${suffix}`).check();
  const bar = page.getByRole('region', { name: '3 selected' });
  await bar.getByRole('button', { name: 'Ship' }).click();

  const dialog = page.getByRole('dialog', { name: 'Ship' });
  // A run on several records always asks, with the count (Ship has no `confirm` of its own).
  await expect(dialog).toContainText('Run “Ship” on 3 records?');
  await expect(dialog).toContainText('Each of the 3 records is handled on its own');
  // The input form is checked like any form, before anything is sent.
  await dialog.getByRole('button', { name: 'Ship' }).click();
  await expect(dialog.getByText('is required')).toBeVisible();
  await dialog.getByLabel('Tracking code').fill('ab');
  await dialog.getByRole('button', { name: 'Ship' }).click();
  await expect(dialog.getByText('must be at least 4 characters')).toBeVisible();
  await dialog.getByLabel('Tracking code').fill(`TRK-${prefix}`);
  await dialog.getByRole('button', { name: 'Ship' }).click();
  await expect(dialog).toBeHidden();

  const summary = page.getByRole('status').filter({ hasText: 'Ship: 2 done' });
  await expect(summary).toContainText('1 failed');
  await expect(summary).toContainText(`Order ${prefix}-3 is not paid yet: mark it paid first`);
  // Every order that ran said the same thing: the host's message is the toast.
  await expect(page.getByRole('status').filter({ hasText: /^Shipped$/ })).toBeVisible();
  await expect(page.getByRole('region', { name: /selected$/ })).toHaveCount(0);

  expect(await order(page, first)).toMatchObject({ status: 'shipped', tracking: `TRK-${prefix}` });
  expect(await order(page, second)).toMatchObject({ status: 'shipped', tracking: `TRK-${prefix}` });
  expect(await order(page, unpaid)).toMatchObject({ status: 'draft', tracking: null });
  // The list reloaded.
  await expect(page.getByText(`TRK-${prefix}`).filter({ visible: true })).toHaveCount(2);
});

test('an order is paid, shipped and another cancelled from the detail page (M4-2)', async ({ page }, testInfo) => {
  const prefix = `ACT-${testInfo.project.name.toUpperCase()}`;
  const id = await makeOrder(page, `${prefix}-1`);
  await page.goto(`/admin/order/${id}`);
  const actions = page.getByRole('group', { name: 'Actions' });
  await expect(actions.getByRole('button')).toHaveText(['Mark paid', 'Ship', 'Cancel order']);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Order: ${prefix}-1`);

  // Unsaved changes first: an action reloads the record.
  await page.getByLabel('Customer').fill('Someone else');
  await expect(actions.getByRole('button', { name: 'Ship' })).toBeDisabled();
  await expect(actions).toContainText('Save or discard your changes first.');
  await page.getByLabel('Customer').fill('Playwright');
  await expect(actions.getByRole('button', { name: 'Ship' })).toBeEnabled();
  await expect(actions).not.toContainText('Save or discard');

  // The host refuses (409): its message is shown in the dialog, which stays open.
  await actions.getByRole('button', { name: 'Ship' }).click();
  const ship = page.getByRole('dialog', { name: 'Ship' });
  await ship.getByLabel('Tracking code').fill('TRK-TOO-EARLY');
  await ship.getByRole('button', { name: 'Ship' }).click();
  await expect(ship.getByRole('alert')).toHaveText(`Order ${prefix}-1 is not paid yet: mark it paid first`);
  // Ctrl+S belongs to the page's form, which is under the dialog now: nothing is saved and the dialog stays.
  let recordSaves = 0;
  const countSaves = (request: { method(): string; url(): string }) => {
    if (request.method() === 'PATCH' && request.url().includes(`/api/resources/order/${id}`)) recordSaves++;
  };
  page.on('request', countSaves);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(ship.getByLabel('Tracking code')).toHaveValue('TRK-TOO-EARLY');
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toHaveCount(0);
  await ship.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(ship).toBeHidden();
  page.off('request', countSaves);
  expect(recordSaves).toBe(0);
  expect(await order(page, id)).toMatchObject({ status: 'draft', tracking: null });

  // No question and no form: it runs on the click, and the host's message is the toast.
  await actions.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Order ${prefix}-1 is paid` })).toBeVisible();
  await expect(page.locator('[data-color="blue"]')).toHaveText('Paid');
  // Paid: the rules take Mark paid and Cancel away from this record.
  await expect(actions.getByRole('button')).toHaveText(['Ship']);

  await actions.getByRole('button', { name: 'Ship' }).click();
  await ship.getByLabel('Tracking code').fill(`TRK-${prefix}`);
  await ship.getByLabel('Tracking code').press('Enter');
  await expect(ship).toBeHidden();
  await expect(page.locator('[data-color="green"]')).toHaveText('Shipped');
  await expect(page.locator('[data-readonly="tracking"]')).toContainText(`TRK-${prefix}`);
  await expect(actions).toHaveCount(0); // nothing left to do with a shipped order
  await expect(page).toHaveURL(new RegExp(`/admin/order/${id}$`));

  // Cancel asks first; saying no changes nothing.
  const draft = await makeOrder(page, `${prefix}-2`);
  await page.goto(`/admin/order/${draft}`);
  await actions.getByRole('button', { name: 'Cancel order' }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel order' });
  await expect(cancel).toContainText('Cancel this order? It cannot be reopened.');
  await cancel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(cancel).toBeHidden();
  expect((await order(page, draft)).status).toBe('draft');

  await actions.getByRole('button', { name: 'Cancel order' }).click();
  await cancel.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByRole('status').filter({ hasText: '“Cancel order” done.' })).toBeVisible();
  await expect(page.locator('[data-color="gray"]')).toHaveText('Cancelled');
  await expect(actions).toHaveCount(0);
  expect((await order(page, draft)).status).toBe('cancelled');
});

test('a resource action runs from the list toolbar with its form (M4-2)', async ({ page }) => {
  await page.goto('/admin/order');
  await page.getByRole('button', { name: 'Cancel stale drafts' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel stale drafts' });
  await expect(dialog).toContainText('Cancel every draft order older than this?');
  await dialog.getByLabel('Older than (days)').fill('400');
  await dialog.getByRole('button', { name: 'Cancel stale drafts' }).click();
  await expect(dialog.getByText('must be at most 365')).toBeVisible();
  await dialog.getByLabel('Older than (days)').fill('90');
  await dialog.getByRole('button', { name: 'Cancel stale drafts' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'No draft is older than 90 days' })).toBeVisible();
});

test.describe('roles and actions', () => {
  test('the role matrix lists actions and settings pages; the debugger explains them (M4-2)', async ({ page }) => {
    await page.goto('/admin/-/roles/catalog-editor');
    await page.getByRole('button', { name: 'Fields and scopes of Order', exact: true }).click();
    const orderActions = page.locator('[data-actions="order"]');
    await expect(orderActions.getByLabel('Ship')).toBeChecked();
    await expect(orderActions.getByLabel('Mark paid')).not.toBeChecked();
    await expect(orderActions.getByLabel('Cancel order')).not.toBeChecked();
    await expect(orderActions).toContainText('order.action.ship');
    await expect(orderActions).toContainText('Actions on records also need Change.');
    await expect(page.getByRole('checkbox', { name: 'View Shop settings' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Change Shop settings' })).not.toBeChecked();

    // A new role: ticking Change on a page shows that viewing comes with it.
    await page.goto('/admin/-/roles/new');
    await page.getByRole('checkbox', { name: 'Change Shop settings' }).check();
    await expect(page.getByRole('checkbox', { name: 'View Shop settings' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'View Shop settings' })).toBeDisabled();

    await page.goto('/admin/-/debugger?user=2&resource=order');
    const explanation = page.getByTestId('explanation');
    await expect(explanation.locator('[data-action="ship"]')).toContainText('Allowed');
    await expect(explanation.locator('[data-action="ship"]')).toContainText('order.action.ship in catalog-editor');
    await expect(explanation.locator('[data-action="cancel"]')).toContainText('Denied');
    await expect(explanation.locator('[data-action="cancel"]')).toContainText('No role grants it');
    const shop = explanation.locator('[data-page="shop"]');
    await expect(shop.locator('[data-operation="view"]')).toHaveText('Allowed');
    await expect(shop.locator('[data-operation="update"]')).toHaveText('Denied');
    await expect(shop).toContainText('page.shop in catalog-editor (page.shop)');
  });

  test.describe('as the editor', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('the editor may ship but not cancel or mark paid, and sees the settings read-only (M4-2)', async ({ page, browser, baseURL, isMobile }, testInfo) => {
      const number = `ED-${testInfo.project.name.toUpperCase()}`;
      const id = await asAdmin(browser, baseURL, (adminPage) => makeOrder(adminPage, number));

      await page.goto('/admin/login');
      await page.getByLabel('Username').fill('editor');
      await page.getByLabel('Password').fill('editor-demo-pass');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();

      await page.goto(`/admin/order/${id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Order: ${number}`);
      const actions = page.getByRole('group', { name: 'Actions' });
      await expect(actions.getByRole('button')).toHaveText(['Ship']);
      const refused = await page.request.post('/admin/api/resources/order/actions/cancel', { data: { ids: [id] }, headers: await csrf(page) });
      expect(refused.status()).toBe(403);
      // The permission's refusal, not the 403 of a missing CSRF token (which has the same code and another message).
      expect(await refused.json()).toMatchObject({ code: 'FORBIDDEN', message: 'You may not run "Cancel order" on Order records' });

      // The list: Ship for a selection, no delete and no toolbar action.
      await page.goto(`/admin/order?search=${number}`);
      await expect(page.getByRole('button', { name: 'Cancel stale drafts' })).toHaveCount(0);
      if (isMobile) await page.getByRole('button', { name: 'Select', exact: true }).click();
      await page.getByLabel(`Select ${number}`).check();
      const bar = page.getByRole('region', { name: '1 selected' });
      await expect(bar.getByRole('button', { name: 'Ship' })).toBeVisible();
      await expect(bar.getByRole('button', { name: 'Delete selected' })).toHaveCount(0);

      // The settings page: in the sidebar, shown, not changeable.
      await page.goto('/admin/p/shop');
      await expect(page.getByRole('heading', { name: 'Shop settings', level: 1 })).toBeVisible();
      await expect(page.getByText('You can view these settings but not change them.')).toBeVisible();
      await expect(page.locator('[data-readonly="shopName"]')).toContainText('Demo shop');
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
      await expect(page.getByRole('textbox')).toHaveCount(0);
      await expect(page.locator('input[type="file"], input[type="password"]')).toHaveCount(0);
      await expect(page.locator('[data-secret="paymentApiKey"]').getByRole('button')).toHaveCount(0);
      const save = await page.request.patch('/admin/api/pages/shop', { data: { shopName: 'Hacked' }, headers: await csrf(page) });
      expect(save.status()).toBe(403);
      expect(await save.json()).toMatchObject({ code: 'FORBIDDEN', message: 'You may not change Shop settings' });
    });
  });
});
