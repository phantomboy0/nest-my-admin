# nest-my-admin

A Django-admin-class admin panel for **NestJS + TypeORM**: declarative resources, forms from your DTOs,
admin writes that go through your own services, and a prebuilt shadcn UI served by Nest itself.

> Status: pre-alpha (M3 in progress: sign-in done, permissions next). APIs will change.

Requires NestJS 11 or 12, TypeORM 0.3.20+ or 1.x, Node 20.19+ (or Bun), and Postgres, MySQL 8 or SQLite.
The package is ESM; CommonJS apps load it through Node's `require(esm)`. A CommonJS app compiled with
`"module": "nodenext"` (the `nest new` default since Nest 11) needs TypeScript 5.8+; with `"module": "commonjs"` any 5.x works.

```ts
@AdminResource(Product, { icon: 'package' })
export class ProductAdmin extends AdminResourceBase<Product> {
  constructor(private readonly products: ProductsService) { super(); }
  list: ListConfig<Product> = { columns: ['id', 'name', 'sku', 'price'] };
  form: FormConfig = { create: CreateProductDto, update: UpdateProductDto };
  create(dto: CreateProductDto) { return this.products.create(dto); }   // your business rules run
}

@AdminGroup({ label: 'Catalog' })
@Module({ providers: [ProductsService, ProductAdmin] })
export class CatalogModule {}

@Module({ imports: [TypeOrmModule.forRoot({ ... }), AdminModule.forRoot({ title: 'My shop' }), CatalogModule] })
export class AppModule {}
```

Open `http://localhost:3000/admin`.

Lists support filters and search with a URL syntax you can bookmark:

```
/admin/api/resources/product?search=lamp&filter[status][eq]=active&filter[price][between]=10,20&sort=-price
```

Operators: `eq ne in nin lt lte gt gte between contains startsWith isNull`. Choose filterable and searchable
fields with `list: { filters: [...], search: [...] }`; hooks (`@BeforeSave`, `@AfterSave`, `@BeforeDelete`) run
in the default create/update/delete, and `AdminModule.forRoot({ autoRegister: true })` exposes every entity
without a resource. `ne` and `nin` exclude NULLs (SQL semantics), and datetime filter values must be ISO-8601
with a time zone.

### Customising lists

Put row restrictions in `query(qb, ctx)`. It applies to every read path: the list, GET, PATCH, DELETE, restore and
purge by id, and the pickers of relations that point at the resource (including the check of ids sent to them).
Always use `qb.alias`, because the alias differs from one path to another:

```ts
query(qb: SelectQueryBuilder<Order>, ctx: AdminContext) {
  return qb.andWhere(`${qb.alias}.archived = false`);
}
```

For joins or aggregates, override `findMany` and start from `this.buildListQuery(params, ctx)`. It already applies
`query()`, filters, search, sort and paging (keyset included).

### The list page

- **Filters.**
  - Enum filters are multi-selects (`in`), and nullable fields add an empty or not-empty choice.
  - Active filters show as chips. Removing one chip removes only that filter.
  - Filters live in the URL, so a shared link shows the same list.
- **Columns.** "Columns" shows, hides and reorders columns and switches density. Header edges resize columns (arrow
  keys work too). The layout is remembered per resource in the browser.
- **Selection.** Select rows, then "Delete selected". It calls
  `POST …/bulk-delete { ids }` → `{ ok, failed: [{ id, code, message }] }`, and each record is deleted on its own
  (hooks, `query()` and trash apply), so one refusal does not stop the others.
- **Quick view.** A row click (or Enter on a focused row) opens a side sheet with the record, with Edit and Close.
  The first column still links straight to the edit page.
- **Editing in cells.** Fields listed in `list.editable` are edited in their cell. They must be in the update form
  and be text, number, decimal, bigint, boolean, enum or date fields. Each save is a normal PATCH (DTO, relation checks,
  `If-Match`), and a refused change shows its reason under the cell:

