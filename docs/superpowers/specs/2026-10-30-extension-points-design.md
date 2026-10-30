# Extension points and cleanups (0.7)

What shop-nest, the first real host, had to work around, turned into hooks the host can override and into cleanups of
core. Reviewed with the owner on 2026-10-30: the goal is a more customizable nest-my-admin, not new built-in behaviour.

## Why

shop-nest's admin is about 4,800 lines across 37 files. Part of that is the host's real rules (CRM ownership, catalog
rules). The rest exists because core gives a fixed rule where the host needed a say:

- labels can only be written inline, in every language, so shop-nest has 579 `{ fa, en }` objects;
- a record can only be locked one field at a time (`readonlyIf` on ten fields of `ProductAdmin`, all the same function);
- write methods get `ctx.manager` typed as optional although it is set (29 `ctx.manager!`), and ids typed as a union
  (`Number(id)` everywhere);
- `relationOptions` must answer synchronously, so shop-nest builds a Postgres-only raw-SQL subquery for a value it
  could have looked up;
- `@AdminCan` covers update, delete and actions but not adding a child row, so a CRM-owned product still offers «Add»
  and the server answers 409 from a TypeORM subscriber;
- a menu section cannot reuse an `@AdminGroup`, so the settings group's label and icon are written twice and its
  twelve pages listed by hand.

## Goals

- Each change is either an **extension point** (an overridable method or option, with today's behaviour as the
  default) or a **cleanup** (one way to do a thing instead of two, or exact types for what is already true at runtime).
- After 0.7, shop-nest can delete its workarounds for these six points without losing behaviour.

## Non-goals

- No breaking change. Every 0.6 declaration keeps working and means the same. Nothing is removed or deprecated.
- No new built-in features (no CRM/ownership concept, no message-catalogue format, no i18n library in core).
- `query()` and `buildListQuery` stay synchronous (they are chained into every read path).
- Docs restructuring is separate work (see "Docs", the last section, for what this release must still document).

## Anti-goals

- A hook must never widen what a user may see or do beyond the policy: hooks can only lock or refuse more.
- A hook that throws must fail closed (locked, refused), logged once, exactly like `readonlyIf` and `@AdminCan` today.
- No hardcoding of one host's shape (shop-nest's ownership rules, Persian) into core.

## 1. `translate`: the host resolves texts (extension point)

**Option.** `AdminModule.forRoot({ translate })`:

```ts
type AdminTranslate = (request: { key?: string; text: LocalizedText; locale: string }) => string | undefined;
```

- Called for every host text core resolves for a request, before today's rule. `undefined` (or an empty string) falls
  back to today's `resolveText(text, locale, defaultLocale)`. Without the option nothing changes.
- `text` is what the host declared; when the host declared no label, it is the humanized default (`humanize(name)`),
  so a host can translate fields it never labelled.
- `key` names the text when it has a stable identity (scheme below). Texts without one (layout nodes without a `key`,
  action result messages, record links) come with no `key`; the host can look them up by `text`.
- Synchronous and per request: it must be cheap. A throw is logged once per key (or per text when keyless) and falls
  back.

**Keys.** The owner's path, then the option's path, dot-separated, names as declared:

| Text | Key |
|---|---|
| admin title | `title` |
| group | `group.<key>` |
| menu section, advanced section | `menu.<section key>`, `menu.advanced` |
| resource label | `resource.<r>` |
| field label, help, enum label | `resource.<r>.fields.<f>.label`, `….help`, `….enumLabels.<value>` |
| nested field (object fields) | `resource.<r>.fields.<path>.label` (dotted path, `*` for list items as in constraints) |
| action label, confirm | `resource.<r>.actions.<a>.label`, `….confirm` |
| print label | `resource.<r>.prints.<p>.label` |
| list tab, computed column | `resource.<r>.list.tabs.<key>.label`, `resource.<r>.list.computed.<c>.label` |
| layout section/tab/aside/summary | `resource.<r>.form.<node key>` when the node has the new optional `key`; otherwise no key |
| settings page and its fields | `page.<p>`, `page.<p>.fields.<f>.label` (same suffixes as resources) |
| dashboard widget | `widget.<w>.title` |
| role label | `role.<name>` |
| the UI's own texts (Save, Delete, …) | `ui.<message key>` (keys of `packages/ui/src/i18n/en.ts`); see "UI texts" below |

