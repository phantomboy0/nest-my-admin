import { expect, test, type Locator, type Page } from '@playwright/test';

/** The session's CSRF token as a header, for writes through `page.request` (it shares the signed-in cookie). */
async function csrf(page: Page): Promise<Record<string, string>> {
  const session = await (await page.request.get('/admin/api/session')).json();
  return { 'X-CSRF-Token': session.csrfToken };
}

async function makeOrder(page: Page, number: string, lines: Array<{ description: string; quantity: number; unitPrice: string }> = []): Promise<string> {
  const _inlines = lines.length ? { 'order-line': { create: lines.map((line, index) => ({ _key: `n${index}`, ...line })) } } : undefined;
  const created = await page.request.post('/admin/api/resources/order', { data: { number, customer: 'Playwright', total: '10.00', _inlines }, headers: await csrf(page) });
  expect(created.status()).toBe(201);
  return String((await created.json())._id);
}

const linesOf = async (page: Page, id: string): Promise<Array<{ description: string; quantity: number; position: number }>> =>
  (await (await page.request.get(`/admin/api/resources/order/${id}`)).json())._inlines['order-line'].rows;

const section = (page: Page) => page.locator('[data-inline="order-line"]');
const row = (page: Page, index: number): Locator => section(page).locator('tbody tr').nth(index);
const cell = (line: Locator, name: string) => line.getByRole('textbox', { name, exact: true });

async function fillLine(line: Locator, description: string, quantity: string, price: string) {
  await cell(line, 'Description').fill(description);
  await cell(line, 'Qty').fill(quantity);
  await cell(line, 'Unit price').fill(price);
}

const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true }).click();

test('order lines are added, edited, removed and reordered with one Save (M4-4)', async ({ page }, testInfo) => {
  const number = `INL-${testInfo.project.name.toUpperCase()}`;
  const id = await makeOrder(page, number);
  await page.goto(`/admin/order/${id}`);
  await expect(section(page).getByText('None yet.')).toBeVisible();

  await section(page).getByRole('button', { name: 'Add Lines' }).click();
  await fillLine(row(page, 0), 'Lamp', '2', '25');
  await section(page).getByRole('button', { name: 'Add Lines' }).click();
  await fillLine(row(page, 1), 'Desk', '1', '400');
  await save(page);
  await expect(page).toHaveURL(/\/admin\/order$/);
  expect((await linesOf(page, id)).map((line) => [line.description, line.quantity, line.position])).toEqual([
    ['Lamp', 2, 0],
    ['Desk', 1, 1],
  ]);

  // Edit one, remove the other, add a third and move it first; ⌘S saves and stays.
  await page.goto(`/admin/order/${id}`);
  await cell(row(page, 0), 'Qty').fill('5');
  await row(page, 1).getByRole('button', { name: /^Remove Lines row 2/ }).click();
  await section(page).getByRole('button', { name: 'Add Lines' }).click();
  await fillLine(row(page, 1), 'Chair', '4', '80');
  await row(page, 1).getByRole('button', { name: /^Move Lines row 2 up/ }).click();
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('status')).toContainText('saved');
  expect((await linesOf(page, id)).map((line) => [line.description, line.quantity, line.position])).toEqual([
    ['Chair', 4, 0],
    ['Lamp', 5, 1],
  ]);
  await expect(cell(row(page, 0), 'Description')).toHaveValue('Chair');
});

test('a refused line shows its error on that line, and nothing is saved (M4-4)', async ({ page }, testInfo) => {
  const id = await makeOrder(page, `INL-ERR-${testInfo.project.name.toUpperCase()}`, [{ description: 'Lamp', quantity: 1, unitPrice: '25' }]);
  await page.goto(`/admin/order/${id}`);
  await page.getByLabel('Customer', { exact: true }).fill('Changed');
  await section(page).getByRole('button', { name: 'Add Lines' }).click();
  // 1000 passes the form's own checks only on the server (Max 999): the server's error comes back to the row.
  await fillLine(row(page, 1), 'Too many', '1000', '1');
  await save(page);
  await expect(row(page, 1).getByText(/quantity|999/i)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/admin/order/${id}$`));
  const stored = await (await page.request.get(`/admin/api/resources/order/${id}`)).json();
  expect(stored.customer).toBe('Playwright');
  expect(stored._inlines['order-line'].rows).toHaveLength(1);
});

test('without order-line.delete there is no remove, but lines can still be edited (M4-4)', async ({ page, browser, baseURL }, testInfo) => {
  const id = await makeOrder(page, `INL-ED-${testInfo.project.name.toUpperCase()}`, [{ description: 'Lamp', quantity: 1, unitPrice: '25' }]);
  const context = await browser.newContext({ baseURL });
  try {
    const signedIn = await context.request.post('/admin/api/session', { data: { username: 'editor', password: 'editor-demo-pass' } });
    expect(signedIn.ok()).toBe(true);
    const editor = await context.newPage();
    await editor.goto(`/admin/order/${id}`);
    await expect(cell(row(editor, 0), 'Description')).toHaveValue('Lamp');
    await expect(section(editor).getByRole('button', { name: /^Remove/ })).toHaveCount(0);
    await cell(row(editor, 0), 'Qty').fill('3');
    await save(editor);
    await expect(editor).toHaveURL(/\/admin\/order$/);
  } finally {
    await context.close();
  }
  expect((await linesOf(page, id))[0]!.quantity).toBe(3);
});
