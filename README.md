# nest-my-admin

A Django-admin-class admin panel for **NestJS + TypeORM**: declarative resources, forms from your DTOs,
admin writes that go through your own services, and a prebuilt shadcn UI served by Nest itself.

> Status: pre-alpha (milestone M0 — walking skeleton). APIs will change.

Requires NestJS 11 or 12, TypeORM 0.3.20+ or 1.x, Node 20.19+ (or Bun), and Postgres, MySQL 8 or SQLite.
The package is ESM; CommonJS apps load it through Node's `require(esm)`.

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

Override `findMany` and start from `this.buildListQuery(params)`, which already applies filters, search, sort and
paging; add your joins or restrictions to it. A restriction added there applies to the list only, so apply the same
one in `findOne`, which GET, PATCH and DELETE by id use:

```ts
async findMany(params: ListParams) {
  const [items, total] = await this.buildListQuery(params).andWhere('entity.archived = false').getManyAndCount();
  return { items, total };
}
findOne(id: RecordId) { return this.repository.findOne({ where: { id, archived: false } }); }
```

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