```ts
list: ListConfig<Product> = { columns: ['name', 'status', 'stock'], editable: ['status', 'stock'] };
```

### Lists at scale

- **`list.count`:**
  - `'exact'` is the default.
  - `'estimate'` answers with the query planner's row estimate on Postgres and MySQL, marked `estimated: true`, and
    shown as "about 12,000". It counts exactly below 1000 rows and on other drivers.
  - `'none'` does not count and only says `hasMore`.
- **`list.pagination: 'keyset'`** pages with a cursor (`?after=`, from `nextCursor`), which stays fast deep into big
  tables:
  - it sorts only by non-nullable columns;
  - it counts nothing unless `count` asks;
  - the UI shows Previous/Next.
- **Several DataSources:**
  - `@AdminResource(Report, { dataSource: 'reports' })` reads and writes, transactions included, through that
    DataSource.
  - `autoRegister: ['default', 'reports']` covers several DataSources. A taken name gets the DataSource as a prefix
    (`reports-widget`).
- **Related lists.** When another resource has a relation field pointing at this one, the edit page links to that
  resource's list, filtered by the record (a customer's orders). The filter is added to the other resource for it.
- **Relations by title.** A to-one relation whose target is titled by a column sorts by that column (`sort=customer`
  sorts by customer name).
- **Lazy relations** (`{ lazy: true }`) are fields like the others.
- **Dependent options.** `relationOptions(field, qb, ctx, values)` gets the record's values as the user sees them, so
  one field's options can depend on another:
  - in the picker, the form's current values;
  - on create, the body;
  - on update, the stored record with the body on top.

### Relations and record titles

Many-to-one, owning one-to-one and owning many-to-many relations are fields:

- **Field names.** A to-one relation's field is named like the property that holds the id: `customer`, or
  `customerId` when the entity declares `@Column() customerId` next to `@JoinColumn({ name: 'customerId' }) customer`.
  A many-to-many field is named like the relation (`tags`). Name DTO properties the same way.
- **Values.** Reads return `{ id, title }` (or `null`) for to-one relations and `[{ id, title }]` for many-to-many.
  Writes send the id (or `null`) and an array of ids. Every id is checked before your `create`/`update` runs: a
  missing record is a 422 on that field. The default `create`/`update` save the ids as references; your own
  overrides receive the ids as sent.
- **Paths.** `list.columns`, `filters`, `search` and `sort` accept paths through to-one relations, such as
  `'customer.name'` or `'customer.company.name'` (up to 3 segments, checked at boot). The relations are joined
  automatically as `entity_customer`, `entity_customer_company`, … (you can use these aliases in `buildListQuery`
  extensions). Relation values are loaded after `findMany`/`findOne` with a fixed number of queries, so your finder
  overrides do not need to join them.
- **Filters.** `filter[customer][eq]=3` (also `ne`, `in`, `nin`, and `isNull` when nullable), and
  `filter[tags][in]=1,2`, which matches records that have any of those ids.
- **Titles.** `@AdminResource(Customer, { title: 'name' })` or `title: (c) => \`${c.first} ${c.last}\``. Titles show
  in pickers, relation cells and headers, and as `_title` on every record. Without one, the first string column
  named `name`, `title`, `label`, `displayName`, `fullName`, `username`, `email`, `code` or `sku` is used; else `#<id>`.
- **Picker options.** `relationOptions(field, qb, ctx, values)` restricts what a relation field may point to, both in the
  picker (`GET …/fields/:field/options`) and on writes. `qb` selects the target as `option`:

```ts
relationOptions(field: string, qb: SelectQueryBuilder<any>, ctx: AdminContext, values: Record<string, unknown>) {
  return field === 'customer' ? qb.andWhere('option.active = true') : qb;
}
```

### Entity shapes

