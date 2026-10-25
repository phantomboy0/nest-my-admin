# Owner Admin (v0.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** nest-my-admin looks exactly like the approved design for every app, and gains the generic features the design needs; shop-nest is configured onto them screen by screen.

**Architecture:**
- **The look first:** new design tokens and restyled shadcn primitives in `packages/ui`. They change every page at once.
- **Then the generic features**, each declared server-side in `packages/core` (decorator or resource options), carried to the UI through `contract.ts` and rendered generically.
- **shop-nest last:** it only configures; it adds no UI code.

**Tech Stack:**
- `packages/core`: NestJS + TypeORM, ESM.
- `packages/ui`: React 19 + Vite + Tailwind + shadcn (radix-nova).
- Tests and screenshots: Bun test and Playwright. No new test library: UI logic lives in `lib/*.ts` with bun unit tests; rendering is pinned by e2e (`*.pw.ts`) and screenshots. No `.test.tsx` files.

**Spec:** `docs/superpowers/specs/2026-10-25-owner-admin-design.md` (the design reference is `docs/superpowers/specs/assets/2026-10-25-owner-admin/design.html`).

## Global Constraints

- **The design is the acceptance test (spec §7):**
  - every task that changes something visible ends with real-vs-design screenshots at the design's viewport and theme (Task 0's `bun run design:compare`);
  - the reviewer lists every visible difference;
  - differences are fixed, or added to `docs/superpowers/design-compare/open-differences.md` (committed; one line per difference: screen, what, why, task) for the next checkpoint;
  - only invented data and placeholder names, the §8b items and the accepted differences of spec §8b are accepted without asking.
- **Checkpoints (batched approvals):** the user approves at five checkpoints, not per task:
  - **A** after Task 2e (the look: drawn and undrawn screens);
  - **B** after Task 7 (sidebar, products list);
  - **C** after Task 11 (product edit, order detail: layout, inline presentation, stepper);
  - **D** after Task 13 (dashboard);
  - **E** after Task 18 (shop-nest, all eight screens).

  Between checkpoints tasks continue. At a checkpoint, the screens since the last one and every line of `open-differences.md` are shown; each line is fixed or accepted, and accepted lines move to spec §8b. Each visible task commits its own baselines (`bun run e2e:screens -- --update-snapshots=all`) in a follow-up commit after its checkpoint approves it.
- **Baselines for a plain host:** a fixture app with no menu, widgets, tabs, computed columns or layout (`examples/demo-api` started with `NMA_DEMO_PLAIN=1`, which skips those options) stays in the screenshot matrix, so "a host that sets nothing new" is pinned visually.
- **Tokens:** exactly spec §4's table, plus:
  - Vazirmatn for every locale, bundled (no runtime Google Fonts); Geist removed;
  - cards radius 12px, border 1px, shadow `0 1px 2px rgba(0,0,0,.04)` (none in dark);
  - inputs and buttons radius 8px; `branding.radius` scales both proportionally (12:8);
  - badges as pills;
  - sidebar 256px;
  - default accent `#5B5BD6`, set in `globals.css`.
- **Digits:** `fa` defaults to Persian digits (`arabext`) and `٬` thousands separators (spec §4); `en` keeps Latin. The display preference still overrides. This changes existing `fa` baselines and is a release note.
- **Opt-in:** every new feature is opt-in configuration. An app that configures nothing gets the new look and today's behaviour; the one visible behaviour change is that inline children default to `nav: false` (Task 4, release note).
- **No shop-specific code in nest-my-admin;** the demo app (`examples/demo-api`) must use each feature.
- **Out of scope (spec §8b, listed in both CLAUDE.md files):**
  - printing and Excel export;
  - bulk change-category and bulk price edit;
  - the order tracking-code field, the history note box and gateway refund;
  - inline FAQ answer and hide;
  - variant auto-build;
  - the CRM widget.

  When a task touches a screen that shows one of these, its report reminds the user which are still missing.
- **The repo's own rules** (`CLAUDE.md`):
  - `.js` relative imports in core;
  - decimals and bigints as strings;
  - Playwright files end in `.pw.ts`;
  - `fa` keys mirror `en` (`i18n/{en,fa}.ts`, the parity test);
  - number inputs are `type="text"` + `inputMode`;
  - the UI keeps the server's order;
  - assertions that differ by driver branch on `TEST_DB`.
- **Checks per task:**
  - `bun run typecheck`;
  - `bun run test`;
  - plus `bun run e2e` and `bun run e2e:screens` for visible tasks (baselines are updated only after the checkpoint approves).
- **Release:** all five packages at `0.4.0` (Task 14), `bun run pack:smoke` and `bun run compat` green.
- **shop-nest tasks** follow `~/Develop/shop-nest/CLAUDE.md`. A shop-nest migration is generated, read and run only after the user approves (none is expected: settings are key-value).
- **Commits:** no `Co-Authored-By` or AI attribution. Branch `owner-admin` in nest-my-admin; in shop-nest, create `owner-admin` from `main` before Task 15.

## Review Focus

1. **A host that sets nothing new** (the plain fixture, the existing e2e suites, compat run): it gets the new look, with every existing behaviour intact except the documented inline-child `nav: false` default. Pinned by the plain-fixture baselines, the existing e2e suites in Tasks 1–2e and `bun run compat` in Task 14.
2. **Anything counted or computed from a field or scope the viewer cannot see** (computed columns, `_computed`, menu badges, tab counts, dashboard widgets): it is cut, or counts only scoped rows; `expectNoLeaks` crawls all of them. Pinned in Tasks 5–7 and 12.
3. **`nav: false` resources:** absent from sidebar, home, group pages, palette and `/api/search`; still reachable by direct URL, in history and in the audit log for whoever may read them, and listed in the role editor via `/api/rbac/catalog`. Pinned in Tasks 4–5.
4. **Phone width (375/390px):** every new element (tabs, aside cards, stepper, widgets, the curated sidebar drawer) follows the design's phone screens. Pinned by the mobile screenshot projects in each visible task.
5. **English (LTR) and dark mode** of every new element: mirrored layout, correct colours. Pinned by the `en`/dark screenshot matrix in each visible task.

---

### Task 0: Design comparison harness

