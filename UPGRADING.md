# Upgrading nest-my-admin

Newest first. Upgrade all packages together (`nest-my-admin`, or every `@nest-my-admin/*` at one version).

## Upgrading to 0.10.4

Nothing to change. New: `AdminModule.forRoot({ rootRedirect: true })` sends a browser that opens the bare address to the admin, with a temporary redirect, wherever `path` puts it. It is off by default, because it shows anyone where the admin lives. A route of your own at `/` keeps answering, and every other address keeps its 404.

## Upgrading to 0.10.3

Nothing to change. What you may notice:

- A save with inline rows now answers with every refused row at once: each row runs in a savepoint, and the save still fails as a whole. One refused row keeps its own status and message; several are one 422 with every row's `fields`.
- Filter chips are no longer dashed «+» buttons (they read as "add"): a funnel and an arrow, after a «Filter:» caption, and a title in the popover. A yes/no filter is a switch on the chip (one click on, one click off); «No» is behind its arrow. An editable yes/no list cell is a switch that saves on click.
- Money inputs group digits as they are typed, and a `money` widget also fits a string DTO property.
- Calendars are always six rows, the column menu scrolls inside the window, a field's `warnIf` no longer remounts its input (the input lost its focus after the first letter), and native controls follow the dark theme (`color-scheme`).
- In Persian, the server's own texts are translated by the UI, class-validator's default messages included («must not be greater than 5»), without the property's name. English shows them exactly as sent, and a host's own words are never touched. A field the form does not show gives its message without its name.

New: `@AdminResource({ creatable: false })` (no «New», a create is refused, records can still be edited), `{ inline, existingOnly: true }` (rows only on an existing parent), `form.afterCreate: 'edit'` (saving a new record opens it), and `afterInlines(record, dto, ctx)` on a resource (a rule about a record and its rows, after both are written, inside the transaction).

## Upgrading to 0.10.2

Nothing to change. New: `builtinAuth({ issuerImage })`, an http(s) URL of your logo, sent as `image=` in the two-factor QR code. Only some authenticator apps read it; others, Ente Auth among them, show their own icons, matched on `issuer`. A value that is not an absolute http(s) URL fails at boot.

## Upgrading to 0.9.1