- **Record ids.** Every record carries `_id`, the id used in URLs: key values in primary-key order, joined by `,`,
  with `~` written `~0` and `,` written `~1`. Composite primary keys work this way; their `findOne`, `update` and
  `delete` receive `{ key: value, … }`, and single-key resources keep receiving the plain value.
- **Embedded columns** (`@Column(() => Address) address`) are a group of fields in the form. Records nest them
  (`address: { city, zip }`), and paths such as `'address.city'` work in `list.columns`, filters, search and sort. A
  PATCH may send part of a group (`{ address: { zip } }`).
- **Nested DTOs** (`@ValidateNested() @Type(() => AddressDto) address`) make sub-forms, and
  `@IsArray() @ValidateNested({ each: true }) @Type(() => LineDto) lines` makes a list of sub-forms, for example over
  a `simple-json` column. Field errors use dotted paths (`address.city`, `lines.1.qty`).
- **Single-table inheritance**: each `@ChildEntity` gets its own resource (autoRegister included), which creates rows
  of its kind and lists only those. The root resource lists every row with a read-only discriminator and does not
  create.
- **`@VersionColumn`**: the form sends `If-Match: "<version>"` with PATCH and DELETE. If someone saved the record in
  between, the answer is 409 with `current` (the record as it is now), and the form offers "Keep my changes" or "Load
  theirs". The check runs in the write transaction, holding a row lock on Postgres and MySQL, before your `update`.