**Files:**
- Create: `scripts/design-compare.ts`.
- Create: `scripts/design-screens.json`: screen id → `{ designId, viewport, theme, route, setup? }`, where `setup` is a list of Playwright steps (`click`, `hover`, `press`, `viewport`) that put the real page into the drawn state.
- Create: `scripts/design-ids.json` (committed): the design's board UUID prefixes → screen ids: `7b88` dashboard-light, `12c8` dashboard-dark, `0c52` dashboard-phone, `70af` sidebar, `4b7d` products-desktop, `1c86` products-phone, `73aa` product-edit, `5694` order-detail.
- Create: `docs/superpowers/design-compare/open-differences.md` (empty list with its column header).
- Modify: `package.json` (script `design:compare`), `.gitignore` (`design-compare/` output folder at the root).

**Interfaces:**
- Produces `bun run design:compare [screenId…] [--base-url <url>]`. For each screen it:
  - extracts the design page from `design.html` (the `<script type="__bundler/manifest">` entries are gzip+base64 HTML) and renders it with Playwright at the given viewport and theme, with `fonts.gstatic.com` routed to the bundled Vazirmatn files (no network);
  - screenshots the real route after running `setup`;
  - writes `design-compare/<id>.png` (design on the right, real on the left) plus `<id>-overlay.png` (50%), and prints the paths.
- Screen ids: `dashboard-light`, `dashboard-dark`, `dashboard-phone`, `sidebar-expanded`, `sidebar-collapsed` (setup: collapse, hover a group for the flyout), `palette` (setup: `Meta+K`), `phone-drawer` (setup: 390px, open the drawer), `products-desktop`, `products-phone`, `product-edit`, `order-detail`. The four sidebar ids all compare against board `70af`, each cropped to its state.
- Documents at the top of the script how the real side is started:
  - demo: `cd examples/demo-api && bun src/main.ts` (seeds itself on boot), signed in through the e2e `login.setup.ts` storage state;
  - shop-nest: `bun run db:up && bun run start` (shop-nest has no seed script; Task 15 adds `scripts/seed-design.ts`, run once with `bun scripts/seed-design.ts`), signed in as the bootstrap admin from `.env` (`ADMIN_BOOTSTRAP_USERNAME`/`ADMIN_BOOTSTRAP_PASSWORD`), `--base-url http://localhost:4000/admin`.

- [ ] **Step 1:** Write the script, the two JSON files and the docs header.
- [ ] **Step 2:** Run `bun run design:compare dashboard-light palette`. Expected: two PNG pairs are written; the real side of `dashboard-light` is today's home page, and the design side renders in Vazirmatn with the network off.
- [ ] **Step 3:** Commit: `chore: design comparison harness`.

### Task 1: Design tokens and font

**Files:**
- Modify: `packages/ui/src/styles/globals.css` (the light and dark token values from spec §4, the default accent `#5B5BD6` as `--primary`, `--radius` so that card = 12px and input/button = 8px, the status tokens `--ok --ok-bg --warn --warn-bg --bad --bad-bg --info --info-bg`, the primary-soft mix, and `--nma-font` = Vazirmatn for all locales; the Geist rule and font files removed).
- Modify: `packages/ui/src/lib/theme.ts` (`brandingVariables`: no accent → no `--primary` override; `radius` scales `--radius-card`/`--radius-control` at 12:8).
- Test: `packages/ui/src/lib/theme.test.ts`.

**Interfaces:**
- Produces Tailwind colour utilities `ok`, `ok-bg`, `warn`, `warn-bg`, `bad`, `bad-bg`, `info`, `info-bg` and `primary-soft` (registered in `@theme`), and radius utilities `rounded-card` (12px) and `rounded-control` (8px).

- [ ] **Step 1: Failing tests:**
  - `brandingVariables({})` sets no `--primary` (the CSS default `#5B5BD6` applies);
  - `brandingVariables({ accent: '#123456' })` sets `--primary: #123456`;
  - `brandingVariables({ radius: 6 })` gives `--radius-card: 9px` and `--radius-control: 6px`.
- [ ] **Step 2:** Run `bun test packages/ui/src/lib/theme.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the tokens. Read every value from `design.html`'s CSS (spec §4), not from memory.
- [ ] **Step 4:** Run `bun run typecheck && bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ui): design tokens and font`.

### Task 2a: Primitives

**Files:**
- Modify: `packages/ui/src/components/ui/{button,input,table}.tsx`, `packages/ui/src/app/widgets/badge.tsx` (`ValueBadge` maps the existing `BADGE_COLORS` to tones).
- Create: `packages/ui/src/components/ui/{badge,card,tabs,page-header}.tsx`, `packages/ui/src/lib/tones.ts`.
- Modify: `packages/core/src/contract.ts` (`export type Tone`, used by later core tasks).
- Test: `packages/ui/src/lib/tones.test.ts`.

**Interfaces:**
- Produces:
  - `type Tone = 'ok'|'warn'|'bad'|'info'|'neutral'|'primary'` (contract) and `toneOf(color: BadgeColor): Tone` (`lib/tones.ts`);
  - `<Badge tone>` (pill);
  - `<Card title? subtitle? icon? actions? footer?>` (header with divider);
  - `<Tabs items={{ key, label, count?, estimate? }[]} value onChange>` (underlined);
  - `<PageHeader title subtitle? breadcrumbs? actions? badges?>`.

  Later tasks use these.

- [ ] **Step 1: Failing test:** `toneOf` maps every `BADGE_COLORS` entry to a tone (green → ok, amber → warn, red → bad, blue → info, gray → neutral; an unknown colour → neutral).
- [ ] **Step 2:** Run `bun test packages/ui/src/lib/tones.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the primitives from the design's CSS (heights, paddings, weights).
- [ ] **Step 4:** Run `bun run typecheck && bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ui): restyled primitives`.

### Task 2b: Shell

**Files:**
- Modify: `packages/ui/src/app/{sidebar,header,admin-layout,command-palette,user-menu}.tsx`.

