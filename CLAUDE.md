# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

nest-my-admin: an npm-installable admin panel for NestJS + TypeORM (Django-admin parity and beyond). The design spec is `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md` (decisions D1–D14, milestones in §16); implementation plans live in `docs/superpowers/plans/`.

## Commands

```bash
bun install
bun run build                                   # packages/ui (vite) then packages/core (tsc); core serves ui/dist
bun run typecheck                               # every workspace package
bun run test                                    # all bun tests (unit next to src, integration in packages/core/test, examples/demo-api/test)
bun test packages/core/test/crud.test.ts        # one file
bun test -t "rejects unknown fields"            # tests matching a name
bun run db:up                                   # Postgres + MySQL in Docker for the lines below
bun run test:postgres                           # whole suite on Postgres (test:mysql for MySQL); or NMA_TEST_DB=postgres bun test <file>
bun run compat                                  # core suite on NestJS 11.0 + TypeORM 0.3.20 (scripts/oldest-supported.ts), in a temp copy
bun run e2e:screens                             # screenshot matrix (desktop/mobile × en/fa × light/dark) against committed baselines; add `-- --update-snapshots=all` after a deliberate UI change
bun run e2e                                     # build + Playwright on examples/demo-api (desktop + mobile); needs `bunx playwright install chromium` once (or, if that download is blocked, `PW_CHANNEL=chrome bun run e2e` to use installed Chrome)
bun run pack:smoke                              # pack all five packages (core, ui, auth, testing, nest-my-admin), npm-install into temp apps (a signed-in consumer too, and `esm-one`: `nest-my-admin` alone with `/auth` and `/testing`), boot on node and bun; `dist/same.js` checks the unscoped names are the scoped packages
cd examples/demo-api && bun src/main.ts         # demo at http://localhost:3000/admin
cd packages/ui && bun run dev                   # UI dev server :5173, proxies /admin/api to :3000
```

## Architecture