- **`@DeleteDateColumn`**: DELETE moves the record to the trash (the default `delete` soft-deletes; a service
  override should call `softRemove`). `?trashed=only|with` lists the trash, `POST …/:id/restore` restores a record
  (the resource's `restore`), and `DELETE …/:id?purge=true` removes it for good (`purge`). `@BeforeDelete` hooks get
  `'soft'` or `'hard'`.
- **CHECK constraint** violations are a 422 on the columns the check's expression names. TypeORM does not create
  checks on MySQL.

### Languages, theme and branding

```ts
AdminModule.forRoot({
  title: { en: 'Demo shop', fa: 'فروشگاه نمونه' },
  locale: 'en',             // default language
  locales: ['en', 'fa'],    // the UI ships English and Persian; Persian is right-to-left
  branding: { name: { en: 'Shop', fa: 'فروشگاه' }, logo: '/static/logo.svg', primaryColor: '#0f766e', radius: '0.5rem' },
});
@AdminGroup({ label: { en: 'Sales', fa: 'فروش' }, icon: 'cart' })
@AdminResource(Order, { label: { en: 'Orders', fa: 'سفارش‌ها' }, icon: 'receipt' })
```

- **Languages.**
  - The language switch appears when there is more than one locale, and the choice is remembered in the browser.
  - The UI sends it as `Accept-Language`. Labels given per language answer in it, falling back to the default
    locale.
  - Resources and hooks see it as `ctx.locale`.
  - Field labels, help, placeholders and enum value labels take the same `{ en, fa }` form (see Fields and forms).
- **Branding.**
  - `primaryColor` may be hex, `rgb()`, `hsl()` or `oklch()`, and `radius` a length. Text on the primary colour is
    chosen from its lightness.
  - `logo` must be an http(s) URL or a relative path.
  - Anything else fails at boot, so no value can inject CSS.
- **Theme.** Light, dark or system, from the header. It is applied before the page renders, so nothing flashes.
- **Icons** for groups and resources: bell, book, box, boxes, briefcase, building, calendar, cart, chart, clock, credit-card, database, dollar, file, file-text, folder, globe, heart, history, home, image, inbox, key, layers, link, list, lock, mail, map, map-pin, message, package, phone, printer, receipt, server, settings, shield, shopping-bag, shopping-cart, star, store, tag, tags, ticket, truck, user, users, video, wallet, wrench, zap.

### Persian, dates and phones

- **Search in Persian.**
  - `search`, the `contains`/`startsWith` filters and relation pickers treat Arabic ي/ى and Persian ی as one letter, and likewise ك and ک.
  - Persian, Arabic-Indic and Latin digits match each other, and a zero-width non-joiner matches a space. `کتاب ۱۲` finds `كتاب 12`.
  - This works on sql.js, Postgres and MySQL, and Latin searches keep a plain `LIKE`.
- **Digits.** Number, decimal, bigint, date and datetime inputs and filters accept every digit set. Values on the wire always use Latin digits.
- **Calendar and digits** are per browser, from the header's Display settings:
  - calendar: Gregorian, or Jalali (the default in Persian);
  - digits: Latin, or Persian for display.
  - `date` values are shown without time zone shifts; datetimes are shown in the browser's time zone.
- **Jalali dates.**
  - Date inputs take `1403/01/15` in any digits, next to a calendar with day, month and year views. The calendar supports the keyboard: arrows, PageUp/PageDown, and Shift for years.
  - Date and datetime filter ranges use the same input. A Jalali datetime range covers whole local days, sent as UTC instants.
- **Phones.**
  - Lists become cards with infinite scroll. With `list.mobile: { title, subtitle, badge, meta: [...] }` (fields or paths, checked at boot) cards show those; without it they show the title and the columns.
  - Filters and sort open in a bottom drawer, and **Select** turns on checkboxes for bulk delete.
  - `?pageSize=` in the URL sets the page size.
- **Command palette.**
  - ⌘K / Ctrl+K (or the header's search button) goes to resources and groups, opens "New …" forms, and finds records.
  - Records come from `GET /api/search?q=&limit=`: up to `limit` (default 5) per resource with `list.search`, through each resource's `findMany`, so `query()` restrictions apply. A resource whose search fails is left out and logged.

### Fields and forms

```ts
@AdminResource(Product)
export class ProductAdmin extends AdminResourceBase<Product> {
  fields: FieldsConfig<Product> = {
    price: { widget: 'money', currency: 'USD', readonlyIf: (p) => p.status === 'archived' },
    status: {
      widget: 'badge',
      colors: { draft: 'amber', active: 'green', archived: 'gray' },
      enumLabels: { draft: { en: 'Draft', fa: 'پیش‌نویس' }, active: 'Active', archived: 'Archived' },
    },
    slug: { widget: 'slug', slugFrom: 'name', help: { en: 'The address in the shop.', fa: 'نشانی در فروشگاه.' } },
    releasedOn: { showIf: { status: ['active', 'archived'] } },
    sku: { readonly: true },
  };
  form: FormConfig = {
    create: CreateProductDto,
    update: UpdateProductDto,
    layout: [
      { tab: 'General', sections: [{ section: 'Details', fields: ['name', 'slug', 'status', 'releasedOn'], columns: 2 }] },
      { tab: 'Catalog', sections: [{ fields: ['categoryId', 'tags'] }] },
    ],
  };
  links(product: Product) {
    return [{ label: { en: 'View in shop', fa: 'در فروشگاه' }, href: `https://shop.example/p/${product.slug}` }];
  }
}
```

- **Where options come from.** Options merge in this order, later ones winning option by option:
  1. `@AdminField({ … })` on the entity property;
  2. `@AdminField` on the create DTO, then on the update DTO;
  3. the resource's `fields`.
- **Options.**
  - Texts: `label`, `help` (shown under the input, and linked to it for screen readers), `placeholder`, `enumLabels`. The values sent stay the raw enum values.
  - `widget`: text, textarea, number, money, switch, checkbox, select, radio, date, datetime, json, color, badge, slug, password, email or url.
    - Without one, the widget follows the type and format.
    - A widget that does not fit the type (`money` on a boolean) fails at boot.
  - `colors` for badges: gray, red, amber, green, blue, purple or pink.
  - `currency` for money: display only. Money is grouped as you leave the input, and the commas are dropped when saving.
- **Validation at boot.** Unknown fields, widgets and colours fail at boot with a did-you-mean hint, and so do `showIf`/`slugFrom` names and enum labels for values the column does not have.
- **Read-only fields.**
  - `readonly: true` shows the field on edit forms as text with a lock and removes it from `form.update`.
  - `readonlyIf(record)` runs on the server for every record. Records carry `_readonly` (the fields it locks), and a PATCH that sends a locked field is a 422 `{ field: ['is read-only'] }` before your `update` runs. That covers inline cell edits too.
  - A `readonlyIf` that throws locks its field and is logged once.
  - Create ignores it.
- **`showIf`** hides a field while other fields do not hold the given value (or one of the values), evaluated live in the browser. A hidden field is not sent and not checked. It is presentation, not a permission: the server keeps the stored value.
- **`slugFrom`** makes the slug widget fill itself from another field. It keeps the letters of every script and stops once someone types in it, or when it already holds a value.
- **Layout.**
  - `form.layout` has sections (a title, and 1–3 columns on wide screens, one on phones) and tabs.
  - Every name must be on a form and listed once. Fields left out go into a last section.
  - A tab with a field error is marked, and a refused save switches to it.
- **Detail header.**
  - The edit page title shows badge fields and `links(record)` (records carry them as `_links`).
  - Only http(s) and relative URLs are kept. They open in a new tab with `rel="noopener noreferrer"`.
- **Form keys.**
  - Leaving a form with unsaved changes asks first: an inline bar for in-app navigation, the browser's prompt for closing the tab.
  - ⌘S / Ctrl+S saves and stays on the record.
  - **Save & new** saves and opens an empty form.
  - **Duplicate** opens `/:resource/new?from=<id>`, prefilled without primary keys, unique columns and read-only fields.

## Transactions, context and errors

Every create, update and delete runs in one database transaction. Pass `ctx.manager` to your services so their writes
join it — a hook or service that throws afterwards rolls everything back:

```ts
create(dto: CreateProductDto, ctx: AdminContext) {
  return this.products.create(dto, ctx.manager); // service: manager ? manager.getRepository(Product) : this.products
}
```

Services that keep using their own injected repository still work, but on Postgres/MySQL they write outside the
transaction, on a separate pooled connection, and can block on the admin transaction's locks (writing the same row or
the same unique key blocks until the admin transaction ends on both drivers; inserting a row with a foreign key to the
just-created record blocks on MySQL and fails at once with a foreign-key conflict, 409 `CONFLICT`, on Postgres). Pass `ctx.manager`. `AdminContext.current()` returns the admin
request being handled (or `undefined` in your own controllers), so deep code can find it without a `ctx` parameter.
Turn transactions off with `forRoot({ transactions: false })`.

On SQLite-family drivers admin writes are serialized per DataSource (one connection); admin reads and other code on that
connection can see an open write's uncommitted rows. On Postgres, serialization or deadlock failures at COMMIT
(40001/40P01) surface as a 500 `INTERNAL` with no retry.

Translate your own exceptions with `forRoot({ errorMapper: (e) => e instanceof OutOfStock ? new AdminFieldError({ stock: 'out of stock' }) : undefined })`.
The mapper runs after the request's context has ended (`AdminContext.current()` is `undefined` inside it) and before the
built-in database-error mapping, so never put raw error messages (they may contain SQL) into a mapped response. Errors
from host middleware that carry a 4xx `status`, and body-parser errors, skip it. A mapped error with status 500 or more
is logged with the original stack and the correlation id.

Forms check your DTO rules (`@Length`, `@Min`/`@Max`, `@IsInt`, `@Matches`, `@IsEmail`, `@IsUrl`, `@IsUUID`, `@IsIn`) in the
browser before saving; the server still validates everything. PATCH bodies are always validated as partial (only the
sent fields), including dedicated update DTOs. A DTO property with a class initializer (`status = 'draft'`) is not
required, and a `@ValidateIf` property gets no browser rules at all. Column length (`varchar(n)`) is checked in the
browser even on SQLite, which does not enforce it.

## Sign-in

```ts
import { ADMIN_AUTH_ENTITIES, builtinAuth } from '@nest-my-admin/auth';

