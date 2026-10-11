import { expect, test, type Locator, type Page } from '@playwright/test';

/** Two one-pixel PNGs (different bytes), and the smallest thing the server takes for a PDF. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const OTHER_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('\n%%EOF\n')]);

const png = (name: string, buffer = PNG) => ({ name, mimeType: 'image/png', buffer });

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

/** Moves a test's product to the trash: other tests expect the seeded products on the first page of the list. */
async function discard(page: Page, id: string): Promise<void> {
  expect((await page.request.delete(`/admin/api/resources/product/${id}`, { headers: await csrf(page) })).status()).toBe(204);
}

/** The image was really fetched and decoded (a 404 or a refused download leaves it broken). */
async function expectLoaded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as unknown as { complete: boolean; naturalWidth: number }).complete && (element as unknown as { naturalWidth: number }).naturalWidth > 0)).toBe(true);
}

test('an image is uploaded to a product, shown in the list, then replaced', async ({ page, isMobile }, testInfo) => {
  const sku = `IMG-${testInfo.project.name.toUpperCase()}`;
  const id = await make(page, 'product', { name: 'Pictured lamp', sku, price: '10' });
  const record = async () => (await page.request.get(`/admin/api/resources/product/${id}`)).json();

  await page.goto(`/admin/product/${id}`);
  await page.getByLabel('Image', { exact: true }).setInputFiles(png('lamp.png'));
  // The preview is the local copy until the record is saved.
  const preview = page.locator('[data-file="lamp.png"]').getByRole('img', { name: 'lamp.png' });
  await expectLoaded(preview);
  await expect(preview).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  const first = (await record()).image as string;
  expect(first).toMatch(/^product\/image\/\d{4}\/\d{2}\/.+\.png$/);
  if (!isMobile) {
    // Phones show cards without pictures; the table has the thumbnail.
    const row = page.getByRole('row').filter({ hasText: sku });
    await expectLoaded(row.getByRole('img', { name: 'lamp.png' }));
  }

  await page.goto(`/admin/product/${id}`);
  const stored = page.locator('[data-file="lamp.png"]').getByRole('img', { name: 'lamp.png' });
  await expectLoaded(stored);
  await expect(stored).toHaveAttribute('src', `/admin/api/files/${first}`);
  await page.getByLabel('Image', { exact: true }).setInputFiles(png('shade.png', OTHER_PNG));
  await expectLoaded(page.locator('[data-file="shade.png"]').getByRole('img', { name: 'shade.png' }));
  await expect(page.locator('[data-file="lamp.png"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  const second = (await record()).image as string;
  expect(second).not.toBe(first);
  expect((await page.request.get(`/admin/api/files/${second}`)).status()).toBe(200);
  expect((await page.request.get(`/admin/api/files/${first}`)).status()).toBe(404); // the replaced file is gone
  if (!isMobile) await expectLoaded(page.getByRole('row').filter({ hasText: sku }).getByRole('img', { name: 'shade.png' }));
  await discard(page, id);
});

test('a gallery takes several images, reorders them and drops one', async ({ page }, testInfo) => {
  const id = await make(page, 'product', { name: 'Gallery lamp', sku: `GAL-${testInfo.project.name.toUpperCase()}`, price: '10' });
  await page.goto(`/admin/product/${id}`);
  await page.getByLabel('Gallery', { exact: true }).setInputFiles([png('one.png'), png('two.png', OTHER_PNG), png('three.png')]);
  const tiles = page.locator('ul:has(> [data-file="two.png"]) > [data-file]');
  await expect(tiles).toHaveCount(3);
  // Uploads finish in any order: put them in a known one with the buttons, then move and remove.
  const names = () => tiles.evaluateAll((items) => items.map((item) => item.getAttribute('data-file')));
  for (const [index, name] of ['one.png', 'two.png', 'three.png'].entries()) {
    while ((await names()).indexOf(name) > index) await page.getByRole('button', { name: `Move ${name} up` }).click();
  }
  expect(await names()).toEqual(['one.png', 'two.png', 'three.png']);
  await page.getByRole('button', { name: 'Move three.png up' }).click();
  await page.getByRole('button', { name: 'Remove one.png' }).click();
  expect(await names()).toEqual(['three.png', 'two.png']);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  const saved = await (await page.request.get(`/admin/api/resources/product/${id}`)).json();
  expect((saved._files.gallery as Array<{ name: string }>).map((file) => file.name)).toEqual(['three.png', 'two.png']);
  await page.goto(`/admin/product/${id}`);
  await expect(tiles.first()).toBeVisible();
  expect(await page.locator('[data-file]').evaluateAll((items) => items.map((item) => item.getAttribute('data-file')))).toEqual(['three.png', 'two.png']);
  await discard(page, id);
});

test('a file the field does not accept is refused before and after the upload', async ({ page }, testInfo) => {
  const id = await make(page, 'invoice', { number: `INV-BAD-${testInfo.project.name}`, customer: 'Nobody', total: '1' });
  await page.goto(`/admin/invoice/${id}`);
  // The browser knows it is a picture: not sent at all.
  await page.getByLabel('PDF', { exact: true }).setInputFiles(png('photo.png'));
  await expect(page.getByRole('alert')).toContainText('photo.png: This type of file is not accepted here.');
  // Named and typed like a PDF, but the bytes are a picture: the server says no.
  await page.getByLabel('PDF', { exact: true }).setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: PNG });
  await expect(page.getByRole('alert')).toContainText('fake.pdf: is not an accepted file type');
  await expect(page.locator('[data-file]')).toHaveCount(0);
});

