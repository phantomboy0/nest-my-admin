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
- Task 7: minor (deferred): path regex allows '..'/'//' segments; test asserts message not class
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

## M2-2 follow-ups
- -> M3: column layouts, pins and recents per user (localStorage per browser today); bulk delete permission per record.
- -> M4: bulk actions beyond delete (`@AdminAction({ bulk: true })`) reuse the selection bar and `BulkResult`.
- Row click opens the quick view on desktop; E2E and people who expect "row → edit page" use the first-column link or the sheet's Edit.
- Inline editing covers text, number, decimal, bigint, boolean, enum and date; relations and datetimes are edited in the form.
- The table is not virtualized (pages hold at most 100 rows).

## M2-3 follow-ups
- -> M4: rich text (Tiptap plus server-side sanitizing) and file/image widgets, with uploads.
- -> M2-4: Jalali date pickers; money grouping uses Latin digits and commas in both languages.
- -> M3: `readonlyIf` is per record, not per user; per-user read-only fields come with permissions (`_perm`).
- `showIf` supports top-level fields only (not inside object groups) and equality only (no ranges or functions).
- Duplicate copies what the create form holds; to-many relations are copied as ids, and the slug is copied unless the column is unique.
- ⌘S on a create form saves and opens the new record; a save that the server refuses keeps the form dirty.

## M2-4 follow-ups
- -> M3: global search and the palette ignore permissions beyond each resource's `query()`; per-user saved calendar and digit preferences (localStorage per browser today).
- -> M5: the full palette (actions, recents, saved views); palette record search runs one query per searchable resource.
- Persian normalization covers ی/ي/ى, ک/ك, digits and ZWNJ; other Arabic forms (ة/ه, أ/ا, harakat) are not folded. On MySQL, an accent-insensitive collation may match more than this.
- Inputs keep Latin digits after typing; only displayed values use the Persian digit preference.
- Screenshot baselines are made with Playwright's Chromium on Linux; another Chromium build or OS may need `-- --update-snapshots`.
- Mobile infinite scroll keeps every loaded page in memory (no virtualization); the desktop table still pages.

## M3-1 follow-ups
- -> M3-3: TOTP 2FA and recovery codes; a Users page (create, deactivate, reset password); the configurable table prefix for `nma_*` tables.
- -> M5: `nma createsuperuser`; until then `bootstrapSuperuser` or `createAdminUser()`.
- The IP rate limit is in memory per process; behind several instances each counts on its own (lockout per account is in the database and shared).
- `GET /api/session` answers a plain 401 when signed out; the login page always shows the username/password form (a custom adapter without `login` answers 404 there).
- A resource named `login` or `account` is shadowed by those UI routes.
- The screenshot threshold (1% of pixels) lets small header changes through; regenerate with `-- --update-snapshots=all` after any deliberate UI change.

## M3-2 follow-ups
- -> M3-3: database roles/groups/memberships and their UI; anti-escalation; permission debugger; view-as; a permissions cache with `permissionsVersion` (today they are computed per request from code roles and `resolveRoles`).
- Sorting by a path into a scoped resource (`team.name`) orders by values the user cannot see (the values themselves are masked); keep such paths out of `list.sortable` for multi-tenant targets.
- A function `title` may read hidden fields; only column titles are masked when their column is hidden.
- A `findMany` override that ignores scopes still reports its own `total`; rows are filtered, the count is not.
- Paths deeper than one hop check each hop's resource permission, and the rows of the first hop's scope only.
- Meta lists resources the user may view; a create-only role reaches `/r/new` by URL, not from the sidebar.

## M3-3 follow-ups
- -> M3-4: permission debugger; view-as; TOTP 2FA; configurable `nma_` table prefix; `@nest-my-admin/testing`.
- The permissions cache and `permissionsVersion` live in memory per process; with several instances, a role change reaches the others only when their cache is cleared (restart) — a shared cache adapter (Redis) comes with M5's infrastructure work.
- Group members show display names from the first page of users (and users picked in the session); others show their id.
- A group's members are replaced as a whole on save; two managers editing one group at once: the last save wins.
- Anti-escalation compares scope names; two differently named scopes that select the same rows are treated as different.