TypeOrmModule.forRoot({ /* … */ entities: [/* yours */, ...ADMIN_AUTH_ENTITIES] }),
AdminModule.forRoot({
  auth: builtinAuth({ bootstrapSuperuser: { username: 'admin', password: process.env.ADMIN_PASSWORD! } }),
}),
```

- **`@nest-my-admin/auth`** (built in).
  - Admin users live in `nma_user`, with scrypt password hashes (`node:crypto`, no native module).
  - Sessions live in `nma_session`, stored as the SHA-256 of an opaque token. The cookie `nma_session` is HttpOnly and SameSite=Lax, has Path set to the admin path, and is Secure on https (Express's `trust proxy` decides behind a proxy).
  - A session ends after 12 hours without a request or 30 days after sign-in.
  - Five wrong passwords lock an account for 15 minutes. Sign-in attempts are limited to 20 per minute per IP, with 429 and `Retry-After`.
  - Unknown users, wrong passwords and locked accounts get the same answer.
  - The account page changes the password (which signs out every other session), lists signed-in devices, and signs out one or all others.
  - **Two-factor sign-in** (TOTP, any authenticator app). A user turns it on from the account page by scanning a QR code and confirming a code, and gets 10 one-time recovery codes. After the password, sign-in answers 401 `TWO_FACTOR_REQUIRED` until the request also carries `otp` (a code or a recovery code). Each code works once, wrong codes count toward the lockout, and turning it on signs out every other session. Turning it off or issuing new recovery codes needs the password; an admin can reset a lost second factor from the Users page. Set `secretKey` (32 bytes, base64: `openssl rand -base64 32`) to encrypt the keys at rest with AES-256-GCM. `issuer` names the app in authenticators. Upgrading from 0.0.x adds four nullable columns to `nma_user` (`totpSecret`, `totpPending`, `totpLastStep`, `recoveryCodes`).
  - `bootstrapSuperuser` creates the first user when `nma_user` is empty (it runs in module init, so call `app.init()` before seeding other users). `createAdminUser(dataSource, { … })` adds more.
- **CSRF.** Every POST, PATCH and DELETE of a cookie session must send the session's token as `X-CSRF-Token` (the UI does). The API also accepts only `application/json` bodies.
- **Your own users:**
  - `auth: AdminAuth.custom(MyAdapter)` takes a provider of your app implementing `AdminAuthAdapter`.
  - `authenticate(req)` is required; `login`, `logout`, `listSessions`, `revokeSession`, `revokeOtherSessions`, `changePassword` and the two-factor methods (`twoFactorStatus`, `beginTwoFactor`, `confirmTwoFactor`, `disableTwoFactor`, optionally `newRecoveryCodes` and `resetTwoFactor`) are optional, and the UI shows only what exists.
  - Return a `csrfToken` from `authenticate` when you use cookies.
  - `ctx.user` and `AdminContext.current().user` carry the result into resource methods and your services.
- **No sign-in.** `AdminAuth.none()` makes everyone a superuser, for local tools. Without `auth` the admin behaves the same with a warning at boot, and **refuses to boot under `NODE_ENV=production`**.
- Every signed-in user who is not a superuser gets only what their roles grant (see Permissions).

## Permissions

```ts
AdminModule.forRoot({
  roles: [{
    name: 'catalog-editor',
    permissions: ['product.view', 'product.update', 'category.*', 'reports.run'],
    fields: { product: { price: 'readonly', cost: 'hidden' } },
    scopes: { product: { update: 'drafts' } },   // view / update / delete; none = every row
  }],
  resolveRoles: (user) => (user.username === 'editor' ? ['catalog-editor'] : []),
  permissions: ['reports.run'],                   // global custom codes
  globalScopes: [{ name: 'tenant', appliesTo: ({ metadata }) => !!metadata.findColumnWithPropertyName('tenantId'),
                   where: (ctx) => ({ tenantId: ctx.user?.attrs?.tenantId }) }],
});

