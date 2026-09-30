# M2-4 — Persian and Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin is at home in Persian and on a phone:
- Jalali date pickers in forms and in filter ranges, with month and year drill-down;
- search that matches Arabic and Persian letter variants and every digit set;
- inputs that accept Persian digits, with an optional Persian digit display;
- mobile cards from `list.mobile`, infinite scroll, filters and sort in a bottom drawer, and a select mode for bulk delete;
- a ⌘K command palette that navigates, creates, and searches records across resources;
- a screenshot matrix of desktop/mobile × LTR/RTL × light/dark.

**Architecture:**
- **Normalization on the server.**
  - `i18n/persian.ts` normalizes a search term: Arabic ي/ى → ی, ك → ک, Persian and Arabic-Indic digits → Latin, ZWNJ → space.
  - `persianLike(column, term)` wraps the column in `REPLACE`s, but only for the characters the normalized term contains, so Latin searches keep their plain SQL.
  - It is used for `search`, the `contains` and `startsWith` filters, and relation option search.
  - Filter values of number, decimal, bigint, date and datetime fields accept any digit set.
- **Global search.** `GET /api/search?q=` runs each searchable resource's `findMany` with the search term (5 per resource, no count) and returns `{ _id, _title }` groups. A resource that fails is left out and logged.
- **`list.mobile`.** `{ title?, subtitle?, badge?, meta? }` names fields or paths.
  - It is checked at boot like columns, and its paths are loaded with the list.
  - Without it, cards keep today's layout: the title, then the columns.
- **Calendar and digits** are display preferences in the browser:
  - calendar: Gregorian, or Jalali (the default for Persian);
  - digits: Latin (default) or Persian.
  - Values on the wire stay ISO dates and Latin digits.
  - `formatDate` never shifts `date` columns (it formats them in UTC); datetimes show in the browser's time zone.
- **Jalali conversion.** `lib/jalali.ts` is the jalaali algorithm (no dependency), checked day by day against `Intl`'s Persian calendar.
- **Date input.**
  - With the Gregorian calendar, forms and filters keep the native inputs.
  - With Jalali, a text input (`1403/01/15`, any digits) sits next to a calendar popover with day, month and year views.
  - Datetime filter ranges become whole Jalali days converted to UTC instants.
- **Mobile list.**
  - Below `md`, the list uses an infinite query: offset pages or keyset cursors, an IntersectionObserver, and a "Load more" button as fallback.
  - Filters and sort live in a bottom sheet; "Select" turns cards into checkboxes for the bulk bar.
- **Command palette.** A Radix dialog with a combobox (`aria-activedescendant`) listing:
  - resources and groups to go to;
  - "New X" for creatable resources;
  - records from `/api/search` (debounced, two characters or more).
  - It is opened with ⌘K / Ctrl+K or the header's search button.

**Spec:** §8/§12 (Persian normalization, digit sets, Jalali ranges to UTC, `date` never shifted), §9.1 (⌘K palette skeleton), §9.2 (Jalali date range with drill-down), §9.3 (mobile cards from `list.mobile`, infinite scroll, bottom drawer, select mode), §13 (screenshot comparison). Plan 4 of 4 for M2.

## Global Constraints

- All earlier constraints apply (exact pins, logical utilities only, every string through `t()` in `en` and `fa`, per-app test databases, no AI attribution, never commit `.idea/`, `.serena/` or the local Playwright config).
- **No new runtime dependencies** in core. The UI adds none either: Jalali is computed, and the drawer and palette are Radix Dialogs.
- **Wire format unchanged.** Dates are ISO `YYYY-MM-DD`, datetimes ISO UTC, numbers Latin, whatever the display preferences.
- **Normalization is symmetric.** A Persian-letter query finds Arabic-letter data and the other way round, on sql.js, Postgres and MySQL.

## Review Focus

1. **Jalali correctness.** Conversion matches `Intl` for every day from 1900 to 2100. A picked Jalali date saves the right Gregorian date (no time zone shift), and a Jalali datetime filter range covers exactly those local days.
2. **Search variants.** `كتاب` finds `کتاب` and the other way round; `۱۲` finds `12`; ZWNJ and space match. Latin searches keep plain SQL.
3. **Mobile list.** Infinite scroll neither skips nor repeats rows (offset and keyset), and resets when filters change. The drawer applies filters and sort.
4. **Palette.** Keyboard only: open, type, arrow, Enter, and focus returns on close. Record search respects each resource's `query()` restrictions (it goes through `findMany`).

## File Structure