Nothing to change. New: `@AdminAction({ choices })` (see Actions): an input field whose dropdown a resource method fills when the dialog opens, re-checked when the action runs. Every dropdown in the dashboard (forms, filters, sort, page size, inline cell edits, language, roles, audit, debugger, the editor's heading level) is now the dashboard's own list, styled like the rest and right to left in Persian, instead of the browser's native `<select>`. Tests that drove a native select (`selectOption`) click the field, then the option (`getByRole('option', { name })`).

## Upgrading to 0.9.0

The contracts between the admin and your code are now enforced: the decorators' types refuse a method or class of the wrong shape at compile time, and the admin refuses a wrong value at run time (a 500 with `nest-my-admin: …` in the log, or a boot error) instead of reading it as something else. Code that already followed the docs keeps working; code that compiled only through `any` or plain JavaScript may now fail. What to check:

- **Resource classes.** `@AdminResource(Entity)` needs a class that extends `AdminResourceBase<Entity>`, and `@AdminSource(Row)` one that extends `AdminSourceBase<Row>` (compile errors now, as well as the boot errors before).
- **Actions.** A method returns nothing or `{ message }` (`ActionOutcome`), sync or async. Anything else (the record, a string, `{ mesage }`) fails the run and its writes are rolled back. The first parameter of a record action is one of the resource's rows (typed: `extend(inst: Instance, …)` on an `AdminResourceBase<Instance>`). The next parameter is the input: give it the type of `input`, or leave `input` out and the parameter's class becomes the form. `input` that is not the parameter's class (or a parent of it), and a record parameter of another class, fail at boot. `label.for` returns a text or `null`, never a Promise.
- **Parameter types need `emitDecoratorMetadata`** (as Nest's own injection does; tsc, SWC and Bun emit it, esbuild, Vite and tsx do not). Without it, an action whose method takes an input parameter and sets no `input` fails at boot: set `input: SomeDto`, or `input: false` for an action that takes none.
- **`@AdminScope`** returns a column map or a callback at once, never a Promise: an async scope used to mean «no restriction»; now it is an error.
- **`@AdminCan`** returns `true` or `false` at once. A Promise or another value is an error (a rule that throws still means «no», with a warning).
- **`@AdminPrint`** returns `` html`…` `` (or a Promise of it). A plain string is refused: it was not escaped.
- **`readonlyIf`** returns a boolean, and `readonlyFields()` an array of names.
- **`findMany`** of a resource, a source or an inline child returns `{ items, total }` (`total` may be left out); an array is refused.
- **Computed columns:** `compute()` returns an object of values by id, and a badge's `map()` a `{ label, tone }` with a known tone.
- **Widgets** return the data of their `type` (a stat's `value` is text); `@AdminWidget` needs a class with `load()` and `@AdminSettingsPage` one with `load()` and `save()`.
- **Hooks:** `@BeforeSave`/`@AfterSave` take `(dto | entity, ctx, mode: 'create' | 'update')`, `@BeforeDelete` `(entity, ctx, mode: 'soft' | 'hard')`, and return nothing: a hook that returns a value (`return dto` in a `@BeforeSave` that meant to change it) is a compile error and fails the save. Change `dto` in place.
- **Resource methods:** `query()` returns the query builder it was given, at once (an `async query()` is an error); a list tab's `where(qb, ctx)` adds to `qb` at once; `relationOptions()` returns the query builder (or a Promise of it); `findOne()` a record or `null`; `create()`/`update()`/`restore()` the record or nothing (then it is reloaded); `links()` an array of `{ label, href }` (a link that is not http(s) or relative is still left out, now with a warning).
- **Module options and adapters:** `resolveRoles` (option or adapter) returns an array of role names (a string used to be read letter by letter); a thrown error still means «no roles». `authenticate()` returns `{ user }` or `null`; `getUser()` a user or `null`; a global scope's `appliesTo()` a boolean; `translate` a string or `undefined` at once (an async `translate` used to show the declared texts silently; a throw still falls back). An `errorMapper` that returns something other than an `AdminError` or `undefined` is logged as an error. `files.storage.publicUrl()` returns a URL or `undefined` at once, and `get()` `{ body, contentType, size }` or `null`.
- **What the types cannot see:** two DTO classes with the same properties are the same type to TypeScript; the boot check (with the parameter types) tells them apart.

New types: `ActionReturn` (what an action may return), `Awaitable<T>`, `RowOf<P>`, `TypedMethodDecorator<M>` and `TypedClassDecorator<I>` (for your own wrappers around the decorators).

## Upgrading to 0.8.1

Nothing to change. New: with `appearance` on, whoever holds `appearance.manage` uploads the **logo** (sidebar and sign-in page) and the **tab icon** (favicon) from the account menu, for everyone (PNG, JPEG, GIF, WebP, ICO or SVG, up to 512 KB; stored in `nma_setting`, served at `<path>/appearance/logo` and `/appearance/favicon`). An uploaded logo wins over `branding.logo`. Without a logo the sidebar shows the admin's own mark instead of the first letter of the title, and it is the default tab icon.

## Upgrading to 0.8.0

Nothing to change. New: [source resources](#source-resources): `@AdminSource(RowClass, …)` and `AdminSourceBase` give rows that are not database rows (an HTTP API, files, live state) the list, record page, forms and actions of a table; `inMemoryList` searches, filters, sorts and pages rows fetched whole.

## Upgrading to 0.7.4

Nothing to change. New: `@AdminField({ default })` starts action input forms and create forms at a value (checked at boot to fit the field), and `@AdminField({ fillFrom: '{crm}.example.com' })` fills a text field from other fields of the same form until someone types in it, in action dialogs too (see Field config).

## Upgrading to 0.7.3

Nothing to change. Smaller packages: `@nest-my-admin/core`, `/auth` and `/testing` no longer ship source maps (they pointed at sources the packages do not include), so core is about 1.2 MB instead of 1.9 MB; core no longer asks for `rxjs` and `@nest-my-admin/testing` no longer asks for `@nestjs/core`, neither of which they import.

## Upgrading to 0.7.2

Nothing to change. Fixed: 0.7 typed the context of `AdminSettingsSource.save` as `AdminWriteContext`, so code that calls a page's `save()` with an `AdminContext` stopped compiling; it takes an `AdminContext` again. Your own `save` may still declare `ctx: AdminWriteContext` to use `ctx.manager` without `!`.

## Upgrading to 0.7.1

Nothing to change. New: install `nest-my-admin` alone and import `nest-my-admin/auth` and `nest-my-admin/testing` (see the top of this page). To move to it, replace `@nest-my-admin/core`, `@nest-my-admin/auth` and `@nest-my-admin/testing` in your dependencies with `nest-my-admin`, keep `@nestjs/testing` among your dev dependencies, and change the imports (`@nest-my-admin/core` → `nest-my-admin`, `@nest-my-admin/auth` → `nest-my-admin/auth`, `@nest-my-admin/testing` → `nest-my-admin/testing`). `@nest-my-admin/testing` now marks `@nestjs/testing` an optional peer.

## Upgrading to 0.7

Nothing needs changing in an app on 0.6, except two type-only cases:

- an override that returns `super.relationOptions(...)` under an explicit `: SelectQueryBuilder<any>` return type: drop the annotation (`relationOptions` may now be async);
- code that names `AdminMenuSection['items']` as a type: wrap it in `NonNullable<…>` (a `{ group }` section's items are optional);
- code that reads `item.resource` or `item.page` of its own menu items as a string: they may now be classes too (`string | Function`), so narrow with `typeof item.resource === 'string'`.

New:

- `translate` (Languages, theme and branding): your own i18n for every text you declare and for the UI's own texts, by key; UI languages the admin does not ship.
- `readonlyFields(record, ctx)` and `this.updateFields` (Fields and forms): lock a record's fields from one place.
- `AdminWriteContext` and `AdminResourceBase<T, Id>` (Transactions, context and errors); with `transactions: false` writes now get the DataSource's own `ctx.manager`.
- `relationOptions` may be async, and relation ids in its `values` (and `values._parent`) have the key's type.
- `@AdminCan('create')` on an inline child (Inlines): whether rows may be added under a parent; `_perm.inlines` on the parent's records.
- Menu sections from groups (`{ group: 'settings' }`) and menu items by class (The menu).
- Layout nodes and aside cards take an optional `key`, for `translate`.

## Upgrading to 0.4

0.4 gives the admin a new look (the owner-admin design) and the features a shop owner's panel needs. All five packages are 0.4.0; upgrade them together. Every new feature is an option: an app that sets none of them gets the new look and today's behaviour, except for the points under "What a 0.3 app will notice".

**What a 0.3 app will notice**

- **The look.** New design tokens: the Vazirmatn font for every language (bundled), 12px cards, pill badges, a 256px sidebar with sections, a floating save bar with ⌘S, filter chips over lists, cards on phones. The default accent is `#5B5BD6`; to keep the old neutral one, set it back: `branding: { primaryColor: 'oklch(0.205 0 0)' }`.
- **Persian digits by default in `fa`** (۱۲۳ and ٬ thousands separators). People switch back to Latin digits in their account menu (Display); the choice is kept per browser.
- **Inline children leave navigation.** A resource another resource edits inline (`{ inline: ChildAdmin }`) is no longer in the sidebar, home, group pages, palette or global search; it keeps its URLs, permissions, history and audit entries. To keep it listed: `@AdminResource(Child, { nav: true })`.
- **Contract changes** for code that reads the JSON API itself: `FieldSchema.currency` is `{ unit, position }` (a `currency: 'USD'` option still works), and a record's `_perm.actions` maps each record action to its label on that record, or `false` where it may not run (it was a list of names).
- **The e2e/screenshot baselines of your own app**, if you keep any, change with the look.

**New options**

- **Currency**: `forRoot({ currency: { unit: { en: 'Toman', fa: 'تومان' } } })` labels every `money` field without a unit of its own; a field's `currency` (a code, or `{ unit, position }`) wins.
- **A curated menu**: `forRoot({ menu: { sections: [{ key: 'sales', label: { fa: 'فروش' }, icon: 'shopping-cart', items: [{ resource: 'order', badge: { 'filter[status][eq]': 'paid' } }, { page: 'shop' }, { href: 'https://shop.example', label: 'Shop' }] }] } })`. Sections replace module groups in the sidebar, home, group pages, breadcrumbs and the palette; everything not placed goes into «Advanced», collapsed. Badges are counted for each user through the list's scoped count (`GET /api/menu/badges`, refreshed every minute).
- **`nav: false`** on `@AdminResource` takes any resource out of navigation.
- **Computed list columns**: `list.computed: { picture: { label, kind: 'image', source: { first: 'media', field: 'image', by: 'sort' } }, stock: { label, kind: 'badge', source: 'stock', map: (value, row) => ({ label, tone }) }, variants: { label, kind: 'count', source: { aggregate: 'count', relation: 'variants' }, sortable: true }, active: { label, kind: 'toggle', source: { toggle: 'status', on: 'active', off: 'archived' } } }`, named in `list.columns`. Kinds: image, title (with `subline`), money (with `previous`), badge, count, toggle; sources: a field or path, an aggregate or first row of a one-to-many relation (only the rows the viewer sees), an enum toggle, or `{ compute: (rows, ctx) => …, fields }` called once per page. A column reading something the viewer cannot see is cut.
- **List tabs**: `list.tabs: [{ key: 'all', label }, { key: 'active', label, filter: { 'filter[status][eq]': 'active' } }, { key: 'out', label, where: (qb) => qb.andWhere(qb.alias + '.stock = 0') }]` (at most six), counted per user (`GET /api/resources/:r/tab-counts`).
- **Primary record actions with per-record labels**: `@AdminAction({ primary: true, label: { static: 'Next step', for: (order) => (order.status === 'draft' ? 'Mark paid' : null) } })`: a filled button last in the record's header; `null` hides it on that record (and a run is refused).
- **The record page**: `form.layout: { main: [...sections], aside: [{ title, fields: ['status', 'total'] }, { title, fields: { relation: 'customerId', fields: ['phone'] }, link: true }] }`, `form.mode: 'view'` (opens as text until «Edit»), `form.header: { badges, subtitle: ['customer', { computed: 'items' }], stepper: 'fulfillment' }`.
- **Inline presentation**: an inline's `readonly`, `computed` (child computed columns as table columns) and `cards: { markFirst }`; a `{ summary: [{ label, value: 'total' | { computed } }] }` layout node; a field's `warnIf: { empty: true, message }` (a soft warning that never blocks a save).
- **A stepper**: `fields: { fulfillment: { widget: 'stepper', exclude: ['cancelled'], history: { inline: StatusLogAdmin, value: 'value', at: 'at', where: { field: 'fulfillment' } } } }` shows an ordered enum as steps with the time each was reached.
- **The accent colour, in the admin**: `forRoot({ appearance: {} })` (add `ADMIN_SETTING_ENTITIES` to the DataSource) lets people with `appearance.manage` set the accent for everyone (account menu → Display → «Use for everyone»); everyone may pick their own, kept in their browser. Order: their own, the admin-wide one, `branding.primaryColor`.
- **A dashboard**: `@AdminWidget('sales', { type: 'stat' | 'chart' | 'table' | 'progress' | 'list', title, order, size, permission })` providers with `load(params, ctx)`; the period (today, week, month, year, a range; Jalali-aware) is computed by the UI and checked by the server. Codes `dashboard.<name>` (or the widget's `permission`); `dashboard.*` grants every widget. With a widget to show, the dashboard replaces the home page.
- **`@nest-my-admin/testing`**: `expectNoLeaks` also crawls menu badges, tab counts, computed cells and the dashboard.

Still missing (planned): printing a record (an invoice, a shipping label) and exporting a list to Excel.

## Upgrading to 0.3.2

Nothing to change in an app on 0.3.1. New: `@AdminResource(Entity, { readonly: true })` for records only your own code writes (logs, orders, snapshots): the admin offers no New, Save, Delete, editable cell or inline add and remove, and its API answers 403 to every write, whatever the roles say; the resource's `@AdminAction`s still run with their usual permissions. The schema says `readonly: true`. Before, the way to get this was to throw from `create`/`update`/`delete`, and a superuser still saw the buttons.

## Upgrading to 0.3.1

A fix, nothing to change in an app on 0.3.0. A property of a create DTO that is not a column (a value your `create()` uses, such as the price of a first variant) is no longer shown on the edit form as an empty read-only field; a create-only column (a number fixed once saved) still is. `form.readonly` in the schema changes accordingly.

## Upgrading to 0.3.0

Nothing in 0.3.0 breaks an app that runs on 0.2.1: no option or export was removed or changed, no table or stored key changed, and a resource without inlines answers exactly as before (responses only gain fields). All five packages are 0.3.0; upgrade them together, as before.

**New**

- **Inlines**: child resources edited in the parent's form and saved with it in one transaction. See [Inlines](#inlines).
- **`AdminFiles.register()` and `release()`**: files a host stored itself become files of a record's field. See "Registering files yourself" under [Files](#files-images-and-rich-text).
- **A key column named `id` without a label is "شناسه" in Persian** (still "Id" in English).

**What a 0.2.1 app may notice**

- `relationOptions(field, qb, ctx, values)`: a key named `_parent` in `values` now has a meaning when the picker belongs to an inline (`?parent=` on the options route); without `?parent=` it is passed through as before.
- The UI's lists, sidebar and header: the sidebar and the header stay in place while the page scrolls, and in right-to-left languages table headers start on the right like their cells.

## Upgrading to 0.2.1

Nothing in 0.2.1 breaks an app that runs on 0.2.0: no option or export was removed or changed, no table or stored key changed, and permissions decide as before. All five packages (`@nest-my-admin/core`, `ui`, `auth`, `testing` and `nest-my-admin`) are 0.2.1. Upgrade them together: `@nest-my-admin/auth` and `@nest-my-admin/testing` peer on the exact core version (0.2.1 of either does not install next to core 0.2.0), and core brings the UI of its own version.

**New**

- **`@AdminGroup` by key, for any members.** A module's `@AdminGroup` now configures the group of its key whoever the members are, also when they are only settings pages that say `group: '<key>'`, and also when the module provides nothing. See [Sidebar groups and order](#sidebar-groups-and-order).
- **`order`** on `@AdminResource` and `@AdminSettingsPage`: the place inside the group (lower first, default 100, then by label).
- **`AdminFiles`** (`publicFile(key)`, `openPublic(key)`): which keys are public files, for a host that serves them itself. See "Serving public files yourself" under [Files](#files-images-and-rich-text).
- **The page is in the admin's language**: `GET <path>/` answers `<html lang dir>`, `<title>` and `Content-Language` for the default `locale` and your `title`.
- **Documented:** the storage key of a settings page's file, `page/<name>/<field>/<yyyy>/<mm>/<uuid><ext>` (unchanged; it was only in the source).

**What a 0.2.0 app may notice**

- **A sidebar group can change its label, icon and place.** In 0.2.0 an `@AdminGroup` was read only when its module provided a resource, or a page without `group`. A group reached only through `group: '<key>'` therefore showed the key as its label ("Settings"), with no icon and order 100, even though a module carried `@AdminGroup({ key: '<key>', … })` (or was named like the key and carried `@AdminGroup` without a `key`). In 0.2.1 that module's label, icon and order apply. Group keys, URLs (`/g/<key>`) and permissions are unchanged. If you worked around it by leaving `group` off some pages, both spellings now give the same group.
  - A module that carries `@AdminGroup` now also wins over a module without the decorator whose name gives the same key, whichever is imported first (in 0.2.0, the one whose resource was registered first).
  - Two modules that configure one key differently: the first in import order wins (in 0.2.0, the first that had a resource or a page registered, which is nearly always the same), and 0.2.1 logs a warning at boot that names both.
- **The served HTML.** `GET <path>/` used to answer `<html lang="en" dir="ltr">` and `<title>Admin</title>` whatever the admin's language. It now answers with the default `locale` (`lang`, `dir`, `Content-Language`) and your `title` in it. The page is still one page for every request (it does not vary by `Accept-Language`, and there is no `Vary` header), and `Cache-Control` is still `no-cache`. An admin with `locale: 'en'` and no `title` gets byte-for-byte what it got before, plus `Content-Language: en`. The UI behaves as before once it runs. If you serve your own UI build (`uiDistPath`), the `lang` and `dir` of its `<html>` and the `<title>` of its `<head>` are replaced the same way.
- **Boot fails for `order` that is not a finite number** on a resource or a settings page. TypeScript did not accept the option in 0.2.0, so only untyped code that already passed one can be hit.

## Upgrading to 0.2

**Boot can now fail.** Each of these stops the app at start, with a message that names the class:

- An app that ran on 0.1 can be hit by one of them without using anything new: `widget: 'password'` (and the new `sensitive` and `secret`) on a property inside a group, that is a nested DTO or an embedded entity. Nothing applied those options there. Move the field to the top level.
- The others come with the features of 0.2, as you adopt them:
  - a settings page whose name is reserved (`view`, `create`, `update`, `delete`, `purge`, `field`, `action`), a resource's name, or a custom permission of a resource (`order.export` and a page named `export`); a `permissions` entry that is a page's code (`page.<name>`, `page.<name>.update`); a resource named `page`, or whose name starts with `page:`, in an admin that has settings pages;
  - an action's input DTO with a `file`, `image` or `richtext` widget;
  - `atomic` on an action without `bulk: true`, on a resource action, or with `transactions: false`;
  - an action method named like a built-in operation (`view`, `create`, `update`, `delete`, `restore`, `purge`) or like a method of `AdminResourceBase`;
  - `@AdminCan('<name>')` whose name is not `update`, `delete` or a record action of that resource (a typo, or the name of a resource action);
  - `files` without `ADMIN_FILE_ENTITIES`, or `audit` without `ADMIN_AUDIT_ENTITIES`, in the entities of the DataSource they name.

**Behaviour that changed**

- **Core and UI go together.** `@nest-my-admin/ui` 0.2.0 is installed with `@nest-my-admin/core` 0.2.0; if you pin or override either, keep both on 0.2.0. `GET /api/session` now always carries `audit: { enabled, view }` (`SessionResponse.audit`), which the 0.2 UI reads.
- **A 401 thrown by your code inside a write or a settings page's `load()` is answered as 400** with your message. The UI reads every 401 as "signed out"; the admin's own 401 is unchanged.
- **Deleting a record releases its files only when the row is really gone** (read again inside the write). A `delete()` override that keeps the row keeps the files; a purge always releases them. A row that goes where the write cannot see it (MySQL and a service that ignores `ctx.manager`, or a delete queued for later) leaves its files as orphans. See [Files, images and rich text](#files-images-and-rich-text).
- **With `audit` on:**
  - every admin write reads the stored row before and after your method, and inserts one row into `nma_audit` in the same transaction. If that insert fails, the write fails (500);
  - entry ids are 32-bit integers on Postgres and MySQL (2.1 billion entries); set `retentionDays` on a busy admin;
  - a purge always closes the record's history, even when your `purge()` keeps the row;
  - **not in the log:** changes made outside the admin, changes to `select: false` columns, and, on MySQL, a relation changed by a service that ignores `ctx.manager`;
  - **whatever is typed into the username box of a failed sign-in is stored** as typed, cut to 200 characters: a password typed there by mistake ends up in the log. Failed sign-ins are capped per address and username, per address, and per process.
