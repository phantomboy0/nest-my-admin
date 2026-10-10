# M4-2 — Actions and Settings Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- **Actions** (spec §5.2 `@AdminAction`, §6.1 `{r}.action.{name}`, §6.3 `@AdminCan('<action>')`): buttons on a record, on a selection and on a resource, with an optional input form, confirmation, per-record permission and bulk results.
- **Settings pages** (`@AdminSettingsPage`, a kind of spec §5.2 `@AdminPage`): a singleton form backed by host code, with write-only secret fields.

First consumer: shop-nest (order fulfillment transitions, cancel, resolve `needs_attention`, bulk publish; settings for branding, payments, SMS and the CRM).

**Architecture:**
- **Declaring an action** (`decorators/admin-action.ts`):

  ```ts
  @AdminAction({
    label: { en: 'Mark shipped', fa: 'ارسال شد' },
    target: 'record',          // 'record' (detail page; bulk when bulk: true) | 'resource' (list toolbar, no ids)
    bulk: true,                // also offered on a list selection
    atomic: false,             // bulk: one transaction for all (true) or one per record (false, default)
    confirm: true,             // or LocalizedText for a custom question
    variant: 'default',        // | 'destructive'
    input: ShipDto,            // optional DTO: a form in the dialog, validated like writes
    icon: 'truck',
  })
  ship(order: Order, input: ShipDto, ctx: AdminContext): ActionOutcome | void | Promise<ActionOutcome | void> { … }
  ```

  - `target: 'resource'` methods are `(input, ctx)`.
  - `ActionOutcome = { message?: LocalizedText }`.
  - The method name is the action name (`{r}.action.ship`). It must not collide with `create`/`update`/`delete`/`restore`/`purge`; a collision fails at boot.
  - The spec sketched `approve(ids[], ctx)`. Record actions take **one loaded entity** instead: core loads, scope-checks and rule-checks each record, so no host action can act on a record outside the user's scopes. Bulk is core looping over the selection.
- **Running an action:** `POST /api/resources/:r/actions/:action`, body `{ ids?: string[], input?: object }`.
  1. `policy.require(entry, 'action.<name>')`. Codes `{r}.action.{name}` are added to the catalog, so roles and the matrix see them.
  2. Validate `input` against the DTO (whitelist; 422 with field errors).
  3. **Record target:** for each id, inside `write()`: in scope for view and update (404 otherwise), then `@AdminCan('<name>')` (403 otherwise), then `findOne`, then call the method.
     - One id → `{ message?, record }`.
     - Several ids (`bulk` required, ≤ `MAX_BULK`) → `BulkResult` plus `message?`. With `atomic: true` everything runs in one `write()` and any failure answers that error with nothing applied.
  4. **Resource target:** one `write()` → `{ message? }`.
