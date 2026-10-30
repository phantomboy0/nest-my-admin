# Extension Points and Cleanups (v0.7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six places where core gives a fixed rule become hooks or cleanups (translate, readonlyFields, write types, async relationOptions, a create rule for inline children, menu sections from groups), with today's behaviour as every default.

**Architecture:** Each change lands in `packages/core` behind an option or an overridable method of `AdminResourceBase`. Only two reach the contract and the UI: `AdminRuntimeConfig.messages` (UI text overrides) and `RecordPermissions.inlines` (the create rule). Each task updates its own README section and CLAUDE.md note.

**Tech Stack:** NestJS + TypeORM (ESM, `.js` imports) in `packages/core`, React + Vite in `packages/ui`, Bun test, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-extension-points-design.md`

## Global Constraints

- No breaking change: every 0.6 declaration keeps compiling and means the same. Nothing removed or deprecated.
- A hook can only lock or refuse more, never widen what the policy allows.
- A hook that throws fails closed (locked, refused), logged once, like `readonlyIf` and `@AdminCan` today. Exception: `translate` falls back (texts are not permissions), except for `ui.` keys at boot, where a throw fails boot.
- Relative imports in core use `.js`. Integration tests get their database from `createTestApp`/`testDatabase()`, never `type: 'sqljs'`. Playwright files end in `.pw.ts`.
- `examples/demo-api` uses core's built `dist`: run `bun run build` before demo tests or E2E.
- Every task ends with `bun run typecheck` and `bun run test` green. The last task also runs `test:postgres`, `test:mysql`, `compat`, `pack:smoke` and `e2e`.
- Commits have no `Co-Authored-By` or other AI attribution (owner's rule).

## Review Focus

1. `translate` returns `''`, a non-string or throws → the declared text is shown and the request still succeeds (Task 1 test).
2. `readonlyFields` returns duplicates, the primary key or a field that is already `readonly` → `_readonly` has each name once and nothing crashes (Task 3 test).
3. A parent is created together with inline rows in one request → the create rule gets the freshly created parent (Task 6 test).
4. A configured locale without a UI bundle (`de`), or a key missing from `fa` → English, overridden by `translate` (Task 2 test).
5. A `{ group }` menu section whose members the user may not see → the section is left out, like an empty section today (Task 8 test).

---

### Task 1: `translate` for host texts

**Files:**
- Create: `packages/core/src/i18n/texts.ts`, `packages/core/src/i18n/texts.test.ts`, `packages/core/test/translate.test.ts`
- Modify: `packages/core/src/options.ts` (option + resolved option), `packages/core/src/index.ts` (export the type), the 28 `resolveText(` call sites listed by `grep -rn "resolveText(" packages/core/src | grep -v test` (`api/admin-api.service.ts`, `api/action.service.ts`, `policy/admin-policy.service.ts`, `pages/page.service.ts`, `dashboard/dashboard.service.ts`, `schema/field-config.ts`, `schema/dto-form.ts`, `inlines/inline-config.ts`, `decorators/admin-action.ts`, `decorators/admin-print.ts`, `api/menu.ts`, `http/admin-http.server.ts`), the layout node types in `schema/field-config.ts` (optional `key`) and `checkLayout` (unique keys)
- Docs: README "Languages, theme and branding" (translate, the key table, plain strings already allowed); CLAUDE.md, a line under "UI shell and i18n"

**Interfaces:**
- Produces:
  - `export type AdminTranslate = (request: { key?: string; text: LocalizedText; locale: string }) => string | undefined;`
  - `AdminModuleOptions.translate?: AdminTranslate`
  - `export type TextResolver = (text: LocalizedText, locale: string, key?: string) => string;`
  - `export function createTexts(options: { translate?: AdminTranslate; locale: string }, logger: Logger): TextResolver`, held on the resolved options as `options.texts`, so every service reaches it the way it reaches `options.locale` today.
  - Layout nodes (`section`, `tab`, aside cards, `summary` rows, inline nodes) accept `key?: string`.

- [ ] **Step 1: Unit tests in `texts.test.ts`**
  - `'uses the translation when given'`: translate returns `'Name'` for key `resource.product.fields.name.label` → `'Name'`.
  - `'falls back on undefined, empty string or a non-string'`: each → `resolveText(text, locale, 'fa')`.
  - `'a throw falls back and is logged once per key'`: two calls with the same key, one `logger.warn`.
  - `'keyless texts reach translate with text only'`: the request has no `key` property.
  - `'no option is resolveText'`: the same answers as `resolveText` for string and object labels.
- [ ] **Step 2: Run them:** `bun test packages/core/src/i18n/texts.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `createTexts` in `i18n/texts.ts`** and add the option (resolved in `resolveOptions`).
- [ ] **Step 4: Run the unit tests.** Expected: PASS.
- [ ] **Step 5: Integration test `test/translate.test.ts`.** Its app declares a group, a resource with fields (one unlabelled, one with `enumLabels`, one `help`), an action with `confirm`, a print, a tab, a computed column, a layout section with `key: 'main'`, a settings page, a widget, a role and a menu section. `translate` records every request it gets and answers `T(<key>)`.
  - `'every keyed text goes through translate'`: GET meta, schema, page, dashboard and the role list in `en`. Each text shows as `T(<key>)` and the recorded keys equal this exact set: `title`, `group.<g>`, `menu.<s>`, `menu.advanced`, `resource.<r>`, `resource.<r>.fields.<f>.label`, `resource.<r>.fields.<f>.help`, `resource.<r>.fields.<f>.enumLabels.<v>`, `resource.<r>.actions.<a>.label`, `resource.<r>.actions.<a>.confirm`, `resource.<r>.prints.<p>.label`, `resource.<r>.list.tabs.<t>.label`, `resource.<r>.list.computed.<c>.label`, `resource.<r>.form.main`, `page.<p>`, `page.<p>.fields.<f>.label`, `widget.<w>.title`, `role.<n>`.
  - `'an unlabelled field asks with its humanized name'`: the request's `text` is `humanize(name)`.
  - `'a nested field uses its dotted path'`: an embedded `hours.*.day` field asks with `resource.<r>.fields.hours.*.day.label`.
  - `'a duplicate layout key is a boot error'`: two sections with `key: 'main'` → rejects with `form.layout: key "main" is used twice`.
- [ ] **Step 6: Run it:** `bun test packages/core/test/translate.test.ts`. Expected: FAIL.
- [ ] **Step 7: Route every call site through `options.texts`, passing the key from the table.** Action labels from `labelFor` pass their computed label as `text` with the action's label key. Action result messages and record links pass no key. `resolveText` stays exported and stays in `ui-assets.ts`.
- [ ] **Step 8: Run the integration test, then the whole suite:** `bun run test`. Expected: PASS; `i18n.test.ts` and `meta.test.ts` unchanged.
- [ ] **Step 9: Write the docs, then commit:** `git commit -m "feat(core): translate option resolves every host text by key"`

### Task 2: `translate` for the UI's own texts

**Files:**
- Create: `packages/ui/scripts/write-messages.ts`, `packages/core/src/http/ui-messages.ts`, `packages/core/src/http/ui-messages.test.ts`, `packages/ui/src/i18n/overrides.test.ts`, `packages/core/test/fixtures/ui-dist/messages.json`
- Modify: `packages/ui/package.json` (`"build": "vite build && bun scripts/write-messages.ts"`), `packages/core/src/contract.ts` (`AdminRuntimeConfig.messages?`), `packages/core/src/http/admin-http.server.ts` (`onModuleInit`), `packages/ui/src/i18n/index.tsx` (lookup), `packages/ui/src/main.tsx` (apply the overrides before render), `packages/core/test/ui-serving.test.ts`
- Docs: README (a "UI texts" paragraph under translate: purity, placeholders, new languages); CLAUDE.md "UI shell and i18n"

**Interfaces:**
- Consumes: `AdminTranslate` (Task 1).
- Produces:
  - `dist/messages.json`: `{ "en": { "<key>": "<template>" }, "fa": { … } }`, every bundle of `packages/ui/src/i18n`.
  - `export function readUiMessages(distDir: string): Record<string, Record<string, string>> | undefined` (undefined when the file is missing).
  - `export function uiOverrides(bundles: Record<string, Record<string, string>>, locales: readonly string[], translate: AdminTranslate | undefined): Record<string, Record<string, string>>`, which throws `Error` on a placeholder mismatch or a throw.
  - `AdminRuntimeConfig.messages?: Record<string, Record<string, string>>`
  - UI: `export function applyMessageOverrides(overrides: Record<string, Record<string, string>> | undefined): void` in `i18n/index.tsx`.

- [ ] **Step 1: Core unit tests in `ui-messages.test.ts`**
  - `'asks once per locale and key with the locale's built-in text'`: bundles `{ en: { 'form.save': 'Save' }, fa: { 'form.save': 'ذخیره' } }`, locales `['fa', 'en']` → 2 calls with keys `ui.form.save`, texts `'ذخیره'` and `'Save'`.
  - `'keeps only answers that differ'`: translate answers the built-in text for `en` → `{ fa: { 'form.save': 'ثبت' } }`.
  - `'a locale without a bundle starts from English'`: locale `de`, text `'Save'`.
  - `'a placeholder mismatch fails'`: `'form.add': 'Add {name}'` answered `'Add'` → throws `translate: ui.form.add (de) must keep the placeholders {name}`.
  - `'a throw fails'`: the error names the key and the locale.
  - `'no translate gives no overrides'`: `{}`.
- [ ] **Step 2: UI unit test `overrides.test.ts`:** after `applyMessageOverrides({ fa: { 'form.save': 'ثبت' }, de: { 'form.save': 'Speichern' } })`, `translate('form.save', {}, 'fa')` is `'ثبت'`, `'de'` is `'Speichern'`, `'en'` is `'Save'`; a key with no `de` override is the English text; placeholders still fill.
- [ ] **Step 3: Run both:** `bun test packages/core/src/http/ui-messages.test.ts packages/ui/src/i18n/overrides.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `ui-messages.ts`, `applyMessageOverrides` and the lookup** (override for the locale → bundle for the locale → `en`). Placeholders are compared as sets of `/\{(\w+)\}/g` names against the English template.
- [ ] **Step 5: Run both again.** Expected: PASS.
- [ ] **Step 6: Wire it up**
  - `write-messages.ts` imports the bundles and writes `dist/messages.json`. Add a unit test: the file's `en` keys equal `Object.keys(en)`.
  - `onModuleInit` reads the file from the UI dist path and puts `uiOverrides(...)` into the runtime config as `messages` (only when non-empty). A missing file logs one warning and skips.
  - `main.tsx` calls `applyMessageOverrides(runtimeConfig.messages)`.
- [ ] **Step 7: Integration tests in `ui-serving.test.ts`** with the fixture `messages.json`:
  - `'translate rewords UI texts in the served config'`: the `nma-config` JSON has `messages.fa['form.save']`.
  - `'a placeholder mismatch fails boot'`: `createTestApp` rejects with the message from Step 1.
- [ ] **Step 8: Run:** `bun run build && bun run test`. Expected: PASS.
- [ ] **Step 9: Write the docs, then commit:** `git commit -m "feat: translate rewords the UI's own texts (ui.<key>)"`

### Task 3: `readonlyFields(record, ctx)`

**Files:**
- Modify: `packages/core/src/resource/admin-resource-base.ts`, `packages/core/src/api/admin-api.service.ts` (`lockedFields` gains `ctx`; its three call sites and the `inlineWriter` dependency), `packages/core/src/inlines/inline-writer.ts` (`lockedFields` dependency type)
- Test: `packages/core/test/fields-config.test.ts`, `packages/core/test/inlines-write.test.ts`
- Docs: README "Fields and forms" (readonlyFields next to readonlyIf); CLAUDE.md "Field config (M2-3)"

**Interfaces:**
- Produces on `AdminResourceBase<T>`:
  - `readonlyFields(record: T, ctx: AdminContext): readonly string[]`, default `[]`.
  - `protected get updateFields(): readonly string[]`: the resource's `schema.form.update`, read from the schema the registry attaches, the same way `attachRepository` works (`attachSchema(schema)`, `@internal`).
- `lockedFields(entry, entity, ctx): string[]` = union of `readonlyIf` and `readonlyFields`, each name once, unknown names dropped.

- [ ] **Step 1: Tests in `fields-config.test.ts`.** A resource locks `['price', 'note']` when `status === 'archived'`, plus `'nope'` and `'id'`.
  - `'readonlyFields locks on GET'`: `_readonly` equals `['price', 'note']` (deduplicated with `price`'s `readonlyIf`; no `id`, no `nope`).
  - `'readonlyFields refuses PATCH'`: 422 `{ note: ['is read-only'] }`.
  - `'an unknown name warns once'`: two GETs, one warning naming `nope`.
  - `'a throwing readonlyFields locks the update form'`: `_readonly` equals `schema.form.update`.
  - `'updateFields lists the update form'`.
- [ ] **Step 2: Test in `inlines-write.test.ts`:** `'a child's readonlyFields refuses an inline update'` → error key `_inlines.<child>.update.<id>.<field>`.
- [ ] **Step 3: Run them:** `bun test packages/core/test/fields-config.test.ts packages/core/test/inlines-write.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** Pass `ctx` at every `lockedFields` call site. The record-loop call in `records()` uses the request `ctx`; the writes use `tx`.
- [ ] **Step 5: Run the tests, then `bun run test`.** Expected: PASS.
- [ ] **Step 6: Write the docs, then commit:** `git commit -m "feat(core): readonlyFields(record, ctx) locks fields per record"`

### Task 4: Write context and id type

**Files:**
- Modify: `packages/core/src/resource/admin-context.ts` (type), `packages/core/src/resource/admin-resource-base.ts` (generic + signatures), `packages/core/src/api/write-runner.ts` (manager without transactions; `inTransaction`), `packages/core/src/api/admin-api.service.ts` (`checkVersion` lock), `packages/core/src/decorators/admin-settings-page.ts` (`save` ctx type), `packages/core/src/decorators/admin-action.ts` (method type, if typed there), `packages/core/src/index.ts`
- Test: `packages/core/test/transactions.test.ts`, `packages/core/test/versions.test.ts`, `packages/core/test/types.test.ts` (new; compile-only assertions)
- Docs: README "Transactions, context and errors" (write context, `transactions: false`, typed DTO parameters in overrides, the `Id` parameter); CLAUDE.md "Writes run inside…"

**Interfaces:**
- Produces:
  - `export type AdminWriteContext = AdminContext & { manager: EntityManager };`
  - `AdminResourceBase<T extends ObjectLiteral = ObjectLiteral, Id extends RecordId = RecordId>`, with `findOne(id: Id, …)`, `update(id: Id, dto: object, ctx: AdminWriteContext)`, `delete(id: Id, ctx: AdminWriteContext)`, `restore(id: Id, ctx: AdminWriteContext)`, `purge(id: Id, ctx: AdminWriteContext)`, `create(dto: object, ctx: AdminWriteContext)`
  - `AdminSettingsSource.save(changes, ctx: AdminWriteContext)`
  - `WriteRunner.inTransaction(ctx: AdminContext): boolean`

- [ ] **Step 1: Compile-only test `types.test.ts`** (bun runs it; `bun run typecheck` checks it):
  - `class A extends AdminResourceBase<Gadget, number> { override async update(id: number, dto: GadgetDto, ctx: AdminWriteContext) { ctx.manager.getRepository(Gadget); return super.update(id, dto, ctx); } }`
  - a 0.6-style override `create(dto: object, ctx: AdminContext)` still compiles;
  - `// @ts-expect-error` on `update(id: string, …)` in a `<Gadget, number>` class.
- [ ] **Step 2: Test in `transactions.test.ts`:** `'without transactions a write still gets a manager'`. An app with `transactions: false` whose `create` override asserts `ctx.manager === dataSource.manager`, then saves → 201.
- [ ] **Step 3: Test in `versions.test.ts`:** `'If-Match works with transactions off'`. A stale `If-Match` → 409, a current one → 200 (no lock outside a transaction on Postgres/MySQL).
- [ ] **Step 4: Run them:** `bun test packages/core/test/transactions.test.ts packages/core/test/versions.test.ts`, then `bun run typecheck`. Expected: FAIL.
- [ ] **Step 5: Implement**
  - The non-transactional branch of `WriteRunner.run` hands `work` a context with `manager` set to `target.dataSource.manager`, derived the way the transactional branch derives its context.
  - `inTransaction` is a `WeakSet` of transactional contexts.
  - `checkVersion` locks only when `inTransaction(ctx)`.
  - Then audit every other reader of `ctx.manager`: `grep -rn "ctx.manager\|tx.manager" packages/core/src | grep -v test`. Keep each reader's meaning; `files.service.ts:194` stays equivalent; check the audit participant's `record`/`recordAfter` choice. List anything changed in the commit message.
- [ ] **Step 6: Run `bun run typecheck && bun run test`.** Expected: PASS.
- [ ] **Step 7: Write the docs, then commit:** `git commit -m "feat(core): AdminWriteContext and an Id type parameter for resources"`

### Task 5: Async `relationOptions` and typed picker values

**Files:**
- Modify: `packages/core/src/resource/admin-resource-base.ts` (return type, doc comment), `packages/core/src/api/admin-api.service.ts` (`optionsQuery` async; its two callers `await`; normalize `values` after `parseValues` and inside `parentValues`), `packages/core/src/crud/relation-writes.ts` (normalizer)
- Test: `packages/core/test/relations-write.test.ts`, `packages/core/test/inlines-write.test.ts`
- Docs: README "Relations and record titles" (async allowed; the id types guaranteed in `values` and `values._parent`); CLAUDE.md "Lists at scale (M1c-4)" `relationOptions` line

**Interfaces:**
- Produces:
  - `relationOptions(field, qb, ctx, values): SelectQueryBuilder<any> | Promise<SelectQueryBuilder<any>>`
  - `export function normalizeRelationValues(values: Record<string, unknown>, schema: ResourceSchema): Record<string, unknown>`. For each to-one relation field present, it converts the value to the target key's type with the existing `parseId`. Many-to-many arrays are converted element-wise. A value that does not parse is removed. `null` stays. Other keys are untouched.

- [ ] **Step 1: Tests**
  - `relations-write.test.ts`, `'an async relationOptions restricts the picker and submitted ids'`: an override that `await`s a repository lookup before `andWhere` → the picker lists only allowed ids, and a POST with a disallowed id is 422 on the field.
  - `relations-write.test.ts`, `'picker values arrive in the key type'`: `?values={"provinceId":"3"}` → the override sees `values.provinceId === 3`; `"x"` → the key is absent.
  - `inlines-write.test.ts`, `'_parent values arrive in the key type'`: `values._parent.categoryId` sent as `"5"` is seen as `5`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The parent's values are normalized with the parent's schema.
- [ ] **Step 4: Run them, then `bun run test`.** Expected: PASS.
- [ ] **Step 5: Write the docs, then commit:** `git commit -m "feat(core): relationOptions may be async; picker values carry typed ids"`

### Task 6: `@AdminCan('create')` on the server

**Files:**
- Modify: `packages/core/src/decorators/admin-scope.ts` (`RecordOperation` gains `'create'`; doc), `packages/core/src/registry/resource-registry.ts` (boot check after inlines resolve), `packages/core/src/policy/admin-policy.service.ts` (`createRule`, `recordPermissions` fills `inlines`), `packages/core/src/inlines/inline-writer.ts` (refuse creates), `packages/core/src/api/admin-api.service.ts` (direct POST), `packages/core/src/contract.ts`
- Test: `packages/core/test/inline-create-rule.test.ts` (new)
- Docs: README "Inlines" (the create rule); CLAUDE.md "Inlines and host files (M4-4)"

**Interfaces:**
- Produces:
  - `AdminPolicy.createRule(child: RegisteredResource, parent: object, ctx: AdminContext): boolean`. All `@AdminCan('create')` rules of the child must return `true`; a throw is no, warned once. `true` when the child has none.
  - `RecordPermissions.inlines?: Record<string, { create: boolean }>`, filled only for children with a create rule, on records whose resource has such inlines. `recordPermissions` no longer returns `undefined` for a superuser when a child has a create rule.
  - Boot error: `<Class>: @AdminCan('create') needs <Class> to be an inline child (no form.layout names it)`.

- [ ] **Step 1: Tests in `inline-create-rule.test.ts`.** Fixture: `Shelf` (`locked` boolean) with inline `Book`, whose rule is `@AdminCan('create') open(shelf: Shelf) { return !shelf.locked; }`.
  - `'refuses an inline create under a locked parent'`: PATCH a locked shelf with `_inlines.book.create` → 403, nothing written.
  - `'allows it under an open parent'` → 200.
  - `'the rule sees a parent created in the same request'`: POST a shelf with `locked: true` and an inline create → 403; with `locked: false` → 201.
  - `'refuses a direct POST that names a locked parent'`: `POST /resources/book` `{ shelfId: <locked> }` → 403.
  - `'a direct POST without the link value is not judged by the rule'` → today's answer (422 if the link is required).
  - `'_perm.inlines on the parent'`: GET the locked shelf → `_perm.inlines.book.create === false`, also for a superuser; a shelf of a resource with no create rule has no `inlines`.
  - `'a throwing rule says no'` → 403, one warning.
  - `'declared on a resource that is no inline child fails boot'` → the error above.
- [ ] **Step 2: Run it:** `bun test packages/core/test/inline-create-rule.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - The inline writer checks creates next to its update/delete rules, against the stored parent (a new parent after its create). Check order stays 404 → 409 → 403 → 422.
  - The direct POST runs the rule for each inline naming this child whose `link` is set in the validated body. The parent is loaded with the parent resource's `findOne` in the user's view scope; when that parent is not found, skip the rule (the relation check answers).
- [ ] **Step 4: Run it, then `bun run test`.** Expected: PASS; `debugger.test.ts` still matches the API.
- [ ] **Step 5: Write the docs, then commit:** `git commit -m "feat(core): @AdminCan('create') decides whether a child row may be added to a parent"`

### Task 7: The create rule in the UI; both new record hooks in the demo

**Files:**
- Modify: `packages/ui/src/app/inline-section.tsx` (prop `canAdd?: boolean` ANDed into `canCreate`), `packages/ui/src/app/form-layout.tsx` / `form-page.tsx` (pass `record?._perm?.inlines?.[inline.name]?.create`), `examples/demo-api/src/sales/order-line.admin.ts`: the create rule (no line is added to an order whose status is `shipped`), and `readonlyFields` locking the lines of a shipped order (every field of `updateFields`; the line must be read with its order, through `query()`), `examples/demo-api/e2e/inlines.pw.ts`
- Docs: none beyond Task 6

**Interfaces:**
- Consumes: `RecordPermissions.inlines` (Task 6).

- [ ] **Step 1: E2E test in `inlines.pw.ts`:** `'a shipped order offers no Add for lines'`. Open a shipped order: the order-lines section has no «Add» button and its line fields are read-only. A draft order still has «Add» and editable lines.
- [ ] **Step 2: Run it:** `bun run build && bun run e2e -- inlines`. Expected: FAIL.
- [ ] **Step 3: Implement the prop and the demo rule.** A new parent (no record yet) keeps «Add».
- [ ] **Step 4: Run it, plus `bun run e2e:screens`.** Expected: PASS, no screenshot changes.
- [ ] **Step 5: Commit:** `git commit -m "feat(ui): inline Add follows the parent's create rule; demo: no lines on shipped orders"`

### Task 8: Menu sections from groups, items by class

**Files:**
- Modify: `packages/core/src/options.ts` (`AdminMenuSection`, `AdminMenuItem`), `packages/core/src/api/menu.ts` (`checkMenu` resolves first; `buildMenu` fills group sections), `packages/core/src/registry/resource-registry.ts` / `pages/page-registry.ts` (look up a registered name by class, if no helper exists)
- Test: `packages/core/test/menu.test.ts`
- Docs: README "Sidebar groups and order" gains a "The menu" subsection (today the menu is documented only in "Upgrading to 0.4"): sections, badges, `{ group }` sections, class items; CLAUDE.md "Owner admin (0.4)" navigation line

**Interfaces:**
- Produces:
  - `AdminMenuSection = { key: string; label: LocalizedText; icon: string; items: AdminMenuItem[] } | { group: string; key?: string; label?: LocalizedText; icon?: string; items?: AdminMenuItem[] }`
  - `AdminMenuItem` adds `{ resource: Type<AdminResourceBase>; badge? }` and `{ page: Type }`.
  - `export function resolveMenu(menu: AdminMenuOptions, registry, pages, claims): ResolvedMenu`: plain sections with string names, run once at boot before `checkMenu`.

- [ ] **Step 1: Tests in `menu.test.ts`**
  - `'a group section takes the group's label, icon and key'`: `{ group: 'sales' }` with `@AdminGroup({ key: 'sales', label: 'Sales', icon: 'cart' })` → `meta.menu.sections[0]` is `{ key: 'sales', label: 'Sales', icon: 'cart' }`.
  - `'without items it lists the group's members in order'`: navigable resources and viewable pages by `order`, then label; inline children (`nav: false`) left out.
  - `'given values override the group's'`: `{ group: 'sales', label: 'Shop' }`.
  - `'items may be classes'`: `{ resource: OrderAdmin }`, `{ page: ShopSettingsPage }` → same `meta.menu` as the names.
  - `'a section whose members the user may not see is left out'`.
  - Boot errors: unknown group → `menu: unknown group "slaes" (did you mean "sales"?)`; an unregistered class → `menu: OrphanAdmin is not a registered resource`.
- [ ] **Step 2: Run them:** `bun test packages/core/test/menu.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `resolveMenu`.** `checkMenu` and `buildMenu` then work on the resolved menu unchanged, except that a group section without `items` is filled per request through the same visibility the sidebar uses.
- [ ] **Step 4: Run them, then `bun run test`.** Expected: PASS.
- [ ] **Step 5: Write the docs, then commit:** `git commit -m "feat(core): menu sections from @AdminGroup, menu items by class"`

### Task 9: Upgrade note, docs of what already exists, full verification

**Files:**
- Modify: `README.md` (and the copies in `packages/core/README.md`, `packages/nest-my-admin/README.md`, kept identical as today), `CLAUDE.md`

- [ ] **Step 1: README "Upgrading to 0.7".** Nothing needs changing; it lists the new hooks with one line each.
- [ ] **Step 2: README, under the matching sections, a short "you may not need to" note for each of:**
  - `errorMapper` (it also maps bulk-action failures);
  - `readonly: true` instead of refusing writes by hand;
  - leaving out `form.update` (the create DTO checked as a partial);
  - typed DTO parameters in overrides (`override create(dto: ProductDto, ctx)`);
  - property injection (`@Inject(Service) protected service`) in a shared base class instead of a constructor per subclass;
  - inline children leaving navigation by default.
- [ ] **Step 3: Run the full verification:** `bun run typecheck && bun run test && bun run db:up && bun run test:postgres && bun run test:mysql && bun run compat && bun run pack:smoke && bun run e2e && bun run e2e:screens`. Expected: every command passes; record any skipped step and why in the commit message.
- [ ] **Step 4: Commit:** `git commit -m "docs: upgrading to 0.7, and the options hosts tend to miss"`
