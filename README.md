# nest-my-admin

A Django-admin-class admin panel for **NestJS + TypeORM**: declarative resources, forms from your DTOs,
admin writes that go through your own services, and a prebuilt shadcn UI served by Nest itself.

> Status: pre-alpha (milestone M0 — walking skeleton). APIs will change.

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
  - Field labels are English until M2-3 adds per-language field labels.
- **Branding.**
  - `primaryColor` may be hex, `rgb()`, `hsl()` or `oklch()`, and `radius` a length. Text on the primary colour is
    chosen from its lightness.
  - `logo` must be an http(s) URL or a relative path.
  - Anything else fails at boot, so no value can inject CSS.
- **Theme.** Light, dark or system, from the header. It is applied before the page renders, so nothing flashes.
- **Icons** for groups and resources: bell, book, box, boxes, briefcase, building, calendar, cart, chart, clock, credit-card, database, dollar, file, file-text, folder, globe, heart, history, home, image, inbox, key, layers, link, list, lock, mail, map, map-pin, message, package, phone, printer, receipt, server, settings, shield, shopping-bag, shopping-cart, star, store, tag, tags, ticket, truck, user, users, video, wallet, wrench, zap.

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

## Security (pre-alpha)

M0 has **no authentication**. Anyone who can reach the port can read every column of the registered entities that is not `select: false`, and create, update or delete records (the default delete uses `repository.remove`; override `delete` to call your service instead). Host `APP_GUARD`s do not protect the admin, by design (it is mounted on the HTTP adapter, not as Nest controllers).

Gate it yourself with Express middleware registered in `main.ts` before `listen`:

```ts
app.use('/admin', yourAuthMiddleware); // use app.use, not a string-prefix check: Express path matching is case-insensitive
```

Do not enable wildcard CORS for it. Catch-all routes the host registered earlier take precedence over the admin.

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