- **Schema:**
  - `ResourceSchema.actions: ActionSchema[]` with `{ name, label, target, bulk, atomic, confirm?: string | true, variant, icon?, input?: { fields: FieldSchema[]; constraints: Record<string, FieldConstraints>; required: string[] } }`, cut by the policy to the actions the user may run;
  - `_perm.actions: string[]` per record (the record-target actions allowed on it), computed with `recordPermissions` (scopes for `update`, plus each action's `@AdminCan` rules).
- **The input form** is built from the DTO alone by a new `schema/dto-form.ts`: `buildDtoForm(dto, fieldsConfig?) → { fields, constraints, required }`, using `dtoPropertyNames`, `dtoOnlyField`, `dtoObjectField` and `dtoConstraints`. It is shared with settings pages.
- **Settings pages** (`decorators/admin-settings-page.ts`):

  ```ts
  @AdminSettingsPage('payments', { label: { en: 'Payments', fa: 'پرداخت' }, group: 'settings', icon: 'credit-card',
    form: PaymentSettingsDto, fields: { zarinpalMerchantId: { secret: true } }, layout: [...] })
  export class PaymentSettingsPage implements AdminSettingsSource<PaymentSettingsDto> {
    load(ctx: AdminContext): Promise<Partial<PaymentSettingsDto>> { … }
    save(changes: Partial<PaymentSettingsDto>, ctx: AdminContext): Promise<void> { … }
  }
  ```

  - Discovered like resources (`DiscoveryService`) and registered in a `PageRegistry`.
  - The sidebar group is the providing module (or `group`). `MetaGroup.pages: Array<{ name; label; icon? }>` lists the pages the user may view.
  - **Permissions:** `page.{name}` (view) and `page.{name}.update` (save), added to the catalog.
  - **`GET /api/pages/:name`** → `{ schema: PageSchema, values, secrets: Record<string, boolean> }`.
    - `PageSchema = { name, label, fields, layout?, constraints, required, readonly: boolean }`;
    - `values` never contains a secret field. `secrets[field]` is true when `load()` returned a non-empty value for it.
  - **`PATCH /api/pages/:name`** (needs `page.{name}.update`) validates the body as a partial of the DTO.
    - A secret is replaced by any non-empty string, cleared by `null`, and left alone when absent.
    - Runs `save()` inside a transaction on the default DataSource (`ctx.manager` set), then answers like GET.
  - `AdminFieldConfig.secret: true` is allowed only on settings pages (boot check). Field options otherwise reuse `fields` config (labels, help, widgets, `showIf`).
  - Files: file and image widgets work on pages, using the upload flow from M4-1. `resource` is `page:<name>` for tokens and downloads; access is `page.{name}` / `.update`.
  - View-as: GET works, PATCH is refused (existing read-only rule).

**Deferred:** async actions (jobs), actions returning files, generic `@AdminPage` with custom React components (v1.1 plugins), dashboards.

**Spec:** §5.2 (`@AdminAction`, `@AdminPage`), §6.1 (`{r}.action.{name}`, `page.{name}`), §6.3 (`@AdminCan` per action), §11 (actions endpoint, bulk results, `atomic`). Plan 2 of 3 for M4 (shop-nest spec §9).

## Global Constraints

- All earlier constraints apply.
- **An action never runs on a record the user cannot update or view** (scopes, `@AdminCan`), on every path: single, bulk, atomic.
- **A secret value never leaves the server** after it is saved: not in GET, PATCH answers, errors, logs or audit entries (M4-3).
- View-as stays read-only: actions and page saves are refused.

## Review Focus

1. **A bulk action with one id out of scope** among allowed ones: non-atomic → that id fails with NOT_FOUND and the others run; atomic → 404 and nothing is applied. Test in Task 1.
2. **An action called by a role that has `{r}.view` + `{r}.update` but not `{r}.action.ship`** → 403, and the action is absent from the schema. Test in Task 1.
3. **Input DTO extra keys or wrong types** → 422 with field errors; the method never runs. Test in Task 1.
4. **Sending the masked placeholder or an empty string for a secret** must not overwrite it. Empty means "unchanged" only in the UI (which omits the key); the API refuses `''` for secrets with 422. Test in Task 2.
5. **A settings page `load()` that throws** → 500 with a correlation id and no partial values; `save()` throwing `AdminFieldError` → 422 on that field. Test in Task 2.

## File Structure

```
packages/core/src/decorators/admin-action.ts (+ test)        @AdminAction, getActions(), boot checks
packages/core/src/schema/dto-form.ts (+ test)                buildDtoForm()
packages/core/src/api/action.service.ts                      run actions (single, bulk, atomic, resource)
packages/core/src/policy/catalog.ts · admin-policy.service.ts action codes, _perm.actions, schema cut
packages/core/src/decorators/admin-settings-page.ts          @AdminSettingsPage, AdminSettingsSource
packages/core/src/pages/page-registry.ts · page.service.ts · page-routes.ts
packages/core/src/contract.ts                                ActionSchema, PageSchema, MetaGroup.pages, _perm.actions
packages/core/test/actions.test.ts · settings-pages.test.ts
packages/ui/src/app/action-button.tsx · action-dialog.tsx · settings-page.tsx; list selection bar; detail header
packages/ui/src/app/admin/role-editor.tsx                    action and page permissions in the matrix
examples/demo-api                                            order actions; a shop settings page; E2E
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Actions in core

**Interfaces:** produces `AdminAction(options)`, `ActionOutcome`, `getActions(resourceClass): Map<string, ActionDefinition>`, `buildDtoForm(dto, fieldsConfig?)`, `ActionSchema`, `_perm.actions`, `AdminApiService.runAction(name, action, body, ctx)` and the route.

- [ ] **Tests first** (`actions.test.ts`, every database, on a fixture `OrderAdmin` with `ship` (record, bulk, input DTO), `cancel` (record, destructive, `@AdminCan('cancel')` only for drafts) and `recount` (resource target)):
  - single run answers the reloaded record and message;
  - bulk non-atomic with one out-of-scope id and one rule-refused id → `{ ok, failed }` (Review Focus 1);
  - bulk atomic with one bad id → nothing applied;
  - no `{r}.action.ship` → 403 and absent from the schema (Review Focus 2);
  - input errors → 422, method not called (Review Focus 3);
  - `_perm.actions` per record matches `@AdminCan`;
  - resource target runs without ids, and ids sent to it → 400;
  - a name colliding with `delete` fails at boot;
  - view-as → 403;
  - a host method throwing `HttpException(409)` passes through as `BUSINESS_RULE`.
- [ ] **Implement:** the decorator, `dto-form.ts` (with `dto-form.test.ts`), the catalog codes, `recordPermissions` extended to actions, the schema cut, and the route.
- [ ] **Verify** on all three databases. Commit `feat: resource actions with input forms, bulk and per-record rules`.

### Task 2: Settings pages in core

**Interfaces:** produces `AdminSettingsPage(name, options)`, `AdminSettingsSource<T> { load(ctx); save(changes, ctx) }`, `PageSchema`, `MetaGroup.pages`, and the `GET`/`PATCH /api/pages/:name` routes. Consumes `buildDtoForm` (Task 1) and the M4-1 upload resolution with `resource = 'page:<name>'`.

- [ ] **Tests first** (`settings-pages.test.ts`, on a fixture page with text, number, boolean, enum, a nested group, one secret and one image field):
  - GET returns values without the secret and `secrets.apiKey = true`;
  - PATCH partial saves only the sent keys;
  - secret replaced, cleared with null, unchanged when absent, and `''` refused (Review Focus 4);
  - the secret never appears in any response or error;
  - `page.x` without `.update` → GET works, PATCH 403;
  - no `page.x` → 404 and absent from meta;
  - `load()` throwing → 500 with nothing else (Review Focus 5);
  - `AdminFieldError` from `save()` → 422 on the field;
  - `secret: true` on a resource field fails at boot;
  - image upload and download through `page:<name>`;
  - view-as PATCH → 403.
- [ ] **Implement:** registry, routes, meta pages, catalog codes, and roles validation of page codes.
- [ ] **Verify.** Commit `feat: settings pages with write-only secrets`.

### Task 3: UI, demo, E2E, docs

- [ ] **UI:**
  - **actions:** detail-header buttons (allowed by `_perm.actions`); list selection bar for bulk actions (reusing the bulk-delete bar and `BulkResult` toast); list toolbar for resource actions; `action-dialog.tsx` with the input form (shared `FormLayout` + `validatePayload`), confirmation and destructive styling; the result message as a toast;
  - **settings:** pages in the sidebar under their group; route `/p/:page` rendering `settings-page.tsx`; secret fields show "Set ✓ · Replace · Clear" and send only on change; the unsaved-changes guard and ⌘S reused;
  - **roles:** the role matrix lists actions per resource and pages;
  - texts in `en`/`fa`.
- [ ] **Demo:**
  - `OrderAdmin` actions: `markPaid`, `ship` (tracking-code input, bulk) and `cancel` (destructive, drafts only);
  - a `ShopSettingsPage` storing JSON in a `shop_setting` table, with a secret API key and a logo image;
  - the editor role gets `order.action.ship` but not `cancel`.
- [ ] **E2E** (`actions.pw.ts`, `settings.pw.ts`):
  - ship two orders from the list selection;
  - cancel from the detail page with confirmation;
  - the editor sees Ship but not Cancel;
  - save settings, replace the secret, reload (never shown), upload a logo.
- [ ] **Screens:** baselines for the detail header and the settings page.
- [ ] **Docs:** README (actions, settings pages, secrets), CLAUDE.md (M4-2 bullets), m0-followups.
- [ ] **Verify everything.** Commit `feat(ui): actions and settings pages; demo; E2E; docs`.
