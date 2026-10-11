import { expect, test, type Locator, type Page } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** The session's CSRF token as a header, for writes through `page.request` (it shares the signed-in cookie). */
async function csrf(page: Page): Promise<Record<string, string>> {
  const session = await (await page.request.get('/admin/api/session')).json();
  return { 'X-CSRF-Token': session.csrfToken };
}

const stored = async (page: Page) => (await page.request.get('/admin/api/pages/shop')).json();

/** The image was really fetched and decoded (a 404 or a refused download leaves it broken). */
async function expectLoaded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as unknown as { complete: boolean; naturalWidth: number }).complete && (element as unknown as { naturalWidth: number }).naturalWidth > 0)).toBe(true);
}

test('settings are saved; the secret is replaced and never shown again; a logo is uploaded (M4-2)', async ({ page, isMobile }, testInfo) => {
  test.slow(); // one long walk through the page (two reloads, seven saves, an upload)
  const key = `sk_test_${testInfo.project.name}_4242424242`;
  const nextKey = `sk_live_${testInfo.project.name}_9898989898`;
  // Every answer of the page's API that the browser receives: none may ever hold a key.
  const bodies: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/pages/shop')) void response.text().then((text) => bodies.push(text), () => undefined);
  });
  // Every save the browser sends, as its JSON body.
  const patches: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/api/pages/shop')) patches.push(request.postDataJSON() as Record<string, unknown>);
  });
  const nextPatch = () => page.waitForRequest((request) => request.method() === 'PATCH' && request.url().includes('/api/pages/shop'));
  const saved = page.getByRole('status').filter({ hasText: '“Shop settings” saved.' });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  const secret = page.locator('[data-secret="paymentApiKey"]');

  // From the sidebar: the Settings group holds only this page.
  await page.goto('/admin');
  await expect(page.getByRole('main').getByRole('link', { name: 'Shop settings' })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Resources' }).getByRole('list', { name: 'Settings' }).getByRole('link', { name: 'Shop settings' }).click();
  await expect(page).toHaveURL(/\/admin\/p\/shop$/);
  await expect(page.getByRole('heading', { name: 'Shop settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' }).getByRole('listitem').last()).toHaveText('Shop settings');

  // No key yet: an empty input that browsers do not fill in.
  const input = page.getByLabel('Payment API key');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(input).toHaveAttribute('autocomplete', 'new-password');

  // The client checks what is sent; the host's own refusal lands on the field, without the value.
  await page.getByLabel('Shop name').fill('D');
  await save.click();
  await expect(page.getByText('must be at least 2 characters')).toBeVisible();
  expect(patches).toEqual([]); // stopped in the browser
  await page.getByLabel('Shop name').fill(`Demo shop ${testInfo.project.name}`);
  await input.fill('not-a-payment-key');
  await save.click();
  await expect(secret).toContainText('must start with sk_');
  expect((await stored(page)).values.shopName).toBe('Demo shop'); // nothing of a refused save is kept

  await input.fill(key);
  await save.click();
  await expect(saved).toBeVisible();
  await expect(secret).toContainText('Set');
  await expect(secret.getByRole('button', { name: 'Replace Payment API key' })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(await stored(page)).toMatchObject({ values: { shopName: `Demo shop ${testInfo.project.name}` }, secrets: { paymentApiKey: true } });

  // After a reload the key is still only "Set".
  await page.reload();
  await expect(page.getByLabel('Shop name')).toHaveValue(`Demo shop ${testInfo.project.name}`);
  await expect(secret).toContainText('Set');
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  expect(await page.content()).not.toContain(key);

  // Replace opens an empty input; keeping the current value closes it again and leaves nothing to save.
  await secret.getByRole('button', { name: 'Replace Payment API key' }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('');
  await input.fill('sk_never_saved_0000');
  await secret.getByRole('button', { name: 'Keep the current value' }).click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Discard changes' })).toHaveCount(0);
  // Saving now sends nothing at all (no empty PATCH), and says nothing was saved.
  expect(patches).toHaveLength(2);
  await save.click();
  // Only spaces in the input are no new value either: nothing is sent and the input closes again.
  await secret.getByRole('button', { name: 'Replace Payment API key' }).click();
  await input.fill('   ');
  await save.click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(secret).toContainText('Set');
  await expect(saved).toHaveCount(0);

  // Replace it for real, with Ctrl+S; a save of something else afterwards does not touch it.
  await secret.getByRole('button', { name: 'Replace Payment API key' }).click();
  await input.fill(nextKey);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(saved).toBeVisible();
  await expect(secret).toContainText('Set');
  // The two saves of nothing above sent no request: this is the third PATCH, and it holds the key alone.
  expect(patches).toHaveLength(3);
  expect(patches[2]).toEqual({ paymentApiKey: nextKey });
  await page.getByRole('switch', { name: 'Maintenance mode' }).click();
  const later = nextPatch();
  await save.click();
  // Exactly the changed key: the secret is not sent again (the browser no longer has it).
  expect((await later).postDataJSON()).toEqual({ maintenance: true });
  await expect(saved).toBeVisible();
  expect(await stored(page)).toMatchObject({ values: { maintenance: true }, secrets: { paymentApiKey: true } });

  // Leaving with unsaved changes asks first.
  await page.getByLabel('Support email').fill('help@shop.example.test');
  if (isMobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Resources' }).getByRole('list', { name: 'Sales' }).getByRole('link', { name: 'Order' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Leave without saving?');
  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/\/admin\/p\/shop$/);
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByLabel('Support email')).toHaveValue('support@shop.example.test');

  // A logo: uploaded for the page (`resource=page:shop`), stored by `save()` as its key.
  const upload = page.waitForRequest((request) => request.url().includes('/api/uploads?'));
  await page.getByLabel('Logo', { exact: true }).setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  expect(new URL((await upload).url()).searchParams.get('resource')).toBe('page:shop');
  const logo = page.locator('[data-file="logo.png"]').getByRole('img', { name: 'logo.png' });
  await expectLoaded(logo);
  await save.click();
  await expect(saved).toBeVisible();
  const withLogo = await stored(page);
  expect(withLogo.values.logo).toMatch(/^page\/shop\/logo\/\d{4}\/\d{2}\/.+\.png$/);
  expect(withLogo.files.logo).toMatchObject({ name: 'logo.png', contentType: 'image/png' });
  await page.reload();
  await expectLoaded(logo);
  await expect(logo).toHaveAttribute('src', `/admin/api/files/${withLogo.values.logo}`);

  // Back to how the page was: the logo removed, the key cleared (Clear is undone once first), the first name.
  await page.getByRole('button', { name: 'Remove logo.png' }).click();
  await secret.getByRole('button', { name: 'Clear Payment API key' }).click();
  await expect(secret).toContainText('Will be cleared when you save.');
  await secret.getByRole('button', { name: 'Undo' }).click();
  await expect(secret).toContainText('Set');
  await secret.getByRole('button', { name: 'Clear Payment API key' }).click();
  await page.getByRole('switch', { name: 'Maintenance mode' }).click();
  await page.getByLabel('Shop name').fill('Demo shop');
  const clearing = nextPatch();
  await save.click();
  // Clear is an explicit null (an absent key would keep the secret).
  expect((await clearing).postDataJSON()).toEqual({ shopName: 'Demo shop', maintenance: false, logo: null, paymentApiKey: null });
  await expect(saved).toBeVisible();
  await expect(input).toHaveValue('');
  expect(await stored(page)).toMatchObject({ values: { shopName: 'Demo shop', logo: null, maintenance: false }, secrets: { paymentApiKey: false }, files: {} });

  // Nothing the browser was sent, and nothing on the page, ever held a key.
  expect(bodies.length).toBeGreaterThan(8);
  expect(patches).toHaveLength(6);
  // After the first two saves (which typed it) no request ever carried a key again, except the one replacing it.
  expect(patches.filter((body) => Object.hasOwn(body, 'paymentApiKey')).map((body) => body.paymentApiKey)).toEqual(['not-a-payment-key', key, nextKey, null]);
  for (const text of [...bodies, await page.content(), JSON.stringify(await stored(page))]) {
    expect(text).not.toContain(key);
    expect(text).not.toContain(nextKey);
    expect(text).not.toContain('sk_never_saved_0000');
  }
});

test('a settings page is read-only while viewing as someone, and its API refuses the save (M4-2)', async ({ page }) => {
  await page.goto('/admin/-/users?search=editor');
  await page.getByRole('link', { name: /Demo Editor/ }).click();
  await page.getByRole('button', { name: 'View as this user' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Viewing as Demo Editor. Read-only.' })).toBeVisible();

  await page.goto('/admin/p/shop');
  await expect(page.getByText('You can view these settings but not change them.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"], input[type="password"]')).toHaveCount(0);
  const refused = await page.request.patch('/admin/api/pages/shop', { data: { shopName: 'x' }, headers: { ...(await csrf(page)), 'X-View-As': '2' } });
  expect(refused.status()).toBe(403);
  // Not the 403 of a missing CSRF token (same code): the refusal is the view-as one.
  expect(await refused.json()).toMatchObject({ code: 'FORBIDDEN', message: 'Viewing as another user is read-only' });

  // Actions are not offered either: running one as someone else is refused.
  await page.goto('/admin/order/2');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order: SO-1002');
  await expect(page.getByRole('group', { name: 'Actions' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop viewing' }).click();
  await expect(page.getByText('Viewing as Demo Editor. Read-only.')).toHaveCount(0);
});
