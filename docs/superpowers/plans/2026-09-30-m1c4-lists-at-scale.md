# M1c-4 — Lists at Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lists stay fast and correct on big tables and across databases. That means:
- count modes (`exact | estimate | none`) and keyset pagination;
- one `query(qb, ctx)` hook whose restrictions apply to lists, records and pickers alike;
- several DataSources;
- the remaining relation work: related lists (inverse relations), lazy relations, sorting a relation by its title, and options that depend on other form values;
- deferred minors.

**Architecture:**
- **`query(qb, ctx)` hook.** Every read builds on a query builder: the default `findMany` and `findOne`, relation options (with the target resource's hook), and existence checks. A restriction written once therefore covers the list, GET/PATCH/DELETE by id, restore/purge and pickers.
- **Count and pagination.** `ListParams` carries `count` and `after`, from `list.count` and `list.pagination` and the `after` query parameter.
  - The default `findMany` answers `{ items, total | null, estimated?, nextCursor? }`.
  - An estimate comes from the query planner on Postgres and MySQL, and falls back to an exact count below 1000 rows or on SQLite.
  - Keyset pages use `(sort, keys…) > cursor` comparisons.
- **Relations.** The registry links resources:
  - An inverse relation whose target resource has the matching to-one or many-to-many field becomes a `related` entry: a link to the target list filtered by this record.
  - A relation whose target is titled by a column becomes sortable by that column.

**Tech Stack:** unchanged (no new dependencies).

**Spec:** §5.2 (`count`, `pagination`, `query(qb, ctx)`, `relationOptions(field, qb, ctx, values)`, `dataSource`), §5.4 (multiple DataSources), §9.2 (offset or keyset), §9.4 (Related tab: reverse relations), §10.1 (`show_full_result_count` → `list.count`), §11 (`&after=<cursor>`), §13.2 (large tables with exact counts or offset pagination). Plan 4 of 4 for M1c. Also `m0-followups.md` (M1a: count modes and keyset; the `query(qb, ctx)` decision; M1c-2 relation follow-ups; M1c-1 minors).

**Findings this plan is built on** (spike on 2026-09-30 on sql.js, Postgres 17 and MySQL 8.4; nothing committed):
- **Postgres estimates.** `EXPLAIN (FORMAT JSON) <query without limit/order>` gives `[0]['QUERY PLAN'][0].Plan['Plan Rows']`: 1500 for a filter matching 1500 of 3001 rows after `ANALYZE`.
- **MySQL estimates.** `EXPLAIN FORMAT=JSON` gives `query_block.table.rows_produced_per_join`, or the last `nested_loop[].table` for joins: 1000 for the same filter (filter selectivity is guessed). It is an estimate in the loose sense, which is why small results fall back to exact counts.
- **SQLite** has no row estimate; `estimate` counts exactly there.
- **Lazy relations.** `@ManyToOne(() => Owner, { lazy: true })` saves from `create({ owner: { id } })`. A `leftJoinAndSelect` stores the target in `__owner__`, and awaiting the `owner` getter then resolves without a query. `WHERE e.owner = :id` works as for eager relations.

## Global Constraints

- All earlier Global Constraints apply (exact pins, `.js` imports, isolated mount, error contract, per-app test databases, `TEST_DB` branches with reasons, no AI attribution, never commit `.idea/` or `.serena/`).
- **Contract:**
  - `ListResponse.total` becomes `number | null` (`null` with `count: 'none'`).
  - New optional `estimated: true` and `nextCursor: string | null` (keyset only).
  - `ResourceSchema.list` gains `count` and `pagination`.
  - `ResourceSchema` gains `related: Array<{ label, resource, field, operator }>`.
- **Host `findMany` overrides stay valid:** returning `{ items, total }` works in every mode. With keyset pagination an override must honour `params.after` (easiest: `buildListQuery`), like filters today.
- **The `query(qb, ctx)` hook** uses `qb.alias` and never a hardcoded alias, because the same hook runs on `entity`, `option` and `ref` queries.
- **Review Focus:** each scenario gets an integration test on every database.

## Review Focus

1. **A `query()` restriction applies on every read path.** The list, GET, PATCH, DELETE, restore, purge, relation options pointing at the resource, and the existence check all hide rows outside it (404, or `does not exist` for picks). → Task 1.
2. **Keyset pages** sorted by a non-unique column (with ties) and by `-createdAt` must return every row exactly once across pages, in the same order as offset paging, and a bad cursor is a 422. → Task 3.
3. **`count: 'estimate'`** on a big table is marked `estimated: true` on Postgres and MySQL. A small result is exact, and filters narrow the estimate. `count: 'none'` pages with `nextCursor` or `hasMore` and never runs `COUNT`. → Task 2.
4. **Two DataSources** (default plus `reports`) each get their own resources, transactions and autoRegister entities, and a name collision is a boot error with a hint. → Task 4.
5. **A related list:** a customer's "Orders" link lists exactly that customer's orders through the target's filter. Sorting orders by `customer` sorts by customer name. → Task 5.

---

### Task 1: The `query(qb, ctx)` hook on every read path

- [ ] **Tests first** (`query-hook.test.ts`, every database). A `Note { ownerId }` resource whose `query` adds `${qb.alias}.ownerId = 1`:
  - the list shows owner 1's notes;
  - GET, PATCH and DELETE of owner 2's note are 404;
  - soft-delete restore and purge of an out-of-scope note are 404;
  - a `Comment → note` relation's options list only owner 1's notes;
  - writing `note: <owner 2 note>` is 422 `does not exist`;
  - references to out-of-scope notes still load their title (documented, M3 permissions decide).
  - Unit test: `findOne` is built on a query builder, so `withDeleted` and composite keys still work.
- [ ] **Implement:**
  - `AdminResourceBase.query(qb, ctx)` (default: `qb`).
  - `buildListQuery` applies it.
  - `findOne` uses `createQueryBuilder(alias)` + keys + `query()` + optional `withDeleted()`.
  - The API's options and existence queries apply the target resource's `query()` (when the target has a resource) before `relationOptions()`.
  - `checkVersion` keeps reading the raw row (it only compares versions; `findOne` still answers 404).
- [ ] **Verify** on all three databases, then commit `feat: query(qb, ctx) restricts lists, records and pickers alike`.

### Task 2: Count modes

- [ ] **Tests first** (`count-modes.test.ts`, every database). A `Ticket` resource with 2500 rows seeded in chunks (`count: 'estimate'`), plus a `none` variant:
  - An estimate with no filter is `estimated: true` on Postgres/MySQL after `ANALYZE`, within ±50% of the true count; it is exact on SQLite.
  - A filter matching 3 rows is exact, not estimated.
  - `none` returns `total: null` and `hasMore` (pageSize+1 fetch), and the query log shows no `COUNT`.
  - The default stays exact.
  - Unit tests for picking the estimate out of both EXPLAIN shapes (single table, nested loop).
- [ ] **Implement:**
  - `list.count` in the schema.
  - `ListParams.count`.
  - `estimateCount(qb)` per driver: Postgres `EXPLAIN (FORMAT JSON)`, MySQL `EXPLAIN FORMAT=JSON`, others exact. Estimates under 1000 are replaced by an exact count.
  - The default `findMany` switches on `params.count`.
  - `ListResponse` gets `total: number | null`, `estimated?` and `hasMore?`.
- [ ] **UI:** "about 12,000" for estimates. With `total: null`, "Next" is enabled by `hasMore` and "Page N of M" becomes "Page N".
- [ ] **Verify**, then commit `feat: list.count exact | estimate | none`.

### Task 3: Keyset pagination

- [ ] **Tests first.**
  - `keyset.test.ts` (every database), on `Ticket` with `pagination: 'keyset'`:
    - Walking pages with `after` sorted by `priority` (many ties), `-createdAt` and `title` returns each row once, in the same order as offset paging with the same sort (Review Focus 2).
    - A filter combined with keyset works.
    - `page` combined with `after` is 422.
    - A tampered or foreign cursor is 422.
    - The last page has `nextCursor: null`.
  - Unit tests: cursor encode/decode and the WHERE builder for asc and desc with composite keys.
- [ ] **Implement:**
  - `list.pagination`.
  - Keyset sort fields must be non-nullable columns or keys: a boot error otherwise, and a 422 for a request sorting by a nullable column.
  - The cursor is base64url JSON `{ s: sortField, v: [sortValue, ...keyValues] }`.
  - `applyListParams` adds `(sort > v) OR (sort = v AND (k1 > …))`, direction-aware (tie-breakers are always ascending) and fetches pageSize+1.
  - Responses carry `nextCursor`, and keyset lists default to `count: 'none'`.
- [ ] **UI:** keyset lists show Previous/Next driven by a stack of cursors (Previous walks back), with no page numbers. `after` lives in the URL.
- [ ] **Verify**, then commit `feat: keyset pagination`.

### Task 4: Several DataSources

- [ ] **Tests first** (`data-sources.test.ts`, every database).
  - The test helper gets a second `testDatabase()` registered as `reports`.
  - `@AdminResource(Report, { dataSource: 'reports' })` lists and writes through its own DataSource, and a failing write rolls back there.
  - `autoRegister: ['default', 'reports']` registers both DataSources' entities, and `true` still means `['default']`.
  - An auto name collision across DataSources registers the second as `<dataSource>-<name>` with a warning.
  - An explicit duplicate stays a boot error.
- [ ] **Implement:** `autoRegister: boolean | string[]`, a registry loop per DataSource, and the collision naming.
- [ ] **Verify**, then commit `feat: several DataSources (autoRegister per DataSource)`.

### Task 5: Relations: related lists, lazy relations, sort by title, dependent options

- [ ] **Tests first** (every database, orders fixture):
  - **Related lists.** `schema.related` of `customer` is `[{ label: 'Orders', resource: 'order', field: 'customer', operator: 'eq' }, …seller…]`; the target resource's filters gain the back-reference field; the link's query lists exactly that customer's orders (Review Focus 5). Tag → orders via `tags` with `in`.
  - **Sort by title.** `sort=customer` on orders sorts by customer name, and `-sellerId` by seller name. A relation whose target has a function title stays unsortable.
  - **Lazy relations.** A lazy `@ManyToOne` is a field: its references load, it filters, and create/update work.
  - **Dependent options.** `relationOptions(field, qb, ctx, values)` receives:
    - the `values` JSON from the options endpoint (max 4 KB; bad JSON is 422);
    - on writes, the stored record merged with the body.
    - The fixture restricts `seller` options to the customer's company, and a write that breaks it is 422.
- [ ] **Implement:**
  - `linkRelations` builds `related` and the implied filters, and marks relation fields sortable when the target title is a column (the API rewrites the sort to the path).
  - The reference loader awaits lazy getters.
  - `relationOptions` gets a 4th argument.
- [ ] **UI:**
  - The edit page has a "Related" section of links.
  - Relation pickers send `values` (top-level scalars and relation ids of the current form) and refetch when they change.
- [ ] **Verify**, then commit `feat: related lists, lazy relations, relation sort by title, dependent relation options`.

### Task 6: Deferred minors, demo, E2E, docs

- [ ] Minors from `m0-followups.md`:
  - duplicate names in `list.columns`/`filters`/`search` fail at boot;
  - MySQL constraint regexes take the last match;
  - `DbNames` is exported;
  - the demo test cleans up with try/finally;
  - stale test databases carry a host hash (`nma_t_<host8>_<pid>_<hex>`) so hosts never sweep each other's.
- [ ] Demo: `Product.list` uses `count: 'estimate'`, `Order`-like related links on categories (Category → Products). E2E:
  - the category page shows "Products", which opens the filtered list;
  - a keyset resource (an `AuditEvent`-style demo `StockMove` log with `pagination: 'keyset'`) pages forward and back.
- [ ] Docs: README (lists at scale, `query()` hook, DataSources, related lists), CLAUDE.md, m0-followups.
- [ ] Verify everything (`typecheck`, three databases, `compat`, `pack:smoke`, `e2e`), then commit `feat(demo): estimates, keyset log, related links; minors; docs`.

## After this plan

M1 is complete. **M2 (UI)** is next: shell, list polish, filters and widgets, mobile, i18n/RTL/Jalali, theming, and the command-palette skeleton (spec §16).
