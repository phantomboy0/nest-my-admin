# M0 follow-ups for the M1 plan

Deferred findings from the M0 per-task and final reviews (see git history for context).

## Promoted by the final review (do early in M1)
- Error contract for body-parser/host errors is in place; keep it covered as M1 adds routes.
- (done in M1c-3) Record with string primary key "new" is shadowed by the :resource/new route: ids are encoded, `new` is `~new`.
- (done in M1c-4) Count modes (`exact | estimate | none`) and keyset pagination.
- (from M1a) Persian/Arabic search normalization (spec §12) belongs with i18n in M2.

## Deferred minors
- Task 3: minor (deferred): @ValidateIf treated as optional → dtoOnlyField nullable; no tests for isDeleteDate/Array/simple-array mapping
- Task 4: minor (deferred): no tests for list.sort failure / pageSize bounds / '-name' / separate update DTO; empty list.columns accepted; #private vs Proxy
- Tasks 5+6: minor (deferred): toFixed rounds/exponent for over-scale numbers (comment says never rounded); huge page → unsafe int; bigint id not format-checked ('abc' may 500); '-0' id; partial ignores nested DTOs
- Task 7: minor (deferred): path regex allows '..'/'//' segments; group key collisions first-wins silently; test asserts message not class
- Tasks 8+9: minor (deferred): case-insensitive FS /INDEX.HTML served raw; symlinks followed out of dist; traversal test file doesn't exist; router params on plain {}; 429→BUSINESS_RULE; duplicate statSync
- Tasks 8+9: minor (deferred): "vanishing file" test hits pre-existing /assets 404 branch, not sendFile's statSync catch (untested); test servers not closed in finally; uncaughtError check may be early
- Task 10: minor (deferred): this.ui! assertion; no test for headersSent branch
- Task 10: minor (deferred): /admin// test accepts 200|404 (loose)
- Task 11: minor (deferred): globals.css packs several declarations per line; Number('0x10')/'1e3' accepted in toPayload
- Task 12: minor (deferred): ProductAdmin Number(id) NaN path untested (update of garbage id); releasedOn untested
- Task 13: minor (deferred): removeQueries while record observer mounted; PageMessage error + form alert both role=alert (not simultaneous today)
- Task 14: minor (deferred → carried to Task 16): document PW_CHANNEL in README/CLAUDE.md
- Task 15: minor (deferred): asset regex tied to Vite output
- Task 16: minor (deferred): docs phrase e2e as `PW_CHANNEL=chrome bun run e2e` — reads as required, is optional

## M1a follow-ups
- -> M3 (blocker there): method-override middleware can turn a CORS-simple form POST into DELETE and bypass the JSON content-type CSRF check; use req.originalMethod when auth lands.
- (done in M1c-3) CONFLICT for @VersionColumn carries `current` (spec §11 diff dialog).
- (done in M1c-4) `query(qb, ctx)` restricts lists, `findOne` and pickers; M3 scopes build on it.
- -> M2: Unicode case folding on SQLite with §12 normalization.
- -> M2: Save and Confirm delete are not mutually disabled.
- -> M2: datetime "To" filter uses lte at minute precision.
- -> M2: free-text numeric filter inputs.
- (done in M1c-4) duplicate list.columns/filters/search entries fail at boot.
- (done in M1c-3) Nested DTOs (`@ValidateNested` + `@Type`) → sub-forms and arrays of sub-forms.
- (from M1b) Client constraints do not cover `@IsDecimal` digit limits or `@IsPositive`; the server still enforces them.

## M1c-1 follow-ups
- (done in M1c-2) a column declared with both `@Column()` and `@JoinColumn` is now the relation field.
- (done in M1c-2) FK-on-delete E2E: deleting a category that products use.
- Postgres `22001` (value too long) names no column, so that 422 has no field; the client's `maxLength` usually catches it first.
- `bun run compat` tests the oldest supported stack; the newest is what the workspace pins. Versions in between (and Nest 12.0 / TypeORM 1.0 exactly) are assumed.
- Final review minors: (done in M1c-4: host tag in `nma_t_*` names, last-match MySQL regexes, `DbNames` exported, demo test cleans up on a failed boot) SQLite/Postgres FK direction comes from the HTTP method, so a PATCH that changes a referenced primary key reports 422 instead of 409; no committed test for the schema-sync-failure path of fast boot failure.
- (done in M1c-3) CHECK constraint violations → 422 VALIDATION on the columns the expression names.

## M1c-2 follow-ups
- (done in M1c-4) related lists, lazy relations, relation sort by title column, dependent `relationOptions(…, values)`.
- -> M3: the options endpoint and relation titles read targets that may have no resource (with `autoRegister: false`); permissions must cover them (anti-oracle: missing and not-allowed ids already share one message).
- NULL placement when sorting by a path differs by driver (Postgres: last ascending; MySQL/SQLite: first). Normalise it if it matters to users.
- Relation ids are checked before the write and the check is not locked, so a target deleted concurrently still reaches the database FK (mapped to 422 as before). The SQLite/Postgres insert-side FK mapping is now covered only by unit tests.
- Title functions see only what was loaded (columns; relations only when a finder joined them); spec §5.2's `o.customer.name` example needs `?.` or a column title.
- Multi-select pickers close after each pick (so the list never covers the form); the keyboard flow still works by typing again.

## M1c-3 follow-ups
- -> M4 (trash UI): purge button and a trash page; the list's Trash toggle only restores today. A to-one relation to a trashed record reads as `null` (TypeORM filters the join).
- -> M4: `@VersionColumn` diff dialog is an inline notice; a field-by-field merge view is M2/M4 polish.
- Relations to entities with composite primary keys are still not fields (RelationSchema has one id).
- Nested DTO detection needs `@Type(() => X)` (class-transformer) or a non-array class type; plain `@ValidateNested()` on `object` stays a DTO-only string field.
- A json column behind a nested DTO is returned as stored (keys the DTO does not describe survive); an embedded group returns only its columns.
- `trashed` needs host `findMany` overrides to start from `buildListQuery` (or apply `withDeleted` themselves), like filters.
- Soft-deleted rows keep their unique values (a new product cannot reuse a trashed product's SKU); partial unique indexes are a host concern.

## M1c-4 follow-ups
- -> M3: related lists and relation titles ignore permissions (a customer's orders link works for anyone who can open the customer); `query()` is the hook M3 scopes attach to.
- Keyset pagination does not support sorting by dotted paths or nullable columns (the schema only offers eligible columns); datetimes with microseconds (Postgres `timestamp`) compare at millisecond precision in cursors, so rows within the same millisecond may be skipped or repeated — use `precision: 3` or sort by id.
- `estimate` on MySQL is the optimizer's guess (it assumes 33% for unindexed ranges); it is labelled "about".
- The related list filter is added to the other resource's filter bar too (visible there as a picker).
- Dependent options send the form's short scalar values and relation ids as `?values=` (≤ 4 KB); long text and groups are left out.

## M2-1 follow-ups
- -> M2-3: field labels, help and enum value labels per language (`@AdminField`, `fields` config); server validation messages are English (class-validator's) in both UIs.
- -> M2-4: Persian digits option, Jalali pickers (display already uses the Persian calendar through Intl for `fa`).
- A resource named `g` is shadowed by the group landing route `/g/:group`.
- Home page counts run one list request per resource (exact counts for `exact` resources); fine for tens of resources, revisit with dashboards (M5).
- Pinned and recent resources and the sidebar state live in localStorage per browser; per user in M3.
