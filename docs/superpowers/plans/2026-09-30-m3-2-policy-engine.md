# M3-2 — Policy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users see and change only what their roles allow (spec §6):
- entity permissions (`{r}.view|create|update|delete|purge`);
- field rules (hidden, read-only, `restricted` fields);
- row scopes (`@AdminScope`, with role assignments per operation, and `globalScopes` for tenants);
- record rules (`@AdminCan`, reported as `_perm`);
- custom permission codes (`ctx.can()`).

Everything is enforced on the server at one place, `AdminPolicy`, with anti-oracle rules and 404 for records out of scope. The UI hides what the user cannot do.

**Architecture:**
- **Roles in code.** `AdminModule.forRoot({ roles, resolveRoles, globalScopes, permissions })`:

  ```ts
  roles: [{
    name: 'catalog-editor', label: { en: 'Catalog editor', fa: 'ویرایشگر کاتالوگ' },
    permissions: ['product.view', 'product.update', 'category.*', 'product.field.cost.view'],
    fields: { product: { price: 'readonly', cost: 'hidden' } },
    scopes: { product: { update: 'drafts' } },          // view/update/delete; default: all rows
  }],
  resolveRoles: (user) => user.username === 'editor' ? ['catalog-editor'] : [],
  ```

  - Assignment comes from `resolveRoles` in `forRoot`, plus the auth adapter's optional `resolveRoles(user)`. M3-3 adds database roles, groups and memberships under the same model.
  - Superusers bypass everything except `globalScopes` that do not opt out.