- `packages/core` (ESM Nest library). `ResourceRegistry` discovers `@AdminResource` providers via `DiscoveryService` in `onModuleInit`, attaches the TypeORM repository, and builds a `ResourceSchema` with `buildResourceSchema` (TypeORM column metadata + class-validator DTO metadata). The sidebar group of a resource is the Nest module that provides it (`@AdminGroup` customises it).
  - Groups: `ResourceRegistry.claims()` reads `@AdminGroup` from every module of the app (the hosts of all discovered providers), lazily, because `PageRegistry.onModuleInit` may run first. `ensureGroup(key)` (a member's `group: '<key>'`) and `registerModuleGroup` both take the claim for the key, so a module with the key configures the group whoever its members are; two modules that differ: first wins, with a boot warning.
  - Order inside a group: `order` on `@AdminResource`/`@AdminSettingsPage` (`memberOrder`, default 100, finite or boot fails) is kept on `RegisteredResource.order`/`RegisteredPage.order`; `AdminApiService.meta` sorts resources and pages by it, then by label. It is not in the contract: the UI keeps the server's order everywhere (sidebar, group page, home, palette) and must not re-sort.
- The admin HTTP surface is **not** Nest controllers: `AdminHttpServer` mounts one handler on the Express adapter at `path` (spec D12), so host guards, interceptors, pipes, filters and `setGlobalPrefix` never affect it. `/api/*` goes through the package's own `Router` → `AdminApiService` → resource methods; everything else is served by `UiAssets` (SPA fallback, `<base href>` + JSON config (`<script type="application/json" id="nma-config">`) injected into `index.html`). The page is rendered once, in the admin's default `locale` (never from `Accept-Language`: the UI starts in the saved choice or the default, and the server cannot see the saved choice): `localizeDocument` sets `<html lang dir>` (`isRtlLocale`, the same list as the UI's `RTL` in `i18n/index.tsx`) and the `<title>` inside `<head>`, and the response carries `Content-Language` and no `Vary`.
- Writes: `validateWrite` (DTO whitelist + class-validator) → the resource's `create`/`update`, which host apps override to call their services (spec D2). Errors always leave through `toErrorResponse` as `{ code, message, fields?, correlationId }`; TypeORM unique/not-null violations are mapped to field errors.
- Lists: `parseListQuery` turns `filter[field][op]=value` / `search=` into `FilterCondition`s using only the schema's allow-lists (`list.filters`, `list.search`, `list.sortable`); `applyListParams` puts them on a TypeORM `SelectQueryBuilder` (LIKE escaped with `!`, primary key as sort tie-breaker). Resources override `findMany` and extend `this.buildListQuery(params, ctx?, alias?)` to add restrictions; those apply to the list only, so mirror them in `findOne` (used by GET/PATCH/DELETE by id).
- Relations (M1c-2): `relationFields` (schema/relation-fields.ts) turns many-to-one, owning one-to-one and owning many-to-many relations into `type: 'relation'` fields. A to-one field is named by `relation.joinColumns[0].propertyName`, so an explicit `customerId` column becomes the field. `resolvePath` validates `customer.name` paths. `applyListParams(qb, params, metadata)` joins them as `<alias>_<relation>` and adds `addSelect` for sort paths, because skip/take with joins breaks otherwise. Many-to-many filters use `EXISTS` on the join table. `crud/references.ts` loads `{ id, title }` refs and path values after the finder runs. `relationIdsOf` + `AdminApiService.checkRelationsExist` (through `relationOptions()`) validate ids before the resource method runs, and the default `create`/`update` call `toRelationReferences`. Titles come from `compileTitle`; `registry.titleFor(metadata, dataSource)` also covers entities without a resource.
- Entity shapes (M1c-3):
  - `_id` is the encoded record id (`crud/record-id.ts`: `~0`/`~1` escapes, `~new`), and `parseRecordId` returns a scalar for one key, `{ key: value }` for composite keys.
  - Embedded columns and nested DTOs are `type: 'object'` fields with `fields` (and `many`), built by `schema/nested-fields.ts`. `nestedTypeOf` finds `@Type` classes by probing `plainToInstance`. Constraints and errors use dotted paths (`hours.*.day` in constraints).
  - Single-table inheritance: child resources hide the discriminator, and the root has `creatable: false`. `AdminApiService.records` fills the discriminator from each entity's class.
  - `If-Match` → `checkVersion` (row lock, 409 `AdminConflictError` with `current`).
  - Soft delete: `trashed` list param, and base `delete`/`restore`/`purge`.
- Lists at scale (M1c-4):
  - `query(qb, ctx)` (base) restricts `buildListQuery`, `findOne` (now query-builder based with `setFindOptions`) and relation options and existence checks through the target resource.
  - `list.count` goes through `crud/count.ts` (`EXPLAIN` estimates, exact below 1000 rows).
  - `list.pagination: 'keyset'` goes through `crud/cursor.ts`: `after` is a base64url `{ s, v }`, and `applyKeyset` builds the WHERE clause.
  - `autoRegister` is a list of DataSource names.
  - `linkRelations` fills `schema.related`, adds the implied filters, and fills `sortPaths` (relation → title column).
  - `relationOptions` takes a 4th `values` argument (`?values=` JSON, or the body/stored record on writes) and may return a Promise (`optionsQuery` awaits it). Picker `values` and `values._parent` go through `normalizeRelationValues` (`crud/relation-writes.ts`) so relation ids have the key's type.
- UI shell and i18n (M2-1):
  - Text lives in `packages/ui/src/i18n/{en,fa}.ts`. `fa` is typed as `Messages` from `en`, and a test checks keys, placeholders and physical Tailwind utilities.
  - React components use `useT()`; non-React code uses `translate()` (module locale from `applyLocale`).
  - Host texts on the server go through `options.texts` (`i18n/texts.ts` `createTexts`: the `translate` option, then `resolveText`), with keys from `scopedText(texts, locale, 'resource.<r>')`; field texts through `FieldText` paths, layout nodes through their optional `key`. Boot-time schemas use `bootText`/`bootFieldText`. `resolveText` stays only for the served page's title.
  - UI texts: the UI build emits `dist/messages.json` (`i18n/messages-file.ts`, a Vite plugin); `AdminHttpServer.onModuleInit` reads it (`http/ui-messages.ts` `readUiMessages`, `uiOverrides`: `translate` with `ui.<key>` once per locale, placeholders checked) into `AdminRuntimeConfig.messages`; the UI's `translate()` looks up `applyMessageOverrides` first. Test apps' fixture `test/fixtures/ui-dist/messages.json` has two keys.
  - Core resolves `LocalizedText` labels per request (`pickLocale(Accept-Language)` in `AdminHttpServer.handle`, `meta(locale)`/`schema(locale)`), and sets `Content-Language` and `Vary`.
  - Theme and branding are applied in `main.tsx` before render (`lib/theme.ts`).
  - Sidebar state lives in `lib/nav-state.ts`, and icons come from a curated map (`lib/icons.ts`).
  - `/g/:group` is a group landing page, and `/` shows every group with counts.
- List page (M2-2):
  - `lib/filter-chips.ts` derives chips from the URL.
  - `lib/column-prefs.ts` stores columns and density per resource in localStorage.
  - `app/quick-view.tsx` is a Radix Dialog sheet; a row's Enter handler must `preventDefault()`, or the same key closes the sheet.
  - `app/editable-cell.tsx` saves `list.editable` fields with PATCH and patches the cached list pages.
  - `AdminApiService.bulkDelete` loops `remove()` per id.
- Auth, permissions and RBAC (M3):
  - `@nest-my-admin/auth` (packages/auth) is the built-in adapter: `nma_user`/`nma_session`, scrypt, lockout, TOTP 2FA (`totp.ts`, `secret-box.ts`: AES-256-GCM with `secretKey`; recovery codes stored as SHA-256).
  - `AdminPolicy` (policy/admin-policy.service.ts) decides everything per request from `EffectivePermissions`; `AdminRbac` stores roles/groups (`rbac: {}` + `ADMIN_RBAC_ENTITIES`).
  - The debugger (`policy/explain.ts`, `/api/rbac/explain`) reuses those code paths, one role at a time for the breakdowns; `test/debugger.test.ts` checks it against the API for random role sets.
  - View-as: `X-View-As` on a superuser's request swaps `ctx.user`/`ctx.permissions` in `AdminHttpServer.handle` (`ctx.viewAs`), refuses non-GET routes except sign-out, and closes `/api/account/*`. The UI keeps the id in sessionStorage (`lib/session.ts`) and makes schemas read-only (`lib/view-as.ts`).
  - `@nest-my-admin/testing` (packages/testing) calls `AdminApiService` in-process through `@nest-my-admin/core/internal` (not a stable API, never on HTTP), actions and settings pages included (`runAction`, `page`, `savePage`); `expectNoLeaks` is its crawler.
- Files for hosts: `AdminFiles` (files/admin-files.service.ts, exported from `AdminModule` and the entry point) answers `publicFile(key)`/`openPublic(key)` for rows that are `public` and `attached`; anything else, malformed keys included, is `null` without reading the storage. Storage keys are `<owner.keyPrefix>/<field>/<yyyy>/<mm>/<uuid><ext>`: the prefix is the resource's name, and `page/<name>` for a settings page (owner `page:<name>`); `test/admin-files.test.ts` pins both, stored keys must never change.
- Hooks (`@BeforeSave/@AfterSave/@BeforeDelete`) run only in `AdminResourceBase`'s default create/update/delete; resources that override those methods call their own services instead.
- Writes run inside `AdminApiService.write()` (a delegate of `WriteRunner.run`, see Audit log): one `dataSource.transaction()`, `ctx.manager` set, and `AdminContext.run()` re-entered so `AdminContext.current()` sees the transactional context. The callback gets an `AdminWriteContext` (`manager` always set; with `transactions: false` the DataSource's own manager). "A transaction is open" is `inAdminTransaction(ctx)` (`resource/admin-context.ts`, set by `markTransaction`), never `ctx.manager !== undefined`: `checkVersion`'s row lock and the audit log's in-transaction entries use it. Base write methods keep `ctx: AdminContext` (0.6 overrides call `super` with one); hosts narrow it in their overrides. `AdminResourceBase` defaults use `repositoryFor(ctx)`. Reads get no manager. On Postgres/MySQL a service that ignores `ctx.manager` writes on another pooled connection (outside the transaction, can block on its locks); SQLite-family writes are serialized per DataSource.
- Field config (M2-3):
  - Merging: `mergeFieldConfig` (`schema/field-config.ts`) merges `@AdminField` (entity, create DTO, update DTO) with the resource's `fields`.
  - Boot checks: `checkFieldConfig`/`checkLayout` run there.
  - Texts: the registry keeps the raw `LocalizedText`, and `AdminApiService.schema(name, locale)` applies it per request through `applyFieldConfig`/`localizeLayout`.
  - `readonly: true` fields leave `form.update` and are listed in `form.readonly`.
  - `readonlyIf` and the resource's `readonlyFields(record, ctx)` stay on the server (`AdminApiService.lockedFields(entry, entity, ctx)` unions them; `updateFields` comes from `attachUpdateFields`):
    - `records()` adds `_readonly` (a throw locks the field) and `_links` (http(s)/relative only);
    - `update()` refuses locked fields with 422 before the resource method.
  - The UI side:
    - `lib/widgets.ts` `widgetOf` picks inputs;
    - `lib/show-if.ts` hides fields, which are then left out of the payload and the constraints;
    - `app/form-layout.tsx` renders sections and tabs.
  - `FieldSchema.unique` (single-column unique constraint or index) drives Duplicate.
- Persian and mobile (M2-4):
  - Server normalization: `i18n/persian.ts` `persianLike` wraps a column in `REPLACE`s only for the characters the normalized term contains. It is used by search, `contains`/`startsWith` and relation options; `parseScalar` accepts any digits.
  - `AdminApiService.search` backs `/api/search`.
  - `list.mobile` paths are loaded with the list.
  - UI display preferences (`lib/display-prefs.ts`) live in `LocaleState` (`calendar`, `digits`, `setDisplay`) and in module state for formatters (`formatDate` formats `date` values in UTC). Intl calendar tags are `gregory`/`persian`.
  - Jalali: `lib/jalali.ts` is the jalaali algorithm; a test checks it against `Intl` for 1900–2100. `app/date-input.tsx`: `live` for forms, commit on pick/Enter/blur for filters.
  - Phones: `useIsMobile()` switches `ListPage` to `app/mobile-list.tsx` (`useInfiniteQuery` under `['list', resource, 'cards', query]`) and `FilterBar` to a bottom drawer with a sort select.
  - `app/command-palette.tsx` uses `lib/palette.ts` for matching.
  - Screenshot baselines live in `examples/demo-api/e2e/__screenshots__` (`playwright.screens.config.ts`, its own server on :3320).
- Authentication (M3-1):
  - `AdminAuthService` (auth/auth.service.ts) resolves `options.auth` at module init (`AdminAuth.custom` via ModuleRef, `AdminAuth.factory`, `none`).
  - `AdminHttpServer.handle` authenticates every `/api/*` request except `GET`/`POST /api/session` (401), checks `X-CSRF-Token` on writes when the principal has a `csrfToken` (403), and sets `ctx.user`.
  - `/api/session` and `/api/account/*` call the adapter's optional methods (404 when missing).
  - `packages/auth` (`@nest-my-admin/auth`) is the built-in adapter; it imports core's built `dist`, so its tests build their own app with `AdminModule` from `@nest-my-admin/core` (never core's `createTestApp`, whose src classes would differ from dist).
  - UI: `lib/session.ts` holds the CSRF token and the signed-out handler (set in `main.tsx`); `AdminLayout` gates on `useSession()`; `/login` is outside the shell.
  - E2E: the `setup` project signs in and saves `e2e/.auth/*.json` (not committed); `page.request` writes need the `csrf(page)` header.
- Permissions (M3-2):
  - Roles: `policy/roles.ts` holds `RoleDefinition`, `codeMatches` and boot `checkRoles`; `policy/effective.ts` holds `EffectivePermissions` (union, field levels, scopes).
  - `AdminPolicy` (policy/admin-policy.service.ts):
    - validates roles at `onApplicationBootstrap` and attaches a scoper to each resource (`attachScoper`: view scopes in `buildListQuery`/`findOne`);
    - `forUser()` runs per request into `ctx.permissions`;
    - `view(entry, schema, ctx)` cuts the schema (the API parses, serializes and validates against the cut one);
    - `allowedIds`/`requireInScope` are the scoped re-checks that make overrides safe;
    - `maskOutOfScope` masks related rows outside the target's scopes.
  - `AdminApiService` calls the policy at every endpoint: `require` (404 without reach, 403 without the operation), then `checkWriteFields`, then the scope checks.
  - Tests: `test/policy.test.ts`, ending with a leak crawl.
- RBAC in the database (M3-3):
  - `rbac/entities.ts` holds the tables. `AdminRbac` (rbac/rbac.service.ts) handles:
    - the system-role sync at `onApplicationBootstrap`;
    - `roles()` (code roles plus stored roles that validate) and `assignedRoleNames()`, both cached by `permissionsVersion` and cleared by `invalidate()` on every write;
    - every write, each passing validation and `escalations()` (rbac/escalation.ts).
  - `AdminPolicy.forUser` unions `resolveRoles`, adapter roles and stored assignments.
  - `rbac/rbac-routes.ts` holds `/api/rbac/*`; users go through the adapter's optional methods.
  - UI: `app/admin/*` pages under `/-/users|groups|roles`; `lib/role-draft.ts` expands wildcards when a matrix box is unticked.
- Files and rich text (M4-1):
  - Server: `files/storage.ts` (`AdminStorage`, `localStorage`), `files/s3-storage.ts` + `sigv4.ts`, `files/sniff.ts` (types from bytes), `files/entities.ts` (`nma_file`, `ADMIN_FILE_ENTITIES`), `files/file-routes.ts` (`POST /api/uploads` with a raw body, `GET /api/files/*key`).
  - `FilesService` (files/files.service.ts) does the rest, called from `AdminApiService` and, around writes, from its write participant (`files/files-participant.ts`):
    - `upload` (permission, sniff, `accept`, size, temp row);
    - `resolve` → `attach` → `afterCommit`/`rollback` around a write (`{ token }`/`{ key }` become `AdminFile`s; objects are deleted only after commit);
    - `refs` (`_files` on records), `download` (same 404 for every refusal), `release` (a record that is really gone, or a purge: `filesParticipant` decides), `sweep` (temp rows after 24 h).
  - Rich text: `files/rich-text.ts` sanitizes in `validateWrite` (`sanitize-html` is an optional peer, loaded at boot only when a field needs it) and attaches `<img>` uploads by the keys in the saved HTML. The sanitizer keeps no `dir`, so per-block direction is CSS (`styles/rich-text.css`, `unicode-bidi: plaintext`).
  - UI:
    - `lib/upload.ts` is the XHR uploader (pure, environment passed in; `api.upload` fills it);
    - `lib/form-values.ts` keeps `FileValue`s, read from `_files` (so Duplicate starts without files) and sent as `{ token }`/`{ key }`;
    - `lib/upload-queue.ts` (`UploadQueue`: check, send, progress, cancel, problems; plain state, unit-tested) is wrapped by `useUploads` in `app/use-uploads.ts`, which also holds `useFileField` and `useReorder`; file, image and rich-text fields all upload through it, and unmounting aborts;
    - `app/file-input.tsx` holds `DropZone`, `UploadProgress` and `FileInput`; `app/image-input.tsx` the previews;
    - `app/rich-text-input.tsx` (Tiptap) is a lazy chunk behind `RichText` in `field-input.tsx`; its toolbar must offer only what the sanitizer keeps, and read-only rich text goes through the same editor (never `dangerouslySetInnerHTML`);
    - `app/file-display.tsx` renders `_files` in lists, quick view and read-only fields (`plain` inside phone cards, which are links);
    - a form does not save while a field reports `onBusy`.
  - The demo keeps uploads in `var/uploads` (git-ignored); tests and Playwright set `NMA_UPLOAD_DIR` to a temporary directory.
- Actions (M4-2):
  - `decorators/admin-action.ts`: `@AdminAction` on resource methods (`(record, input, ctx)`, or `(input, ctx)` for `target: 'resource'`), boot checks in `resolveActions`, `toActionSchema`. The method name is the action name; the code is `{r}.action.{name}` (`actionCode`).
  - `schema/dto-form.ts` `buildDtoForm`/`localizeDtoForm` build a form from a DTO alone (action inputs and settings pages).
  - `api/action.service.ts` (`ActionService`, a plain class built by `AdminApiService`) runs `POST /api/resources/:r/actions/:action` inside `write()`:
    - `runOnRecord` is the one per-record path (view and update scopes → `findOne` → `@AdminCan('<name>')` → method → reload), used by single, bulk and atomic runs;
    - the answer's shape follows the number of distinct ids (`distinctIds` folds aliases): the record (or `null`), a `BulkResult`, or just `{ message? }`;
    - `atomic` checks every record before running any, and needs `transactions` (boot check).
  - Policy: `canRunAction` (reach, the code, and `{r}.update` for record actions) cuts `schema.actions`, fills `_perm.actions` and guards the run; `@AdminCan('update')` does not gate actions.
  - Host errors: `HttpException` below 500 passes through (409 `CONFLICT`, 400 `BUSINESS_RULE`); bulk failures carry `code` and `message` only. A host 401 becomes a 400 (`hostError` in `http/error-response.ts`, applied in `AdminApiService.write()` and around a page's `load()` in `PageService.get`), because the UI reads every 401 as signed out.
  - `ActionService.run` and `PageService.save` refuse `ctx.viewAs` themselves (callers that are not HTTP). Resource actions are not row-scoped: the method applies `this.query(qb, ctx)` itself (the demo's `cancelStaleDrafts`).
  - UI: `lib/actions.ts` (which actions to offer, the outcome by shape; `asksFirst`/`actionQuestion`: `confirm`, a destructive variant or more than one record always open the dialog); `app/action-button.tsx` (`ActionButton` runs or opens `app/action-dialog.tsx`; `RecordActions` in the detail header, disabled while the form is dirty); the list page puts resource actions on the toolbar and bulk actions on the selection bar, with one `BulkSummary` for bulk deletes and bulk actions. Messages are toasts (`lib/toast.ts`, `app/toaster.tsx`). After a record action `FormPage` remounts the form from the answer's record.
- Settings pages (M4-2):
  - `decorators/admin-settings-page.ts` (`@AdminSettingsPage(name, options)`, `AdminSettingsSource` `load`/`save`); `pages/page-registry.ts` discovers them and runs the boot checks (names, `secret`, `many`, a resource named `page`).
  - `pages/page.service.ts`: `GET`/`PATCH /api/pages/:name` → `PageResponse` (`schema`, `values` without secrets, `secrets` as booleans, `files`). A save validates as a partial, then `apply()` runs `load` → resolve files → `save` → `load` → attach inside one `write()`; `scrubSecrets` replaces secret values (6+ characters) in errors leaving it.
  - Secrets: a non-empty string replaces, `null` clears, an absent key keeps, `''` is a 422. `secret: true` is allowed only on a page's own text fields.
  - Codes `page.{name}` / `page.{name}.update` (`pageCode`, `canPage`, `requirePage`); `codeMatches` never lets a pattern starting with `*` (other than `*` itself) grant a page code, here and in the UI's copy (`lib/role-draft.ts`).
  - Files: `files/file-owner.ts` (`FileOwner`): resources and pages (`pages/page-file-owner.ts`, owner `page:<name>`, record id `page`) are both owners for `FilesService`.
  - `MetaGroup.pages` lists viewable pages; a group may have no resources.
  - UI: `lib/page-form.ts` (`pageFormValues`, `pagePayload`: changed keys only, groups whole, a secret as text or `null` and never `''`; `validatePagePayload` checks only what is sent); `app/settings-page.tsx` at `/p/:page` (`SecretField`: Set ✓ · Replace · Clear); pages appear in the sidebar, group and home cards, breadcrumbs and the command palette.
  - Shared form pieces: `app/form-guards.tsx` (`useUnsavedGuard` + `LeaveBar`, `useSaveShortcut` (idle while a modal dialog is open over the form), `useUploadGate`) and `lib/form-errors.ts` (`shownErrors`) are used by the record form, settings pages and the action dialog.
  - View-as: `readOnlySchema` drops `actions`, `readOnlyPage` makes pages read-only.
  - Demo: `src/sales` (`OrderAdmin` with `markPaid`, `ship`, `cancel`, `cancelStaleDrafts`) and `src/settings` (`ShopSettingsPage` on the `shop_setting` table); E2E in `e2e/actions.pw.ts` and `e2e/settings.pw.ts`.
- Audit log (M4-3):
  - Writes: `api/write-runner.ts` (`WriteRunner`: the transaction, `ctx.manager`, `hostError`) runs each change through its `WriteParticipant`s (`api/write-participant.ts`: `before` → host method → `after`, then `onCommit`/`onRollback`). `files/files-participant.ts` is the first, `audit/audit-participant.ts` the second (only with `options.audit`). `WriteRunner.change` also reads what is stored of the record after the host method, once and lazily (`StoredRow`, `crud/stored-row.ts`): `gone` is the one fact both participants use (files are released on a delete or a record action only when the row is gone, always on a purge; the audit log ends the record's history on it). `AdminApiService.write()`/`change()` are thin delegates; `api/write-queue.ts` (`exclusive`) serializes single-connection drivers for writes, rbac and the audit log's own inserts.
  - Recording: the participant reads the stored row before and after (`crud/serialize-full.ts`, no permissions, relations as ids), `audit/diff.ts` diffs (`fitChanges` caps sizes), `AdminAudit` (audit/audit.service.ts) inserts with `ctx.manager` when the write is on the audit DataSource (`record`), else after commit (`recordAfter`); failed sign-ins go through `recordDetached` and `audit/login-failures.ts` (caps per address and username, per address (`addressBucket`: an IPv6 /64), and `GLOBAL_LIMIT` per process); `onModuleDestroy` waits up to 2 s for the detached queue. Auth and view-as entries are written in `AdminHttpServer`, rbac ones in `AdminRbac.transact()` / `rbac-routes.ts`, page saves through the participant.
  - `sensitive` (`sensitiveFields` in `schema/field-config.ts`: `sensitive`, `secret`, `widget: 'password'`) → `{ field, changed: true }`; protected options inside a group are refused at boot (`schema/dto-form.ts`, `registry/resource-registry.ts`).
  - Reading: `audit/audit-reader.ts` (`AuditReader.history`/`list`) does all the masking per reader (`hidden`, `restricted`, `*.updated`, endings of gone records, `findOne` overrides); `audit-query.ts` parses the filters; `audit-routes.ts` only maps HTTP. `SessionResponse.audit: { enabled, view }`; code `audit.view` (`AUDIT_CODES`). Retention: `audit/retention.ts`, timers in `AdminAudit`.
  - Tests: `test/audit.test.ts` (recording), `test/audit-read.test.ts` (reading; ends with a sentinel sweep), `expectNoLeaks` crawls history and the audit page.
  - UI: `lib/audit.ts` is the pure part (`eventLabel`, `entrySubject`, `restrictedNote`, `changeRow`/`formatAuditValue`: relations as ids, files as names, rich text as text; `auditQueryFromUrl`: `from`/`to` days become local-day instants). `app/audit-entries.tsx` renders entries for both views, `app/history-tab.tsx` is the History tab (`RecordTabs` in `form-page.tsx`: the form stays mounted under it; `historyKey` is invalidated by saves and actions), `app/admin/audit-page.tsx` is `/-/audit` (filters in the URL; schemas and pages are fetched per resource on the page, never per entry). Never render HTML from an entry.
  - Demo: `audit: { retentionDays: 365 }`, `src/staff` (`Employee.salary` is `sensitive`); E2E in `e2e/audit.pw.ts`.
- Inlines and host files (M4-4):
  - Declaring: `{ section, inline: ChildAdmin, display, fields, order, min, max, link? }` in a parent's `form.layout` (`LayoutInlineConfig`, `schema/field-config.ts`); the registry resolves the link field and the child at boot (`RegisteredResource.inlines`). One level only.
  - Reading: `inlines/inline-reader.ts` fills `_inlines` on GET through the child's own read path (scopes, field cuts, `_perm`, `_files`); `ResourceSchema.inlines` holds each child's schema cut by the policy (`canSeeInline`).
  - Create rule: `@AdminCan('create')` on an inline child (boot check in `ResourceRegistry` after inlines resolve) → `AdminPolicy.createRule(child, parent, ctx)` (`recordRule` with `'create'`): checked in the inline writer's `apply` against the parent as the save leaves it (created or updated; the transaction undoes it on refusal), on the child's own POST and on a PATCH that changes the link (`AdminApiService.checkParentRules`, the parent through the parent resource's `readQuery`; not found there is a 422), and as `_perm.inlines.<child>.create` (`recordPermissions`).
  - Writing: `inlines/inline-writer.ts` applies `_inlines` (`InlineChanges` in the contract) inside the parent's `write()`: deletes, updates, creates through the child resource's methods and write participants, then `order` and `min`/`max`; errors as `_inlines.<child>.create.<index>.<field>` / `.update.<_id>.<field>`. Pickers: `?parent=` + `values._parent` (`AdminApiService.parentValues`).
  - UI: `lib/inline-changes.ts` (pure: rows from `_inlines`, the payload diff, server errors back to rows) and `app/inline-section.tsx` (table and cards); `FormLayout` renders inline nodes in place through `renderInline`; `RecordForm` keeps `rows`/`initialRows` next to `values`, and view-as cuts `schema.inlines` too (`readOnlySchema`).
  - `AdminFiles.register()`/`release()` (`FilesService.register`/`releaseHeld`): a host's own file checked like an upload and recorded as attached; work tied to the host's transaction goes through `files/transaction-files.ts` (TypeORM transaction subscribers, by savepoint depth).
  - Demo: `OrderLine` (table, `src/sales`) and `ProductSpec` (cards, `src/catalog`); the editor may edit order lines but not delete them. E2E in `e2e/inlines.pw.ts`.
- Form constraints: `dtoConstraints` compiles class-validator metadata (names like `isLength`, `matches`, `isIn`; `@IsOptional` is `name: 'isOptional'`; `@ValidateIf` properties get no client rules; DTO properties with a class initializer are not required) on top of entity facts into `form.constraints.{create,update}`; the UI's `validatePayload` checks them before submit. PATCH is always validated as partial.
- Owner admin (0.4):
  - Look: tokens and Vazirmatn in `styles/globals.css`; primitives `components/ui/{badge,card,tabs,page-header}.tsx` (`Card` names its section by its title); `lib/tones.ts`. Design comparison: `bun run design:compare` (`scripts/design-compare.ts`, screens in `scripts/design-screens.json`); open differences in `docs/superpowers/design-compare/open-differences.md`.
  - e2e: the existing suites run against the plain demo (`NMA_DEMO_PLAIN=1`, :3310: a host that sets no 0.4 option); `e2e/owner/*.pw.ts` test the new features on the configured demo (:3311). The demo applies owner-only options behind `plain` checks (`app.module.ts`, `product.admin.ts`, `order.admin.ts`, `sales.module.ts`).
  - Money: `options.currency` (runtime config) and a field's `currency` (`{ unit, position }`); UI `lib/money.ts` `formatMoney`/`setGlobalCurrency`. `fa` defaults to Persian digits (`lib/display-prefs.ts`).
  - Navigation: `@AdminResource({ nav })` (inline children default to `nav: false`, `RegisteredResource.nav`); `options.menu` → `meta.menu` (`api/menu.ts`: `resolveMenu` at bootstrap turns classes into names and `{ group }` sections into the group's label/icon (`labelKey` `group.<key>`), then `checkMenu`; `buildMenu` fills a group section without items from meta's group; `AdminApiService.resolvedMenu()` is what badges and `@nest-my-admin/testing` read), `GET /api/menu/badges` (`api/menu-routes.ts`, `AdminApiService.badges` through the shared scoped `count()`). UI `lib/menu.ts` `navGroups(meta)` feeds the sidebar, home, group pages, breadcrumbs and `lib/palette.ts` (records, actions, go-to).
  - Lists: `list.computed` → `crud/computed-columns.ts` (`checkComputed` at registration, `loadComputed` one query per source per page, `addComputedSort` subquery through `AdminResourceBase.attachComputedSort`; children read through `readQuery`, i.e. `query()` + scopes); `AdminPolicy.computedVisible` cuts columns; `_computed` on list rows (image cells as URLs). `list.tabs` → `crud/list-tabs.ts`, `tab` list param applies `where` in `buildListQuery`, `GET /api/resources/:r/tab-counts`. UI `lib/computed-cells.ts`, `app/computed-cell.tsx`, `lib/list-state.ts` `activeTab`/`tabChanges`.
  - Actions: `@AdminAction({ primary, label: { static, for } })`; `_perm.actions` is `Record<name, label | false>` (`actionLabel` in the policy); UI `lib/actions.ts` `headerActions`.
  - Record page: `form.layout: { main, aside }` (`mainLayout()` reads both shapes; `FormSchema.layout` stays the main column), `form.mode`, `form.header`; `AdminApiService.recordPage` adds `_aside` (relation cards through the target's GET), `_computed` (header and summary columns) and `_steps` (stepper history, `RegisteredResource.steppers`). Inlines: `readonly`, `computed`, `cards.markFirst`; layout `summary` nodes; `warnIf`. UI `lib/record-layout.ts`, `app/{aside-card,stepper}.tsx`, `lib/stepper.ts`.
  - Dashboard: `@AdminWidget` providers (`dashboard/widget-registry.ts`), `DashboardService` (`GET /api/dashboard`, `/api/dashboard/:widget`, `parsePeriod`), codes join the catalog's globals; `meta.dashboard`. UI `app/dashboard/*`, `lib/dashboard.ts` (`periodRange`, `changeModel`, `chartGeometry`); the home page is the dashboard when `meta.dashboard`.
  - Accent: `forRoot({ appearance })` → `appearance/appearance.service.ts` (`AdminAppearance`: `nma_setting` via `ADMIN_SETTING_ENTITIES`, `PUT /api/appearance` with `appearance.manage`, `SessionResponse.appearance`); UI `lib/theme.ts` `effectiveAccent`/`applyAccent` (own pick in localStorage, then the admin's, then branding), `AccentPicker` in `app/preferences.tsx`.
  - `@nest-my-admin/testing` `expectNoLeaks` crawls menu badges, tab counts, `_computed` and dashboard widgets.
- `packages/core/src/contract.ts` is the JSON contract with the UI. It is types only; the UI imports it from source through a tsconfig path.
- `packages/ui` is a Vite + React + shadcn SPA published as static `dist/` only (all its deps are devDependencies). The shadcn primitives and theme tokens were copied from crm-next (`radix-nova`, neutral).
- `examples/demo-api` is the reference host app used by integration and E2E tests. It imports `@nest-my-admin/core` through the package `exports` (the built `dist/`), so run `bun run build` (or `bun run --filter @nest-my-admin/core build`) after changing core; the root `test`, `typecheck` and `e2e` scripts do this for you.

## Conventions

- Relative imports in `packages/core` use `.js` extensions (NodeNext ESM).
- `decimal` and `bigint` values are always strings in API responses (`serializeValue`); drivers disagree, so never rely on the driver.
- Playwright files end in `.pw.ts`; Bun's test runner would otherwise pick up `*.spec.ts`.
- Every `*.test.ts(x)` runs with a 20-second default timeout for tests and hooks: `scripts/test-setup.ts` (a Bun plugin that prepends `setDefaultTimeout` to each test file) is preloaded by `bunfig.toml` at the root and in each workspace with tests (Bun 1.4.2 ignores a `timeout` key in bunfig, a preload's `setDefaultTimeout` holds for the first file only, and `bun test` reads only the bunfig of the directory it starts in). A new workspace with tests needs its own `bunfig.toml`.
- New UI inputs for numbers use `type="text"` with `inputMode`, not `type="number"`.
- Integration tests get their database from `createTestApp` (core) or `testDatabase()` (`packages/core/test/helpers/test-db.ts`): one fresh database per app on the server `NMA_TEST_DB` selects. Never hardcode `type: 'sqljs'` in a test. Assertions that differ by driver branch on `TEST_DB` and say why.
- Database errors are mapped in `http/error-response.ts` using the resource's `dbNames` (column, unique constraint/index and FK names → properties). MySQL reports unique constraints as index names; SQLite's FK error names no column and no side (the request method decides).
- In Bun 1.4.2, `expect(obj).toMatchObject({ x: expect.any(...) })` overwrites `obj.x` with the matcher — read values you need before such assertions.

## Print and export (0.5)

- `@AdminPrint` (`decorators/admin-print.ts`, `resolvePrints` at registration, names may not collide with base methods or actions) → `AdminApiService.print` (`findOne` + `requireInScope` per id, host errors through `hostError`, audit `{r}.print.{name}` per record) → `print/print-page.ts` (the page, `@page` size, nonce CSP). `print/html.ts` is the escaping `html` tag. The route takes `?lang=` because a new tab cannot send the UI's `Accept-Language`. View-as drops `prints` (a new tab cannot carry `X-View-As`).
- `list.export` → `RegisteredResource.export` (`checkExport` in the registry) → `AdminApiService.export` (the list query through `parseListQuery`, `findMany` in pages of 500, scope re-check for `findMany` overrides, `records()` for masking, `export/export-cells.ts` `toCell`, `export/xlsx.ts` the in-house writer: zip + CRC-32, inline strings). Codes `{r}.print.{name}` and `{r}.export` are resource custom codes in the catalog; `AdminPolicy.canPrint`/`canExport` cut `schema.prints`/`list.export`.
- UI: `app/print-export.tsx` (`PrintButtons` in the record header and the selection bar, `ExportButton` on the list toolbar), `printUrl`/`api.exportList` in `lib/api.ts`.
