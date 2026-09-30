import { expect, test } from '@playwright/test';

/** The pages compared in every language and theme. The demo database is fresh, so ids and counts are stable. */
const PAGES: Array<[string, string]> = [
  ['home', '/admin'],
  ['product-list', '/admin/product'],
  ['product-form', '/admin/product/1'],
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
