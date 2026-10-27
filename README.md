# nest-my-admin

A Django-admin-class admin panel for **NestJS + TypeORM**: declarative resources, forms from your DTOs,
admin writes that go through your own services, and a prebuilt shadcn UI served by Nest itself.

> Status: pre-alpha, version 0.2.1 (lists and forms, sign-in, permissions, files and rich text, actions, settings pages, audit log). APIs will change.
>
> **Upgrading from 0.2.0:** nothing breaks; see [Upgrading to 0.2.1](#upgrading-to-021) for what is new and what you may notice.
>
> **Upgrading from 0.1:** boot can now fail for an app that booted before, and a few behaviours changed. See [Upgrading to 0.2](#upgrading-to-02).

Requires NestJS 11 or 12, TypeORM 0.3.20+ or 1.x, Node 20.19+ (or Bun), and Postgres, MySQL 8 or SQLite.
The package is ESM; CommonJS apps load it through Node's `require(esm)`. A CommonJS app compiled with
`"module": "nodenext"` (the `nest new` default since Nest 11) needs TypeScript 5.8+; with `"module": "commonjs"` any 5.x works.

```bash
npm install @nest-my-admin/core          # the admin (brings the prebuilt UI with it)
npm install @nest-my-admin/auth          # optional: the built-in sign-in
npm install -D @nest-my-admin/testing    # optional: test helpers
```

`nest-my-admin` (no scope) is the same package as `@nest-my-admin/core` under a shorter name: it re-exports it, at the same version.

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

### Sidebar groups and order

```ts
@AdminGroup({ key: 'settings', label: { en: 'Settings', fa: 'تنظیمات' }, icon: 'settings', order: 900 })
@Module({ providers: [BrandingPage, SeoPage] })
export class SettingsModule {}

@AdminSettingsPage('branding', { group: 'settings', order: 10, form: BrandingDto })   // first
@AdminSettingsPage('seo', { group: 'settings', order: 20, form: SeoDto })             // second
@AdminResource(Product, { order: 10 })                                                // first among its group's resources
```

- **A group is a Nest module.** Resources and settings pages go to the group of the module that provides them; `@AdminGroup` on the module sets its `key` (default: the module's name in kebab-case, without `Module`), `label`, `icon` and `order` (lower first, default 100; then by label).
- **`group: '<key>'`** on a resource or a page puts it into another group. That group is configured by the module whose `@AdminGroup` has that key: any module of the app, whether the group's members are its own or not, resources, pages or both, in any import order. Such a module may provide nothing at all. A key that no `@AdminGroup` names gets its key as label (`odds-and-ends` → "Odds and ends"), no icon and order 100.
- **One module per key.** When two modules configure the same key with a different label, icon or order, the first one Nest discovers (import order) wins and a warning is logged at boot. The same options twice are fine.
- **`order` inside a group.** `@AdminResource(Entity, { order })` and `@AdminSettingsPage(name, { order })`: lower comes first, then the label in the reader's language; the default is 100, as for groups. A group lists its resources first and its settings pages after them, so `order` sorts resources among resources and pages among pages. The sidebar, the group's page, the home page and the command palette all show this order. `order` must be a finite number, or boot fails.

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
  - The page itself (`GET <path>/` and every deep link) is served in the default `locale`: `<html lang dir>` (`dir` is `rtl` for `fa`, `ar`, `he` and `ur`), your `title` in that language as `<title>`, and `Content-Language`. It is the same page for every request; the browser's `Accept-Language` is not consulted, because the UI starts in the default locale too.
  - A reader who switched to another language gets the default-locale page for the moment before the script runs, which then sets `lang`, `dir` and the title for their choice (the choice lives in their browser, where the server cannot see it).
  - The UI sends the language in use as `Accept-Language` with every API request. Labels given per language answer in it, falling back to the default
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
  - `widget`: text, textarea, number, money, switch, checkbox, select, radio, date, datetime, json, color, badge, slug, password, email, url, file, image or richtext (the last three: [Files, images and rich text](#files-images-and-rich-text)).
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
  - The edit page title shows badge fields, the record's [actions](#actions) and `links(record)` (records carry them as `_links`).
  - Only http(s) and relative URLs are kept. They open in a new tab with `rel="noopener noreferrer"`.
- **Form keys.**
  - Leaving a form with unsaved changes asks first: an inline bar for in-app navigation, the browser's prompt for closing the tab.
  - ⌘S / Ctrl+S saves and stays on the record.
  - **Save & new** saves and opens an empty form.
  - **Duplicate** opens `/:resource/new?from=<id>`, prefilled without primary keys, unique columns, read-only fields and files.

### Files, images and rich text

```ts
import { ADMIN_FILE_ENTITIES, AdminModule, localStorage } from '@nest-my-admin/core';

TypeOrmModule.forRoot({ /* … */ entities: [Product, Article, Invoice, ...ADMIN_FILE_ENTITIES] }),
AdminModule.forRoot({
  files: { storage: localStorage({ dir: 'var/uploads' }), maxBytes: 10 * 1024 * 1024 },
}),

@AdminResource(Product)
export class ProductAdmin extends AdminResourceBase<Product> {
  fields: FieldsConfig<Product> = {
    image: { widget: 'image', file: { visibility: 'public', maxBytes: 2 * 1024 * 1024 } }, // a string column
    gallery: { widget: 'image', many: true },                                              // a json column: keys in order
    manual: { widget: 'file', file: { accept: ['application/pdf'] } },                     // private by default
    description: { widget: 'richtext' },                                                   // a text column: sanitized HTML
  };
}
```

- **Storage.**
  - `localStorage({ dir, publicBaseUrl? })` writes under `dir`. Keep `dir` out of the repository and out of any folder your app serves.
  - `s3Storage({ endpoint, region, bucket, accessKeyId, secretAccessKey, publicBaseUrl?, forcePathStyle? })` works with S3 and compatible stores (MinIO, R2), with no SDK.
  - Anything else: implement `AdminStorage` (`put`, `get`, `delete`, `publicUrl`).
  - Files are tracked in the `nma_file` table (`ADMIN_FILE_ENTITIES`; `files.dataSource` names another DataSource).
- **Storage keys.** The admin makes up a key at upload and never changes it:

  | The file of | Upload query | `nma_file.resource` / `recordId` | Storage key |
  | --- | --- | --- | --- |
  | a resource's record | `resource=<resource>&field=<field>` | `<resource>` / the record's id | `<resource>/<field>/<yyyy>/<mm>/<uuid><ext>` |
  | a settings page | `resource=page:<name>&field=<field>` | `page:<name>` / `page` | `page/<name>/<field>/<yyyy>/<mm>/<uuid><ext>` |

  - `<yyyy>/<mm>` is the month of the upload in UTC, `<uuid>` a random UUID, and `<ext>` the extension of the type found in the bytes (`.png`, `.pdf`; nothing when the type has none).
  - A page is written `page:<name>` wherever it is named as the owner, and `page/<name>/` in the key: a colon is not a file name everywhere. Example: `page/branding/logo/2026/10/ca56b927-6a9a-40c9-8967-28a6433f7b59.png`.
- **Fields.**
  - The column holds the storage key (`product/image/2026/10/<uuid>.png`), or the list of keys for `many`. Records carry `_files[field]` with each file's `name`, `size`, `contentType` and `url`.
  - `file.accept` lists types (`image/*`, `application/pdf`); the image widget defaults to `image/*`. `file.maxBytes` overrides `files.maxBytes` (default 10 MiB); both stop at 2147483647 bytes (2 GiB - 1).
  - The form uploads as soon as a file is picked or dropped, shows progress, and waits with saving until uploads finish. Lists show thumbnails for image fields and file names for the rest. A `many` field is reordered by dragging or with its arrow buttons.
  - Replacing or removing a file, and purging a record, delete the stored objects once the change has committed. Uploads that never reach a record are swept after 24 hours.
  - **A delete releases a record's files only when the row is really gone**: the admin reads the row again inside the write, after your `delete()` (or a record action) returned. A record in the trash keeps its files, and so does one your `delete()` only flags (an archive column). A purge always releases them, whatever your `purge()` leaves.
  - "Gone" means that no row is left under the key the request named. A record action that changes its record's primary key, or moves a single-table-inheritance child to another type, therefore reads as gone: the files are released while the row still names them (and the record's audit history ends there). Do not change keys or types in actions on resources with file fields.
  - A `purge()` override that keeps the row leaves that row holding a file key with no object behind it.
  - With `transactions: false` and TypeORM replication, that read may be answered by a replica. One that lags behind a row that was just created answers "no row", and an archive-style delete or an action on that record then releases its files. Keep transactions on with replicas.
  - The other side of that rule: when the row goes without the admin's write seeing it (on MySQL, a service that ignores `ctx.manager` and deletes on another connection; anywhere, a delete you queue for later), the files stay as orphans, rows in `nma_file` and objects in the storage. Nothing removes them afterwards; pass `ctx.manager`.
  - **Duplicate** copies no files: a file belongs to one record.
- **Your own services.** `create`/`update` overrides receive `AdminFile` objects (`key`, `name`, `contentType`, `size`, `isNew`) for file fields, already checked. Store `file.key` (the DTO property needs any class-validator decorator, such as `@IsOptional()`). The default `create`/`update` do this themselves.
- **Rich text.**
  - Install the sanitizer in your app: `npm install sanitize-html` (an optional peer; the admin refuses to boot with a rich-text field and without it), or pass your own `files.sanitizeHtml`.
  - The editor offers what the sanitizer keeps: paragraphs, headings 2–4, bold, italic, strikethrough, links, lists, quotes, tables, images, line breaks and rules. Every block takes the direction of its own text, so Persian and English paragraphs share a document.
  - Images are uploaded through the same endpoint (when `files` is configured) and belong to the record once the saved HTML refers to them; `file: { visibility, maxBytes }` applies to them.
  - HTML shown outside the admin (a storefront) needs images the public can load: give the field `file: { visibility: 'public' }` and the storage a `publicBaseUrl`. Otherwise each `<img>` points at the admin's own download route (`<path>/api/files/<key>`), which answers only signed-in admin users.
  - The stored HTML holds the full URL of each image. Changing the admin `path` or the storage's `publicBaseUrl` later breaks the images of existing records (and the admin no longer recognises them as the record's files), so rewrite the stored HTML when you move either.
  - **Duplicate** copies the text without its images, for the same reason it copies no files.
  - The editor is a separate chunk of the UI, loaded only by forms with a rich-text field.
- **API.** `POST /api/uploads?resource=&field=` (`resource=page:<name>` for a settings page) takes the file itself as the request body (not multipart) with `Content-Type: application/octet-stream`, `Content-Length` and an optional percent-encoded `X-File-Name`, and answers `{ token, name, contentType, size, url? }`. Do not send the file's own type: a body parser of your app (Nest's JSON parser, for one) would read an `application/json` body before the admin does, and the upload is then refused with a 400 that says so. A write then sends `{ token }` for a new file, `{ key }` to keep a stored one, or `null`; a `many` field sends the whole list. Sending the same `{ token }` again for the same record and field (a retry after a lost answer) keeps the file.

**Security notes**

- The type of a file is read from its bytes, never from its name or the request's `Content-Type`. HTML, SVG and scripts are refused whatever they are called, and stored files get the extension of the type that was found.
- A text file is recognised from its first 8 KB only; what follows is not inspected. Text uploads are stored as `text/plain` with a `.txt` extension: keep it that way, and never serve them as HTML from a public bucket or your own static route (the admin's download route sends `nosniff` and `Content-Disposition: attachment` for them).
- Uploading needs create or update permission on the resource and edit access to the field; `text/plain`, `multipart/form-data` and `application/x-www-form-urlencoded` bodies are refused (a form on another site could send those), on top of the CSRF token.
- Private files (the default) are served only by `GET /api/files/<key>`, which checks, for every request, that the user may view the record (permission, scopes, `query()`) and the field, and that the record still holds the file. Every refusal is the same 404. Responses carry `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, and `Content-Disposition: attachment` for everything but images and PDFs.
- `visibility: 'public'` links to the storage's `publicUrl` when it has one (`publicBaseUrl`): anyone with the link can read such a file, with no permission check. Without a public URL, public files are served by the admin like private ones.
- `localStorage` keeps public and private files in one directory. If you serve that directory yourself for `publicBaseUrl`, private files in it are reachable by anyone who learns their key; serve only what you mean to publish, or use a bucket with its own rules.
- Rich text is sanitized on the server at every write, whatever the browser sent. Links keep http(s), mailto and relative addresses and get `rel="noopener noreferrer nofollow"`; an `<img>` is kept only when it points at a file of this admin that belongs to the record (or that the same user just uploaded for this field). A custom `files.sanitizeHtml` is trusted to do the same.
- An unsaved upload can be fetched only by the user who made it.

**Serving public files yourself**

A storefront needs the public files (product images, the shop's logo) without an admin session. With a `publicBaseUrl` the storage serves them. Without one, serve them from a route of your own and ask `AdminFiles` which keys are public; do not read `nma_file` yourself.

```ts
import { AdminFiles } from '@nest-my-admin/core';
import { Controller, Get, NotFoundException, Param, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Images a browser may show in place; everything else is downloaded. */
const RASTER = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

@Controller('media')
export class MediaController {
  constructor(private readonly files: AdminFiles) {}   // AdminModule is global: nothing to import

  @Get('*key')                                          // Nest 11 (Express 5): the segments of the key
  async serve(@Param('key') key: string | string[], @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StreamableFile | undefined> {
    const path = Array.isArray(key) ? key.join('/') : key;
    // Express answers HEAD with the GET route: the row is enough for that, the object is not opened.
    const file = req.method === 'HEAD' ? await this.files.publicFile(path) : await this.files.openPublic(path);
    if (!file) throw new NotFoundException();
    res.setHeader('Content-Type', file.contentType.startsWith('text/') ? 'text/plain; charset=utf-8' : file.contentType);
    res.setHeader('Content-Length', String(file.size));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');   // a replaced file gets a new key
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (!RASTER.has(file.contentType)) {
      const name = encodeURIComponent(file.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${name}`);
    }
    if (!('body' in file)) return undefined;
    const { body } = file;
    res.on('close', () => body.destroy());   // a reader who leaves early must not keep the file or the connection open
    return new StreamableFile(body);
  }
}
```

- **Keep the headers.** Uploaded bytes are someone else's content served from your origin. `nosniff` and the type found at upload stop a browser from guessing another type; the `Content-Security-Policy` stops anything served here from running or loading anything if it is opened as a page; everything but a raster image is a download (`Content-Disposition: attachment`), and text is only ever `text/plain`. This is what the admin's own download route does.
- `publicFile(key)` answers `{ key, name, contentType, size }` or `null`, from the `nma_file` table alone (the storage is not touched): enough for a `HEAD`, or to decide before streaming.
- `openPublic(key)` makes the same check and then reads the storage: `{ body, contentType, size, name }`, or `null` when the key is not a public file or the object is gone from the storage. `size` is the stored object's size, or the size recorded at upload when the storage does not report one. **Consume `body` or destroy it**: an unread body holds a file descriptor or a connection to the storage.
- **Public** means a row with `visibility: 'public'` (the field's `file: { visibility: 'public' }`) and `status: 'attached'` (a saved record or settings page holds it). A private file, an upload nobody saved yet, a file its record let go of and a key the admin never issued are all `null`, and so is anything that is not a key (an empty string, `..` segments, a backslash, more than 500 characters): neither method throws for what a key is, so the key can come straight from the URL. No permission is checked.
- **Public is what was recorded at upload.** `AdminFiles` goes by the row's visibility, set from the field's `file.visibility` when the file was uploaded: a field you later make private keeps its earlier files public (new uploads are private). A record in the trash still holds its files, so its public files are still served; they stop when the record is purged or the file is removed from it.
- `contentType` is the type the admin found in the file's bytes at upload, never what the uploader claimed. The long `Cache-Control` is safe for the key (a replaced file gets a new one), but a file that is removed or made private stays in browser and CDN caches until it expires there; choose the lifetime with that in mind.
- `AdminFiles` is always injectable and follows `files.dataSource`. In an admin without `files`, both methods reject with an error that says `files` is missing (`files.enabled` tells beforehand); before the application has started they reject too.
- The admin's own `url` for a public file without a `publicBaseUrl` is `<path>/api/files/<key>`, which needs an admin session: build your storefront's link from the key (`/media/${key}`) instead.

#### Registering files yourself

A host that stores a file itself (an image fetched from another system, an attachment its own API took) registers it, so the admin's downloads, `_files`, `publicFile` and the delete/purge cleanup treat it like an upload:

```ts
await dataSource.transaction(async (manager) => {
  const file = await this.adminFiles.register(
    { resource: 'product', field: 'image', recordId: product.id, body: imageStream, name: 'front.jpg' },
    manager,
  );
  await manager.update(Product, product.id, { image: file.key });   // the record holds the key: you store it
});
```

- The bytes are checked like an upload's: the type is read from the content and must fit the field's `accept`, and the size its `maxBytes`. A refusal is an `AdminValidationError` (422) on the field, and nothing is stored. The field must be a `file` or `image` field (not rich text); an unknown resource or field is an error.
- The object is stored under a new key in the usual format, and the row is `attached` to `recordId` (`RecordId`: a value, or `{ key: value }` for composite keys; for a settings page, `resource: 'page:<name>'` and any `recordId`). `visibility` defaults to the field's.
- **With `manager`** the row is written in that transaction when `nma_file` is on its DataSource (else at once), and if the transaction rolls back neither the row nor the object is left. Without one, the row is written at once.
- **It does not write the record.** Store `file.key` in the column yourself, in the same transaction.
- `release({ resource, field, recordId, key }, manager?)` is for a key the record no longer holds: its row goes, and its object after the transaction commits (at once without one). A key that is not that record's file in that field is left alone: `release` never deletes another record's file.

### Actions

```ts
class ShipDto {
  @AdminField({ label: { en: 'Tracking code', fa: 'کد رهگیری' } })
  @IsString() @Length(4, 40) tracking: string;
}

@AdminResource(Order)
export class OrderAdmin extends AdminResourceBase<Order> {
  @AdminAction({ label: { en: 'Ship', fa: 'ارسال' }, bulk: true, input: ShipDto, icon: 'truck' })
  async ship(order: Order, input: ShipDto, ctx: AdminContext): Promise<ActionOutcome> {
    if (order.status !== 'paid') throw new ConflictException(`Order ${order.number} is not paid yet`);
    await this.orders.ship(order.id, input.tracking, ctx.manager);
    return { message: { en: 'Shipped', fa: 'ارسال شد' } };
  }

  @AdminAction({ variant: 'destructive', confirm: { en: 'Cancel this order?', fa: 'این سفارش لغو شود؟' } })
  async cancel(order: Order, _input: unknown, ctx: AdminContext) { await this.orders.cancel(order.id, ctx.manager); }
  @AdminCan('cancel') onlyDrafts(order: Order) { return order.status === 'draft'; }

  @AdminAction({ target: 'resource', label: 'Recount stock' })
  async recount(_input: unknown, ctx: AdminContext) { return { message: `Counted ${await this.stock.recount(ctx.manager)} items` }; }
}
```

- **Declaring one.** `@AdminAction(options)` on a method of the resource; the method name is the action's name.
  - `target: 'record'` (the default): the method is `(record, input, ctx)` and gets one loaded entity. The button is in the record's detail header. With `bulk: true` it is also offered for a list selection.
  - `target: 'resource'`: the method is `(input, ctx)`. The button is on the list toolbar and runs once, without records.
  - `label` (default: the humanized name), `icon`, `variant: 'destructive'` (a red button), `confirm: true` or a question of your own (asked in a dialog before it runs). A destructive action, and any run on more than one record, is always asked about first, with a default question when `confirm` is not set.
  - `input`: a DTO. Its properties become a form in the dialog, checked in the browser and validated on the server like any write (whitelisted; class-validator; `@AdminField` for labels, help and widgets). A property with a class initializer is optional and keeps its default. File, image, rich-text and secret fields are not allowed in an input.
  - Return `{ message }` (a text or `{ en, fa }`) to say what happened: the UI shows it as a toast. Returning nothing gives a default "done".
  - Names that collide with `create`, `update`, `delete`, `restore`, `purge` or a method of `AdminResourceBase`, and options that do not fit together (`bulk` on a resource action, `atomic` without `bulk`), fail at boot.
- **Permissions.**
  - Each action has the code `{r}.action.{name}`. `{r}.*` and `*` cover it, `{r}.action.*` covers every action of the resource, and `*.update` or `{r}.update` do not.
  - A record action also needs `{r}.update`, and the record must be inside the user's view and update scopes: an action never runs on a record the user could not change. A resource action needs only its own code.
  - **A resource action is not row-scoped.** It is handed no records, so neither `query()` nor the user's row scopes have been applied to anything: the method decides which rows it touches. Start from your restrictions yourself, `this.query(this.repositoryFor(ctx).createQueryBuilder('entity'), ctx).andWhere(…)`, and add the condition of an `@AdminScope` method by calling it, or the action changes rows the user cannot see.
  - The code holds the method's name: renaming an action method (or removing a settings page) leaves stored roles naming the old code. Such a role no longer validates and grants nothing at all until it is fixed on the Roles page.
  - `@AdminCan('<action name>')` is a rule per record, as for update and delete: where it says no, the button is not there (`_perm.actions` lists the allowed ones) and the API answers 403. Rules apply to superusers too. `@AdminCan('update')` does not gate actions, so a record closed to edits can still be cancellable.
  - The schema lists only the actions the user may run. While viewing as someone, none can be run.
- **Selections.** A bulk action runs on up to 100 records.
  - By default each record gets its own transaction: the answer is `{ ok, failed: [{ id, code, message }], message? }`, and one failure does not stop the others. The list shows how many ran and why the others did not.
  - `atomic: true` runs them all in one transaction: every record is checked first, and one failure is the answer, with nothing applied. It needs the admin's transactions (boot fails with `transactions: false`). The confirmation says "all or nothing".
- **Refusing.** Throw from the method:
  - an `HttpException` below 500 answers with its status and message (409 is `CONFLICT`, 400 is `BUSINESS_RULE`), and the UI shows the message;
  - a 401 from host code is answered as 400, because 401 means signed out to the admin: an action, a settings page's `load`/`save`, or a resource's `create`/`update`/`delete` (and their hooks) that rethrows a provider's `UnauthorizedException` gets a 400 `BUSINESS_RULE` with its message (an `errorMapper` sees that 400, with the original as its `cause`);
  - `AdminFieldError({ tracking: 'is unknown to the courier' })` is a 422 shown on that input;
  - anything else goes through `errorMapper` and the usual error mapping (a 500 with a correlation id when nothing maps it).
- **Transactions.** An action runs inside the admin's write transaction: pass `ctx.manager` to your services, as in `create` and `update`.
- **Files.** An action that hard-deletes a record, or changes a file column itself, does not release the files: the objects and their `nma_file` rows stay. Only the admin's own update, delete and purge do that for now.
- **API.** `POST /api/resources/:resource/actions/:action` with `{ ids?, input? }`. One distinct id answers `{ message?, record }` (`record` is `null` when the action took it out of the user's view), several answer the bulk result, and a resource action answers `{ message? }`.

### Printing records

A print template is a resource method that returns the body of a printed page. The record page shows a button per template (the list selection too, with `bulk`); it opens a page in a new tab that is sized for the paper and prints itself. «Save as PDF» in the browser's print dialog is the PDF.

```ts
import { AdminPrint, html } from '@nest-my-admin/core';

@AdminPrint({ label: { en: 'Invoice', fa: 'فاکتور' }, paper: 'A4', bulk: true, icon: 'receipt' })
invoice(orders: Order[], ctx: AdminContext) {
  return html`${orders.map((order) => html`<section class="nma-print-page"><h1>${order.number}</h1>…</section>`)}`;
}
```

- `html` escapes every value it puts in; another `html` (or `raw('…')`, for trusted markup only) goes in as it is. Wrap each record in `<section class="nma-print-page">` to start it on a new sheet.
- `paper`: `A4` (default), `A5`, `label` (100×150 mm) or any CSS `@page` size (`'80mm 200mm'`). The page has a 10 mm margin and the admin's language and direction.
- Permissions: `{resource}.view`, the user's row scopes and `{resource}.print.{name}`. The method gets whole entities, like an action. Throw an `HttpException` to refuse a record (an unpaid order's label).
- Each printed record is written to the audit log (`{resource}.print.{name}`).
- API: `GET /api/resources/:resource/print/:name?id=…[&id=…]&lang=fa` answers the HTML page (up to 100 ids with `bulk`, else one).

### Exporting a list to Excel

```ts
list: ListConfig<Order> = { columns: [...], export: true }; // or { columns: ['number', 'customer', 'total'], max: 50_000 }
```

«Export to Excel» on the list downloads the rows the list shows now (filters, search, tab, sort, row scopes) as an `.xlsx`, in `columns` (default: the list's field columns), up to `max` rows (default 10,000, at most 100,000; the UI says when it was cut). Fields the user may not see are left out. Numbers and money are numbers, dates are dates (on the exporter's clock), enums and relations show their labels and titles; the sheet is right to left in an RTL language. It needs `{resource}.export` and is written to the audit log. API: `GET /api/resources/:resource/export?<list query>&offset=<minutes east of UTC>`.

### Settings pages

```ts
export class ShopSettingsDto {
  @IsString() @Length(2, 60) shopName: string;
  @IsOptional() @IsInt() @Min(0) lowStockThreshold?: number | null;
  @IsOptional() logo?: AdminFile | string | null;
  @IsOptional() @IsString() @Length(12, 80) paymentApiKey?: string | null;
}

@AdminSettingsPage('shop', {
  label: { en: 'Shop settings', fa: 'تنظیمات فروشگاه' },
  icon: 'store',
  form: ShopSettingsDto,
  fields: { logo: { widget: 'image' }, paymentApiKey: { secret: true } },
  layout: [{ section: 'Shop', fields: ['shopName', 'logo'], columns: 2 }, { section: 'Payments', fields: ['paymentApiKey'] }],
})
export class ShopSettingsPage implements AdminSettingsSource<ShopSettingsDto> {
  load(ctx: AdminContext) { return this.settings.all(ctx.manager); }
  save(changes: Partial<ShopSettingsDto>, ctx: AdminContext) { return this.settings.write(changes, ctx.manager); }
}
```

- **What it is.** One form that is not a table: a provider with `load` and `save`, shown in the sidebar under its module's group (or `group: '<key>'`) at `/p/<name>`. A group may hold only pages; its label, icon and order come from the module whose `@AdminGroup` has its key, and `order` places a page among the pages of its group (see [Sidebar groups and order](#sidebar-groups-and-order)). List the class in a module's `providers`.
- **The form** comes from the DTO alone: one field per property with a class-validator decorator. `fields` and `@AdminField` set labels, help, widgets and `showIf`; `layout` works as on resources. `readonly`, `readonlyIf` and `restricted` do not exist on pages.
- **`load(ctx)`** returns the stored values. Keys that are not form fields are dropped.
- **`save(changes, ctx)`** gets only the keys that were sent: a save is partial and validated like a PATCH. The UI sends what changed; a group of fields (a nested DTO) is sent whole once one of its fields changed, so `save` can store it under its key.
  - It runs in a transaction on the default DataSource, and `load` is called inside it before and after. Use `ctx.manager` when it is set: a `save` that ignores it writes outside the transaction.
  - Throw `AdminFieldError` (422 on a field) or an `HttpException` to refuse (a 401 is answered as 400, as for actions).
- **Secrets.** `secret: true` (text fields of the page only) makes a field write-only.
  - The value is never served: not by GET, not in the answer of a save. The API reports `secrets: { paymentApiKey: true }` when one is stored, and the form shows **Set ✓ · Replace · Clear**.
  - A save replaces it with any non-empty text, clears it with `null` (even when the DTO requires the property), and leaves it alone when the key is absent. An empty string is refused with 422: empty never means "clear".
  - `load` returns the secret like any other value (the admin needs to know whether one is set), and `save` gets the new text or `null`. Encrypt it in `save` if the table is not a safe place for it.
  - Never put a secret into an error message. As a last line of defence the admin replaces the exact values of secrets of 6 or more characters with `***` in errors leaving a save (messages, field errors, the log). That is best effort: shorter and transformed values are not found, and errors thrown by `load` outside a save are logged as thrown.
- **Files.** File, image and rich-text fields work as on records, with `resource=page:<name>&field=<field>` for uploads; the stored key is `page/<name>/<field>/<yyyy>/<mm>/<uuid><ext>` (see Storage keys under [Files](#files-images-and-rich-text)). `save` gets an `AdminFile` (store its `key`) or `null`, and `load` returns the key, and `null` once the file was cleared: leaving the key out means "unknown", and the removed file is then kept. List fields (`many`) are not supported on pages.
- **Permissions.** `page.<name>` views the page and `page.<name>.update` saves it; whoever may save may view.
  - `*` and `page.*` grant both codes of every page, and `page.*.update` saves every page. Resource wildcards (`*.view`, `*.update`, `product.*`) never reach a page.
  - Without view, the page is a 404 and absent from the sidebar. With view only, the form is read-only. Viewing as someone is always read-only.
- **Names.** Letters, digits, `-` and `_`; not the name of a resource, an operation (`view`, `update`, …) or a resource's custom permission. Because page codes start with `page.`, **a resource cannot be named `page` in an admin with settings pages**: boot fails and suggests `@AdminResource(Page, { name: 'content-page' })`.
- **API.** `GET /api/pages/:name` answers `{ schema, values, secrets, files }`, and `PATCH /api/pages/:name` takes the changed keys and answers the same.

### Inlines

A parent's form can edit its child records (a product's variants, specifications and pictures; an order's lines), and one Save writes the parent and every change to its children in **one transaction**. The child is an ordinary resource, with its own permissions, scopes, fields, DTOs, hooks and service overrides; the parent's layout places it:

```ts
@AdminResource(OrderLine, { name: 'order-line' })
export class OrderLineAdmin extends AdminResourceBase<OrderLine> {
  form: FormConfig = { create: CreateOrderLineDto, update: UpdateOrderLineDto };
}

@AdminResource(Order)
export class OrderAdmin extends AdminResourceBase<Order> {
  form: FormConfig = {
    create: CreateOrderDto,
    update: UpdateOrderDto,
    layout: [
      { section: { en: 'Order', fa: 'سفارش' }, fields: ['number', 'customer'], columns: 2 },
      { section: { en: 'Lines', fa: 'ردیف‌ها' }, inline: OrderLineAdmin, display: 'table', fields: ['productId', 'description', 'quantity', 'unitPrice'], order: 'position', min: 1, max: 50 },
    ],
  };
}
```

- **`inline`**: the child resource class. Its entity needs exactly one many-to-one (or owning one-to-one) relation to the parent's entity: that relation's field is the **link** (`orderId`). With several candidates, name it with `link: 'orderId'`. The server sets the link; a client that sends it is refused (422), and an update cannot change it.
- **`display`**: `cards` (default; each child is a card with the child's own form layout) or `table` (one row per child, one cell per field: for short rows like order lines; on phones the table scrolls sideways).
- **`fields`**: which of the child's form fields the inline shows, in order (default: the child's update form fields without the link). Fields it does not show keep their stored values, and their DTO defaults on create.
- **`order`**: a number field of the child. Rows are read sorted by it (then by key), and dragging or the up/down buttons write 0, 1, 2… into it on save. Without it rows go by key and cannot be reordered.
- **`min`**, **`max`** (default 100, at most 500): how many rows a save may leave, checked on the server after the changes (422 on the inline). `max` is also how many rows are read: a record with more shows them read-only, with a link to the child's list filtered by the parent.
- One level only: an inline cannot contain inlines (boot error). A child may be inlined into more than one parent (with different links).

**Permissions.** An inline never widens access: a user reads, adds, changes, removes or reorders a child through an inline only as they could through the child's own resource (`order-line.view`, `.create`, `.update`, `.delete`, its field levels and scopes, each row's `@AdminCan`), and only the children of this parent. A user without `<child>.view` does not see the inline at all; without `<child>.delete` there is no remove button, and a crafted delete is a 403 that saves nothing. Since children are saved with the parent, the save also needs `<parent>.create` (a new parent) or `<parent>.update`. View-as shows inlines read-only, like everything else.

**Saving.** The form sends, next to the parent's fields, `_inlines: { <child>: { create, update, delete, order } }` (`InlineChanges` in the contract): new rows with a `_key`, changed fields of changed rows with their `_id` (and `_version` for a child with a version column), the ids to delete, and the new order. Inside the parent's write the parent is saved first (a save with only inline changes does not update the parent), then each inline in layout order: deletes, updates, creates, each through the child resource's own `delete`/`update`/`create` and its write participants (files, audit). Any error rolls back everything; errors name the row (`_inlines.order-line.create.2.quantity`, `_inlines.order-line.update.17.unitPrice`) and the form shows them on that row. At most 500 entries per inline per request.

**Options that depend on the parent.** A child's `relationOptions(field, qb, ctx, values)` receives `values._parent`: the parent form's values as the user sees them (unsaved, in the picker; body over stored, on save), with `_parent._resource` naming the parent. Use it to narrow a picker to what the parent allows, such as the attributes of the product's category.

**History.** Each child change is the child's own audit entry (`order-line.created`, …) in the child's history, with `meta.parent` naming the parent (for readers who may view the parent's resource). The parent's History tab shows the parent's own entries only.

**Duplicate** copies the parent only, not its children (the copied form says so).

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
  - actions: `{r}.action.{name}` ([Actions](#actions));
  - settings pages: `page.{name}` and `page.{name}.update` ([Settings pages](#settings-pages));
  - custom codes, per resource or global;
  - `audit.view`, with the [audit log](#audit-log) on.
  - Wildcards: `*`, `{r}.*`, `*.view`. Page codes are granted only by `*` and by patterns that start with `page`.
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
  - `_perm: { update, delete, actions? }` on each record combines permission, scope and `@AdminCan`, and PATCH, DELETE and actions re-check it.
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
- **The Roles page** is a matrix of resources × view/create/update/delete/purge. Each row expands to per-field access, row scopes per operation, the resource's actions and its custom codes. Settings pages have their own table (view, change), and global codes follow. Roles export and import as JSON; an import is all or nothing and validated like the editor.
- **Anti-escalation.** A manager who is not a superuser may only create, change, assign or remove roles within their own permissions (codes, field levels, scopes). They cannot change superusers, make anyone a superuser, or give themselves roles or groups.
- **Users** come from the auth adapter. `@nest-my-admin/auth` lists, creates and edits users and sets passwords; deactivating a user or setting their password signs them out everywhere. Other adapters may implement `listUsers`, `getUser`, `createUser`, `updateUser` and `setPassword`. Without them, the page shows the users that have roles or groups.

### Debugging permissions and viewing as a user

- **Permission debugger** (Administration → Permission debugger, for `rbac.view`; `GET /api/rbac/explain?user=&resource=[&record=]`). For one user and resource it shows:
  - each role and where it comes from (directly, a group, `resolveRoles`, the adapter), and names that are not roles;
  - each operation, allowed or not, and the patterns that grant it;
  - each action, and whether a granted one is held back because the user lacks `update`;
  - every settings page: view, change, and the patterns behind them;
  - each field's level, with every role's level and the rule or code behind it;
  - the row scopes per operation, per role, and the global scopes;
  - for a record id: whether the user may view, change and delete it, and why not (no permission, outside their rows, an `@AdminCan` rule, no such record), and the actions they may run on it.

  The answers come from the code the API enforces with, and a test checks them against the API for random role combinations.
- **View as.** A superuser opens a user and chooses *View as this user*. The admin then shows exactly what that user sees (the UI sends `X-View-As: <id>`), under a banner with *Stop viewing*. It is read-only: the server refuses every write (actions and settings pages included, so the UI offers neither), and the account pages are closed. Each start is recorded in the [audit log](#audit-log) (`auth.view_as`, at most once an hour per pair); without the audit log the server logs it with both ids. History and the audit page work while viewing as someone, with that user's permissions.

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
  - `runAction(resource, action, { ids?, input? })` runs an `@AdminAction`: one id answers `{ message?, record }`, several `{ ok, failed }`, and a resource action takes no ids.
  - `page(name)` reads a settings page (`{ schema, values, secrets, files }`) and `savePage(name, changes)` saves the keys of `changes`.

  ```ts
  await operator.runAction('order', 'ship', { ids: [1], input: { tracking: 'TRK-1' } });
  await expect(operator.runAction('order', 'cancel', { ids: [1] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(operator.savePage('shop', { shopName: 'Mine' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  ```
- **`expectNoLeaks(resource, { as })`** reads everything as a superuser, then crawls everything the user can reach:
  - meta and the schema;
  - every list page and each visible record;
  - each out-of-scope record, which must be 404;
  - global search for each hidden value;
  - the other resources' titles, relation columns and relation pickers.

  It fails with `AdminLeakError` and a report of each hidden value or out-of-scope record it found (a title built from a hidden field, a `findMany` override that ignores scopes and the search term, …).
- **`adminTesting(app)`** gives the same helpers for an app you already created.

Host `APP_GUARD`s do not protect the admin, by design (it is mounted on the HTTP adapter, not as Nest controllers); middleware registered in `main.ts` before `listen` still runs. Do not enable wildcard CORS for it. Catch-all routes the host registered earlier take precedence over the admin.

## Audit log

```ts
import { ADMIN_AUDIT_ENTITIES } from '@nest-my-admin/core';

TypeOrmModule.forRoot({ /* … */ entities: [/* yours */, ...ADMIN_AUDIT_ENTITIES] }),
AdminModule.forRoot({ audit: { retentionDays: 365 } }),   // `audit: {}` keeps entries for ever

@AdminResource(Employee)
export class EmployeeAdmin extends AdminResourceBase<Employee> {
  fields: FieldsConfig<Employee> = { salary: { sensitive: true } };   // recorded as "changed", without values
}
```

- **Enabling it.** `audit: {}` and `ADMIN_AUDIT_ENTITIES` (one table, `nma_audit`) in the entities of the default DataSource, or of the one named by `audit.dataSource`. Without `audit` nothing is recorded, records have no History tab, and the two routes answer 404. Boot fails when the table's entity is missing.
- **What is recorded.** Every entry has the time, the actor (id and display name at the time; none for a failed sign-in), the event, the request's correlation id, and for a record its resource, id and title.

  | event | what it holds |
  |---|---|
  | `{r}.created`, `{r}.updated`, `{r}.deleted`, `{r}.restored`, `{r}.purged` | the changed fields: after only for a create, before only for a delete or purge, both for an update, none for a restore |
  | `{r}.action.{name}` | the fields the action changed on the record (none for a resource action), and its input |
  | `page.{name}.updated` | the changed fields of a settings page |
  | `rbac.role.changed`, `rbac.group.changed`, `rbac.user_roles.changed` | permissions, field rules and scopes of a role; roles and members of a group; a user's roles and groups. A deleted role also names the users and groups that lost it |
  | `rbac.user.created`, `rbac.user.changed`, `rbac.user.password_reset`, `rbac.user.two_factor_reset` | username, display name, email, active and superuser flags; never a password |
  | `auth.login`, `auth.logout`, `auth.login_failed`, `auth.view_as` | address and browser; for a failure the username that was typed and why (`UNAUTHENTICATED`, `RATE_LIMITED`, `WRONG_CODE`, `SUPPRESSED`) |
  | `auth.password_changed`, `auth.two_factor_enabled`, `auth.two_factor_disabled`, `auth.recovery_codes_regenerated`, `auth.sessions_revoked` | the user's own account changes |

  - The diff is computed by the admin from the stored row before and after your method ran, so it also covers resources that override `create`/`update`/`delete`, and fields your service changed that the form did not send (a computed total).
  - An update or a page save that changes nothing writes no entry. Bulk runs write one entry per record. The update-date, version and discriminator columns are never diffed.
  - Related records are stored as ids (a many-to-many as its sorted ids), files as their storage keys, decimals and bigints as strings.
  - A text over 4,000 characters is cut, a larger value of another kind is left out, and an action's input over 8 kB is left out; the entry says so (`truncated`, `inputTruncated`).
- **How writes are observed.** `AdminApiService` runs every write through its *write participants* (`before` → your method → `after`, then `onCommit` or `onRollback`). File handling is one participant and the audit log the other; nothing in your resource has to call it.
- **An entry exists if and only if its change committed.** The entry is inserted with `ctx.manager`, inside the write's transaction: a rollback discards it, and if the entry cannot be written the write fails with it (500). Two setups are weaker:
  - **the audit table on another DataSource** (`audit.dataSource`): the entry is written right after the commit, on its own connection. A crash or a failed insert in between loses it; the failure is logged with the correlation id.
  - **`transactions: false`**: the entry is written after your method returns. A method that throws after it changed something leaves the change without an entry.
- **Sensitive fields.** `sensitive: true` on a field (of a resource, a settings page, or an action's input DTO) records only that it changed. `widget: 'password'` fields and a page's `secret` fields are sensitive by themselves. The option is opt-in: a `passwordHash` or token column is stored in clear unless you mark it.
  - **`sensitive`, `secret` and `widget: 'password'` are refused at boot on a property inside a group** (a nested DTO, an embedded entity), where they would not be applied: move the field to the top level, or mark the group itself.
  - When the title column is sensitive (or the title is a function and the resource has a sensitive field), no title is stored.
- **What is never stored:** passwords, one-time codes, recovery codes, two-factor keys, session tokens, the values of sensitive and secret fields (not even hashed), and sensitive keys of an action's input.
- **Failed sign-ins** are written without making the sign-in wait, and are capped by three caps a minute, so that guessing cannot fill the table:
  - per address and username: the first 5 are recorded, and a 6th marked as the last (`limited`);
  - per address across usernames: the first 50, and a 51st marked `limited`. An IPv6 address counts as its /64 (one client usually has a whole /64 to pick addresses from), an IPv4-mapped one (`::ffff:203.0.113.7`) as the IPv4 address;
  - for the whole process, whatever the addresses: 300 recorded failures.

  Of a lockout's answers only the first is recorded. When a minute closes, `SUPPRESSED` entries carry the counts of what was left out: one per address (and username), at most 100 of those a minute, and at most one a minute without an address, for the process-wide cap and for every address beyond the 100. **So failed sign-ins write at most 401 rows a minute per process** (300 failures, 100 named summaries, 1 unnamed one), whoever is guessing and from however many addresses. Counts that do not fit a minute are carried to the next, not dropped; only what is still uncounted when the process stops is lost. Successful sign-ins are never capped. The counters live in memory, per process (four processes write up to four times as much).
  - **Whatever was typed into the username box is stored**, cut to 200 characters. A password typed there by mistake ends up in the log.
- **Reading.**
  - `GET /api/resources/:r/:id/history` (the History tab on a record) is for whoever may open the record: the same 403 and 404 as GET, a record in the trash included. It needs no extra permission.
  - `GET /api/audit?actor=&event=&resource=&record=&from=&to=` (user menu → Audit log) needs the global code **`audit.view`**, which exists only with `audit`. `event` is a whole name or a family ending in `.*` (`order.*`, `auth.*`); `record` needs `resource`, and alone matches only entries without a resource (a role's name, a user's id); `from`/`to` are days (UTC) or instants.
  - Both answer 50 entries a page, newest first, with `next` to send as `before`.
- **Who sees what.** Entries are cut for their reader, and reading the log never shows more than the record itself would:
  - a field the reader may not view (a field rule, `restricted` without the grant) is served as `{ field, hidden: true }`; a sensitive field as `{ field, changed: true }` for everyone;
  - an action's input only to holders of that action's code; the address and browser only to holders of `audit.view`;
  - a record outside the reader's row scopes or the resource's `query()` is listed without its id, title and changes (`restricted: true`). A resource they cannot reach is listed as `*.updated`, without even its name, and a settings page they cannot view as `page.*.updated`;
  - role, group and user changes show their changes (permissions, members, flags) only with `rbac.view`. What every holder of `audit.view` still sees of `rbac.*` and `auth.*` entries: that the entry exists, its actor, and its subject, which is the role's name, the group's name, or the user's id and display name;
  - filters never match by something the reader is not shown.
- **Records that are gone.** A record's history is the history of the record that holds the key now: entries from before a purge, a hard delete or an action that deleted it are left out, so a reused key does not open its predecessor's history. On the audit page those entries are shown in full to a superuser and to a reader whom nothing restricts in that resource (no scope, no global scope, no `query()` or `findOne()` override), and closed to everyone else, because their scopes can no longer be checked against a row that does not exist.
- **If you override `findOne`** to hide records, the audit page honours it: each record is also asked of your `findOne(id, ctx, { withDeleted: true })`, and one it does not return stays closed. Keep `withDeleted` working there, or records in the trash are closed on the audit page too.
- **Retention.** With `retentionDays`, entries older than that are deleted a minute after boot and then once a day, 1,000 at a time. Without it nothing is ever deleted.
- **Limits.**
  - Changes made outside the admin (your own controllers, jobs, SQL) are not recorded. That includes deletions: a row deleted elsewhere leaves no closing entry, and if its key is given again, the earlier entries read as the new record's.
  - **MySQL and services that ignore `ctx.manager`:** such a write happens on another connection, which the admin's transaction (REPEATABLE READ) does not see. The admin then diffs against the entity your method returned, which covers columns but not relations: a relation changed that way is not recorded. Pass `ctx.manager`.
  - User and account entries (`rbac.user.*`, `auth.*`) are written after the auth adapter's call, not in a transaction with it.
  - The address is Express's `req.ip`. Behind a proxy set `trust proxy` to the proxies you run, never to `true` on an open network: a forwarded header anyone can send would then be recorded as the address.
  - `select: false` columns are not read for the diff: a change to one is not recorded.
  - On Postgres and MySQL the entry id is a 32-bit integer (2.1 billion entries).
  - **A purge always closes the record's history**, even when your `purge()` keeps the row: what was recorded before it is then read as a gone record's.
  - **An action that changes its record's primary key**, or moves a single-table-inheritance child to another type, ends the record's history: no row is left under the key the request named, which is what "gone" means.
  - **A delete on another connection** (MySQL, a service that ignores `ctx.manager`) is noticed by one more read right after the commit, and its entry is stamped as the record's end then. That step can miss: a key that is created again between the commit and the read leaves the entry unstamped; so does a crash, a failed read or a failed update in that step (failures are logged with the correlation id). An unstamped ending means a later record with the same key shows the earlier entries in its history.
  - **Read replicas.** Reads outside a transaction (that check after commit; with `transactions: false` the before and after images too) go through `dataSource.manager`, which TypeORM replication may send to a replica. A lagging replica then still shows a deleted row (no stamp), or shows an update as unchanged (a smaller diff, or no entry).
  - **Scopes that depend on a field.** A record's history is open to whoever may open the record now. A reader whose scope depends on a field (`ownerId`, a status) reads the values the record had before it entered their scope, in the fields they may view.

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
