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
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/admin\/product$/);
  const created = page.getByText(sku, { exact: true }).filter({ visible: true }); // upper-cased by ProductsService
  await expect(created).toBeVisible();

  await openRecord(page, sku);
  await expect(page).toHaveURL(/\/admin\/product\/\d+$/);
  const editUrl = page.url();
  await page.getByLabel('Stock', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Save' }).click();
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
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#field-price-error')).toContainText('must be a number');

  await page.getByLabel('Price').fill('1.234'); // valid number, but the DTO allows 2 decimals
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#field-price-error')).toContainText('decimal');

  await page.getByLabel('Price').fill('10');
  await page.getByLabel('Status').selectOption('active');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Active products need stock');
  await expect(page).toHaveURL(/\/admin\/product\/new$/);
});

test('filters and search narrow the list', async ({ page, isMobile }) => {
  await page.goto('/admin/product');
  if (isMobile) await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Status', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'draft' }).click();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/filter%5Bstatus%5D%5Bin%5D=draft/);
  await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Status:draft');
  await expect(page.getByText('DEMO-3', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Search').fill('notebook');
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
  await page.getByRole('button', { name: 'Save' }).click();
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
  await page.getByRole('button', { name: 'Save' }).click();
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
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  const row = isMobile ? page.getByRole('listitem').filter({ hasText: sku }) : page.getByRole('row').filter({ hasText: sku });
  await expect(row).toContainText('Lighting');
  await expect(row).toContainText('Bestseller, Eco');

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
  await page.getByRole('button', { name: 'Save' }).click();
  await openRecord(page, sku);
  const editUrl = page.url();

  const other = await page.context().newPage();
  await other.goto(editUrl);
  await other.getByLabel('Stock', { exact: true }).fill('7');
  await other.getByRole('button', { name: 'Save' }).click();
  await expect(other).toHaveURL(/\/admin\/product$/);
  await other.close();

  await page.getByLabel('Name').fill('My lamp');
  await page.getByRole('button', { name: 'Save' }).click();
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
  await page.getByRole('button', { name: 'Save' }).click();
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
  await page.getByRole('button', { name: 'Save' }).click();
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

test('the stock log pages forward and back with a cursor', async ({ page }) => {
  await page.goto('/admin/stock-move');
  await expect(page.getByText('Move 25', { exact: true }).filter({ visible: true })).toBeVisible();
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

test('dark mode survives a reload', async ({ page }) => {
  await page.goto('/admin/product');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/dark/);
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
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/admin\/product$/);
  }
  await page.getByLabel('Search').fill('Bulk');
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
