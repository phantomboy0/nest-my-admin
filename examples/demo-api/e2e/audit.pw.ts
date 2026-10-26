import { openAccountMenu } from './shell.js';
import { expect, test, type Browser, type Page } from '@playwright/test';

/** The session's CSRF token as a header, for writes through `page.request` (it shares the signed-in cookie). */
async function csrf(page: Page): Promise<Record<string, string>> {
  const session = await (await page.request.get('/admin/api/session')).json();
  return { 'X-CSRF-Token': session.csrfToken };
}

async function make(page: Page, resource: string, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post(`/admin/api/resources/${resource}`, { data, headers: await csrf(page) });
  expect(res.status()).toBe(201);
  return encodeURIComponent(String((await res.json())._id));
}

/** Records are made as the superuser, also for tests that then sign in as someone else. */
async function asAdmin<T>(browser: Browser, baseURL: string | undefined, work: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ baseURL, storageState: 'e2e/.auth/admin.json' });
  try {
    return await work(await context.newPage());
  } finally {
    await context.close();
  }
}

async function signInAsEditor(page: Page): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('editor');
  await page.getByLabel('Password').fill('editor-demo-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Catalog' })).toBeVisible();
}

const entries = (page: Page) => page.getByRole('list', { name: 'Recorded changes' }).getByRole('listitem');

test('a product’s price is changed: the History tab shows the old and the new price (M4-3)', async ({ page }, testInfo) => {
  const sku = `AUD-${testInfo.project.name.toUpperCase()}`;
  const id = await make(page, 'product', { name: 'Audited lamp', sku, price: '10' });
  let historyRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes(`/api/resources/product/${id}/history`)) historyRequests++;
  });
  await page.goto(`/admin/product/${id}`);

  // The History tab is next to the form; opening it leaves the form's edits alone.
  const tabs = page.getByRole('tablist', { name: 'Record and its history' });
  await expect(tabs.getByRole('tab')).toHaveText(['Details', 'History']);
  await page.getByLabel('Price').fill('12.5');
  // Loaded only when the tab is opened: the page, its record and its schema are here, and no history was asked for.
  await page.waitForLoadState('networkidle');
  expect(historyRequests).toBe(0);
  await tabs.getByRole('tab', { name: 'History' }).click();
  await expect(entries(page)).toHaveCount(1);
  expect(historyRequests).toBe(1);
  await expect(entries(page).first()).toContainText('Created');
  await expect(entries(page).first()).toContainText('Demo Admin');
  await expect(entries(page).first().locator('[data-change="price"]')).toContainText('10.00 USD');
  await expect(page.getByLabel('Price')).toBeHidden();

  // Ctrl+S on the History tab saves the form under it, and the history reloads with the change.
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: '“Audited lamp” saved.' })).toBeVisible();
  await expect(entries(page)).toHaveCount(2);
  const changed = entries(page).first();
  await expect(changed).toContainText('Changed');
  const price = changed.locator('[data-change="price"]');
  await expect(price.locator('[data-before]')).toContainText('10.00 USD');
  await expect(price.locator('[data-after]')).toContainText('12.50 USD');
  await expect(changed.locator('[data-change]')).toHaveCount(1); // only what changed
  // Counted from when the history was loaded, however long the save took: "now" or "… ago", never "in …".
  await expect(changed.locator('time')).toContainText(/^(now|\d+ (second|minute)s? ago) · /);
  await expect(entries(page).nth(1).locator('time')).toContainText(/^(now|\d+ (second|minute)s? ago) · /);

  await tabs.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByLabel('Price')).toHaveValue('12.50');
  // The form is clean again: leaving asks nothing.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);
  await page.request.delete(`/admin/api/resources/product/${id}`, { headers: await csrf(page) });
});

test('unsaved edits survive a look at the History tab, and leaving still asks (M4-3)', async ({ page, isMobile }, testInfo) => {
  const id = await make(page, 'order', { number: `AUD-DIRTY-${testInfo.project.name.toUpperCase()}`, customer: 'Playwright', total: '10.00' });
  await page.goto(`/admin/order/${id}`);
  await page.getByLabel('Customer').fill('Someone else');
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(entries(page)).toHaveCount(1);
  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByLabel('Customer')).toHaveValue('Someone else');
  await page.getByRole('tab', { name: 'History' }).click();
  if (isMobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Resources' }).getByRole('list', { name: 'Sales' }).getByRole('link', { name: 'Order', exact: true }).click();
  const bar = page.getByRole('alertdialog', { name: 'Leave without saving? Your changes will be lost.' });
  await expect(bar).toBeVisible(); // shown above the tabs, whichever is open
  await bar.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`/admin/order/${id}$`));
});