```
packages/core/src/
  i18n/persian.ts (+ test)                 (normalizeSearch, toLatinDigits, persianLike)
  crud/list-query-builder.ts               (search/contains/startsWith through persianLike)
  crud/list-query.ts                       (digit normalization of typed filter values)
  api/admin-api.service.ts                 (search(); options search through persianLike)
  http/router.ts                           (GET /api/search)
  resource/admin-resource-base.ts          (ListConfig.mobile)
  schema/build-resource-schema.ts          (list.mobile checked; paths loaded)
  contract.ts                              (list.mobile, SearchResponse)
packages/core/test/persian-search.test.ts · global-search.test.ts
packages/ui/src/
  lib/digits.ts (+ test) · lib/jalali.ts (+ test) · lib/display-prefs.ts (+ test)
  i18n/index.tsx                           (calendar, digits in LocaleState; formatDate/formatNumber)
  app/date-input.tsx                       (Jalali text + calendar popover; native for Gregorian)
  app/display-menu.tsx                     (calendar and digits preferences)
  app/mobile-list.tsx                      (cards, infinite scroll, select mode)
  app/filter-drawer.tsx                    (bottom sheet with filters and sort)
  app/command-palette.tsx
examples/demo-api                          (list.mobile; Persian seed rows with Arabic letters)
examples/demo-api/e2e/screens.pw.ts + playwright.screens.config.ts (+ committed baselines)
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Core — Persian search, digits, `list.mobile`, global search

- [ ] **Tests first:**
  - `persian.test.ts`: normalization table, `toLatinDigits`, and which REPLACEs a term needs.
  - `persian-search.test.ts` (every database):
    - Review Focus 2 for `search`, `contains` and relation options;
    - numeric and date filters with Persian digits.
  - `global-search.test.ts`: groups per resource, the limit, resources without search left out, `query()` respected, a throwing resource skipped.
  - Registry: an unknown field in `list.mobile` is a boot error; a path in it is loaded.
- [ ] **Implement** as in Architecture.
- [ ] **Verify** on all three databases, then commit `feat: Persian search normalization, digit sets, list.mobile and global search`.

### Task 2: UI — digits, Jalali, display preferences, formatting

- [ ] **Tests first:**
  - `jalali.test.ts`: round trips and `Intl` agreement for 1900–2100, leap years, month lengths.
  - `digits.test.ts`: to/from Persian digits, Persian decimal and thousands separators.
  - `display-prefs.test.ts`: defaults per locale; stored choices survive.
  - `format`: `date` columns in Jalali without shifting; Persian digits in numbers and money.
  - `toPayload` accepts Persian digits in numbers, dates and money, and a malformed date is an error.
- [ ] **Implement:**
  - calendar and digits in `LocaleState`, and module state for formatters;
  - a Display menu in the header;
  - formatters and chips follow the preferences.
- [ ] **Verify**, then commit `feat(ui): Jalali calendar, Persian digits and display preferences`.

### Task 3: UI — date input and Jalali filters

- [ ] **Implement:**
  - `DateInput`:
    - Jalali text input plus a popover calendar: week starts Saturday, arrow keys move by day and week, PageUp/PageDown by month, Enter picks;
    - the month title opens a month grid, then a year grid (drill-down);
    - "Today" and "Clear".
  - Datetime: a `DateInput` plus a time input.
  - Used in forms, inline cells and date/datetime range filters. Jalali datetime ranges become whole local days sent as UTC instants.
- [ ] **E2E:** pick 1403/01/15 for "Released on" → the record stores 2024-04-03; typing Persian digits works; the filter range narrows the list; chips show Jalali.
- [ ] **Verify**, then commit `feat(ui): Jalali date input and date range filters`.

### Task 4: UI — mobile list

- [ ] **Implement:**
  - cards from `list.mobile` (title, subtitle, badge, meta);
  - infinite scroll (offset and keyset);
  - the bottom drawer with the filters, a sort select and "Show results";
  - select mode for the bulk bar.
  - Desktop is unchanged.
- [ ] **E2E (mobile):** scrolling loads the next page without repeats; the drawer filters and sorts; select mode deletes two drafts.
- [ ] **Verify**, then commit `feat(ui): mobile cards, infinite scroll, filter drawer and select mode`.

### Task 5: Command palette

- [ ] **Implement:**
  - the palette: ⌘K / Ctrl+K, the header button;
  - sections Go to, Create and Records;
  - arrow keys, Enter, Escape, and focus restored.
- [ ] **E2E:** ⌘K → "note" → Enter opens Notebook; "new prod" → Enter opens the new Product form; a Persian query finds the Persian row.
- [ ] **Verify**, then commit `feat(ui): command palette with record search`.

### Task 6: Demo, screenshot matrix, docs

- [ ] **Demo:**
  - Product `list.mobile: { title: 'name', subtitle: 'category.name', badge: 'status', meta: ['price', 'stock'] }`;
  - seed rows with Persian names written with Arabic ي/ك, and a Persian tag.
- [ ] **Screenshots:**
  - `e2e/screens.pw.ts` under `playwright.screens.config.ts` (`bun run e2e:screens`, its own fresh server);
  - home, product list and product form × desktop/mobile × en/fa × light/dark;
  - baselines committed, threshold 1%.
- [ ] **Docs:** README (Persian and mobile, `list.mobile`, palette), CLAUDE.md, and m0-followups.
- [ ] **Verify everything** (typecheck, three databases, compat, pack:smoke, e2e, e2e:screens), then commit `feat(demo): Persian data and mobile cards; screenshot matrix; docs`.

## After this plan

M2 is complete. M3: permissions (policies, scopes, field and record rules), users/roles/groups pages, audit log.
