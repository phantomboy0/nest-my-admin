# nest-my-admin

A Django-admin-class admin panel for **NestJS + TypeORM**: declarative resources, forms from your DTOs,
admin writes that go through your own services, and a prebuilt shadcn UI served by Nest itself.

> Status: pre-alpha (milestone M0 — walking skeleton). APIs will change.

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
without a resource.

## Security (pre-alpha)

M0 has **no authentication**. Anyone who can reach the port can read every column of the registered entities that is not `select: false`, and create or update records. Host `APP_GUARD`s do not protect the admin, by design (it is mounted on the HTTP adapter, not as Nest controllers).

Gate it yourself with Express middleware registered in `main.ts` before `listen`:

```ts
app.use('/admin', yourAuthMiddleware); // use app.use, not a string-prefix check: Express path matching is case-insensitive
```

Do not enable wildcard CORS for it. Catch-all routes the host registered earlier take precedence over the admin.

## Develop

```bash
bun install
bun run build        # UI then core
bun run test         # unit + integration
bun run e2e                          # Playwright (run `bunx playwright install chromium` in examples/demo-api once; if that download is blocked, use an installed Chrome with `PW_CHANNEL=chrome bun run e2e`)
cd examples/demo-api && bun src/main.ts
```

Design: `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md`.
