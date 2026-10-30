import { expect, test } from '@playwright/test';

/** The pages compared in every language and theme. The demo database is fresh, so ids and counts are stable. */
const PAGES: Array<[string, string]> = [
  ['home', '/admin'],
  ['product-list', '/admin/product'],
  ['product-form', '/admin/product/1'],
  ['article-form', '/admin/article/1'], // the rich-text editor: each block takes the direction of its own text
  ['order-form', '/admin/order/4'], // a draft order: its status badge and its actions in the detail header
  ['order-lines', '/admin/order/1'], // an order with lines: a table inline (cards: product specs)
  ['shop-settings', '/admin/p/shop'], // a settings page: sections, a switch, an image field and a secret
];

/** The blocking alert (dimmed, blurred app behind it), once, so the look can be judged: desktop, English, light. */
test('leave alert', async ({ page }, testInfo) => {
  test.skip(!/^(plain-)?desktop$/.test(testInfo.project.name) || testInfo.project.name.startsWith('plain'), 'one baseline is enough');
  await page.addInitScript(() => {
    localStorage.setItem('nma.locale', 'en');
    localStorage.setItem('nma.theme', 'light');
  });
  await page.goto('/admin/product/1');
  await page.waitForLoadState('networkidle');
  await page.evaluate('document.fonts.ready');
  await page.getByLabel('Stock', { exact: true }).fill('99');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.waitForTimeout(400); // the fade-in ends
  await expect(page).toHaveScreenshot('leave-alert-en-light.png');
});

for (const locale of ['en', 'fa']) {
  for (const theme of ['light', 'dark']) {
    test(`${locale} ${theme}`, async ({ page }) => {
      await page.addInitScript(
        ([language, scheme]) => {
          localStorage.setItem('nma.locale', language!);
          localStorage.setItem('nma.theme', scheme!);
        },
        [locale, theme],
      );
      for (const [name, path] of PAGES) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await page.evaluate('document.fonts.ready');
        await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
        await expect(page).toHaveScreenshot(`${name}-${locale}-${theme}.png`);
      }
    });
  }
}
