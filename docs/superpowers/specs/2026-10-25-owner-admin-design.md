# Owner admin: a new look and the features behind it (v0.4)

Date: 2026-10-25 · Status: draft for review

## 1. Intent

nest-my-admin works, but out of the box it reads like a database browser: every entity is a sidebar page, lists show raw columns, a record is always an edit form, and the home page is a grid of counts. Its first real user, shop-nest, has 53 admin resources, and a shop owner meets all of them.

The user commissioned a design (Claude Design, 2026-10-25) and approved it **100%, with full attention to detail**. This milestone makes nest-my-admin look and behave like that design **for every app that uses it** (the user's decision: it becomes nest-my-admin's design, not an opt-in theme), and adds the generic features the design needs. shop-nest then configures itself onto them.

**The design is the acceptance test.** Reference files (committed):
- `docs/superpowers/specs/assets/2026-10-25-owner-admin/design.html` — the original, all eight screens (open in a browser);
- `…/dashboard-desktop.png`, `…/screens-0.png` … `screens-4.png` — renders of it.

Screens in the design: dashboard (desktop light, desktop dark, phone), sidebar (expanded, collapsed with flyout, ⌘K palette, phone drawer), products list (desktop; phone cards with filter sheet), product edit, order detail.

## 2. Goals

1. **The look.** Every nest-my-admin page matches the design's visual language: tokens (§4), sidebar, top bar, page header, cards, tables, badges, inputs, tabs, save bar, phone layouts.
2. **The eight features** (§5), each generic, each shown in the design.
3. **shop-nest configured onto them** (§6), so its five screens match the design screen for screen.

## 3. Non-goals and anti-goals

- **Non-goals:** a page builder; arbitrary host React components inside the admin (the UI stays a prebuilt bundle, spec D12 of the original design); per-app themes beyond what exists (accent colour, logo, name).
- **Anti-goal:** "close enough". A screen that differs from the design in spacing, alignment, colour, weight, icon or wording without the user having accepted the difference is not done (§7).
- **Anti-goal:** shop-specific code in nest-my-admin. Every feature must make sense for an admin that is not a shop (the demo app proves it).
- **Anti-goal:** breaking existing hosts. Everything new is opt-in configuration except the look; an app that configures nothing gets the new look and today's behaviour.

## 4. The look (design tokens, from the design's own CSS)

Light / dark:

| Token | Light | Dark |
|---|---|---|
| page background | `#fafafa` | `#0a0a0a` |
| card | `#ffffff` | `#151515` |
| foreground | `#0a0a0a` | `#f4f4f4` |
| muted background | `#f4f4f5` | `#222222` |
| muted foreground | `#686868` | `#a3a3a3` |
| border | `#e8e8e8` | `#ffffff1a` |
| input border | `#e0e0e0` | `#ffffff24` |
| card shadow | `0 1px 2px rgba(0,0,0,.04)` | none |
| primary (accent) | `#5B5BD6` default, host-configurable (existing branding option) | same |
| primary soft (selected nav, tab, row) | primary 9% | primary 22% |
| ok / ok bg | `#15803d` / `#e7f6ec` | `#4ade80` / `#22c55e1f` |
| warn / warn bg | `#975a00` / `#fcf1d8` | `#fbbf24` / `#f59e0b1f` |
| bad / bad bg | `#c11f1f` / `#fde8e8` | `#f87171` / `#ef44441f` |
| info / info bg | `#3c42b0` / `#eceefc` | `#a5b4fc` / `#6366f124` |

- Font **Vazirmatn** for every locale's UI text (bundled with the UI, not from Google at runtime; the admin must work offline/intranet); monospace for SKUs, codes and ids.
- Cards: radius 12px, 1px border, the shadow above. Badges: fully rounded pills on the status colours above. Inputs and buttons: radius 8px.
- Sidebar 256px; collapsed sidebar is icons only with a flyout of the group's items on hover/click.
- Numbers: Persian digits (`arabext`) and `٬` thousands separators by default in `fa` (the display preference can switch back; a release note); prices as `۳٬۲۵۰٬۰۰۰ تومان` (unit muted, after the number); a struck-through old price under/next to a sale price.
- The exact sizes, weights and spacings are whatever the design's CSS says; the builder reads them from `design.html` (each screen is an embedded page; extract them with the bundler manifest, `<script type="__bundler/manifest">`, gzip+base64).