Layout nodes (`section`, `tab`, `aside` cards, `summary` rows, inline sections) accept an optional `key: string`
(unique within the resource's layout, checked at boot) only to give them a translation key.

**Cleanup inside core.** The 28 `resolveText(x, locale, this.options.locale)` call sites go through one helper (a
small `Texts` service or a function built once from the options) that takes `(text, locale, key?)`. `resolveText`
itself stays as the fallback and for the server-rendered `index.html` title.

**UI texts.** The same hook rewords the UI's built-in texts; there is no second mechanism.

- The UI build writes `dist/messages.json`: every message key with its English template. Core reads it with the other
  UI assets at boot.
- At boot, for each configured locale and each key, core calls `translate({ key: 'ui.<key>', text: <the built-in
  template for that locale, else the English one>, locale })` once. For `ui.` keys, `translate` must be pure (same
  answer every time); this is documented.
- An answer whose `{name}` placeholders differ from the English template's fails boot, naming the key and the
  locale. A throw fails boot too (it is boot, not a request).
- The answers that differ from the built-in text go to the UI in the runtime config (`AdminRuntimeConfig.messages:
  Record<locale, Record<key, string>>`, only the overridden keys). The UI's `translate` looks up the host's override
  for the locale, then the built-in bundle for the locale, then English.
- This also lets a host add a UI language core has no bundle for: a locale in `locales` without a built-in bundle
  starts from English and takes whatever `translate` answers.
- Without `messages.json` (core used without the built UI, as in some tests), the UI keys are skipped with one
  warning.

**Already true and to be documented, not built:** a plain string label is accepted today and shown in every locale.

**shop-nest after:** labels written once in Persian; an English table (or nothing) behind `translate`.

## 2. `readonlyFields(record, ctx)`: lock fields per record from one place (extension point)

**Method.** On `AdminResourceBase`:

```ts
/** Fields locked on this record, in addition to each field's `readonlyIf`. Default: none. */
readonlyFields(record: T, ctx: AdminContext): readonly string[] { return []; }
```

- Synchronous, like `readonlyIf` and `@AdminCan` rules (they run inside per-record loops).
- `AdminApiService.lockedFields` returns the union of every `readonlyIf` that says yes and `readonlyFields`. It gains a
  `ctx` parameter; every place that uses it today uses the union: `_readonly` on records, the 422 on update, the
  inline writer's per-row 422 and its "cannot be moved" check for `order`.
- Names that are not fields of the resource are ignored, with a warning logged once per resource and name.
- A throw locks every field of the update form (`schema.form.update`), logged once.
- A protected getter `updateFields: readonly string[]` (the names of `schema.form.update`) helps write "everything but
  these": `return owned ? this.updateFields.filter((f) => !SHOP_FIELDS.has(f)) : []`.
- `readonlyIf` stays as it is (sugar for one field). No contract or UI change: the UI already reads `_readonly`.

## 3. Exact types for writes (cleanup)

- **Write context.** `AdminWriteContext extends AdminContext { manager: EntityManager }`. The write methods take it:
  `create`, `update`, `delete`, `restore`, `purge`, `@AdminAction` methods, `@BeforeSave/@AfterSave/@BeforeDelete`
  hooks, `AdminSettingsSource.save`. Overrides that declare `AdminContext` keep compiling (method parameters are
  bivariant).
- With `transactions: false`, `ctx.manager` in a write becomes the target DataSource's own manager (today
  `undefined`). Core code that reads `ctx.manager`'s presence as "a transaction is open" must stop doing so and ask
  the write runner instead. Known places: `checkVersion`'s `pessimistic_write` lock (`admin-api.service.ts`, which
  would fail outside a transaction on Postgres) and `FilesService`'s manager choice (`files.service.ts`); the builder
  audits every other read of `ctx.manager`. Reads still get no manager.
- **Id type.** `AdminResourceBase<T, Id extends RecordId = RecordId>`: `findOne`, `update`, `delete`, `restore`,
  `purge` and `records`-side helpers take `Id`. Runtime is unchanged: `parseRecordId` already turns a key into the
  primary column's type (number for integer columns, string for bigint and uuid).
- **Relation ids.** The builder checks that relation ids reach `create`/`update` DTOs and `relationOptions`'s
  `values` (form values in the picker, `values._parent`) in the target key's type, and normalizes any path that
  passes strings (shop-nest's `idOf` suggests the picker's `?values=` JSON does). Document the guarantee.
- **Documented, not built:** an override may already type its DTO (`override create(dto: ProductDto, ctx)`), so no
  `dto as ProductDto` cast is needed. Verified with `tsc --strict --noImplicitOverride`.

## 4. `relationOptions` may be async (extension point)

- Return type `SelectQueryBuilder<any> | Promise<SelectQueryBuilder<any>>`. `optionsQuery` (its only caller, used by
  the picker and by the existence check of submitted ids) awaits it. Existing synchronous overrides are unchanged.
- The doc comment says a lookup inside it should use `ctx.manager` when present, so a write's check sees the
  transaction.

