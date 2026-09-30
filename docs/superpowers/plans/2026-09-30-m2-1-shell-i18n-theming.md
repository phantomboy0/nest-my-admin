# M2-1 — Shell, i18n and Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**M2 (UI) is split into four plans:**
1. **M2-1 shell, i18n and theming** (this plan).
2. **M2-2 lists:** typed filter bar with chips (enum multi-select, number/date ranges), column visibility/order/width and density, row selection, quick-view sheet, skeleton/empty/error-retry states.
3. **M2-3 forms and widgets:**
   - `fields` config and `@AdminField` hints (labels in both languages, help, widget, readonly/showIf);
   - widgets: money, switch, multi-select, JSON, color, badge, slug, rich text (sanitized);
   - layout sections, tabs and columns;
   - unsaved-changes guard, ⌘S, Duplicate, and Save & new.
4. **M2-4 Persian and mobile:**
   - Jalali date and datetime pickers and Jalali filter ranges;
   - Persian search normalization (spec §12) and digits;
   - mobile list cards from `list.mobile`, with filters in a bottom drawer;
   - the command-palette skeleton;
   - the E2E screenshot matrix (desktop and mobile × LTR/RTL × light/dark).

**Goal:** The admin speaks English and Persian from the first screen.
- **i18n:** translated UI text, right-to-left layout for Persian, and labels given as `{ en, fa }`.
- **Theming:** light, dark and system themes, plus host branding (name, logo, primary colour, radius, fonts).
- **Shell:** collapsible sidebar groups with icons, a filter box, pinned resources, recents and an icon-only collapse; a header with breadcrumbs, the theme and locale switches, and module landing pages with counts.

**Architecture:**
- **UI text.** It lives in typed message bundles (`packages/ui/src/i18n/{en,fa}.ts`) behind a small `useT()` hook, with no new runtime dependency. The locale is picked from the saved choice, then the host default. It sets `<html lang dir>`, and every API request sends it as `Accept-Language`.
- **Server labels.** Core resolves `LocalizedText` (`string | { en?: string, fa?: string, … }`) per request, with a fallback chain of requested locale → default locale → first value. This covers the admin title, group labels and resource labels in meta and schemas.
- **Branding.** It travels in the injected runtime config and becomes CSS variables at start-up.
- **Fonts.** Vazirmatn (fa) and Geist (en) are bundled into the UI `dist/` through `@fontsource-variable` packages (devDependencies, so hosts install nothing).

**Tech Stack:** unchanged, plus UI devDependencies `@fontsource-variable/vazirmatn` 5.3.0 and `@fontsource-variable/geist` 5.3.0 (exact pins).

**Spec:** §5.1 (`locale`, `locales`, `branding`, `@AdminGroup({ label: { en, fa }, icon, order })`), §9.1 (shell: collapsible group per module, tab per resource with icon, filter box, pinned favorites, recents, icon-collapse, side follows direction, drawer on mobile; header: breadcrumbs, theme toggle, locale switch; module landing page: resources in the group with counts), §9.5 (branding sets shadcn CSS variables at runtime; light/dark/system; Vazirmatn/Geist; en + fa bundles; labels `{ en, fa }`; direction from locale; logical utilities only), D5.

## Global Constraints

- All earlier Global Constraints apply (exact pins, `.js` imports in core, the error contract, per-app test databases, no AI attribution, never commit `.idea/` or `.serena/`).
- **The UI ships static files only:**
  - new UI packages are devDependencies, bundled by Vite;
  - there is no runtime fetch of fonts or icons from a CDN;
  - icons come from a curated map of lucide icons (`src/lib/icons.ts`), and unknown names fall back to a generic icon, so the bundle does not carry all of lucide.
- **Direction.** Only logical Tailwind utilities (`ms-/me-/ps-/pe-/start-/end-`, `rtl:` variants for icons that point) may be used. A unit test scans `src/**/*.tsx` for `ml-|mr-|pl-|pr-|left-|right-|text-left|text-right` and fails on any.
- **Locale resolution:**
  - `locales` defaults to `[locale]`, and `locale` defaults to `'en'`;
  - an `Accept-Language` outside `locales` falls back to the default;
  - schemas and meta for different locales never share a cache entry (the response carries `Content-Language` and `Vary: Accept-Language`).