test('an order is shipped: the action is in its history, with its input (M4-3)', async ({ page }, testInfo) => {
  const number = `AUD-SHIP-${testInfo.project.name.toUpperCase()}`;
  const id = await make(page, 'order', { number, customer: 'Playwright', total: '10.00' });
  await page.goto(`/admin/order/${id}`);
  const actions = page.getByRole('group', { name: 'Actions' });
  await actions.getByRole('button', { name: 'Mark paid' }).click();
  await expect(page.locator('[data-color="blue"]')).toHaveText('Paid');
  // An action run from the History tab leaves the user there, with the new entry.
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(entries(page)).toHaveCount(2);
  await actions.getByRole('button', { name: 'Ship' }).click();
  const ship = page.getByRole('dialog', { name: 'Ship' });
  await ship.getByLabel('Tracking code').fill(`TRK-${number}`);
  await ship.getByRole('button', { name: 'Ship' }).click();
  await expect(ship).toBeHidden();
  await expect(page.locator('[data-color="green"]')).toHaveText('Shipped');

  await expect(page.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(entries(page)).toHaveCount(3);
  const shipped = entries(page).first();
  await expect(shipped).toContainText('Ran “Ship”');
  await expect(shipped.locator('[data-change="status"] [data-before]')).toContainText('Paid');
  await expect(shipped.locator('[data-change="status"] [data-after]')).toContainText('Shipped');
  await expect(shipped.locator('[data-change="tracking"]')).toContainText(`TRK-${number}`);
  await expect(shipped.locator('[data-input="tracking"]')).toContainText('Tracking code');
  await expect(shipped.locator('[data-input="tracking"]')).toContainText(`TRK-${number}`);
  await expect(entries(page).nth(1)).toContainText('Ran “Mark paid”');
  await expect(entries(page).nth(2)).toContainText('Created');
});

test('a salary change is recorded as changed, without its values (M4-3)', async ({ page }, testInfo) => {
  const id = await make(page, 'employee', { name: `Audited ${testInfo.project.name}`, position: 'Tester', salary: '5123.00' });
  await page.goto(`/admin/employee/${id}`);
  await page.getByLabel('Salary').fill('6789');
  await page.getByLabel('Position').fill('Lead tester');
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status').filter({ hasText: 'saved.' })).toBeVisible();
  await page.getByRole('tab', { name: 'History' }).click();
  await expect(entries(page)).toHaveCount(2);
  for (const entry of [entries(page).first(), entries(page).nth(1)]) {
    await expect(entry.locator('[data-change="salary"]')).toHaveAttribute('data-state', 'changed');
    await expect(entry.locator('[data-change="salary"]')).toContainText('changed');
  }
  await expect(entries(page).first().locator('[data-change="position"] [data-after]')).toContainText('Lead tester');
  const history = page.getByRole('list', { name: 'Recorded changes' });
  await expect(history).not.toContainText('5,123');
  await expect(history).not.toContainText('6,789');
  // Not in what the server sent either: the salary's change carries no value at all.
  const sent = (await (await page.request.get(`/admin/api/resources/employee/${id}/history`)).json()) as { entries: Array<{ changes?: Array<{ field: string }> }> };
  expect(sent.entries.map((entry) => entry.changes?.find((change) => change.field === 'salary'))).toEqual([
    { field: 'salary', changed: true },
    { field: 'salary', changed: true },
  ]);
});

test('the audit page lists everything and filters by actor, kept in the URL (M4-3)', async ({ page, browser, baseURL }, testInfo) => {
  const number = `AUD-PAGE-${testInfo.project.name.toUpperCase()}`;
  const id = await make(page, 'order', { number, customer: 'Playwright', total: '10.00' });
  // Someone else signs in, and someone fails to.
  const adminId = String((await (await page.request.get('/admin/api/session')).json()).user.id);
  let editorId = '';
  const other = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const anonymous = await other.newPage();
    expect((await anonymous.request.post('/admin/api/session', { data: { username: `nobody-${number}`, password: 'wrong-password-typed' } })).status()).toBe(401);
    const editor = await anonymous.request.post('/admin/api/session', { data: { username: 'editor', password: 'editor-demo-pass' } });
    expect(editor.status()).toBe(200);
    editorId = String((await editor.json()).user.id);
  } finally {
    await other.close();
  }

  await page.goto('/admin');
  await openAccountMenu(page); // Demo Admin
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/admin\/-\/audit$/);
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  await expect(entries(page).first()).toBeVisible();
  const all = page.locator('ol[aria-label="Recorded changes"] > li');

  // Each thing is looked for under a filter that finds it, never among "the newest 50 of everything".
  // A failed sign-in: nobody, the username that was typed, the address; never the password.
  await page.getByLabel('Event').fill('auth.login_failed');
  await page.getByLabel('Event').press('Enter');
  await expect(page).toHaveURL(/event=auth\.login_failed/);
  const failed = entries(page).filter({ hasText: `nobody-${number}` });
  await expect(failed).toContainText('Failed sign-in');
  await expect(failed).toContainText('Nobody signed in');
  await expect(failed.locator('[data-client]')).not.toBeEmpty(); // address and browser, for audit.view
  await expect(page.getByRole('main')).not.toContainText('wrong-password-typed');
  await expect(all.locator(':scope:not([data-event="auth.login_failed"])')).toHaveCount(0);

  // The editor's sign-in, by actor and event.
  await page.goto(`/admin/-/audit?${new URLSearchParams({ actor: editorId, event: 'auth.login' })}`);
  await expect(page.getByLabel('Actor (user id)')).toHaveValue(editorId);
  await expect(entries(page).first()).toContainText('Signed in');
  await expect(entries(page).first()).toContainText('Demo Editor');
  await expect(all.locator(`:scope:not([data-actor="${editorId}"])`)).toHaveCount(0);

  // The order's entry, by resource and record: the filters are fields of the page and live in the URL.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/admin\/-\/audit$/);
  await expect(page.getByLabel('Actor (user id)')).toHaveValue('');
  await page.getByLabel('Resource', { exact: true }).selectOption('order');
  await page.getByLabel('Record id').fill(decodeURIComponent(id));
  await page.getByLabel('Record id').press('Enter');
  await expect(page).toHaveURL(/resource=order/);
  await expect(page).toHaveURL(/record=/);
  await expect(entries(page)).toHaveCount(1);
  const created = entries(page).first();
  await expect(created).toContainText('Created');
  await expect(created.getByRole('link', { name: `Order: ${number}` })).toHaveAttribute('href', new RegExp(`/admin/order/${id}$`));

  // An actor's name filters by them, on top of the other filters.
  await created.getByRole('button', { name: 'Show only what Demo Admin did' }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]actor=${adminId}(&|$)`));
  await expect(page.getByLabel('Actor (user id)')).toHaveValue(adminId);
  await expect(entries(page)).toHaveCount(1);
  await page.reload();
  await expect(entries(page)).toHaveCount(1);
  await expect(page.getByLabel('Resource', { exact: true })).toHaveValue('order');
  await expect(page.getByLabel('Actor (user id)')).toHaveValue(adminId);

  // Another resource drops the record id; what is left is everything the admin did, and only that.
  await page.getByLabel('Resource', { exact: true }).selectOption('');
  await expect(page.getByLabel('Record id')).toBeDisabled();
  await expect(page).not.toHaveURL(/record=/);
  await expect(entries(page).first()).toBeVisible();
  await expect(all.locator(`:scope:not([data-actor="${adminId}"])`)).toHaveCount(0);

  await page.getByLabel('Actor (user id)').fill('no-such-user');
  await page.getByLabel('Actor (user id)').press('Enter');
  await expect(page.getByText('No entries match.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).toHaveURL(/\/admin\/-\/audit$/);
  await expect(entries(page).first()).toBeVisible();

  // A family of events.
  await page.getByLabel('Event').fill('auth.*');
  await page.getByLabel('Event').press('Enter');
  await expect(page).toHaveURL(/event=auth\.\*|event=auth\.%2A/);
  await expect(entries(page).first()).toBeVisible();
  await expect(all.locator(':scope:not([data-event^="auth."])')).toHaveCount(0);
});

test.describe('as the editor', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the editor reads a record’s history but cannot open the audit page (M4-3)', async ({ page, browser, baseURL }, testInfo) => {
    const number = `AUD-ED-${testInfo.project.name.toUpperCase()}`;
    const id = await asAdmin(browser, baseURL, (adminPage) => make(adminPage, 'order', { number, customer: 'Playwright', total: '10.00' }));
    await signInAsEditor(page);

    await openAccountMenu(page); // Demo Editor
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The page is closed from the session alone: no filter form, and the audit API is not even asked.
    let auditRequests = 0;
    page.on('request', (request) => {
      if (/\/api\/audit(\?|$)/.test(request.url())) auditRequests++;
    });
    await page.goto('/admin/-/audit');
    await expect(page.getByRole('alert')).toHaveText('You may not read the audit log');
    await page.waitForLoadState('networkidle');
    expect(auditRequests).toBe(0);
    await expect(page.getByRole('list', { name: 'Recorded changes' })).toHaveCount(0);
    await expect(page.getByLabel('Actor (user id)')).toHaveCount(0);
    expect((await page.request.get('/admin/api/audit')).status()).toBe(403);

    // The history of a record they can open is theirs to read, without addresses.
    await page.goto(`/admin/order/${id}`);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(entries(page)).toHaveCount(1);
    await expect(entries(page).first()).toContainText('Created');
    await expect(entries(page).first()).toContainText('Demo Admin');
    await expect(page.locator('[data-client]')).toHaveCount(0);
    // An employee is not theirs to see: neither the record nor its history.
    expect((await page.request.get('/admin/api/resources/employee/1/history')).status()).toBe(404);
  });
});