- [ ] **Step 1:** Restyle against the design:
  - **Sidebar:** brand block at the top, items, sections with chevrons, count pills, the user block at the bottom, collapsed mode with a flyout, the phone drawer.
  - **Top bar:** sidebar toggle, breadcrumbs, search with ⌘K, theme toggle, bell.
  - **Command palette:** groups and the footer key hints (the groups' content is Task 5).
- [ ] **Step 2:** Run `bun run design:compare sidebar-expanded sidebar-collapsed palette phone-drawer`. Fix every shell difference; content differences (menu, badges) go to `open-differences.md` tagged Task 5.
- [ ] **Step 3:** Run `bun run test && bun run e2e`. Expected: existing suites green; selectors that changed are updated, assertions are not.
- [ ] **Step 4:** Commit: `feat(ui): restyled shell`.

### Task 2c: List page

**Files:**
- Modify: `packages/ui/src/app/{list-page,filter-bar,mobile-list,column-menu,editable-cell}.tsx`.

- [ ] **Step 1:** Restyle: header, filter row, table header style, row height, selection bar, pagination; phone cards and the filter sheet.
- [ ] **Step 2:** Run `bun run design:compare products-desktop products-phone`. Fix every difference in the list chrome; content differences (computed columns, tabs) go to `open-differences.md` tagged Tasks 6–7.
- [ ] **Step 3:** Run `bun run test && bun run e2e`. Expected: green.
- [ ] **Step 4:** Commit: `feat(ui): restyled list page`.

### Task 2d: Form, inlines and save bar

**Files:**
- Modify: `packages/ui/src/app/{form-page,form-layout,form-guards,inline-section,field-input,image-input,file-input}.tsx`.

- [ ] **Step 1:** Restyle: sections as cards, tabs, inline tables and cards, the sticky save bar with «تغییرات ذخیره نشده» and ⌘S.
- [ ] **Step 2:** Run `bun run design:compare product-edit order-detail`. Fix every form-chrome difference; content differences go to `open-differences.md` tagged Tasks 8–11.
- [ ] **Step 3:** Run `bun run test && bun run e2e`. Expected: green.
- [ ] **Step 4:** Commit: `feat(ui): restyled form and save bar`.

### Task 2e: Undrawn pages and checkpoint A

**Files:**
- Modify as needed: `packages/ui/src/app/{home-page,group-page,settings-page,login-page,account-page,action-dialog,quick-view,history-tab,file-display}.tsx`, `packages/ui/src/app/admin/*`.

- [ ] **Step 1:** Screenshot users, roles, groups, audit, a settings page, login, 2FA, the action dialog, quick view, home, group page and the files UI (desktop and phone, fa and en, light and dark) into `design-compare/undrawn/`; fix anything that breaks the design's language.
- [ ] **Step 2:** Run `bun run test && bun run e2e`. Expected: green.
- [ ] **Step 3:** Commit: `feat(ui): undrawn pages in the owner-admin look`.
- [ ] **Step 4: Checkpoint A.** Show the user the drawn comparisons from 2b–2d, the undrawn batch, the plain fixture and `open-differences.md`. Fix or accept each line.
- [ ] **Step 5:** After approval: `bun run e2e:screens -- --update-snapshots=all` (plain fixture included), commit `test(ui): owner-admin look baselines`.

### Task 3: Money, currency and digits

**Files:**
- Modify: `packages/core/src/options.ts` (`currency?: { unit: LocalizedText; position: 'after' | 'before' }`, passed in the UI config), `packages/core/src/decorators/admin-field.ts` (field `currency?` of the same shape, which wins over the global option), `contract.ts` (`FieldSchema.currency`).
- Modify: `packages/ui/src/lib/money.ts`, `lib/format.ts`, `lib/digits.ts`, `lib/display-prefs.ts` (the `fa` default `digits: 'arabext'`).
- Test: `packages/ui/src/lib/{money,digits,display-prefs}.test.ts`, `packages/core/src/options.test.ts`.

**Interfaces:**
- Produces `formatMoney(value: string, opts?: { previous?: string; currency?: CurrencyConfig }) → { main: string; unit?: string; previous?: string }` and `type CurrencyConfig = { unit: string; position: 'after'|'before' }` (UI side, unit localized).

- [ ] **Step 1: Failing tests:**
  - `formatMoney('3250000')` in `fa` with the global unit `تومان` gives `main: '۳٬۲۵۰٬۰۰۰'` and `unit: 'تومان'`;
  - a field `currency` wins over the global one;
  - with no currency configured there is no unit;
  - `previous` is formatted the same way;
  - with no saved preference, `fa` resolves to `arabext` digits and `en` to `latn`; a saved preference wins.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Decimal fields declared `widget: 'money'` use `formatMoney`.
- [ ] **Step 4:** Run `bun run typecheck && bun run test && bun run e2e` (fix e2e text matchers that read digits through the digit helper, not by hard-coding). Expected: PASS. `fa` baseline changes are listed in `open-differences.md` for checkpoint B.
- [ ] **Step 5:** Commit: `feat: currency option, money display and Persian digits by default`.

### Task 4: Inline-only resources (`nav: false`)

**Files:**
- Modify:
  - `packages/core/src/decorators/admin-resource.ts` (`nav?: boolean`);
  - `registry/resource-registry.ts` (`RegisteredResource.nav: boolean`; the default: a resource used as an inline child gets `nav: false` unless it sets `nav: true`);
  - `api/admin-api.service.ts` (`meta` stays sync and leaves `nav: false` resources out of groups and counts; `search` skips them);
  - `rbac/rbac-routes.ts` (`/api/rbac/catalog` keeps listing them).
- Modify (UI): `lib/palette.ts` (only what `meta` gives; no change expected beyond tests).
- Modify (demo): `examples/demo-api` e2e that expected inline children in the sidebar.
- Test: `packages/core/test/nav.test.ts`; `packages/ui/src/lib/palette.test.ts`.

**Interfaces:**
- Produces `RegisteredResource.nav`. No `MetaResponse.resources` is added.

- [ ] **Step 1: Failing tests:**
  - a resource with `nav: false` is absent from `meta.groups` and home counts;
  - `/api/search` returns no records of it;
  - GET of its record by id, its history and its audit entries work for a permitted user;
  - an inline child with no `nav` option gets `nav: false`, and `nav: true` keeps it;
  - `/api/rbac/catalog` still includes it.
- [ ] **Step 2:** Run `bun test packages/core/test/nav.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test && bun run e2e`; update the demo e2e for inline children that left the sidebar (a visible change; noted for Task 14's upgrade notes). Expected: PASS, `expectNoLeaks` green.
- [ ] **Step 5:** Commit: `feat: inline-only resources`.

### Task 5: Curated sidebar, badges and palette groups

**Files:**
- Modify: `packages/core/src/options.ts`, adding:
  ```ts
  menu?: {
    sections: {
      key: string;
      label: LocalizedText;
      icon: string;
      items: (
        | { resource: string; badge?: Record<string, string> }
        | { page: string }
        | { href: string; label: LocalizedText }
      )[];
    }[];
    advanced?: { label?: LocalizedText };
  }
  ```
  `badge` holds `filter[...]` params, checked at boot against the resource's filter allow-list.
- Create: `packages/core/src/api/menu-routes.ts` (`GET /api/menu/badges`), mounted from `http/admin-http.server.ts`.
- Modify: `api/admin-api.service.ts` (`meta` returns `menu` with items permission-cut; badges are not in `meta`), `contract.ts` (`MetaMenu`, `MetaMenuSection`, `MenuBadges`).
- Modify (UI): `app/sidebar.tsx`, `app/home-page.tsx`, `app/group-page.tsx` (route `/g/:section` with a menu), `app/header.tsx` (breadcrumbs), `app/command-palette.tsx`, `lib/palette.ts`, `lib/nav-state.ts`, `lib/queries.ts` (`useMenuBadges`).
- Modify: `packages/testing` `expectNoLeaks` (crawls `/api/menu/badges`).
- Test: `packages/core/test/menu.test.ts`; `packages/ui/src/lib/{palette,nav-state}.test.ts`; `examples/demo-api/e2e/menu.pw.ts`.

**Interfaces:**
- Produces `MetaResponse.menu?: { sections: MetaMenuSection[]; advanced: MetaMenuSection }`, `MetaMenuSection = { key, label, icon, items: MetaMenuItem[] }`; unplaced visible resources and pages go into `advanced`, collapsed by default.
- Produces `GET /api/menu/badges → MenuBadges = Record<'<section>.<resource>', { count: number; estimate: boolean }>`, counted through the scoped count path. UI: `useMenuBadges()` with `refetchInterval: 60_000` and `refetchOnWindowFocus: true`.
- With a menu, home cards, `/g/:section` pages and breadcrumbs follow menu sections; palette groups: records (`/api/search`), actions (create X, toggle theme), "go to".

- [ ] **Step 1: Failing tests:**
  - a configured menu comes back in the declared order;
  - an item the viewer cannot reach is cut, and an empty section is cut;
  - unplaced resources land in `advanced`; `nav: false` ones do not;
  - a badge counts only rows inside the viewer's scope (scoped role); an unknown badge filter is a boot error;
  - with no `menu`, `meta` is unchanged (deep-equal to a snapshot taken before the change);
  - UI: `palette.ts` builds the three groups from `meta.menu`; `nav-state.ts` collapses `advanced` by default; e2e: home cards and `/g/:section` follow the menu, the palette never offers a `nav: false` resource.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Configure the demo menu.
- [ ] **Step 4:** Run `bun run test && bun run e2e`, `expectNoLeaks` green, then `bun run design:compare sidebar-expanded sidebar-collapsed palette phone-drawer`; fix or record every difference.
- [ ] **Step 5:** Commit: `feat: curated sidebar menu with badges`.

### Task 6: Computed list columns

**Files:**
- Modify: `packages/core/src/resource/admin-resource-base.ts`: `ListConfig.columns: string[]` may name computed keys; new `ListConfig.computed?: Record<string, ComputedColumn>`:
  ```ts
  type ComputedColumn = {
    label: LocalizedText;
    kind: 'image'|'title'|'money'|'badge'|'count'|'toggle';
    source:
      | string                                                      // relation path
      | { aggregate: 'min'|'max'|'sum'|'count'; relation: string; field?: string }
      | { first: string; field: string; by: string }               // first SKU, first image
      | { toggle: string; on: string; off: string }                // enum field
      | { compute: (rows, ctx) => Promise<Record<string, unknown>>; fields: string[] };
    subline?: ComputedColumn['source'];                             // title kind
    previous?: ComputedColumn['source'];                            // money kind
    map?: (value: unknown, row: AdminRecord) => { label: LocalizedText; tone: Tone } ; // badge kind
    sortable?: boolean;                                             // aggregate and first only
  };
  ```
- Create: `packages/core/src/crud/computed-columns.ts` (`checkComputed` at boot, `loadComputed(rows, columns, ctx)`; `aggregate`/`first` as correlated subqueries, sortable through `applyListParams`).
- Modify: `registry/resource-registry.ts`, `api/admin-api.service.ts` (`records()` attaches `_computed`), `policy/admin-policy.service.ts` (cut columns whose fields or relations are hidden), `contract.ts` (`ListSchema.computed`, `AdminRecord._computed?: Record<string, ComputedValue>` documented).
- Modify (UI): `app/list-page.tsx`, `app/mobile-list.tsx`, `app/column-menu.tsx`; create `app/computed-cell.tsx`, `lib/computed-cells.ts`.
- Modify: `packages/testing` `expectNoLeaks` (`_computed`).
- Modify (demo): `examples/demo-api/src/catalog` product: `ProductMedia` child (file + `sort`), `compareAtPrice` decimal, `stock`, and seed rows for them.
- Test: `packages/core/test/computed-columns.test.ts`; `packages/ui/src/lib/computed-cells.test.ts`; `examples/demo-api/e2e/products-list.pw.ts`.

**Interfaces:**
- Produces `ComputedColumn`, `ComputedValue` (contract), `lib/computed-cells.ts` `cellModel(column, value, locale) → { kind, text?, subline?, previous?, tone?, src?, on? }`.

- [ ] **Step 1: Failing tests:**
  - **No N+1:** a page of 50 rows runs a constant number of queries for `aggregate`, `first` and `relation` sources (query counter).
  - **Batching:** `compute` is called once per page.
  - **Sorting:** an `aggregate`/`first` column with `sortable` sorts (both directions, primary key tie-breaker); others are refused like unknown sort fields.
  - **Toggle:** a `toggle` over an enum shows `on` as checked and writes `on`/`off` through PATCH.
  - **Permissions:** a column whose `fields` or relation is hidden is absent from the schema and `_computed` for that viewer; `expectNoLeaks` green.
  - **Badge mapping** (demo config, threshold 5): `0 → ناموجود/bad`, `1..5 → رو به اتمام/warn`, `>5 → موجود/ok`; `map` receives the row.
  - UI: `cellModel` for each kind (money with `previous`, title with subline, empty image → placeholder).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Cells: image 40×40 radius 8 (placeholder icon when empty); title main + muted mono subline; money via `formatMoney` with struck `previous`; badge `<Badge tone>`; count muted; toggle the existing editable cell. Phone cards show image, title, money and badge.
- [ ] **Step 4:** Run `bun run test && bun run e2e`, then `bun run design:compare products-desktop products-phone`; fix or record every difference.
- [ ] **Step 5:** Commit: `feat: computed list columns`.

### Task 7: List tabs and checkpoint B

**Files:**
- Modify: `packages/core/src/resource/admin-resource-base.ts` (`ListConfig.tabs?: { key; label: LocalizedText; filter?: Record<string, string>; where?: (qb, ctx) => void; count?: 'exact'|'estimate'|'none' }[]`, at most 6, a boot check), `registry/resource-registry.ts`, `api/admin-api.service.ts` (`tab` list param applies `where`), `contract.ts` (`ListSchema.tabs`, `TabCounts`).
- Create: route `GET /api/resources/:r/tab-counts` in `http/router.ts`.
- Modify (UI): `app/list-page.tsx`, `lib/list-state.ts` (a tab writes its filter params plus `tab=<key>` when it has a `where`; the active tab is derived from the URL), `lib/filter-chips.ts` (a tab's own filters don't show as chips).
- Modify: `packages/testing` `expectNoLeaks` (tab counts).
- Test: `packages/core/test/list-tabs.test.ts`; `packages/ui/src/lib/{list-state,filter-chips}.test.ts`.

**Interfaces:**
- Produces `TabCounts = Record<tabKey, { count: number; estimate: boolean } | null>` (`null` for `count: 'none'`), counted in parallel through the scoped count path.

- [ ] **Step 1: Failing tests:**
  - tab counts respect scopes; above 1000 rows they are estimates on Postgres/MySQL and exact on SQLite-family (branch on `TEST_DB`: no `EXPLAIN` estimate there);
  - a `where` tab restricts the list and its count; `count: 'none'` gives `null` and runs no query;
  - seven tabs are a boot error;
  - selecting a tab writes its filters to the URL; a URL with exactly a tab's filters shows that tab active; "همه" is the tab with no filters.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. An estimate is shown with `~`.
- [ ] **Step 4:** Run `bun run test && bun run e2e`, then `bun run design:compare products-desktop products-phone`; fix or record every difference.
- [ ] **Step 5:** Commit: `feat: list tabs with counts`.
- [ ] **Step 6: Checkpoint B.** Show sidebar (four states), palette, products list (desktop, phone) and `open-differences.md`. After approval, Tasks 3–7 commit their baselines: `test: baselines for menu, columns and tabs`.

### Task 8: Primary actions with per-record labels

**Files:**
- Modify:
  - `packages/core/src/decorators/admin-action.ts`: `primary?: boolean` and `label: LocalizedText | { static: LocalizedText; for: (record) => LocalizedText | null }` (a function label needs the static fallback for bulk menus, the role editor and the audit log); `resolveActions` boot checks: one `primary` per resource, `primary` only with `target: 'record'` and no input;
  - `api/action.service.ts` (a run on a record whose label is `null` is refused with 404);
  - `api/admin-api.service.ts` / `policy/admin-policy.service.ts`: per-record labels folded into `_perm.actions` (`Record<name, string | false>`: the label, or `false` when hidden or not permitted).
- Modify: `contract.ts` (`ActionSchema.primary`, `_perm.actions` values).
- Modify (UI): `lib/actions.ts`, `app/action-button.tsx`, `app/form-page.tsx`. The primary action renders as a filled accent button with an arrow, last in the header row; others outline; overflow in a ⋯ menu.
- Test: `packages/core/test/primary-action.test.ts`; `packages/ui/src/lib/actions.test.ts`.

**Interfaces:**
- Produces `ActionSchema.primary`, `_perm.actions[name]: string | false`, `lib/actions.ts` `headerActions(schema, record) → { primary?, buttons, overflow }`.

- [ ] **Step 1: Failing tests:**
  - the label function runs per record with the viewer's locale;
  - a `null` label hides the action and a run is refused with 404;
  - two `primary` actions, a `primary` resource action, or a `primary` with input are boot errors; a function label without `static` is a boot error;
  - an input-free primary action runs without a dialog unless `confirm` is set;
  - `headerActions` puts primary last and overflows beyond three buttons.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. In the demo, give `OrderAdmin` a primary `advanceNext` action with a status-dependent label.
- [ ] **Step 4:** Run `bun run test && bun run e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: primary record actions with per-record labels`.

### Task 9: Two-column record layout, aside cards and view mode

**Files:**
- Modify:
  - `packages/core/src/resource/admin-resource-base.ts` (`FormConfig`): `form.layout` accepts `{ main: LayoutNode[]; aside: AsideCard[] }`, `AsideCard = { title: LocalizedText; icon?: string; fields: string[] | { relation: string; fields: string[] }; link?: boolean }`; `form.mode?: 'edit' | 'view'`; `form.header?: { badges?: string[]; subtitle?: (string | { computed: string })[]; stepper?: string }` (field paths; `stepper` is used in Task 11);
  - `schema/field-config.ts` (`checkLayout`, `localizeLayout` for the new shape), `registry/resource-registry.ts`, `inlines/inline-config.ts` (inlines inside `main`), `schema/build-resource-schema.ts`, `contract.ts` (`FormSchema.layout`, `mode`, `header`).
- Modify (UI): `app/form-page.tsx`, `app/form-layout.tsx`, `lib/inline-changes.ts` (inlines found inside `main`), `lib/view-as.ts` (`readOnlySchema` cuts aside cards' hidden fields and keeps `mode`); create `app/aside-card.tsx`, `app/record-header.tsx`, `lib/record-layout.ts`.
- Test: `packages/core/test/record-layout.test.ts`; `packages/ui/src/lib/{record-layout,view-as,inline-changes}.test.ts`; `examples/demo-api/e2e/record-layout.pw.ts`.

**Interfaces:**
- Produces `AsideCard`, `FormSchema.header`, `lib/record-layout.ts` `layoutModel(schema, record, mode) → { main, aside, header: { badges, subtitle }, editable: string[] }`.

**Behaviour:**
- **View mode:** fields render as text (money via `formatMoney`, enums as badges, relations as links), inlines as read tables. «ویرایش» switches the editable sections to inputs, with the save bar as today.
- **Aside cards:** always read-only. A related card links to its record («مشاهده پروفایل»).
- **Phone:** aside cards follow main.

- [ ] **Step 1: Failing tests:**
  - a layout with `aside` is validated at boot (unknown fields or relations are a boot error);
  - aside fields are cut by permission;
  - `layoutModel` in view mode: `editable` is empty; after «ویرایش» it is exactly `form.update` within the layout;
  - e2e: opening a view-mode record sends no write.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Configure the demo order like the design's order page.
- [ ] **Step 4:** Run `bun run test && bun run e2e`, then `bun run design:compare order-detail`; fix or record every difference except the stepper and inline presentation (Tasks 10–11) and §8b items.
- [ ] **Step 5:** Commit: `feat: record layout with aside cards and view mode`.

### Task 10: Inline presentation

**Files:**
- Modify: `packages/core/src/resource/admin-resource-base.ts` / `schema/field-config.ts` (`LayoutInlineConfig`): `readonly?: boolean`, `computed?: string[]` (keys of the child's `list.computed`, shown as table columns, e.g. line thumbnails), `cards?: { markFirst?: LocalizedText }` (a marker on the first card by `order`, e.g. «تصویر اصلی»); `@AdminField` `warnIf?: { empty: true; message: LocalizedText }` (a soft warning, never blocks a save); layout node `{ summary: { label: LocalizedText; value: string | { computed: string } }[] }` (label/value rows, e.g. totals); `form.header.subtitle` computed entries.
- Modify: `inlines/inline-reader.ts` (child `_computed`), `inlines/inline-writer.ts` (refuse writes to a `readonly` inline with 422), `schema/field-config.ts` (`checkLayout` for `summary`, `computed` keys), `contract.ts` (`InlineSchema.readonly/computed/markFirst`, `FieldSchema.warnIf`, `LayoutSummaryNode`).
- Modify (UI): `app/inline-section.tsx`, `app/form-layout.tsx`, `app/record-header.tsx`, `lib/record-layout.ts` (`summaryRows`, `fieldWarnings`), `lib/inline-changes.ts` (no payload for readonly inlines).
- Modify (demo): order lines show a product thumbnail; `ProductMedia` cards with `markFirst` and an alt-text `warnIf`; order totals as a `summary`.
- Test: `packages/core/test/inline-presentation.test.ts`; `packages/ui/src/lib/{record-layout,inline-changes}.test.ts`; `examples/demo-api/e2e/inlines.pw.ts` (extended).

**Interfaces:**
- Produces `LayoutSummaryNode`, `FieldSchema.warnIf`, `InlineSchema.readonly`, `InlineSchema.computed`, `InlineSchema.markFirst`, `summaryRows(node, record, locale)`, `fieldWarnings(schema, values) → Record<field, string>`.

- [ ] **Step 1: Failing tests:**
  - a write to a `readonly` inline is 422; its rows still read;
  - inline computed columns load in one batch per parent and are cut by the child's permissions;
  - an unknown `computed` key or `summary` value is a boot error;
  - `fieldWarnings` warns on an empty alt text and the save still goes through;
  - `summaryRows` formats money values; `inline-changes` sends nothing for a readonly inline.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test && bun run e2e`, then `bun run design:compare product-edit order-detail`; fix or record every difference except the stepper.
- [ ] **Step 5:** Commit: `feat: inline presentation (readonly, computed columns, main marker, warnings, summary)`.

### Task 11: Stepper for an ordered status field and checkpoint C

**Files:**
- Modify: `packages/core/src/decorators/admin-field.ts` (`WIDGETS` gains `'stepper'`; options `steps?: string[]` (order; defaults to the enum's order), `exclude?: string[]`, `history?: { inline: Type<AdminResourceBase>; value: string; at: string; where?: Record<string, string> }`), `contract.ts` (widget union, `AdminRecord._steps?: Record<value, string | null>`), `api/admin-api.service.ts` (`records()` fills `_steps` on GET by id, through the history child's read path).
- Modify (UI): `lib/widgets.ts`, `app/form-layout.tsx` (renders the field in `form.header.stepper` full-width above the main column); create `app/stepper.tsx`, `lib/stepper.ts`.
- Modify (demo): `OrderStatusLog` child (`field`, `value`, `at`) with seed rows; `Order.fulfillment` with the demo's steps.
- Test: `packages/core/test/stepper.test.ts`; `packages/ui/src/lib/stepper.test.ts`; `examples/demo-api/e2e/record-layout.pw.ts` (extended).

**Interfaces:**
- Produces `_steps`, `lib/stepper.ts` `stepperModel(field, value, steps) → { key, label, state: 'done'|'current'|'future', at: string | null, caption: string | null }[]`.

**Behaviour:**
- **Done:** filled accent circle with a check. **Current:** accent ring with its number, label in accent, caption «از HH:MM» (the time it was reached, as drawn). **Future:** muted ring with its number.
- **Under done steps:** the time reached (Jalali per preference); `—` when not reached.
- **Null value** (e.g. unpaid): every step future, no current.
- **Excluded value** (cancelled): a «لغو شده» badge in the header and no current step.
- **Phone:** the stepper scrolls horizontally.

- [ ] **Step 1: Failing tests:**
  - `stepperModel` states for the first, a middle and the last value; null → all future; excluded → no current;
  - `_steps` takes the latest history row per value and honours `where` (`{ field: 'fulfillment' }`);
  - the times are absent when the history child's `at` or `value` field is hidden;
  - `'stepper'` on a non-enum field is a boot error.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test && bun run e2e`, then `bun run design:compare order-detail product-edit`; fix or record every difference.
- [ ] **Step 5:** Commit: `feat: stepper display for ordered status fields`.
- [ ] **Step 6: Checkpoint C.** Show product edit, order detail (desktop, phone, en, dark) and `open-differences.md`. After approval, Tasks 8–11 commit their baselines: `test: baselines for record layout, inlines and stepper`.

### Task 12: Dashboard widgets, server side

**Files:**
- Create: `packages/core/src/decorators/admin-widget.ts`: `@AdminWidget(name, { type: 'stat'|'chart'|'table'|'progress'|'list', title: LocalizedText, order?: number, size?: 1|2|3|4, permission?: string })` (`permission` defaults to `dashboard.<name>`; a shared code is allowed); classes implement `AdminWidgetSource { load(params: WidgetParams, ctx: AdminContext): Promise<WidgetData> }`.
- Create: `packages/core/src/dashboard/{widget-registry.ts,dashboard.service.ts,widget-data.ts,dashboard-routes.ts}`; `dashboard-routes.ts` is mounted in `http/admin-http.server.ts`. `widget-data.ts` holds `WidgetData` per type:
  - **stat:** `{ value: string; unit?; change?: number; previousLabel? }`;
  - **chart:** `{ kind: 'bar'|'line'; labels: string[]; series: { label; values: number[]; dashed? }[]; total?; subtitle? }`;
  - **table:** `{ columns; rows; link?: { resource; filter } }`;
  - **progress:** `{ percent; value; caption }`;
  - **list:** `{ items: { icon?; text; status?: Tone; link? }[] }`.
- Modify: `policy/roles.ts` (`dashboard.*` codes follow `codeMatches`: `*` grants all, `dashboard.*` grants every widget), `rbac/rbac-routes.ts` (catalog lists dashboard codes), `api/admin-api.service.ts` (`meta.dashboard: boolean`, true when the viewer may see at least one widget), `contract.ts`, `index.ts` (exports), `packages/testing` `expectNoLeaks` (crawls the dashboard).
- Test: `packages/core/test/dashboard.test.ts`.

**Interfaces:**
- Produces `GET /api/dashboard → { widgets: WidgetLayout[] }` and `GET /api/dashboard/:widget?period&from&to&previousFrom&previousTo → WidgetData`.
- Produces `WidgetParams = { period: 'day'|'week'|'month'|'year'|'range'; from: string; to: string; previousFrom: string; previousTo: string }` (ISO instants). The UI computes them (Task 13); the server validates `from < to`, `previousFrom < previousTo`, span ≤ 366 days, and passes them through.
- Produces `MetaResponse.dashboard: boolean`.

- [ ] **Step 1: Failing tests:**
  - widgets are discovered and ordered;
  - an unknown period, `from ≥ to`, or a span over 366 days is a 400;
  - a widget without its permission is absent from the layout and 404 on load; `dashboard.*` and `*` grant it; a shared `permission` code grants both widgets;
  - `meta.dashboard` is false with no permitted widget;
  - one widget throwing gives an error for that widget only;
  - `expectNoLeaks` crawls the dashboard.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun run test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: dashboard widgets (server)`.

### Task 13: Dashboard widgets, UI and checkpoint D

**Files:**
- Create: `packages/ui/src/app/dashboard/{dashboard-page,period-switcher,stat-widget,chart-widget,table-widget,progress-widget,list-widget}.tsx` (charts hand-built SVG, no chart library), `packages/ui/src/lib/dashboard.ts`.
- Modify: `app/home-page.tsx` (the dashboard when `meta.dashboard`, else today's home; no flash), `lib/role-draft.ts` (`dashboard.*` matching copy), `app/admin/role-*.tsx` (the role editor shows dashboard codes), `i18n/{en,fa}.ts`.
- Create (demo): `examples/demo-api/src/dashboard/` widgets covering all five types.
- Test: `packages/ui/src/lib/{dashboard,role-draft}.test.ts`; `examples/demo-api/e2e/dashboard.pw.ts`.

**Interfaces:**
- Produces `lib/dashboard.ts`:
  - `periodRange(period, now: Date, calendar: 'gregory'|'persian', from?, to?) → WidgetParams` (browser timezone; Jalali via `lib/jalali.ts`). Previous = the immediately preceding window of equal calendar length for day/week/year, the previous calendar month for month;
  - `changeModel(change?: number) → { tone: 'ok'|'bad'|'neutral'; arrow: 'up'|'down'|null; text }`;
  - `chartGeometry(data, width, height) → bars/paths/gridlines`.

**Behaviour:**
- **Grid:** 4 columns on desktop, 1 on phone. **Loading:** each widget on its own, skeleton and error card. **Period:** امروز / هفته / ماه / سال plus the range picker, kept in the URL. **Table widget:** «مشاهده همه» links to the list with the filter.

- [ ] **Step 1: Failing tests:**
  - `periodRange` month in Persian calendar: Esfand in a leap year (30 days) and a non-leap year (29), previous month of Farvardin is Esfand; Gregorian month 31 → previous 30-day month; week and year windows; range previous of equal length;
  - `changeModel` sign → tone and arrow;
  - `role-draft` treats `dashboard.*` like the server;
  - e2e: a period change refetches every widget; an error in one widget leaves the others; no permitted widget → today's home.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, and add the demo widgets.
- [ ] **Step 4:** Run `bun run test && bun run e2e`, then `bun run design:compare dashboard-light dashboard-dark dashboard-phone` (no CRM card in the demo); fix or record every difference.
- [ ] **Step 5:** Commit: `feat: dashboard widgets (ui)`.
- [ ] **Step 6: Checkpoint D.** Show the three dashboard screens and `open-differences.md`. After approval, commit Tasks 12–13 baselines: `test: dashboard baselines`.

### Task 14: Release 0.4.0

**Files:**
- Modify:
  - every package's `package.json` (version `0.4.0`);
  - `packages/core/README.md` ("Upgrading to 0.4": the new look and accent, how to set the old neutral accent back, Persian digits by default in `fa` and how to switch back, inline children now `nav: false` by default and how to keep them in the sidebar, and each new option with an example);
  - `CHANGELOG` (if present);
  - `CLAUDE.md` (architecture lines for menu and badges, nav, computed columns, tabs, layout, inline presentation, stepper, primary actions, the dashboard; the §8b "missing" items).

- [ ] **Step 1:** Run `bun run build && bun run test && bun run test:postgres && bun run test:mysql && bun run e2e && bun run e2e:screens && bun run pack:smoke && bun run compat`. Expected: all green.
- [ ] **Step 2:** Show the user the final real-vs-design set from the demo. Remind them of the CLAUDE.md "missing" items.
- [ ] **Step 3:** Commit: `release: 0.4.0`. Publishing to npm happens only on the user's go.

### Task 15: shop-nest, upgrade, menu and inline-only

**Files (shop-nest):**
- First: `git checkout main && git checkout -b owner-admin`.
- Modify: `package.json` (`@nest-my-admin/*` 0.4.0) and `src/admin/admin.module.ts`:
  - `menu` exactly as spec §6;
  - `currency: { unit: { fa: 'تومان', en: 'Toman' }, position: 'after' }`, and remove per-field currency copies;
  - badges: unpaid orders and open tickets.
- Modify: the admin files of every inline-only resource in spec §6, adding `nav: false` where the default doesn't already apply.
- Create: `scripts/seed-design.ts` (fixture products with media and variants, orders across fulfillment steps with status logs, tickets; through the services, idempotent), used by `design:compare`.
- Test: shop-nest's admin tests (`test/admin-catalog.test.ts` and the others), plus a new `test/admin-menu.test.ts`.

- [ ] **Step 1: Failing test** (`test/admin-menu.test.ts`): the menu order; every one of the 54 resources is either placed or in «پیشرفته»; an editor role sees only its sections; badge counts match seeded unpaid orders and open tickets. Run `bun test test/admin-menu.test.ts`. Expected: FAIL.
- [ ] **Step 2:** Configure the menu, currency and `nav`.
- [ ] **Step 3:** Run `bun run typecheck && bun test`. Then `bun run design:compare sidebar-expanded sidebar-collapsed palette phone-drawer --base-url http://localhost:4000/admin`; fix or record every difference.
- [ ] **Step 4:** Commit: `feat(admin): owner menu and inline-only resources`.

### Task 16: shop-nest, products list and product edit

**Files (shop-nest):**
- Modify: `src/catalog/admin/product.admin.ts`, `src/settings/groups.ts` (`commerce.lowStockThreshold: { type: 'int', default: 5, min: 0 }`; key-value, no migration).
- Test: `test/admin-catalog.test.ts` (extended).

**Products list:**
- **Computed columns:** `image` (`{ first: 'media', field: 'file', by: 'sort' }`), `title` (name + `{ first: 'variants', field: 'sku', by: 'id' }`), category, `money` (`{ aggregate: 'min', relation: 'variants', field: 'price' }` with the regular price as `previous`, sortable), stock badge (`{ aggregate: 'sum', relation: 'variants', field: 'stock' }`, `map` against `lowStockThreshold`), variant `count`, active `toggle` over the status enum.
- **Tabs:** همه / فعال / غیرفعال / ناموجود (ناموجود via `where`, stock sum = 0).
- **Bulk actions:** the existing publish and hide as فعال کردن / غیرفعال کردن, plus delete.

**Product edit:** the design's section order; image cards with `markFirst` and the alt-text `warnIf`; the variants table; FAQs as a `readonly` inline; files; history.

- [ ] **Step 1: Failing test:** the list schema has those columns and tabs in that order; an editor without price permission does not get the money column; the stock badge follows `lowStockThreshold`; ناموجود counts only zero-stock products.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Configure the admin and the setting.
- [ ] **Step 4:** Run `bun test`, then `bun run design:compare products-desktop products-phone product-edit --base-url http://localhost:4000/admin`; fix or record every difference. Remind the user of the missing Excel export, bulk category/price, inline FAQ answering and variant auto-build.
- [ ] **Step 5:** Commit: `feat(admin): products list and edit as designed`.

### Task 17: shop-nest, order detail

**Files (shop-nest):**
- Modify: `src/orders/admin/order.admin.ts`:
  - `form.mode: 'view'`;
  - `form.header`: badges (payment state, fulfillment), subtitle (created at, item count), `stepper: 'fulfillment'`;
  - the stepper on `fulfillment`: all seven `FULFILLMENT_STEPS` (accepted difference, spec §8b), `exclude: ['cancelled']`, `history: { inline: OrderStatusLogAdmin, value: 'to', at: 'at', where: { field: 'fulfillment' } }`;
  - `main`: order lines with thumbnails (inline computed), totals (`summary`), shipping, status history; `aside`: customer, address, payment;
  - a single-record primary `advanceNext` action labelled «انتقال به «<next step>»», next to the existing bulk «پیشبرد ارسال».
- Test: `test/admin-orders.test.ts`.

- [ ] **Step 1: Failing tests:**
  - the `advanceNext` label for every fulfillment value from `in_queue` to `prepared`;
  - `null` (hidden, run 404) when status ≠ paid, fulfillment null, `ready_for_posting` (needs a tracking code, §8b), `delivered`, `cancelled` — one test each;
  - running it moves the order one step through `OrdersService.fulfill`, with the audit entry;
  - `_steps` come from the status log rows with `field = 'fulfillment'` only.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Configure the admin and add the action.
- [ ] **Step 4:** Run `bun test`, then `bun run design:compare order-detail --base-url http://localhost:4000/admin`; fix or record every difference. Remind the user of the missing print, tracking-code field, note box and gateway refund.
- [ ] **Step 5:** Commit: `feat(admin): order page as designed`.

### Task 18: shop-nest, dashboard and checkpoint E

**Files (shop-nest):**
- First check `src/settings/define-settings.ts`: settings are key-value, so `commerce.monthlySalesTarget: { type: 'string', label: 'هدف فروش ماه' }` (toman) in `src/settings/groups.ts` needs no migration. If that check fails, generate the migration, read it and run it only after the user approves.
- Create: `src/admin/dashboard/*.widget.ts`:
  - stats: sales, paid orders, new customers, average order value (`permission: 'dashboard.sales'` shared by the sales widgets);
  - chart: sales over the last 30 days against the previous 30;
  - chart: orders by fulfillment step;
  - progress: monthly sales target;
  - tables: latest orders, tickets awaiting an answer, low-stock products (`lowStockThreshold`).

  All are TypeORM queries; no raw SQL (shop-nest's rule).
- Test: `test/admin-dashboard.test.ts`.

- [ ] **Step 1: Failing tests** (fixed seed data, explicit `WidgetParams`):
  - each widget's numbers;
  - the change against the previous period;
  - a role without `dashboard.sales` doesn't get the sales widgets.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun test`, then `bun run design:compare dashboard-light dashboard-dark dashboard-phone --base-url http://localhost:4000/admin`; fix or record every difference. Remind the user of the missing CRM widget.
- [ ] **Step 5:** Commit: `feat(admin): owner dashboard`.
- [ ] **Step 6: Checkpoint E.** Show the user all eight screens (eleven ids) side by side and `open-differences.md` for final approval.
