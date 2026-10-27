import { randomBytes } from 'node:crypto';
import { isRtlLocale } from '../i18n/localized-text.js';
import { escapeHtml } from './html.js';

const TOOLBAR: Record<string, { print: string; close: string }> = {
  en: { print: 'Print', close: 'Close' },
  fa: { print: 'چاپ', close: 'بستن' },
};

/** The page a print template's body goes into, and the CSP that lets only its own script run. */
export function printPage(input: { title: string; body: string; size: string; locale: string }): { html: string; csp: string } {
  const nonce = randomBytes(16).toString('base64');
  const words = TOOLBAR[input.locale.split('-')[0]!] ?? TOOLBAR.en!;
  const dir = isRtlLocale(input.locale) ? 'rtl' : 'ltr';
  const html = `<!doctype html>
<html lang="${escapeHtml(input.locale)}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
@page { size: ${input.size}; margin: 10mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: Vazirmatn, 'Vazirmatn Variable', Tahoma, ui-sans-serif, system-ui, sans-serif; color: #111; font-size: 12px; line-height: 1.5; }
.nma-print-toolbar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: flex-end; padding: 8px 12px; background: #f4f4f5; border-bottom: 1px solid #e4e4e7; }
.nma-print-toolbar button { font: inherit; padding: 4px 14px; border: 1px solid #d4d4d8; border-radius: 6px; background: #fff; cursor: pointer; }
.nma-print-toolbar button:first-child { background: #18181b; color: #fff; border-color: #18181b; }
.nma-print-page { break-after: page; padding: 0; }
.nma-print-page:last-child { break-after: auto; }
table { border-collapse: collapse; width: 100%; }
@media screen { .nma-print-body { max-width: 210mm; margin: 16px auto; background: #fff; padding: 10mm; box-shadow: 0 1px 4px rgba(0,0,0,.12); } html { background: #e4e4e7; } }
@media print { .nma-print-toolbar { display: none; } }
</style>
</head>
<body>
<div class="nma-print-toolbar"><button type="button" id="nma-print">${escapeHtml(words.print)}</button><button type="button" id="nma-close">${escapeHtml(words.close)}</button></div>
<main class="nma-print-body">${input.body}</main>
<script nonce="${nonce}">
document.getElementById('nma-print').addEventListener('click', function () { window.print(); });
document.getElementById('nma-close').addEventListener('click', function () { window.close(); });
window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });
</script>
</body>
</html>`;
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`;
  return { html, csp };
}