@AdminResource(Order, { permissions: ['view_all'] })           // declares order.view_all
export class OrderAdmin extends AdminResourceBase<Order> {
  fields: FieldsConfig<Order> = { margin: { restricted: true } };  // hidden unless a role grants order.field.margin.view|edit
  @AdminScope('own') own(ctx: AdminContext) { return { ownerId: ctx.user?.id }; }  // or (where, alias) => where.where(...)
  @AdminCan('delete') onlyDrafts(order: Order) { return order.status === 'draft'; }
}
```

- **Codes:**
  - operations: `{r}.view`, `{r}.create`, `{r}.update`, `{r}.delete`, `{r}.purge`;
  - fields: `{r}.field.{f}.view` and `{r}.field.{f}.edit`;
  - custom codes, per resource or global.
  - Wildcards: `*`, `{r}.*`, `*.view`.
  - `update` implies `view`.
  - Anything unknown in a role (code, resource, field, scope) fails at boot with a suggestion.
- **Roles combine grant-only, the most permissive winning.**
  - Per field: `hidden < view < edit`. A field without a rule is editable for a role that may create or update.
  - Per operation, scopes are ORed, and a role without a scope means every row.
  - Superusers bypass everything but the global scopes that do not set `exemptSuperusers`.
  - Roles come from `resolveRoles` and the auth adapter's `resolveRoles`. A lookup that throws grants nothing.
- **Enforced on the server, at every endpoint:**
  - Meta lists only what you may view, and every other resource is 404.
  - Schemas are cut: hidden fields disappear, read-only ones move to `form.readonly`, and `permissions` says what you may do.
  - Filter, sort and search accept only visible fields (anti-oracle).
  - Records carry only visible fields. Relation titles of resources or rows you may not see become `#id`, and paths through them are null.
  - A write naming hidden or read-only fields is 403 `FORBIDDEN_FIELDS` with their names. A missing operation is 403 `FORBIDDEN`.
  - Records outside your scope are 404.
  - `_perm: { update, delete }` on each record combines permission, scope and `@AdminCan`, and PATCH/DELETE re-check it.
  - Scopes also restrict counts, global search, relation pickers and the ids a write may link to.
  - A resource that overrides `findMany`/`findOne` still cannot leak rows: the API re-checks with its own scoped query.