test('a private file answers 404 to an editor without access to its record', async ({ page, browser, isMobile }, testInfo) => {
  const id = await make(page, 'invoice', { number: `INV-${testInfo.project.name}`, customer: 'Grace Hopper', total: '99.50' });
  await page.goto(`/admin/invoice/${id}`);
  await page.getByLabel('PDF', { exact: true }).setInputFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.locator('[data-file="invoice.pdf"]')).toContainText('invoice.pdf');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/invoice$/);

  const saved = await (await page.request.get(`/admin/api/resources/invoice/${id}`)).json();
  const url = saved._files.pdf.url as string;
  expect(url).toBe(`/admin/api/files/${saved.pdf}`);
  const mine = await page.request.get(url);
  expect(mine.status()).toBe(200);
  expect(mine.headers()['content-type']).toBe('application/pdf');
  expect(mine.headers()['x-content-type-options']).toBe('nosniff');
  // The table links to the file by name; a phone's card is one link to the record, so it only names the file.
  if (isMobile) await expect(page.getByRole('link', { name: new RegExp(`INV-${testInfo.project.name}`) })).toContainText('invoice.pdf');
  else await expect(page.getByRole('row').filter({ hasText: `INV-${testInfo.project.name}` }).getByRole('link', { name: 'Open invoice.pdf' })).toHaveAttribute('href', url);

  // The catalog editor has no invoice permission at all: the same URL is "not found", as is a made-up one.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL: testInfo.project.use.baseURL });
  try {
    const signedIn = await context.request.post('/admin/api/session', { data: { username: 'editor', password: 'editor-demo-pass' } });
    expect(signedIn.status()).toBe(200);
    const refused = await context.request.get(url);
    expect(refused.status()).toBe(404);
    expect(await refused.json()).toMatchObject({ code: 'NOT_FOUND', message: 'File not found' });
    expect((await context.request.get('/admin/api/files/invoice/pdf/2026/01/nothing.pdf')).status()).toBe(404);
    // Signed out: not even that.
    await context.request.delete('/admin/api/session', { headers: { 'X-CSRF-Token': (await signedIn.json()).csrfToken } });
    expect((await context.request.get(url)).status()).toBe(401);
  } finally {
    await context.close();
  }
});

test('an article keeps bold text and an inline image across a reload', async ({ page }, testInfo) => {
  const title = `Lamp care ${testInfo.project.name}`;
  await page.goto('/admin/article/new');
  await page.getByLabel('Title').fill(title);
  const editor = page.getByRole('textbox', { name: 'Body' });
  await editor.click();
  await page.keyboard.type('Plain then ');
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('bold words');
  await page.locator('input[data-editor-image]').setInputFiles(png('diagram.png'));
  // Shown at once: an unsaved upload answers to the person who uploaded it.
  await expectLoaded(editor.getByRole('img', { name: 'diagram.png' }));
  // Typing goes on after the image instead of replacing it.
  await page.keyboard.type('After the picture');
  await expect(editor.getByRole('img', { name: 'diagram.png' })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/article$/);

  const list = await (await page.request.get(`/admin/api/resources/article?search=${encodeURIComponent(title)}`)).json();
  const article = list.items[0] as { _id: string; body: string };
  expect(article.body).toContain('<strong>bold words</strong>');
  const src = /<img src="(\/admin\/api\/files\/article\/body\/[^"]+\.png)"/.exec(article.body)?.[1];
  expect(src).toBeDefined();

  await page.goto(`/admin/article/${article._id}`);
  for (let visit = 0; visit < 2; visit += 1) {
    await expect(editor.locator('strong')).toHaveText('bold words');
    await expect(editor).toContainText('Plain then bold words');
    await expect(editor).toContainText('After the picture');
    const image = editor.getByRole('img', { name: 'diagram.png' });
    await expectLoaded(image);
    await expect(image).toHaveAttribute('src', src!);
    await page.reload();
  }
  // Nothing was edited, so leaving does not ask about unsaved changes.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/admin\/article$/);
});