- **Copy:** every string a user sees in the UI goes through `t()`. The fa bundle must have the same keys as en; its type is `Messages` (from en), so the compiler checks.

## Review Focus

1. **Switching to Persian:**
   - `<html dir="rtl" lang="fa">`;
   - the sidebar on the right, and pagination chevrons pointing the right way;
   - Persian UI text;
   - server labels given as `{ fa }` in Persian, and ones given only in English falling back to English;
   - the choice surviving a reload.
2. **A host `branding.primaryColor` and `radius`** show on buttons in light and dark themes, and the dark theme survives a reload without a flash of the light one (the class is set before React renders).
3. **Meta and schema requests in two locales** never serve each other's labels (cache keys, `Vary`).
4. **Collapsed sidebar and mobile drawer:** every resource stays reachable, with an accessible name, by keyboard and screen reader (tooltips or `aria-label` when only icons show).

## File Structure

```
packages/core/src/
  i18n/localized-text.ts (+ test)      (LocalizedText, resolveText, pickLocale(accept-language, locales, default))
  options.ts (+ test)                  (title/label LocalizedText, locale, locales, branding)
  decorators/admin-group.ts · admin-resource.ts (labels as LocalizedText)
  registry/resource-registry.ts        (keeps raw labels)
  api/admin-api.service.ts             (meta/schema per locale)
  http/admin-http.server.ts            (locale per request, Content-Language, Vary)
  http/ui-assets.ts                    (runtime config: locale, locales, branding)
  contract.ts                          (MetaResponse.locale/locales, AdminRuntimeConfig.branding/locale/locales, MetaGroup/Resource icons)
packages/ui/src/
  i18n/{en,fa}.ts, i18n/index.tsx (+ tests)   (bundles, LocaleProvider, useT, formatters)
  lib/theme.ts (+ test)                 (theme + branding → CSS vars, pre-render class)
  lib/icons.ts                          (curated lucide map)
  lib/nav-state.ts (+ test)             (pinned, recents, collapsed groups; localStorage with fallbacks)
  app/admin-layout.tsx · app/sidebar.tsx · app/header.tsx · app/group-page.tsx · app/home-page.tsx
  every existing page/component: strings through t()
examples/demo-api/                      (AdminModule locale: 'en', locales: ['en','fa'], Persian labels, branding)
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Localized labels and locales in core

- [ ] **Tests first.**
  - `localized-text.test.ts`:
    - `resolveText('Orders', 'fa')` → `'Orders'`;
    - `resolveText({ en: 'Orders', fa: 'سفارش‌ها' }, 'fa')` → Persian;
    - a missing fa falls back to the default locale, then to the first value;
    - `pickLocale('fa-IR,fa;q=0.9,en;q=0.8', ['en','fa'], 'en')` → `'fa'`, and `pickLocale('de', …)` → `'en'`.
  - `options.test.ts`:
    - `locale` must be one of `locales`;
    - `branding.primaryColor` must be a CSS colour (hex, `rgb()`, `hsl()`, `oklch()`) and `radius` a CSS length, so nothing can inject CSS;
    - a `branding.logo` URL must be relative or http(s).
  - `i18n.test.ts` (integration, sql.js is enough because it is not database-specific; the rule about hardcoding sql.js does not apply since it uses `createTestApp`):
    - `GET /meta` with `Accept-Language: fa` answers Persian group and resource labels, `locale: 'fa'`, `locales: ['en','fa']`, `Content-Language: fa` and `Vary: Accept-Language`;
    - the schema's `label` and `related[].label` follow the locale;
    - `index.html` carries `locale`, `locales` and `branding` in the runtime config.
- [ ] **Implement:**
  - `LocalizedText` for `AdminModuleOptions.title`, `@AdminGroup({ label })` and `@AdminResource({ label })`.
  - The registry keeps the raw labels.
  - `AdminApiService.meta(locale)` and `schema(name, locale)` return localized copies, with `related` labels rebuilt from the other resource's label.
  - The HTTP server picks the locale per request and sets the headers.
  - Runtime config gains `locale`, `locales` and `branding`.
- [ ] **Verify** (the full suite on sql.js, plus Postgres and MySQL once), then commit `feat: localized labels, locales and branding in core`.

### Task 2: i18n in the UI

- [ ] **Tests first (bun unit tests).**
  - `en` and `fa` have the same keys (a runtime check besides the type).
  - `t('list.total', { count: 3 })` interpolates.
  - `formatNumber(12000, 'fa')` gives Latin digits by default, and `formatDate` uses the locale.
  - The logical-utilities scan: no `ml-`/`mr-`/… in `src/**/*.tsx`.
- [ ] **Implement:**
  - `i18n/index.tsx`: `LocaleProvider` (initial locale from localStorage, then the runtime config), `useT()`, `useLocale()`, `setLocale()` (sets `<html lang dir>`, stores the choice, invalidates meta and schema queries), and `formatNumber`/`formatDateTime`.
  - `api.ts` sends `Accept-Language`, and query keys include the locale.
  - Every page and component (list, form, filters, pickers, sub-forms, conflict notice, pager, trash, related) uses `t()`.
  - The Persian bundle is complete.
- [ ] **Verify:** `bun test packages/ui`, `typecheck`, `build`. Commit `feat(ui): English and Persian UI text, right-to-left layout`.

### Task 3: Theme, branding and fonts

- [ ] **Tests first.**
  - `theme.test.ts`:
    - `resolveTheme('system', prefersDark)`;
    - `brandingStyle({ primaryColor: '#0a7', radius: '0.25rem' })` → CSS variable declarations for `--primary`, `--ring` and `--radius`, with `--primary-foreground` white or black from the colour's luminance for hex/rgb, and white otherwise unless `primaryForeground` is given.
- [ ] **Implement:**
  - An inline-free pre-render: `main.tsx` applies the theme class and branding variables before `createRoot`.
  - A theme toggle (light/dark/system) stored in localStorage.
  - The branding name and logo in the sidebar header.
  - Fonts: `@fontsource-variable/geist` and `@fontsource-variable/vazirmatn`, with `--font-sans` switched by `:lang(fa)`.
- [ ] **Verify**, then commit `feat(ui): light/dark/system themes, host branding, bundled fonts`.

### Task 4: Shell: sidebar, header, landing pages

- [ ] **Tests first.** `nav-state.test.ts`:
  - pin and unpin, and recents: last 5, deduplicated, dropping unknown resources;
  - collapsed groups;
  - storage that throws (private mode) falls back to memory.
- [ ] **Implement:**
  - **Sidebar:**
    - collapsible groups (state stored) with group and resource icons;
    - a filter box (matches resource and group labels);
    - a "Pinned" section (pin button per resource) and a "Recent" section;
    - desktop icon-only collapse (toggle stored), where each link keeps an `aria-label` and a `title`;
    - a mobile drawer, which closes on navigation and Escape and traps focus while open;
    - the side follows the direction.
  - **Header:** breadcrumbs (group › resource › record title), the theme toggle and a locale switch (when more than one locale).
  - **Pages:**
    - `/g/:group` lists the group's resources as cards with counts: one list request per resource with `pageSize=1`, where `estimated` shows "about N" and `count: 'none'` shows none;
    - `/` shows every group's cards (no longer redirects to the first resource).
- [ ] **Demo:**
  - `AdminModule.forRoot({ locale: 'en', locales: ['en', 'fa'], title: { en: 'Demo shop', fa: 'فروشگاه نمونه' }, branding: { primaryColor: '#0f766e' } })`;
  - Persian labels on the catalog group and resources.
- [ ] **E2E** (desktop and mobile):
  - Switching to فارسی makes the page RTL with Persian nav labels, and it survives a reload.
  - Dark mode survives a reload.
  - The home page cards show counts and link to lists.
  - The collapsed sidebar still navigates by accessible names.
  - Pinning a resource shows it under Pinned.
  - Existing tests are updated: `/admin` now shows the home cards.
- [ ] **Docs:** README (locales, labels, branding), CLAUDE.md, and m0-followups.
- [ ] **Verify everything:** typecheck, three databases, compat, pack:smoke, e2e. Commit `feat(ui): sidebar with groups, pins and recents; header; landing pages; demo in Persian`.

## After this plan

M2-2 lists, M2-3 forms and widgets, and M2-4 Persian and mobile, as outlined above.