## 5. `@AdminCan('create')`: may a child row be added to this parent (extension point)

The record-rule system covers update, delete and actions; this adds the missing operation for inline children.

- **Declaring.** On a resource that is an inline child (some parent's layout names it as `inline`):
  `@AdminCan('create') rule(parent: P, ctx: AdminContext): boolean`. `parent` is the parent entity as its resource's
  `findOne` reads it. Declared on a resource that is no inline child: boot fails with a message saying so. A child
  inlined under several parents gets whichever parent applies (the host tells them apart, e.g. with `instanceof`).
- **Enforcing.**
  - Inline writes: each `_inlines.<child>.create` entry is refused with 403 when the rule says no, next to the existing
    update/delete record rules, before anything is written.
  - The child's own `POST /api/resources/<child>`: when the body sets the link field of an inline that names this
    child, the parent is loaded through the parent resource (`findOne`, in the user's view scope) and the rule runs;
    no is 403. Without a link value or without that parent, today's behaviour (the relation checks) applies.
- **Showing.** A parent record read for its page gets `_perm.inlines: Record<childName, { create: boolean }>`, only
  for children that have a create rule (contract: `RecordPermissions.inlines?`). The inline section hides «Add» when
  `create` is false (table and cards). View-as already makes inlines read-only.
- A rule that throws says no, logged once, like the other rules.

## 6. Menu sections from groups, items by class (cleanup)

- `AdminMenuSection` may name a group instead of repeating it: `{ group: '<key>', items?, label?, icon?, key? }`.
  Label and icon come from that group's `@AdminGroup` claim (`ResourceRegistry.claims()`), and the section key
  defaults to the group key. Given values override. Without `items`, the section lists the group's navigable
  resources and viewable pages in the group's order (`memberOrder`, then label), exactly as the sidebar does today.
  Unknown group: boot fails, with a did-you-mean.
- `AdminMenuItem` accepts the class as well as the name: `{ resource: ProductAdmin }`, `{ page: BrandingPage }`,
  resolved at boot to the registered name (a class that is not registered: boot fails). Strings keep working.
- `checkMenu` runs its checks on the resolved items, so the existing rules (nav entry, badge filters) are unchanged.

**shop-nest after:** the settings section is `{ group: SETTINGS_GROUP }`, ordered by each page's `order`.

## Dropped from the review, and why

- **A typed permission-code helper:** `checkRoles` already fails at boot on an unknown code, with a did-you-mean;
  a helper would add API for a small gain.
- **A lighter way to declare an inline child:** an inline child is a full resource on purpose: that is how inlines get
  the child's scopes, permissions, `@AdminCan` rules, hooks, audit, files and form checks, and why a child can also
  stand alone. shop-nest's "catalog details" group is a leftover: inline children have been out of navigation by
  default since 0.4.

## Tests

- Unit: the key scheme (one test per row of the table), fallback and throw of `translate`; the UI's lookup order
  (override, built-in locale, English); `messages.json` matches `en.ts`; `readonlyFields` union,
  unknown names, throw; menu resolution (group sections, class items, unknown group/class).
- Integration (`packages/core/test`, on every driver): `translate` reaches meta, schema, page and dashboard responses;
  `ui.` answers reach the runtime config, and a placeholder mismatch fails boot; `readonlyFields` locks on GET `_readonly`, PATCH 422 and inline update 422; async `relationOptions` restricts both
  the picker and submitted ids; `@AdminCan('create')` refuses inline creates and a direct POST with the link set,
  allows a direct POST without it, and fills `_perm.inlines`; `transactions: false` writes get a manager and the
  version check still works.
- Demo and E2E: one demo resource uses `readonlyFields` and a create rule (an order line cannot be added to a shipped
  order); one Playwright check that «Add» is hidden there, and one that a UI text reworded through `translate` shows. `@nest-my-admin/testing` `expectNoLeaks` keeps passing.
- `bun run compat` (NestJS 11.0 + TypeORM 0.3.20) and `pack:smoke` pass.

## Docs

The README sections for each change (translate and its key table, readonlyFields, write context and id type, async
relationOptions, the create rule, menu groups), a CLAUDE.md architecture note for each, and an "Upgrading to 0.7"
note saying nothing needs changing. Also document what shop-nest missed and already exists: `errorMapper` (it also
maps bulk-action failures), `readonly: true`, omitting `form.update`, typed DTO parameters in overrides, and property
injection in shared base classes.

## Left to the builder

File layout; whether the text helper is a service or a function; the exact warning texts; where the `updateFields`
getter reads the schema from; the order of the inline writer's checks (keeping 404 → 409 → 403 → 422 as today).