## M3-4 follow-ups
- -> M4: view-as starts and permission changes go to the audit log (today view-as is only logged by the server).
- Deferred: a configurable table prefix for `nma_*` tables. Entity table names are fixed when the decorators run; a prefix needs entity classes generated at runtime.
- A role name in the debugger's `sources` from `resolveRoles` or the adapter shows how the name was resolved, not why (their code decides).
- `expectNoLeaks` crawls up to 20 pages of 100 records per list and searches for up to 20 hidden values; values shorter than 4 characters are not tracked (too many false matches). An out-of-scope record is found by its `_id`, relation references, and its texts appearing elsewhere; a value that is legitimately visible in a record in scope is not counted.
- The two-factor lockout shares the password's counter; a stolen password plus guessed codes locks the account like guessed passwords do.
- Recovery codes are shown once; there is no "download as file" yet.
- The replay guard claims the code's 30-second step with a conditional update; recovery codes are removed with a plain read-then-write, so the same recovery code sent twice at the same moment can sign in twice.

## M4-1 follow-ups
- Two PATCHes of one record with the same upload token both succeed (one after the other this is by design since the final review: a retried write keeps the file it already attached; at the same moment both take the `temp` row); with `nma_file` on another DataSource, a rollback of the second returns the shared row to `temp` although the first write holds it.
- A custom storage whose public URLs are signed or hashed (not `publicBaseUrl` + key) loses public rich-text images on save: `keyOfSrc` cannot map such a URL back to a key.
- `keyOfSrc` accepts `%2F` inside a path segment (the download route's wildcard refuses it).
- A rejected upload drains the whole request body before answering.
- A host `delete` override that hard-deletes an entity with a `@DeleteDateColumn` keeps the record's files (the admin only knows the schema has a trash).
- With `nma_file` on another DataSource, a crash between the pre-commit attach and the record's commit leaves an `attached` row without a record.
- `localStorage` keeps public and private files in one directory; serving it for `publicBaseUrl` exposes private keys to anyone who knows them (documented in the README; separate directories would fix it).
- UI: an upload cannot be resumed or retried in place (pick the file again); Duplicate copies no files and no rich-text images (the UI removes the `<img>` tags; the server would drop them anyway).
- UI: per-block direction in rich text is CSS (`unicode-bidi: plaintext`), so list markers and quote borders stay on the page's side; a `dir` attribute kept by the sanitizer would fix it.
- UI: phone cards built from `list.mobile` show no thumbnail; the editor chunk is about 460 kB (145 kB gzip), loaded on demand.
- The upload insert and the sweep do not go through the SQLite-family write queue (from Task 2's report).
- List thumbnails load the original files; there are no resized variants.
- The demo reads `NMA_UPLOAD_DIR` when `app.module.ts` is imported (the demo test imports it late for that reason); Playwright's per-run upload directories in the OS temp folder are not removed.
- Accessibility of the new widgets: the editor toolbar has no roving tabindex, the editor has no `aria-required`, focus is lost when a file is moved to an end of its list (the arrow becomes disabled), and reordering is not announced.
- PDFs are served `inline` under `Content-Security-Policy: sandbox`, which Chrome's PDF viewer may refuse; verify by opening one in a tab in M4-2's E2E.
- Flaky test from before M4-1: `products.pw.ts` two-factor sign-in reads the recovery codes right after the click, without waiting.
- A paste that carries text or HTML next to a picture inserts the text or HTML; pictures inside pasted HTML that point at other sites are dropped on save.

Open after the final review of M4-1 (its fixes: octet-stream uploads and a 400 for a body a host parser already read, `validateWrite` failing closed without a sanitizer, boot checks for `list.editable` and `maxBytes`, retry-safe tokens, Duplicate without rich-text images):
- An owner abstraction for `FilesService`: settings pages and action inputs need upload targets other than resource + field (today `nma_file` rows, permissions and keys all assume a resource, a field and a record).
- A write-participant interface (before / after / commit / rollback) that files implement and audit can join, instead of `AdminApiService.write()` calling `resolve`/`attach`/`afterCommit`/`rollback` by hand.
- A stable `nma-file:<key>` form for images in stored HTML, resolved to URLs on read: today the HTML embeds each image's URL, so changing the admin `path` or `publicBaseUrl` breaks existing images (documented in the README).
- `files.sanitizeHtml` cannot be given without `files.storage`: an app with rich text, its own sanitizer and no uploads has nowhere to put it.
- The `IMG` regex (`rich-text.ts`, and its copy in the UI's `withoutImages`) is quadratic on input such as many unclosed `<img` starts; the built-in sanitizer's output never has that shape, a lax host `sanitizeHtml` can let it through (bodies are capped at 1 MiB).
- S3 edge cases: an object reported with size 0 when the answer has no `Content-Length`; error bodies that are not drained; a path inside `endpoint` is dropped.
- No per-user cap on `temp` uploads: a user with upload permission can fill the storage for 24 hours at a time.
- A crash between `storage.put` and the `nma_file` insert leaves an object no row points at; the sweep only walks rows, so it is never removed.
- Downloads answer no `Range` and no `HEAD` (video seeking, resumable downloads).
- `files.service.ts` is over 500 lines: split uploads, the write cycle and downloads.
- A `removed` status with a retention period instead of deleting rows and objects at commit, so record history (M4) can show and restore earlier files.
- Uploads must be sent as `application/octet-stream`; a host parser that reads that type too (`express.raw()` on the admin path) still leaves nothing to store, and the 400 says so. Mounting the admin before the host's body parsers would remove the limit.

## M4-2 follow-ups
- No `If-Match` on settings pages: the last save wins, and two people replacing a file at the same moment can leave one object without an owner.
- List (`many`) file fields are not supported on settings pages (boot error): a page field is never a json column.
- Action inputs have no upload target: file, image and rich-text fields in an input DTO are refused at boot, so import-style actions wait.
- No file-lifecycle helper for actions: an action that sets or clears a file field itself, or hard-deletes a record, bypasses `FilesService` (no attach, no release of the old objects and rows). Documented as a limitation in the README.
- No `If-Match` for actions: a record action runs on the record as it is now, whatever version the user was looking at.
- `expectNoLeaks` (`@nest-my-admin/testing`) knows nothing about settings pages or actions (`AdminClient` has `runAction`, `page` and `savePage`).
- Action input is validated N+1 times for N records (once up front, then a fresh instance per run).
- Resource actions are not row-scoped and there is no public helper that applies `query()` and the user's row scopes together (hosts call `this.query(qb, ctx)` and their scope methods themselves; documented).
- A host 401 is remapped to 400 only on write paths (`AdminApiService.write()`) and a settings page's `load()`; a `findMany`/`findOne` override that throws a 401 on a read still signs the user out.
- File sizes: `admin-api.service.ts` (705 lines), `files.service.ts` (565), `admin-policy.service.ts` (492). The write participants (files, later the audit log) are to be extracted from `AdminApiService` in M4-3.
- `FilesService` knows settings pages by name (`page:<name>` owners) instead of through an owner registry.
- Duplicated helpers: `isPlainObject`/`isText` (`crud/validate-write.ts`, `api/action.service.ts`, `decorators/admin-action.ts`), and the `FieldInput`/`ObjectInput` switch written out in three forms (record form, settings page, action dialog).
- `policy/explain.ts` re-derives `_perm.actions` instead of sharing the code `records()` uses.
- No parity test between the UI's copy of `codeMatches` (`lib/role-draft.ts`) and the server's.
- Bulk action failures carry `code` and `message` only: a 422 on the input of one record loses its `fields` (as bulk delete does).
- `withoutEchoes` covers only a secret's own field: a validation message on another field that quotes a secret (a DTO message using `$value` on a cross-field rule) is not replaced. The scrubber for errors leaving `save()` has a 6-character floor and finds exact, JSON-escaped and URL-encoded values only.
- Errors thrown by `load()` outside a save are logged as thrown (unscrubbed).
- A host `save()` that ignores `ctx.manager` and whose reload fails leaves a `temp` upload row.
- A bulk run reloads each record after its method and loads it twice in an atomic run; the ids-list validation is duplicated in `admin-api.service.ts` and `action.service.ts`; the atomic boot check names only the first atomic action.
- A stored role naming an action or page that was renamed or removed stops validating and grants nothing until fixed (as for custom codes).
- UI: record actions are disabled while the form has unsaved changes (an action reloads the record); they are not offered in the quick view or on phone cards, only on the detail page and the selection bar.
- UI: a selection on phones is offered every bulk action (the cards' `_perm` is not read); the server answers per record, and the summary names failed records by id there.
- UI: the action dialog's inputs take no defaults from the DTO's class initializers (the schema does not carry them): an optional input left empty gets the default on the server.
- UI: `/p/:page` and `/g/:group` shadow the record pages of resources named `p` and `g`.
- UI: after a partial bulk failure the selection is dropped; keeping the failed ids selected would let the user retry them.
- UI: an action invalidates only its own resource's lists, counts and records; an action that changes other resources leaves their cached lists stale until they refetch.
- UI: an empty secret is an open password input (`autocomplete="new-password"`), which password managers may still offer to fill; an "Add" button that opens it (as Replace does) would avoid that.
- UI: the sidebar's pins and recents hold resources only, not settings pages; toasts are a small store of our own (no swipe, no pause on hover).
- UI: a settings page sends a group of fields whole once one field of it changed, and then requires the group's required fields; the API itself accepts a partial group.
- Flaky test fixed here: `products.pw.ts` two-factor sign-in now waits for the recovery codes.

## M4-3 follow-ups
Deferred by the plan:
- `source: 'all'`: a TypeORM subscriber that also audits writes made outside the admin (today those, deletions included, are invisible to the log; a key reused after such a deletion reads the earlier entries as the new record's).
- Reverting a field from the History tab.
- Exporting the audit log.
- `@OnAdminEvent` for host code (the audit table is the record; hosts keep calling their services from overrides).

Open after the reviews of Tasks 1–3:
- No index on `event`: a filter by a rare event alone walks the primary key backwards. Adding one is a schema change to `nma_audit`.
- User and account entries (`rbac.user.*`, `auth.*`) are written after the adapter's call, not in a transaction with it: a crash in between loses the entry.
- A function title that needs joins is computed from the stored row alone; and a function title is dropped whenever the resource has any sensitive field (it could be built from one).
- `select: false` columns: the before and after images are read with the default selection, so a change to such a column is not diffed.
- An action that soft-deletes its record shows as a `deletedAt` diff, not as a deletion (`meta.deleted` is set only when the row is gone).
- Action names are visible to readers who reach the resource but do not hold the action (`{r}.action.{name}` in `event` and `meta.action`); only the input is withheld.
- `correlationId` is served on anonymised entries (`*.updated`): it joins them to log lines and to other entries of the same request.
- `ip` is Express's `req.ip`: with a lax `trust proxy` it is whatever `X-Forwarded-For` says. The admin does not check the setting (documented in the README).
- `nma_audit.id` is a 32-bit integer on Postgres and MySQL (`bigint` + `AUTOINCREMENT` fails on SQLite with one entity class); ids are strings in the contract, so widening later changes nothing there.
- `at` is stored in the server's local wall time on Postgres and MySQL (`@CreateDateColumn`): the hour repeated at a daylight-saving change is ambiguous.
- MySQL: a host service that ignores `ctx.manager` and changes only a relation records nothing (the fallback diff covers columns of the returned entity only). MySQL also compares `actor`/`resource` filters without case.
- The terminal-entry check uses the resource's soft-delete setting as it is now; a `findOne` override that ignores `withDeleted` closes its trashed records on the audit page.
- Hidden field names are served (`{ field, hidden: true }`): a reader learns that a field they cannot see exists and changed. A restricted entry still tells that someone did something at a time.
- Failed sign-in caps are per process and in memory (N processes record N times the 300 a minute); many users behind one proxy share an address's 50 a minute, and everyone in one IPv6 /64 shares one address's caps.
- `expectNoLeaks` makes one history crawl per record (as the superuser and as the user) when the audit log is on.
- UI: relation values are ids; a title is shown only when the open record still references that id (History tab). The audit page shows ids only. Resolving titles through `fields/:field/options?ids=` (one request per field per page) is not done.
- UI: the audit page's actor filter is a user id typed or picked by clicking a name in an entry; there is no user picker. The event filter is free text with suggestions, not a list of the events that exist.
- UI: `from`/`to` are sent as the start and end of the reader's local day; a URL shared across time zones filters different instants.
- UI: role, group and user changes show the stored keys (`permissions`, `roles`, `members`) as field names and raw values (no labels, no added/removed view of a permission list). An action's label comes from the reader's schema, so a reader without the action (or viewing as someone) sees its name.
- UI: the History tab hides the form's buttons while it is open (⌘S still saves); a record's related links are under Details. Two tab rows are stacked on a resource whose form has its own tabs (the product form).
- UI: the audit page is reached from the user menu and the command palette; an admin without sign-in has no user menu, so only the palette (or the URL) leads there.
- UI: entries do not refresh by themselves; relative times are computed when the list renders.
- UI: the audit page and the History tab are not in the screenshot matrix (their times change with every run).
- UI: the main bundle grew by about 24 kB (6.4 kB gzip); the audit page is not a lazy chunk.
- UI: on the audit page an entry links to its record unless the entry itself is a deletion; a record that was deleted (or moved to the trash) by a later entry still gets a link, which then shows the record's 404.
- UI (from the review of Task 3): the Persian audit texts write the ezafe as `‌ی` (`اجازه‌ی`), check against the rest of `fa.ts`; `RecordTabs` should move out of `form-page.tsx` (557+ lines); relative times follow the data (`dataUpdatedAt`) and do not tick while a page stays open.

Open after the final review of M4 (the fixes it asked for are in; these are not):
- `event=page.*` (and other family filters) leaves out the anonymised entries (`page.*.updated`, `*.updated`): a filter never matches by what the reader is not shown, so a reader cannot list "everything about pages" including the ones closed to them.
- A nested admin write that crosses DataSources (host code inside a write calls the API for a resource on another DataSource) with a pool of one: raised by the final review as able to wait for a connection that is not coming back; not reproduced, not fixed, not documented beyond the write runner's comment on re-entrant writes.
- `recordEntry` (audit/audit-participant.ts) handles every write kind in one function; split it per kind (create/update, delete/purge, action).
- The idiom `typeof id === 'object' ? id : { [pk]: id }` is repeated across core (`whereOf` in `crud/stored-row.ts` is one copy with a name; the resource base, the policy and the API service have their own).
- File sizes: `audit/audit-reader.ts` 397 lines, `api/admin-api.service.ts` 618, `ui/src/app/form-page.tsx` 568; `test/audit.test.ts` and `test/audit-read.test.ts` are about 1.4k lines each, and their tests count entries in order, so one cannot be run or moved alone.
- UI: back-to-back filter updates do not compose. The function form of `setSearchParams` is handed the params of the last render, not the live URL; the list page and the audit page change one thing per event, so it does not show. Composing through a ref (or one `withChanges` per event) would make it safe.
- Orphaned files: a record whose row goes without the admin's write seeing it keeps its `nma_file` rows and stored objects for ever. Two ways: a host `delete()` that archives now and removes the row later (the files are kept on purpose while the row is there), and on MySQL a host service that deletes on another connection (the write still reads the row). The audit log notices the second after commit; files deliberately do not release there (releasing on a read outside the transaction could destroy the files of a row that is still there). A sweep of attached rows whose record no longer exists would close it.
- The `StoredRow` read is made by the first participant that asks: a delete or a record action on a resource with file fields costs one more query than before, with or without the audit log.
- `LoginFailures`: the address-wide `limited` entry (the 51st) is recorded even when its pair is already over its own cap. Named `SUPPRESSED` summaries are budgeted at 100 a minute for the process and the rest are summed without their addresses (401 rows a minute at most, `MAX_ROWS_PER_MINUTE`); counts still open or carried when the process stops are lost.
- `StoredRow.gone` is about the key the request named: an action that changes its record's primary key, or moves a single-table-inheritance child to another type, reads as gone (history ended, files released while the row names them). Documented, not detected.
- With `transactions: false` and TypeORM replication the stored-row read may hit a lagging replica and answer "gone" for a row that was just created; forcing it to the master needs a query runner around the read.

## 0.2.1 follow-ups
- The served page (`<html lang dir>`, `<title>`) is always in the admin's default locale; a reader who switched language gets that page until the script runs. Following the reader's own switch needs the UI to write its choice somewhere the server reads (a cookie scoped to the admin path), and then `Vary: Cookie` or `private` caching for the page.
- `order` sorts resources among resources and pages among pages; a group still lists resources first. Mixing them needs `order` in `MetaResourceSummary`/`MetaPageSummary` and one merged list in the sidebar, the group page, the home page and the palette.
- `AdminFiles` goes by the visibility recorded at upload: there is no way to make existing files of a field private (or public) after the fact, and a trashed record's public files stay served.
- The README's public-files controller is exercised by a copy in `packages/core/test/admin-files.test.ts`; nothing checks that the two stay the same.

## Requested by shop-nest (2026-10-14)

- **Register a file the host stored itself.** A host that stores files outside the upload screen (shop-nest: product images fetched from the CRM, customer ticket attachments) needs them in `nma_file`, so that `AdminFiles`, `/api/files/*`, the record's `_files` and the delete/purge lifecycle treat them like uploads. Add a host API on `AdminFiles` (or `FilesService`), e.g. `register({ resource, field, recordId, key?, body, name, contentType?, visibility })` that sniffs and stores the body, writes an `attached` row inside the caller's transaction when given a manager (and releases it on rollback), and checks the field exists and is a file/image field of that resource; plus a way to replace and to release. The owner chose this over a shop-side second file list. Target: the next minor version.
