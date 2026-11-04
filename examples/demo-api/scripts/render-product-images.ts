/**
 * Draws the showcase products' pictures (`showcase/images/<sku>-<n>.jpg`) from their lucide icon and category hue,
 * in the Chrome installed on this machine (Playwright's `chrome` channel: nothing is downloaded).
 *
 *   cd examples/demo-api && bun scripts/render-product-images.ts
 *
 * Picture 1 is the product on a light ground, 2 on a saturated one, 3 on a dark one. The JPEGs are committed;
 * run this again only after changing the catalog.
 */
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';
import { CATEGORIES, PRODUCTS } from '../src/showcase/catalog.js';

const out = join(import.meta.dir, '../showcase/images');
mkdirSync(out, { recursive: true });

// lucide-react is the UI package's dependency: resolved from there.
const fromUi = createRequire(join(import.meta.dir, '../../../packages/ui/package.json'));
const iconsDir = join(dirname(fromUi.resolve('lucide-react')), '../esm/icons'); // resolves to dist/cjs/…
if (!readdirSync(iconsDir).length) throw new Error(`no icons in ${iconsDir}`);

/** The icon's SVG elements, read from lucide's own data (`__iconData.node`: `[[tag, attrs], …]`). */
function iconMarkup(name: string): string {
  const source = readFileSync(join(iconsDir, `${name}.mjs`), 'utf8');
  const match = source.match(/const __iconData = (\{[\s\S]*?\n\});/);
  if (!match) throw new Error(`cannot read the lucide icon ${name}`);
  const nodes = (new Function(`return ${match[1]}`)() as { node: [string, Record<string, string>][] }).node;
  return nodes
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${value}"`).join(' ')}/>`)
    .join('');
}

function tile(icon: string, hue: number, variant: number): string {
  const grounds = [
    `radial-gradient(120% 90% at 30% 15%, hsl(${hue} 45% 96%), hsl(${hue} 28% 85%))`,
    `radial-gradient(120% 90% at 30% 15%, hsl(${hue} 55% 62%), hsl(${hue} 48% 44%))`,
    `radial-gradient(120% 90% at 30% 20%, hsl(${hue} 22% 26%), hsl(${hue} 26% 13%))`,
  ];
  const inks = [`hsl(${hue} 32% 26%)`, `hsl(${hue} 60% 97%)`, `hsl(${hue} 45% 84%)`];
  const shadows = [`hsl(${hue} 25% 55% / .35)`, `hsl(${hue} 50% 22% / .4)`, 'rgba(0,0,0,.45)'];
  const ground = grounds[variant - 1]!;
  const ink = inks[variant - 1]!;
  const shadow = shadows[variant - 1]!;
  const [size, x, y] = [56, 50, 47];
  return `<!doctype html><html><body style="margin:0">
<div style="position:relative;width:480px;height:480px;overflow:hidden;background:${ground}">
  <div style="position:absolute;left:${x}%;top:${y + size * 0.52}%;width:${size * 0.8}%;height:${size * 0.09}%;transform:translate(-50%,-50%);border-radius:50%;background:${shadow};filter:blur(14px)"></div>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"
    style="position:absolute;left:${x}%;top:${y}%;width:${size}%;height:${size}%;transform:translate(-50%,-50%)">${iconMarkup(icon)}</svg>
</div></body></html>`;
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 480, height: 480 } });
let count = 0;
for (const product of PRODUCTS) {
  const hue = CATEGORIES.find((category) => category.key === product.category)!.hue;
  for (let n = 1; n <= product.pictures; n++) {
    await page.setContent(tile(product.icon, hue, n));
    await page.screenshot({ path: join(out, `${product.sku}-${n}.jpg`), type: 'jpeg', quality: 86 });
    count++;
  }
}
await browser.close();
console.log(`${count} pictures in ${out}`);