- **In your code:** `ctx.can('order.view_all')` and `ctx.permissions`.

### Roles, groups and users in the admin

```ts
import { ADMIN_RBAC_ENTITIES } from '@nest-my-admin/core';

TypeOrmModule.forRoot({ /* … */ entities: [/* yours */, ...ADMIN_AUTH_ENTITIES, ...ADMIN_RBAC_ENTITIES] }),
AdminModule.forRoot({ rbac: {}, roles: [/* system roles */], auth: builtinAuth({ /* … */ }) }),
```

- **Tables.** Roles, groups and memberships live in `nma_role`, `nma_group`, `nma_group_role`, `nma_group_member` and `nma_user_role`. The Administration section shows Users, Groups and Roles to `rbac.view`, and `rbac.manage` may change them.
- **Roles from code** are stored as system roles at every boot: read-only in the admin, and code always wins. A user's roles are the union of their direct roles, their groups' roles and `resolveRoles`, and changes apply on the next request.
- **The Roles page** is a matrix of resources × view/create/update/delete/purge. Each row expands to per-field access and to row scopes per operation, plus custom and global codes. Roles export and import as JSON; an import is all or nothing and validated like the editor.
- **Anti-escalation.** A manager who is not a superuser may only create, change, assign or remove roles within their own permissions (codes, field levels, scopes). They cannot change superusers, make anyone a superuser, or give themselves roles or groups.
- **Users** come from the auth adapter. `@nest-my-admin/auth` lists, creates and edits users and sets passwords; deactivating a user or setting their password signs them out everywhere. Other adapters may implement `listUsers`, `getUser`, `createUser`, `updateUser` and `setPassword`. Without them, the page shows the users that have roles or groups.

