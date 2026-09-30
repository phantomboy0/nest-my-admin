import { expect, test, type Page } from '@playwright/test';

/**
 * Opens a record's edit page from the list: on desktop a row click opens the quick view first (its Edit link goes on),
 * on mobile the card is a link.
 */
async function openRecord(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: true }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await Promise.race([dialog.waitFor({ state: 'visible' }), page.waitForURL(/\/admin\/[^/]+\/[^/?]+$/)]);
  if (await dialog.isVisible()) await dialog.getByRole('link', { name: 'Edit' }).click();
}

test('the home page lists resources with counts, and the sidebar navigates', async ({ page, isMobile }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Demo shop', level: 1 })).toBeVisible();
  const card = page.getByRole('main').getByRole('link', { name: /^Product\s*\d+ records$/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(/\/admin\/product$/);
  await page.goto('/admin/category');
  await expect(page.getByRole('heading', { name: 'Category' })).toBeVisible();

  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('navigation', { name: 'Resources' }).getByRole('list', { name: 'Catalog' }).getByRole('link', { name: 'Product' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);
  await expect(page.getByRole('heading', { name: 'Product' })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toBeVisible();
});

test('creates a product through the service and edits it', async ({ page }, testInfo) => {
  const sku = `E2E-${testInfo.project.name.toUpperCase()}`;

  await page.goto('/admin/product');
  await page.getByRole('link', { name: 'New' }).click();
  await page.getByLabel('Name').fill('Playwright lamp');
  await page.getByLabel('Sku').fill(sku.toLowerCase());
  await page.getByLabel('Price').fill('19.9');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page).toHaveURL(/\/admin\/product$/);
  const created = page.getByText(sku, { exact: true }).filter({ visible: true }); // upper-cased by ProductsService
  await expect(created).toBeVisible();

  await openRecord(page, sku);
  await expect(page).toHaveURL(/\/admin\/product\/\d+$/);
  const editUrl = page.url();
  await page.getByLabel('Stock', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  await page.goto(editUrl);
  await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Price')).toHaveValue('19.90');
});

test('deep link refresh works and errors are shown where they belong', async ({ page }) => {
  await page.goto('/admin/product/new'); // served index.html + <base href> (Review Focus 2)

  await page.getByLabel('Name').fill('Bad price');
  await page.getByLabel('Sku').fill('bad-price');
  await page.getByLabel('Price').fill('abc');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#field-price-error')).toContainText('must be a number');

  await page.getByLabel('Price').fill('1.234'); // valid number, but the DTO allows 2 decimals
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#field-price-error')).toContainText('decimal');

  await page.getByLabel('Price').fill('10');
  await page.getByLabel('Status').selectOption('active');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Active products need stock');
  await expect(page).toHaveURL(/\/admin\/product\/new$/);
});

test('filters and search narrow the list', async ({ page, isMobile }) => {
  await page.goto('/admin/product');
  if (isMobile) await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Status', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'draft' }).click();
  await page.keyboard.press('Escape');
  if (isMobile) await page.getByRole('button', { name: 'Show results' }).click();
  await expect(page).toHaveURL(/filter%5Bstatus%5D%5Bin%5D=draft/);
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Status:Draft');
  await expect(page.getByText('DEMO-3', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Search', { exact: true }).fill('notebook');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('DEMO-2', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('moves a draft product to the trash and refuses to delete an active one', async ({ page }, testInfo) => {
  const sku = `DEL-${testInfo.project.name.toUpperCase()}`;
  await page.goto('/admin/product/new');
  await page.getByLabel('Name').fill('Short-lived');
  await page.getByLabel('Sku').fill(sku);
  await page.getByLabel('Price').fill('1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  await openRecord(page, sku);
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm move to trash' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);
  await expect(page.getByText(sku, { exact: true }).filter({ visible: true })).toHaveCount(0);

  await openRecord(page, 'DEMO-1');
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm move to trash' }).click();
  await expect(page.getByRole('alert')).toContainText('Active products cannot be deleted');
});

test('table rows can be opened with the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop table is hidden on small screens (cards are links already)');
  await page.goto('/admin/product');
  const firstLink = page.getByRole('row').nth(1).getByRole('link');
  await firstLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/product\/\d+$/);
});

test('client-side validation stops a bad form before it reaches the server', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/admin/api/resources/product')) posts.push(req.url());
  });
  await page.goto('/admin/product/new');
  await page.getByLabel('Sku').fill('bad sku!');
  await page.getByLabel('Price').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#field-name-error')).toContainText('is required');
  await expect(page.locator('#field-sku-error')).toContainText('sku must be 2-40 letters, digits or dashes');
  expect(posts).toHaveLength(0);
});

test('picks a category and tags, filters by category, and refuses to delete a category in use', async ({ page, isMobile }, testInfo) => {
  const sku = `REL-${testInfo.project.name.toUpperCase()}`;
  await page.goto('/admin/product/new');
  await page.getByLabel('Name').fill('Reading lamp');
  await page.getByLabel('Sku').fill(sku);
  await page.getByLabel('Price').fill('30');
  await expect(page.getByRole('combobox', { name: 'Category' })).toBeHidden(); // on the Catalog tab
  await page.getByRole('tab', { name: 'Catalog' }).click();
  await page.getByRole('combobox', { name: 'Category' }).fill('ligh');
  await page.getByRole('option', { name: 'Lighting' }).click();
  await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('Lighting');
  const tags = page.getByRole('combobox', { name: 'Tags' });
  await tags.fill('eco');
  await page.getByRole('option', { name: 'Eco' }).click();
  await tags.fill('best');
  await expect(page.getByRole('option', { name: 'Bestseller' })).toBeVisible();
  await tags.press('Enter'); // keyboard works too: the first option is active
  await expect(page.getByRole('button', { name: 'Remove Bestseller' })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  const row = isMobile ? page.getByRole('listitem').filter({ hasText: sku }) : page.getByRole('row').filter({ hasText: sku });
  await expect(row).toContainText('Lighting');
  if (!isMobile) await expect(row).toContainText('Bestseller, Eco'); // phone cards show list.mobile's fields

  if (isMobile) await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('combobox', { name: 'Category' }).fill('furn');
  await page.getByRole('option', { name: 'Furniture' }).click();
  await expect(page).toHaveURL(/filter%5BcategoryId%5D%5Beq%5D=\d+/);
  await expect(page.getByText('DEMO-3', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);

  await page.reload(); // the filter's title is looked up from the id in the URL
  if (isMobile) await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Category' })).toHaveValue('Furniture');

  await page.goto('/admin/category');
  await openRecord(page, 'Lighting');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByRole('alert')).toContainText('Other records still refer to this record');
});

test('a second editor gets a conflict notice and can keep their changes', async ({ page }, testInfo) => {
  const sku = `VER-${testInfo.project.name.toUpperCase()}`;
  await page.goto('/admin/product/new');
  await page.getByLabel('Name').fill('Shared lamp');
  await page.getByLabel('Sku').fill(sku);
  await page.getByLabel('Price').fill('10');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await openRecord(page, sku);
  const editUrl = page.url();

  const other = await page.context().newPage();
  await other.goto(editUrl);
  await other.getByLabel('Stock', { exact: true }).fill('7');
  await other.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(other).toHaveURL(/\/admin\/product$/);
  await other.close();

  await page.getByLabel('Name').fill('My lamp');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const notice = page.getByRole('alertdialog');
  await expect(notice).toContainText('Someone else saved this record');
  await expect(notice).toContainText('Stock');
  await notice.getByRole('button', { name: 'Keep my changes' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  await page.goto(editUrl);
  await expect(page.getByLabel('Name')).toHaveValue('My lamp');
  await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('7');
});

test('a product in the trash can be restored', async ({ page }, testInfo) => {
  const sku = `BIN-${testInfo.project.name.toUpperCase()}`;
  await page.goto('/admin/product/new');
  await page.getByLabel('Name').fill('Binned');
  await page.getByLabel('Sku').fill(sku);
  await page.getByLabel('Price').fill('2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await openRecord(page, sku);
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm move to trash' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  await page.getByRole('button', { name: 'Trash' }).click();
  await expect(page).toHaveURL(/trashed=only/);
  await page.getByRole('button', { name: 'Restore Binned' }).filter({ visible: true }).click();
  await expect(page.getByText(sku, { exact: true }).filter({ visible: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Trash' }).click();
  await expect(page.getByText(sku, { exact: true }).filter({ visible: true })).toBeVisible();
});

test('an embedded contact is edited as a group of fields', async ({ page }, testInfo) => {
  const name = `Supplier ${testInfo.project.name}`;
  await page.goto('/admin/supplier/new');
  await page.getByLabel('Name').fill(name);
  const contact = page.getByRole('group', { name: 'Contact' });
  await contact.getByLabel('Email').fill('orders@example.test');
  await contact.getByLabel('Phone').fill('+98 21 1234');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/supplier$/);
  await openRecord(page, name);
  await expect(page.getByRole('group', { name: 'Contact' }).getByLabel('Email')).toHaveValue('orders@example.test');
});

test("a category's related products open as a filtered list", async ({ page }) => {
  await page.goto('/admin/category');
  await openRecord(page, 'Lighting');
  await page.getByRole('navigation', { name: 'Related' }).getByRole('link', { name: 'Product' }).click();
  await expect(page).toHaveURL(/\/admin\/product\?filter%5BcategoryId%5D%5Beq%5D=\d+/);
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-2', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('the stock log pages forward and back with a cursor', async ({ page, isMobile }) => {
  await page.goto('/admin/stock-move');
  await expect(page.getByText('Move 25', { exact: true }).filter({ visible: true })).toBeVisible();
  if (isMobile) {
    // Phones scroll instead: every move once, in order (M2-4 Review Focus 3).
    const cards = page.getByRole('list', { name: 'Stock move' }).getByRole('listitem');
    await scrollUntil(page, cards, 25);
    const titles = await cards.evaluateAll((items) => items.map((item) => item.textContent));
    expect(new Set(titles).size).toBe(25);
    await expect(page.getByText('25 shown')).toBeVisible(); // keyset lists are not counted
    return;
  }
  await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/after=/);
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
  await expect(page.getByText('Move 15', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByText('Move 25', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
});

test('switching to Persian turns the page right-to-left and survives a reload', async ({ page, isMobile }) => {
  await page.goto('/admin');
  await page.getByLabel('Language').selectOption('fa');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
  await expect(page.getByRole('heading', { name: 'فروشگاه نمونه', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  if (isMobile) await page.getByRole('button', { name: 'منو' }).click();
  await page.getByRole('navigation', { name: 'بخش‌ها' }).getByRole('list', { name: 'کاتالوگ' }).getByRole('link', { name: 'محصول' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);
  await expect(page.getByRole('link', { name: 'جدید' })).toBeVisible();
});

test('dark mode survives a reload', async ({ page, isMobile }) => {
  // On phones the theme is in the Display settings menu.
  const openDisplay = async () => {
    if (isMobile) await page.getByRole('button', { name: 'Display settings' }).click();
  };
  await page.goto('/admin/product');
  await openDisplay();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await openDisplay();
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('pinned resources, the collapsed sidebar and breadcrumbs', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop sidebar (pins on hover, icon rail)');
  await page.goto('/admin/product');
  const nav = page.getByRole('navigation', { name: 'Resources' });
  await nav.getByRole('button', { name: 'Pin Tag' }).click();
  await expect(nav.getByRole('region', { name: 'Pinned' }).getByRole('link', { name: 'Tag' })).toBeVisible();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await nav.getByRole('link', { name: 'Supplier' }).click(); // icon-only links keep their names
  await expect(page).toHaveURL(/\/admin\/supplier$/);
  await page.getByRole('button', { name: 'Expand sidebar' }).click();

  await page.goto('/admin/product');
  await openRecord(page, 'DEMO-2');
  const crumbs = page.getByRole('navigation', { name: 'Breadcrumbs' });
  await expect(crumbs).toContainText('Catalog');
  await expect(crumbs).toContainText('Notebook');
  await crumbs.getByRole('link', { name: 'Catalog' }).click();
  await expect(page).toHaveURL(/\/admin\/g\/catalog$/);
  await expect(page.getByRole('heading', { name: 'Catalog', level: 1 })).toBeVisible();
});

test('bulk delete reports what it could not delete', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'selection lives in the desktop table');
  const tag = testInfo.project.name.toUpperCase();
  for (const [name, status] of [['Bulk A', 'draft'], ['Bulk B', 'draft'], ['Bulk C', 'active']] as const) {
    await page.goto('/admin/product/new');
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Sku').fill(`${name.replace(' ', '-')}-${tag}`);
    await page.getByLabel('Price').fill('1');
    await page.getByLabel('Stock', { exact: true }).fill('1');
    await page.getByLabel('Status').selectOption(status);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/product$/);
  }
  await page.getByLabel('Search', { exact: true }).fill('Bulk');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
  await expect(page.getByRole('region', { name: '3 selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('button', { name: 'Delete 3' }).click();
  const summary = page.getByRole('status');
  await expect(summary).toContainText('2 deleted · 1 failed');
  await expect(summary).toContainText('Bulk C: Active products cannot be deleted');
});

test('the quick view opens from a row with the keyboard and closes with Escape', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mobile cards open the record directly');
  await page.goto('/admin/product');
  const row = page.getByRole('row').filter({ hasText: 'DEMO-2' });
  await row.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'Quick view: Notebook' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Stationery');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(row).toBeFocused();
});

test('cells are edited in place; a refused change shows why and keeps the value (Review Focus 2)', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'inline editing lives in the desktop table');
  const sku = `CELL-${testInfo.project.name.toUpperCase()}`;
  await page.goto('/admin/product/new');
  await page.getByLabel('Name').fill('Inline lamp');
  await page.getByLabel('Sku').fill(sku);
  await page.getByLabel('Price').fill('5');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  const row = page.getByRole('row').filter({ hasText: sku });
  await row.getByRole('button', { name: 'Edit Status: draft' }).click();
  await row.getByLabel('Status').selectOption('active');
  await expect(row.getByRole('alert')).toContainText('Active products need stock');
  await expect(row.getByRole('button', { name: 'Edit Status: draft' })).toBeVisible();

  await row.getByRole('button', { name: 'Edit Stock: 0' }).click();
  await row.getByLabel('Stock', { exact: true }).fill('4');
  await row.getByLabel('Stock', { exact: true }).press('Enter');
  await expect(row.getByRole('button', { name: 'Edit Stock: 4' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: sku }).getByRole('button', { name: 'Edit Stock: 4' })).toBeVisible();
});

test('hidden columns survive a reload; a chip removes one filter (Review Focus 3, 4)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the column menu is part of the desktop table');
  await page.goto('/admin/product');
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('checkbox', { name: 'Sku' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: /^Sku/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('columnheader', { name: /^Sku/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('button', { name: 'Reset columns' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: /^Sku/ })).toHaveCount(1);

  await page.goto('/admin/product?search=lamp&filter%5Bstatus%5D%5Bin%5D=draft');
  const chips = page.getByRole('list', { name: 'Active filters' });
  await chips.getByRole('button', { name: 'Remove filter Status' }).click();
  await expect(page).toHaveURL(/search=lamp/);
  await expect(page).not.toHaveURL(/status/);
});

/** Phones: scrolls the list until `count` cards have loaded (the end of the list loads the next page). */
async function scrollUntil(page: Page, cards: ReturnType<Page['getByRole']>, count: number): Promise<void> {
  await expect(async () => {
    await page.mouse.wheel(0, 10_000);
    await expect(cards).toHaveCount(count, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** A product made through the API, for tests that change it; returns its edit URL. */
async function makeProduct(page: Page, data: Record<string, unknown>): Promise<string> {
  const res = await page.request.post('/admin/api/resources/product', { data });
  expect(res.status()).toBe(201);
  return `/admin/product/${encodeURIComponent(String((await res.json())._id))}`;
}

test('labels, help and enum labels follow the language; statuses are badges (M2-3 Review Focus 2)', async ({ page, isMobile }) => {
  await page.goto('/admin/product');
  const row = (isMobile ? page.getByRole('listitem') : page.getByRole('row')).filter({ hasText: 'DEMO-4' });
  await expect(row.locator('[data-color="gray"]')).toHaveText('Archived');
  await page.goto('/admin/product/new');
  await page.getByLabel('Language').selectOption('fa');
  await expect(page.getByRole('textbox', { name: 'نام', exact: true })).toBeVisible();
  await expect(page.getByText('نشانی محصول در فروشگاه.')).toBeVisible();
  const status = page.getByLabel('وضعیت');
  await expect(status.getByRole('option', { name: 'پیش‌نویس' })).toHaveAttribute('value', 'draft');
  await expect(page.getByRole('tab', { name: 'کاتالوگ' })).toBeVisible();
});

test('money is grouped, the slug follows the name, and showIf hides a field that is then not sent (M2-3 Review Focus 3)', async ({ page }, testInfo) => {
  const sku = `SHOW-${testInfo.project.name.toUpperCase()}`;
  await page.goto('/admin/product/new');
  await page.getByLabel('Name').fill('Glass Vase — Large');
  await expect(page.getByLabel('Slug')).toHaveValue('glass-vase-large');
  await expect(page.getByLabel('Slug')).toHaveAccessibleDescription('The product’s address in the shop.');
  await page.getByLabel('Sku').fill(sku);
  await page.getByLabel('Price').fill('1234.5');
  await page.getByLabel('Price').blur();
  await expect(page.getByLabel('Price')).toHaveValue('1,234.50');

  await expect(page.getByLabel('Released on')).toHaveCount(0);
  await page.getByLabel('Status').selectOption('active');
  await page.getByLabel('Released on').fill('2024-05-01');
  await page.getByLabel('Status').selectOption('draft');
  await expect(page.getByLabel('Released on')).toHaveCount(0);
  await page.getByLabel('Status').selectOption('active');
  await expect(page.getByLabel('Released on')).toHaveValue('2024-05-01'); // back with its value
  await page.getByLabel('Status').selectOption('draft');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  const found = await (await page.request.get(`/admin/api/resources/product?search=${sku}`)).json();
  expect(found.items[0]).toMatchObject({ slug: 'glass-vase-large', price: '1234.50', status: 'draft', releasedOn: null });
});

test('an archived product is read-only except its status; the header shows its badge and shop link (M2-3 Review Focus 1)', async ({ page }) => {
  await page.goto('/admin/product');
  await openRecord(page, 'DEMO-4');
  await expect(page.getByRole('heading', { name: 'Product: Brass lamp' })).toBeVisible();
  await expect(page.locator('main [data-color="gray"]').first()).toHaveText('Archived');
  const link = page.getByRole('link', { name: 'View in shop (opens in a new tab)' });
  await expect(link).toHaveAttribute('href', 'https://shop.example.test/p/brass-lamp');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  await expect(page.getByLabel('Price')).toHaveCount(0);
  await expect(page.locator('[data-readonly="price"]')).toContainText('1,299.00 USD');
  await expect(page.getByLabel('Status')).toBeEnabled();

  const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);
  const res = await page.request.patch(`/admin/api/resources/product/${encodeURIComponent(id)}`, { data: { price: '1.00' } });
  expect(res.status()).toBe(422);
  expect((await res.json()).fields).toEqual({ price: ['is read-only'] });
});

test('leaving with unsaved changes asks first; Ctrl+S saves in place (M2-3 Review Focus 4)', async ({ page }, testInfo) => {
  const url = await makeProduct(page, { name: 'Guarded lamp', sku: `GUARD-${testInfo.project.name.toUpperCase()}`, price: '8' });
  await page.goto(url);
  await page.getByLabel('Stock', { exact: true }).fill('41');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const bar = page.getByRole('alertdialog', { name: 'Leave without saving? Your changes will be lost.' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Stay' }).click();
  await expect(bar).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('41');

  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toContainText('“Guarded lamp” saved.');
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await page.getByRole('button', { name: 'Cancel' }).click(); // saved: nothing to ask about
  await expect(page).toHaveURL(/\/admin\/product$/);
  await page.goto(url);
  await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('41');

  await page.getByLabel('Stock', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await bar.getByRole('button', { name: 'Leave' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);
});

test('Duplicate prefills a copy without its SKU; Save & new opens an empty form', async ({ page }, testInfo) => {
  const tag = testInfo.project.name.toUpperCase();
  const url = await makeProduct(page, { name: 'Twin lamp', sku: `TWIN-${tag}`, price: '15', stock: 4 });
  await page.goto(url);
  await page.getByRole('link', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/\/admin\/product\/new\?from=/);
  await expect(page.getByLabel('Name')).toHaveValue('Twin lamp');
  await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('4');
  await expect(page.getByLabel('Sku')).toHaveValue('');
  await page.getByLabel('Sku').fill(`TWIN2-${tag}`);
  await page.getByRole('button', { name: 'Save & new' }).click();

  await expect(page).toHaveURL(/\/admin\/product\/new$/);
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toContainText('“Twin lamp” saved.');
  await expect(page.getByLabel('Name')).toHaveValue('');
  const copy = await (await page.request.get(`/admin/api/resources/product?search=TWIN2-${tag}`)).json();
  expect(copy.items[0]).toMatchObject({ name: 'Twin lamp', stock: 4, price: '15.00' });
});

test('Jalali dates: typed in any digits, picked from the calendar, and used in filters (M2-4 Review Focus 1)', async ({ page, isMobile }, testInfo) => {
  const url = await makeProduct(page, { name: 'Nowruz lamp', sku: `JAL-${testInfo.project.name.toUpperCase()}`, price: '9', stock: 3, status: 'active' });
  await page.goto(url);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('radio', { name: 'Jalali' }).click();
  await page.keyboard.press('Escape');

  const released = page.getByLabel('Released on', { exact: true });
  await released.fill('۱۴۰۳/۰۱/۱۵');
  await released.blur(); // leaving the input writes the date out in the chosen digits
  await expect(released).toHaveValue('1403/01/15');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('status').filter({ hasText: 'saved' })).toBeVisible();
  const id = decodeURIComponent(url.split('/').pop()!);
  expect((await (await page.request.get(`/admin/api/resources/product/${encodeURIComponent(id)}`)).json()).releasedOn).toBe('2024-04-03');

  await page.getByRole('button', { name: 'Choose Released on from a calendar' }).click();
  const calendar = page.getByRole('dialog', { name: 'Released on calendar' });
  await calendar.getByRole('button', { name: 'Choose a month' }).click();
  await calendar.getByRole('button', { name: 'Ordibehesht' }).click();
  await calendar.getByRole('grid').getByRole('button', { name: /Ordibehesht 10, 1403/ }).click();
  await expect(released).toHaveValue('1403/02/10');
  await page.keyboard.press('Control+s');
  await expect.poll(async () => (await (await page.request.get(`/admin/api/resources/product/${encodeURIComponent(id)}`)).json()).releasedOn).toBe('2024-04-29');

  await page.goto('/admin/product');
  if (isMobile) await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const from = page.getByLabel('From', { exact: true }).and(page.locator('#filter-releasedOn-gte'));
  await from.fill('1403/02/01');
  await from.press('Enter');
  if (isMobile) await page.getByRole('button', { name: 'Show results' }).click();
  await expect(page).toHaveURL(/filter%5BreleasedOn%5D%5Bgte%5D=2024-04-20/);
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('1403');
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('phones: list.mobile cards, infinite scroll, sort in the drawer and select mode (M2-4 Review Focus 3)', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the phone list');
  await makeProduct(page, { name: 'Drawer draft A', sku: 'DRW-A', price: '1' });
  await makeProduct(page, { name: 'Drawer draft B', sku: 'DRW-B', price: '2' });
  const { total } = await (await page.request.get('/admin/api/resources/product')).json();

  await page.goto('/admin/product?pageSize=2&sort=name');
  const cards = page.getByRole('list', { name: 'Product' }).getByRole('listitem');
  // Pages of two load while the end of the list is in view (and with Load more).
  await scrollUntil(page, cards, total);
  expect(new Set(await cards.evaluateAll((items) => items.map((item) => item.textContent))).size).toBe(total);
  await expect(page.getByText(`${total} of ${total}`)).toBeVisible();
  const brass = cards.filter({ hasText: 'DEMO-4' });
  await expect(brass).toContainText('Brass lamp');
  await expect(brass).toContainText('Lighting'); // subtitle: category.name
  await expect(brass.locator('[data-color="gray"]')).toHaveText('Archived');

  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Sort by').selectOption('-price');
  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(page).toHaveURL(/sort=-price/);
  await expect(cards.first()).toContainText('Brass lamp'); // a new sort starts over from the first page

  await page.goto('/admin/product?search=Drawer%20draft');
  await expect(cards).toHaveCount(2);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Drawer draft A' }).check();
  await page.getByRole('checkbox', { name: 'Select Drawer draft B' }).check();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  await page.getByRole('button', { name: 'Delete 2' }).click();
  await expect(page.getByText('No records match.')).toBeVisible();
});

test('command palette: go to, create and find records with the keyboard (M2-4 Review Focus 2, 4)', async ({ page }) => {
  await page.goto('/admin');
  const trigger = page.getByRole('button', { name: 'Search and go to' });
  const palette = page.getByRole('dialog', { name: 'Search and go to' });
  const input = palette.getByRole('combobox');

  await page.keyboard.press('Control+k');
  await expect(input).toBeFocused();
  await input.fill('catalog');
  await expect(palette.getByRole('status')).not.toHaveText('Searching…');
  await expect(palette.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  // Category, Product, Stock move, … (one group, so no group entry)
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(palette.getByRole('option', { name: /^Product/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/product$/);

  await page.keyboard.press('Control+k');
  await input.fill('new prod');
  await expect(palette.getByRole('option', { name: 'New Product' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/product\/new$/);

  await page.keyboard.press('Control+k');
  await input.fill('notebook');
  await expect(palette.getByRole('option', { name: /^Notebook/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Product: Notebook' })).toBeVisible();

  // Persian letters find the row typed with Arabic ones.
  await trigger.click();
  await input.fill('دفتر یادداشت کوچک');
  await expect(palette.getByRole('option', { name: /دفتر يادداشت كوچك/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.goto(`/admin/product?search=${encodeURIComponent('کوچک')}`);
  await expect(page.getByText('DEMO-5', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);
});
