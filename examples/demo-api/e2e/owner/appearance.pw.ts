import { expect, test, type Page } from '@playwright/test';
import { openAccountMenu } from '../shell.js';

// A string: the demo's TypeScript has no DOM types.
const primary = (page: Page) => page.evaluate<string>("getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()");

test.describe.configure({ mode: 'serial' });

test('a person picks their own accent; it stays in their browser', async ({ page }) => {
  await page.goto('/admin/');
  await openAccountMenu(page);
  await page.getByRole('group', { name: 'Accent colour' }).getByRole('button', { name: '#9333EA' }).click();
  expect((await primary(page)).toLowerCase()).toBe('#9333ea');
  await page.reload();
  expect((await primary(page)).toLowerCase()).toBe('#9333ea');
  await openAccountMenu(page);
  await page.getByRole('group', { name: 'Accent colour' }).getByRole('button', { name: 'Default' }).click();
  expect((await primary(page)).toLowerCase()).not.toBe('#9333ea');
});

test('a superuser sets it for everyone; others see it until they pick their own', async ({ page, browser }) => {
  await page.goto('/admin/');
  await openAccountMenu(page);
  const picker = page.getByRole('group', { name: 'Accent colour' });
  await picker.getByRole('button', { name: '#0E7490' }).click();
  await picker.getByRole('button', { name: 'Use for everyone' }).click();
  await expect(picker.getByRole('button', { name: 'Reset for everyone' })).toBeVisible();

  // Another browser (same user, no own pick): the admin-wide accent.
  const other = await browser.newContext({ storageState: 'e2e/.auth/admin-3311.json' });
  const second = await other.newPage();
  await second.goto('/admin/');
  await expect.poll(async () => (await primary(second)).toLowerCase()).toBe('#0e7490');
  await other.close();

  await picker.getByRole('button', { name: 'Reset for everyone' }).click();
  await expect(picker.getByRole('button', { name: 'Reset for everyone' })).toHaveCount(0);
});

test('the colour window keeps working after the menu closes and the page changes', async ({ page }) => {
  await page.goto('/admin/');
  await openAccountMenu(page);
  await page.getByRole('group', { name: 'Accent colour' }).getByRole('button', { name: 'Another colour' }).click();
  // The menu closes and another page opens while the browser's colour window is still up.
  await page.keyboard.press('Escape');
  await page.goto('/admin/product');
  // What the colour window does on each change: the always-mounted input gets the value and an `input` event.
  await page.evaluate("(() => { const input = document.querySelector('input[type=color]'); input.value = '#db2777'; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
  expect((await primary(page)).toLowerCase()).toBe('#db2777');
  await openAccountMenu(page);
  await page.getByRole('group', { name: 'Accent colour' }).getByRole('button', { name: 'Default' }).click();
});

test('a superuser uploads a logo and a tab icon for everyone, and removes them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the sidebar is a drawer on phones');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.goto('/admin/');
  const mark = page.getByRole('complementary').locator('img').first();
  await expect(mark).toHaveAttribute('src', 'favicon.svg'); // the admin's own mark when there is no logo
  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Upload' }).first().click();
  await page.getByTestId('picture-input').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(mark).toHaveAttribute('src', /^appearance\/logo\?v=/);
  expect((await page.request.get(`/admin/${await mark.getAttribute('src')}`)).headers()['content-type']).toBe('image/png');

  await openAccountMenu(page);
  await page.getByRole('button', { name: 'Upload' }).nth(1).click();
  await page.getByTestId('picture-input').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^appearance\/favicon\?v=/);

  for (let i = 0; i < 2; i++) {
    await openAccountMenu(page);
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await page.waitForLoadState('load');
  }
  await expect(mark).toHaveAttribute('src', 'favicon.svg');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', 'favicon.svg');
});