The existing UI is shadcn (radix-nova, neutral). The tokens replace its theme values; components are restyled where the design differs (badge, tabs, table header, card header, page header, sidebar item, save bar). The screenshot baselines (`bun run e2e:screens`) are regenerated once the look is approved.

## 5. The features (all generic)

### 5.1 Inline-only resources
A resource can be edited only inside its parent. `@AdminResource(..., { nav: false })` hides it from the sidebar, home, group pages and palette; its routes stay (inlines, relation links, history and the audit page need them), and a direct URL still works for whoever may read it. A resource used as an inline anywhere defaults to `nav: false` unless it sets `nav: true`. The RBAC role editor still lists it through `/api/rbac/catalog` (permissions are per resource); `meta` gains no resource list, `nav: false` only cuts groups, home, palette and `/api/search` results.

### 5.2 Computed list columns
A list can show columns that are not entity columns: `list.columns` (still `string[]`, declared on the resource's `ListConfig` in `resource/admin-resource-base.ts`) may name keys of `list.computed: Record<key, { label, kind, source, … }>`, where the server computes the value per row and the UI renders it by `kind`:
- `image` — a thumbnail (40×40, radius 8) from a file field on the record or on a related/inline record (e.g. first `ProductMedia` by `sort`);
- `title` — a main line plus a muted mono subline (name + SKU);
- `money` — amount with optional struck-through previous amount;
- `badge` — a value mapped to a label and one of `ok | warn | bad | info | neutral` (e.g. stock: `> threshold → موجود`, `1..threshold → رو به اتمام`, `0 → ناموجود`, with the count in the badge);
- `count` — a related-row count;
- `toggle` — an editable boolean (existing `list.editable` look).
Computed values are produced in one batched query per page (no N+1), respect field permissions (a column built from a hidden field is hidden), and are sortable only when declared with a sort path.

### 5.3 Curated sidebar
The host declares the menu in the owner's words: ordered sections (icon, label) each listing resources, settings pages and admin pages, plus one **«پیشرفته»** section at the bottom that is collapsed by default. Anything not placed goes into «پیشرفته». Badges: a section or item may show a count from a declared query (e.g. unpaid orders `۱۸`, open tickets `۵`), loaded from `GET /api/menu/badges` (not `meta`) and refreshed every 60 s and on window focus. With no menu declared, today's module-based grouping stays. The command palette gains the design's three groups: records (search), actions (create X, toggle theme), and "go to".

### 5.4 Dashboard widgets
`@AdminWidget(name, { type, title, order, size, permission? })` providers with `load(params, ctx)`, `params = { period: 'day'|'week'|'month'|'year'|'range', from, to, previousFrom, previousTo }`, computed by the UI (browser timezone, Jalali-aware) and validated by the server (order, span ≤ 366 days). Types: `stat` (value, unit, change % vs previous period, up/down colour), `chart` (bar or line, one or two series, the second dashed for "previous period"), `table` (columns, rows, a status badge column, a "مشاهده همه" link to a list with a filter), `progress` (ring with percent and caption), `list` (icon, text, status dot, link). One period switcher for the page plus a Jalali/Gregorian range picker (per display preference). Each widget is permission-checked (`dashboard.<name>`), loads independently with its own skeleton and error state, and lays out on the design's grid (desktop 4 columns, phone 1). The dashboard replaces the home page when at least one widget exists.

### 5.5 List tabs
`list.tabs`: named filter presets shown as underlined tabs with counts above the filter bar (`همه ۲۴۸ · فعال ۲۲۱ · غیرفعال ۲۷ · ناموجود ۱۴`). A tab is a set of `filter[...]` params; selecting it writes them into the URL like any filter; counts use the existing count path (estimates above 1000 rows, shown as `~`).

### 5.6 Record layout with side cards
`form.layout` gains a two-column arrangement: `main` and `aside` (the design's order page: items, totals, shipping, history in main; customer, address, payment cards aside). Aside cards may be **read-only summaries** of the record or of a related record (§5.8). On phones aside cards follow main.

### 5.7 Stepper for an ordered status field
A field whose type is an ordered enum can be displayed as a stepper (`widget: 'stepper'`): done steps with a check, the current one highlighted, future ones numbered; under each, the time it was reached, taken from a declared history source (e.g. `OrderStatusLog`). It is display-only; changing the status stays an action (the design's «انتقال به «آماده ارسال»» primary button).

### 5.8 Read-mostly records
A resource can open records in **view mode** first (`form.mode: 'view'`): fields render as text/cards, inlines as tables, and «ویرایش» switches the editable parts to inputs. Record actions sit in the page header; one may be marked `primary` (filled accent button). The order page in the design is the target: header with number, status badges, created time and item count; action buttons «چاپ فاکتور», «چاپ برچسب پستی», a ⋯ menu, and the primary next-step button.

## 6. shop-nest onto it

- **Menu:** داشبورد · فروش (سفارش‌ها، پرداخت‌ها، کدهای تخفیف) · محصولات (محصولات، دسته‌بندی‌ها، برندها، ویژگی‌ها، موجودی) · مشتری‌ها (مشتری‌ها، کیف پول، نظرات) · پشتیبانی (تیکت‌ها، پیام‌های تماس) · محتوا (صفحه‌ها، مطالب، اسلایدها، منو) · تنظیمات; «پیشرفته»: logs, sessions, reservations, and every other resource not listed.
- **Inline-only:** product media, variants, attribute values, extra specs, product FAQs, warranties, product files, order lines, order status log, ticket messages and attachments, cart items, wallet entries (shown inside the wallet), discount redemptions, category attributes, attribute options, footer links, addresses.
- **Products list:** image, title (name + SKU), category, price (sale + struck regular), stock badge, variant count, active toggle; tabs همه / فعال / غیرفعال / ناموجود; bulk actions فعال کردن، غیرفعال کردن، حذف (the design's change-category and bulk-price actions are out, §8b); «افزودن محصول» in the header (Excel export is out, §8b).
- **Product edit:** the design's section order: اطلاعات اصلی، قیمت و موجودی، تصاویر (main-image marker, alt-text warning), تنوع‌ها، ویژگی‌ها، پرسش‌ها (as a read inline; answering/hiding inline is out, §8b), فایل‌ها، تاریخچه.
- **Order detail:** §5.6–5.8 as drawn: stepper over all seven fulfillment steps (accepted difference, §8b), items with thumbnails and totals (discount code, shipping), shipping card (method; the tracking-code field is out, §8b), status history, aside customer / address / payment (the gateway refund button is out, §8b).
- **Dashboard:** the widgets drawn: فروش، سفارش‌های پرداخت‌شده، مشتری جدید، میانگین سبد; نمودار فروش ۳۰ روز اخیر; سفارش‌ها بر اساس مرحله ارسال; هدف فروش ماه (needs a monthly target setting on the shop settings page); آخرین سفارش‌ها، تیکت‌های منتظر پاسخ، کالاهای رو به اتمام (the CRM connection widget is out, §8b).

## 7. How "like the design" is checked

1. Each task names the design screens it affects. It ends with screenshots of the real admin (demo app for nest-my-admin features, shop-nest for §6) at the design's viewport and theme, placed next to the design render.
2. The task reviewer lists **every** visible difference (spacing, alignment, colour, size, weight, icon, wording, missing element). Each is fixed, or recorded with a reason and shown to the user. Invented demo data, placeholder names, real counts and the accepted differences listed in §8b are the only differences accepted without asking.
3. The user approves the screens at batched checkpoints (after the look, after lists, after record pages, after the dashboard, after shop-nest); open differences wait in `docs/superpowers/design-compare/open-differences.md`.
4. Approved screens become the new screenshot baselines (desktop/phone × fa/en × light/dark).

## 8. Order of work

1. The look (§4) across the existing UI.
2. Inline-only resources (§5.1) and the curated sidebar with palette groups (§5.3).
3. Computed columns (§5.2) and list tabs (§5.5).
4. Record layout, stepper, view mode, primary action (§5.6–5.8).
5. Dashboard widgets (§5.4).
6. shop-nest configuration (§6), screen by screen against the design.
Release: nest-my-admin 0.4.0 after step 5 (all five packages at one version, `pack:smoke`, `compat`); shop-nest upgrades in step 6.

## 8b. Shown in the design but out of this milestone (the user's decision)

Left out and listed in CLAUDE.md so they are not forgotten (the user is reminded while they are missing): printing (invoice, shipping label) and Excel export (generic, nest-my-admin's CLAUDE.md); bulk change-category and bulk price edit, the order tracking-code field, the status-history note box, gateway refund, inline FAQ answer/hide, variant auto-build, and the CRM connection widget (shop-nest's CLAUDE.md). The screens are built without those controls; the §7 comparison lists them as accepted gaps, not defects.

Accepted differences from the design (the user's decisions):
- **Stepper steps:** the order stepper shows all seven shop-nest fulfillment steps (در صف، تأیید، آماده‌سازی، آماده شده، آماده ارسال، تحویل پست، تحویل شده); the design draws six.

Accepted at checkpoint E (2026-10-27), from the design comparison:
- **dashboard-light (top bar):** No notification bell (nest-my-admin has no notifications feature; the bell is left out (not in spec §8b yet) — ask at checkpoint A).
- **products-desktop:** Set filter chips have a small × to remove them; the design has none (removing one filter in one click (the chip row is the only place desktop shows active filters) — ask at checkpoint A).
- **products-desktop:** Set chips stay in schema order; the design shows the set «دسته‌بندی» chip first (a chip that moves while set remounts and closes its popover mid-choice).
- **products-desktop:** No tabs (همه/فعال/غیرفعال/ناموجود); no thumbnail, SKU line, sale price, stock badge, switch or ⋯ menu in rows; header subtitle is the count only (list tabs and computed columns).
- **products-desktop:** Latin digits and «USD» prices (money and digits).
- **products-desktop:** No «خروجی Excel» button (Excel export is out of scope (spec §8b)).
- **products-phone:** Title and add button sit in the page under the top bar, not in the top bar itself; trash and select buttons are extra (the phone top bar is the shell's; select mode exists because cards are links).
- **products-phone:** Cards have no checkbox outside select mode, no thumbnail, switch, price or badges row (card content comes from list.mobile; computed columns).
- **products-phone:** The drawer's main button says «نمایش نتایج», not «نمایش ۹۶ محصول»; the switch row («فقط محصولات فعال») and the sort button are plain selects (the count needs a live query per change; boolean filters are a segmented control).
- **products-phone:** Floating selection bar has no ⋯ menu; bulk actions show as labelled buttons (the demo has bulk actions with labels).
- **product-edit, order-detail:** One column (max 4xl) instead of the design's main column + aside cards (status, record info, delete; customer, address, payment) (two-column layout and aside cards).
- **product-edit:** Section anchors as a tab strip (اطلاعات اصلی، قیمت و موجودی، تصاویر…) with counts; we show the layout's own tabs (record tabs with counts come with the two-column layout).
- **product-edit:** Header actions «پیش‌نمایش», «کپی», ⋯ and primary «انتشار»; header subtitle "last edited … by …" (per-record primary actions).
- **product-edit:** Image grid with main-image badge and alt-text warning; variants table with inline toggles; questions, files, history cards on the same page (inline presentation).
- **order-detail:** Status stepper at the top; items table with thumbnails and totals block; status history with notes (stepper and inline presentation).
- **order-detail:** «چاپ فاکتور»، «چاپ برچسب پستی», tracking-code field, refund button (printing, tracking code and gateway refund are out of scope (spec §8b)).
- **product-edit, order-detail:** Save bar shows a subtitle of what changed in the design («قیمت فروش ویژه، ۲ تنوع»); ours says only «تغییرات ذخیره نشده» (the list of changed fields is not tracked per field label).
- **all fa screens:** Persian digits and ٬ separators are now the fa default; existing fa screenshot baselines change (release note) (spec §4).
- **palette:** No key hints (G T, N) next to items; records show no status at the end; an empty query lists every place to go (the design shows a few) (keyboard shortcuts per item are not built).
- **sidebar-expanded:** Menu content is the demo's (no مشتری‌ها/پشتیبانی); the support badge is filled primary in the design, ours are all muted (demo content; badge emphasis is not configurable).
- **products-desktop:** No ⋯ row menu; the price header has no unit («قیمت (تومان)»); demo categories are Latin (row actions menu is Task 8; header units are not generated).
- **products-phone:** Cards have no SKU · category line (only SKU); the price unit sits after, as in the design, but the struck price is under it (the card shows the title's subline only).
- **order-detail:** Aside holds the demo's Payment and «Handled by» cards (no customer, address, wallet); the header subtitle has no item count (the demo order has no customer/address entities).
- **order-detail:** View-mode fields are a two-column label/value grid in a card; the design shows the order as the items table and totals (inline presentation and totals).
- **order-detail:** Totals show items and the order total only (no subtotal, discount, shipping rows); line totals per row are not shown (the demo order has no discount/shipping fields).
- **product-edit:** Picture cards are stacked cards with a caption; the design shows a grid of thumbnails with drag handles and an upload tile (a grid presentation for image inlines is not built).
- **dashboard-light/dark/phone:** No horizontal "orders by stage" bars (chart widgets are vertical bars or lines); no relative times («۱۰ دقیقه پیش») in the orders table; the date-range control is an icon, not a date button (widget types as specified (§5.8)).
- **dashboard-light/dark/phone:** No «اتصال‌ها» (CRM) card (out of scope (spec §8b)).
- **sidebar-expanded, phone-drawer (shop-nest):** Settings uses the gear, not the design's sliders; support uses MessageSquare (the design's is a round bubble) (neither icon is in the curated map (`lib/icons.ts`)).
- **sidebar-expanded, phone-drawer (shop-nest):** Every badge is muted; the design fills the support badge with the accent (badge emphasis is not configurable (as on the demo)).
- **sidebar-expanded (shop-nest):** The design captures the sidebar with «فروش» open on the orders page; the capture opens on the dashboard (the screen's URL, not the menu).
- **palette (shop-nest):** The design shows a typed order number with matching orders; the capture's query is empty, so it lists actions and places (the screen script types nothing for shop-nest's numbers).
- **sidebar (shop-nest):** Low-stock badge on «موجودی» is fixed at 5 (`commerce.lowStockThreshold`'s default) (a menu badge is a fixed list query, read at boot).
- **products-desktop (shop-nest):** Title «محصول» (the resource's label) instead of «محصولات», and «جدید» instead of «افزودن محصول» (resources have no plural label or add-button text).
- **products-desktop (shop-nest):** No row ⋯ menu, no «خروجی Excel», no change-category or bulk-price actions (out of scope (spec §8b)).
- **product-edit (shop-nest):** No status card with publish settings beside the form; status is a field of «اطلاعات اصلی» (aside cards are read-only).
- **product-edit (shop-nest):** «قیمت و موجودی» is a summary (lowest price, variant count), not inputs (price, sale price, SKU and stock live per variant in shop-nest; the variants table edits them).
- **product-edit (shop-nest):** Questions are an editable cards inline (question and answer), not the design's answer/hide thread (shop-nest's FAQs are written by staff; answering customers' questions inline is out (spec §8b)).
- **product-edit (shop-nest):** Variants: no colour/size columns, stock or active switch per row, no «ساخت خودکار از ویژگی‌ها» (variant auto-build is out (spec §8b); stock is changed only by «Adjust stock» (plan 3)).
- **product-edit (shop-nest):** Section anchors under the header are the page's tabs (جزئیات، تاریخچه), not one per section with counts (record tabs per section are not built).
- **product-edit (shop-nest):** A «مرتبط» row lists inline children (تنوع، تصویر محصول…) too (related links follow `schema.related`, which ignores `nav: false`).
- **order-detail (shop-nest):** Status history is a table of raw values (`status`, `pending_payment`, `customer:2`), not the design's timeline of labelled events; no internal note box (one log table holds three kinds of value (status, fulfillment, attention), so no enum labels apply; notes need a writable inline).
- **order-detail (shop-nest):** No tracking-code field in «ارسال»: the code is entered through «پیشبرد ارسال»; the next-step button stops at «آماده‌ی ارسال» (aside and sections are read-only; «تحویل پست» needs the code (spec §8b)).
- **order-detail (shop-nest):** No «چاپ فاکتور»/«چاپ برچسب پستی», no «استرداد وجه» to the gateway (only «بازپرداخت به کیف پول»), no ⋯ menu (printing and gateway refunds are out of scope (spec §8b)).
- **order-detail (shop-nest):** Customer card shows the mobile only (no avatar, order count or wallet); the address card has no edit link and no copy button (relation cards show the related record's fields; an order's address is a snapshot).
- **order-detail (shop-nest):** Lines show a picture placeholder when the product has no media; no strikethrough regular price or variant subline (inline columns are plain fields plus computed cells).
- **order-detail (shop-nest):** Step labels follow shop-nest's seven `FULFILLMENT_STEPS` (the design has six) (accepted difference (spec §8b)).
- **dashboard-light/dark/phone (shop-nest):** Stat captions say «نسبت به دوره‌ی قبل» for every period (the design: «نسبت به دیروز» / «نسبت به ماه قبل»); units only on money (one caption per widget, the period is the UI's).
- **dashboard-light/dark/phone (shop-nest):** Low stock: product and a plain number (no SKU column, no «N عدد»/«ناموجود» badge); tickets: subject and status only (no customer, priority, waiting time) (widget tables as specified; per product, not per variant).
- **dashboard-phone (shop-nest):** Latest orders stay a four-column table on a phone (badges clip at the edge); the design turns rows into two-line items (table widgets have no phone layout).
- **dashboard (shop-nest):** The target ring is empty with «هدف فروش ماه تعیین نشده است» until `commerce.monthlySalesTarget` is set (Settings → فروش → داشبورد) (no target by default).

## 9. Calls made by the spec author (check these)

- **Approval (§7):** each affected screen is shown to the user as real-vs-design screenshots in chat (or a private artifact page); the user's yes in chat is the approval. Pages the design does not draw (users/roles/groups, audit, settings pages, login and 2FA, action dialog, quick view, inline cards, files UI) get the tokens and restyled primitives, are judged against the design's language by the reviewer, and are shown to the user as one batch at the end of step 1.
- **English and other locales:** the same layouts mirrored LTR, judged by eye; Vazirmatn stays the UI font. The `money` kind takes its unit and format from host config (`currency: { unit, position }`), no unit by default; shop-nest sets `تومان`.
- **Accent:** existing hosts that set no accent change from neutral to `#5B5BD6` (it is the new look); release notes say so and how to set the old neutral back.
- **Primary actions (§5.8):** a record action may declare `primary: true`, `label: (record) => LocalizedText` (evaluated server-side per record, like `_readonly`) and no input, so «انتقال به «آماده ارسال»» is one generic action whose label follows the status; shop-nest adds a single-record `advanceNext` action next to its bulk one.
- **Computed columns (§5.2):** a declarative descriptor for the common kinds (relation path, `count` of a relation, first related file by an order field) plus an escape hatch `compute(rows, ctx)` (batched, one call per page) that must list the `fields` it reads; the column is cut when any of those fields is hidden. Only declarative columns with a sort path are sortable.
- **Sidebar badges (§5.3):** a badge is a filter preset on a resource, counted through the existing scoped count path (RBAC scopes apply, `expectNoLeaks` covers it), served by `GET /api/menu/badges` (`meta` stays sync) and refetched every 60 s and on window focus.
- **«هدف فروش ماه»:** one monthly target value on shop-nest's shop settings page (shop-nest settings are key-value, so no migration is expected; if one is needed it runs only with the user's approval).

## 10. Left to the builder

Exact API names beyond those given; how computed values are batched; where the menu is declared (module options or decorator); the internal history source format for the stepper; widget grid sizes beyond desktop-4/phone-1 when the design is silent.
