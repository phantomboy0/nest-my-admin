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