### Debugging permissions and viewing as a user

- **Permission debugger** (Administration → Permission debugger, for `rbac.view`; `GET /api/rbac/explain?user=&resource=[&record=]`). For one user and resource it shows:
  - each role and where it comes from (directly, a group, `resolveRoles`, the adapter), and names that are not roles;
  - each operation, allowed or not, and the patterns that grant it;
  - each field's level, with every role's level and the rule or code behind it;
  - the row scopes per operation, per role, and the global scopes;
  - for a record id: whether the user may view, change and delete it, and why not (no permission, outside their rows, an `@AdminCan` rule, no such record).

  The answers come from the code the API enforces with, and a test checks them against the API for random role combinations.
- **View as.** A superuser opens a user and chooses *View as this user*. The admin then shows exactly what that user sees (the UI sends `X-View-As: <id>`), under a banner with *Stop viewing*. It is read-only: the server refuses every write, and the account pages are closed. The server logs each start with both ids; the audit log arrives with M4.

### Testing permissions

```ts
import { createAdminTestingModule } from '@nest-my-admin/testing';

const admin = await createAdminTestingModule({ imports: [AppModule] });
const operator = admin.as({ id: 'u7', roles: ['operator'] });      // or no roles: resolveRoles decides
await operator.list('order', { filter: { status: { eq: 'open' } } });
await expect(operator.update('order', 1, { total: '0' })).rejects.toMatchObject({ code: 'FORBIDDEN_FIELDS' });
await admin.expectNoLeaks('employee', { as: { id: 'u7', roles: ['operator'] } });
```

- **`as(user)`** calls the API in-process as that user (meta, schema, list, get, create, update, delete, restore, purge, search, options), through the same checks as HTTP requests but without signing in.
- **`expectNoLeaks(resource, { as })`** reads everything as a superuser, then crawls everything the user can reach:
  - meta and the schema;
  - every list page and each visible record;
  - each out-of-scope record, which must be 404;
  - global search for each hidden value;
  - the other resources' titles, relation columns and relation pickers.

  It fails with `AdminLeakError` and a report of each hidden value or out-of-scope record it found (a title built from a hidden field, a `findMany` override that ignores scopes and the search term, …).
- **`adminTesting(app)`** gives the same helpers for an app you already created.

Host `APP_GUARD`s do not protect the admin, by design (it is mounted on the HTTP adapter, not as Nest controllers); middleware registered in `main.ts` before `listen` still runs. Do not enable wildcard CORS for it. Catch-all routes the host registered earlier take precedence over the admin.

## Develop

```bash
bun install
bun run build        # UI then core
bun run test         # unit + integration on in-memory sql.js
bun run db:up        # Postgres 17 + MySQL 8.4 in Docker (ports 55432, 53306)
bun run test:postgres  # the same suite on Postgres (test:mysql for MySQL); each test app gets its own database
bun run compat       # core suite on the oldest supported stack (NestJS 11.0, TypeORM 0.3.20)
bun run e2e                          # Playwright (run `bunx playwright install chromium` in examples/demo-api once; if that download is blocked, use an installed Chrome with `PW_CHANNEL=chrome bun run e2e`)
cd examples/demo-api && bun src/main.ts   # DATABASE_URL=postgres://… or mysql://… to use a real database
```

Design: `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md`.