- **Codes.**
  - Resource operations: `{r}.view`, `{r}.create`, `{r}.update`, `{r}.delete`, `{r}.purge`.
  - Field codes: `{r}.field.{f}.view` and `{r}.field.{f}.edit`.
  - Custom codes: `@AdminResource(E, { permissions: ['view_all'] })` gives `{r}.view_all`; global ones come from `forRoot({ permissions: ['reports.run'] })`.
  - Wildcards: `*`, `{r}.*`, `*.view`.
  - `update` implies `view` (Django's change implies view).
  - Unknown codes, resources, fields or scopes in a role are boot errors with did-you-mean.
- **Field levels:** `hidden < view < edit`, computed per resource over the roles that can view it, the most permissive winning (spec §6.2).
  - Within one role:
    - a field without a rule is `edit` if the role can update, else `view`;
    - `readonly` is `view`;
    - field codes lift a field.
  - `fields: { salary: { restricted: true } }` (in `FieldsConfig`) makes the default `hidden` for everyone, until a role grants `{r}.field.salary.view|edit` or names the field in its `fields` rules.
- **Scopes.**
  - `@AdminScope('own') own(ctx) { return { ownerId: ctx.user.id } }` returns a column map (arrays mean IN, null means IS NULL), or `(where, alias) => void` for anything else.
  - Per operation, the roles' scopes are ORed, and a role with no scope for that operation means all rows. `globalScopes` are ANDed.
  - They are applied in `buildListQuery` and `findOne` of the base class, and they also restrict relation options, relation existence checks and global search.
  - Because resources may override `findMany`/`findOne`, `AdminApiService` re-checks with its own scoped query:
    - list rows outside the view scope are dropped (one `IN` query per page, only when a scope applies);
    - GET, PATCH and DELETE of an out-of-scope id are 404.
- **Record rules.** `@AdminCan('update' | 'delete') canEdit(record, ctx)`. Records carry `_perm: { update, delete }`, which combines the permission, the update/delete scope (one `IN` query when it differs from view) and `@AdminCan`. PATCH and DELETE re-check it (403).
- **Enforcement points** (spec §6.5):
  - Meta lists only resources the user can view or create; a schema of anything else is 404.
  - Schemas are cut to the user:
    - hidden fields disappear from `fields`, columns, filters, search, sort, editable, mobile, forms and layout;
    - `view`-level fields move from the forms to `form.readonly`;
    - `permissions: { create, update, delete, purge }` is added;
    - related lists only name viewable resources.
  - Paths (`category.name`) are visible only when the relation field is, and the target's field is visible to the user (when the target is a resource).
  - Anti-oracle: filter, sort and search use the cut schema, so a hidden field is a 400 ("not filterable").
  - Records are serialized with visible fields only. Relation titles of resources the user cannot view become `#id`.
  - Writes: a body naming hidden or `view`-level fields is 403 `FORBIDDEN_FIELDS`, listing them. A missing operation permission is 403 `FORBIDDEN`.
- **Context.** `ctx.can(code)` for host code. `ctx.permissions` is the user's effective permission set, computed once per request.

**Deferred:**
- to M3-3: database roles and groups with their UI, anti-escalation (granting only what you hold), the permission debugger, view-as, and caching with `permissionsVersion`;
- to M4, with the features themselves: `import`/`export`/`action` codes.

**Spec:** D4, §4 (policy check: entity → record → fields), §5.2 (`@AdminScope`, `@AdminCan`, `restricted`), §5.5 (`can`), §6.1–6.5, §11 (`FORBIDDEN`/`FORBIDDEN_FIELDS`, 404 for out of scope). Plan 2 of 4 for M3.

## Global Constraints

- All earlier constraints apply (exact pins, logical utilities, `en` and `fa`, the error contract, per-app test databases, no AI attribution).
- **Fail closed.**
  - A permission that cannot be computed (a `resolveRoles` that throws, an unknown role name) grants nothing, is logged, and answers 403.
  - A scope method that throws fails the request (500). It never falls back to all rows.
- **One policy.** Every check goes through `AdminPolicy`; no endpoint computes permissions itself.
- **Existing apps keep working.**
  - An open admin (`AdminAuth.none()` or no `auth`) is a superuser.
  - With sign-in but no `roles`, only superusers can do anything; a boot warning says so.

## Review Focus

1. **No leaks.** For a limited user, no endpoint reveals a hidden field or an out-of-scope record: meta, schema, list (including `total`), get, search, relation options, relation titles, related lists, errors, filter/sort/search probes, and inline edit. An integration test crawls them all.
2. **Most permissive wins, grant-only.** Two roles combine to the union: a field hidden by one role and editable in another is editable, and scopes OR.
3. **Overrides cannot bypass scopes.** A resource whose `findMany`/`findOne` ignore scopes still leaks nothing and still 404s out-of-scope ids.
4. **Writes.** Hidden or read-only fields in a body are 403 with their names, before the resource method runs. `_perm` and `@AdminCan` are re-checked on PATCH and DELETE.

## File Structure

```
packages/core/src/
  policy/roles.ts (+ test)                 (RoleDefinition, code matching with wildcards, boot validation)
  policy/effective.ts (+ test)             (effective permissions, field levels, scopes per operation)
  policy/admin-policy.service.ts           (per-request policy: meta/schema cutting, scope builders, checks)
  decorators/admin-scope.ts · decorators/admin-can.ts
  resource/admin-resource-base.ts          (scopes in buildListQuery/findOne; ctx.can)
  api/admin-api.service.ts                 (enforcement at every endpoint)
  auth/auth-adapter.ts                     (resolveRoles?, AdminUser.attrs)
  options.ts · contract.ts (schema.permissions, _perm, FORBIDDEN_FIELDS)
packages/core/test/policy-*.test.ts        (entity, fields, scopes, records, leaks crawl; every database)
packages/ui/src                            (hide New/Edit/Delete/bulk/inline by permissions and _perm; read-only form; 403 messages)
examples/demo-api                          (catalog-editor role for `editor`: drafts-only updates, price read-only, no delete, cost hidden)
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Role model, codes and effective permissions

- [ ] **Tests first:**
  - `roles.test.ts`: wildcard matching; validation (unknown resource, operation, field, scope, role name in `resolveRoles`' output at runtime; did-you-mean).
  - `effective.test.ts`:
    - union across roles;
    - `update` implies `view`;
    - field levels, including `restricted` and field codes;
    - scopes ORed per operation, with "all" winning;
    - superuser.
- [ ] **Implement:**
  - `@AdminScope(name)` and `@AdminCan(op)`, collected by the registry;
  - custom codes;
  - the `forRoot` options.
- [ ] **Verify**, then commit `feat: roles, permission codes and effective permissions`.

### Task 2: Enforcement

- [ ] **Tests first** (every database):
  - `policy-entity.test.ts`: meta and schema cutting; 403 per operation; 404 schema of a resource the user cannot view.
  - `policy-fields.test.ts`:
    - hidden fields absent everywhere, and 400 when used in filter/sort/search;
    - `view` fields read-only, and FORBIDDEN_FIELDS on write;
    - paths into a resource with hidden fields;
    - relation titles of resources the user cannot view.
  - `policy-scopes.test.ts`:
    - view/update/delete scopes and OR;
    - `globalScopes`;
    - counts;
    - search, options and existence checks;
    - override-proof lists and ids (Review Focus 3).
  - `policy-records.test.ts`: `_perm`, and `@AdminCan` re-checked.
  - `policy-leaks.test.ts`: the crawl (Review Focus 1).
- [ ] **Implement** as in Architecture.
- [ ] **Verify** on all three databases, then commit `feat: enforce roles, field rules, scopes and record rules at every endpoint`.

### Task 3: UI

- [ ] **Implement:**
  - New, Duplicate and Save & new only with `create`;
  - the edit form read-only without `update` or with `_perm.update === false` (fields as text, no Save);
  - Delete only with `delete` and `_perm.delete`;
  - bulk selection only with `delete`;
  - inline cells only with `update`, `_perm.update` and field edit;
  - trash purge and restore by permission;
  - a 403 shows the message, naming the fields for `FORBIDDEN_FIELDS`.
- [ ] **Verify**, then commit `feat(ui): hide what the user cannot do`.

### Task 4: Demo, E2E, docs

- [ ] **Demo:**
  - Product gets `cost` (restricted) and `@AdminScope('drafts')`;
  - role `catalog-editor` for `editor`: products view and update (drafts only), price read-only, no delete, categories and tags in full, stock moves view only, suppliers not at all.
- [ ] **E2E** (signed in as editor):
  - no Supplier in the sidebar or palette;
  - no Delete;
  - an active product opens read-only, and a draft is editable except price;
  - a hand PATCH of price is 403 FORBIDDEN_FIELDS;
  - no cost column for the editor, and the admin sees it.
- [ ] **Docs:** README (permissions: roles, codes, fields, scopes, records, `ctx.can`), CLAUDE.md, m0-followups.
- [ ] **Verify everything** (typecheck, three databases, compat, pack:smoke, e2e, e2e:screens), then commit `feat(demo): an editor role; E2E; docs`.

## After this plan

M3-3: database roles, groups and memberships with the Roles/Groups/Users UI (matrix), anti-escalation, roles export/import, permission debugger, view-as, TOTP 2FA and the users page.
