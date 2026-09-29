# nest-my-admin — Design Spec

- **Date:** 2026-09-29
- **Status:** Draft for review
- **Scope of this spec:** the whole product architecture and the public contracts between its parts. Each milestone (§16) gets its own implementation plan.

## 1. Purpose

An open-source, npm-installable admin panel for **NestJS + TypeORM** that matches Django admin feature-for-feature and goes beyond it. It is configured declaratively in the NestJS style, enforces the host app's business logic and permissions on the server, and ships a polished, mobile-friendly shadcn UI whose look is based on the `crm-next` dashboard.

### Success criteria
1. Installing the package and calling `AdminModule.forRoot({ autoRegister: true })` gives a working admin for every entity with **zero frontend tooling** in the host project.
2. Admin writes can run through the host's own services, so business rules are never bypassed.
3. Permissions (entity, field, row, record, action) are enforced on the server at every read and write path, verified by an automated leak-crawler test suite.
4. The same package is reused across several projects and is suitable for public open-source release.
5. It works fully in English (LTR) and Persian (RTL, Jalali) from the first release, on desktop and mobile.

### Non-goals (v1)
- ORMs other than TypeORM.
- A running Next.js server (the UI is a prebuilt SPA; see §2).
- A public, semver-stable REST API (the REST layer is internal; see §11).
- Deny rules, time-based access, approval workflows (can be added later on the same policy engine).

## 2. Decisions log

| # | Decision | Chosen | Rejected alternatives |
|---|---|---|---|
| D1 | UI delivery | Prebuilt React + Vite + shadcn + TanStack SPA, served statically by Nest | Embedded Next.js server; SPA + eject |
| D2 | Business logic | Service-first: resource classes override `create/update/delete` to call host services; generic repository + hooks as fallback | Hooks only; TypeORM subscribers only |
| D3 | Auth source | Pluggable `AdminAuthAdapter`; built-in adapter in `@nest-my-admin/auth`; RBAC tables always owned by the package | Built-in only; app-provided only |
| D4 | Permission levels | Entity CRUD, field, row (scope), action — plus per-record rules | — |
| D5 | i18n | English + Persian, LTR + RTL from day one | Single locale first |
| D6 | Config style | Separate `@AdminResource` provider classes (Django `ModelAdmin` style) with DTO-driven form inference and zero-config auto-registration | Decorators on entities only |
| D7 | Auth tokens | Opaque, hashed, server-side sessions (revocable) | JWT in cookie |
| D8 | Live updates (v1.1) | SSE + pluggable pub/sub | Socket.IO |
| D9 | Background work | DB-backed job table + in-process worker; BullMQ adapter optional | Require Redis |
| D10 | Tooling | Bun workspaces, Bun scripts and test runner; Node 20+ still supported for consumers | pnpm + Node |
| D11 | Dogfooding | v0.1 (after M3) is adopted in a new real project chosen by the owner at that point; the demo app is used until then | CRM backend; demo only |

## 3. Packages

Monorepo `nest-my-admin` (Bun workspaces):

| Package | Contents | Peer deps |
|---|---|---|
| `@nest-my-admin/core` | Nest module, decorators, metadata registry, config resolution, CRUD engine, query parser, policy engine, jobs, storage, events, REST controllers, static serving of the UI | `@nestjs/common`, `@nestjs/core`, `typeorm`, `class-validator`, `class-transformer`, `reflect-metadata` |
| `@nest-my-admin/ui` | Prebuilt SPA (static assets only, no runtime JS deps for the host) | — |
| `@nest-my-admin/auth` | Built-in auth adapter: admin users, password hashing, sessions, 2FA (TOTP), rate limiting | `@nest-my-admin/core` |
| `@nest-my-admin/testing` | Test utilities for host apps (§13.3) | `@nest-my-admin/core`, `@nestjs/testing` |
| `@nest-my-admin/sdk` (v1.1) | Types, Vite preset and helpers for UI plugins | — |
| `@nest-my-admin/cli` | `nma` CLI + Nest schematics (§13.1) | — |

Also `examples/demo-api`: a Nest app with representative entities, used for development, integration and E2E tests.

`core` and `ui` are versioned and released in lockstep. `core` depends on the exact matching `ui` version.

## 4. Runtime architecture

1. **Boot:** `core` discovers every provider decorated with `@AdminResource` (via Nest `DiscoveryService`). It reads TypeORM entity metadata and class-validator metadata of the DTOs, applies the resolution rules (§5.3), validates the configuration (failing fast on errors, §13.2), and builds a **resource schema registry**.
2. **Meta:** the SPA loads `GET /admin/api/meta` (light: sidebar, current user, locale, branding, `permissionsVersion`, `schemaVersion`) and lazily `GET /admin/api/meta/resources/:name` (full field/list/form/action schema). Both are **already filtered by the current user's permissions** and cached with ETags.
3. **Requests:** `auth guard → policy check (entity → record → fields) → DTO validation → resource method (host service override, or repository + hooks) → audit/events → response serialization (field stripping)`.
4. **Scopes** (row-level and global) are applied inside the query layer for every read path, never in the UI.
5. **Static UI:** Nest serves `@nest-my-admin/ui` assets at the configured path, with a history fallback, and injects runtime config (`window.__NMA__`: base path, API URL, branding) into `index.html`, so changing `path` needs no rebuild. Assets are resolved with `require.resolve('@nest-my-admin/ui/package.json')` so they survive webpack/`nest build` bundling and monorepos.

## 5. Declarative API

### 5.1 Root and feature registration

```ts
@Module({
  imports: [
    AdminModule.forRoot({
      path: '/admin',
      title: 'My CRM',
      locale: 'fa',                         // default; users may switch
      locales: ['fa', 'en'],
      auth: AdminAuth.builtin({ /* session, 2fa, password policy */ }),  // or AdminAuth.custom(MyAdapter)
      autoRegister: true,                   // default resource for unregistered entities
      roles: [/* system roles, §6.6 */],
      globalScopes: [/* e.g. tenant scope, §6.4 */],
      branding: { name, logo, primaryColor, radius, font },
      storage: AdminStorage.s3({ /* ... */ }),  // or .local({ dir })
      jobs: AdminJobs.database(),               // or .bullmq({ connection })
      audit: { source: 'admin', retentionDays: 365 },
      errorMapper: (err) => /* map domain errors to AdminError */ undefined,
    }),
    OrdersModule,
  ],
})
export class AppModule {}

@Module({
  imports: [AdminModule.forFeature([OrderAdmin, OrderItemAdmin], { group: 'sales', icon: 'cart', label: { en: 'Sales', fa: 'فروش' } })],
  providers: [OrdersService],
})
export class OrdersModule {}
```

Each `forFeature` call defines a **sidebar group**; each resource is a **sidebar tab** within it. The registry is namespaced by **site** (`default` in v1); multiple admin sites (e.g. `/admin`, `/partner`) are enabled in v1.1 without breaking changes.

### 5.2 Resource classes

```ts
@AdminResource(Order, {
  name: 'order',                                         // URL + permission prefix; defaults to kebab(entity)
  group: 'sales',
  icon: 'receipt',
  label: { en: 'Orders', fa: 'سفارش‌ها' },
  title: (o) => `#${o.number} · ${o.customer.name}`,     // record display name everywhere
  dataSource: 'default',
})
export class OrderAdmin extends AdminResourceBase<Order> {
  constructor(private readonly orders: OrdersService, private readonly geo: GeoService) { super(); }

  fields: FieldsConfig<Order> = {
    total:    { widget: 'money', readonlyIf: (o) => o.status !== 'draft' },
    status:   { widget: 'badge', colors: { paid: 'green', cancelled: 'red' } },
    customer: { search: ['name', 'phone'] },
    city:     { dependsOn: 'province', options: (values, ctx) => this.geo.cities(values.province) },
    discount: { showIf: { status: 'draft' } },
    slug:     { from: 'title' },
    salary:   { restricted: true, sensitive: true },
  };

  list: ListConfig<Order> = {
    columns: ['number', 'customer.name', 'total', 'status', 'createdAt'],
    search:  ['number', 'customer.name', 'customer.phone'],
    filters: ['status', 'createdAt', 'customer'],
    sort: '-createdAt',
    pageSize: 25,
    editable: ['status'],
    count: 'exact',                        // 'exact' | 'estimate' | 'none'
    pagination: 'offset',                  // 'offset' | 'keyset'
    mobile: { title: 'number', subtitle: 'customer.name', badge: 'status', meta: ['total'] },
  };

  form: FormConfig<Order> = {
    create: CreateOrderDto,
    update: UpdateOrderDto,
    layout: [
      { section: 'Customer', fields: ['customer', 'province', 'city', 'address'] },
      { section: 'Items', inline: OrderItemAdmin },
      { section: 'Payment', fields: ['discount', 'total'], columns: 2 },
    ],
  };

  links = (o: Order) => [{ label: 'View on site', href: `https://shop.example/orders/${o.number}` }];

  // Business logic: override defaults to call host services.
  create(dto: CreateOrderDto, ctx: AdminContext) { return this.orders.create(dto, ctx.user); }
  update(id: number, dto: UpdateOrderDto, ctx: AdminContext) { return this.orders.update(id, dto, ctx.user); }
  delete(id: number, ctx: AdminContext) { return this.orders.cancel(id, ctx.user); }
  // Not overridden: findMany, findOne → default repository implementation.

  query(qb: SelectQueryBuilder<Order>, ctx: AdminContext) { return qb; }   // extra joins/aggregates
  relationOptions(field: string, qb: SelectQueryBuilder<any>, ctx: AdminContext, values: Partial<Order>) { return qb; }

  @AdminScope('own')    own(ctx: AdminContext)    { return { ownerId: ctx.user.id }; }
  @AdminScope('branch') branch(ctx: AdminContext) { return { branchId: ctx.user.attrs.branchId }; }

  @AdminCan('update')
  canEdit(o: Order, ctx: AdminContext) { return o.status === 'draft' || ctx.user.can('order.edit_locked'); }

  @AdminComputed({ label: 'Margin', widget: 'money' })
  margin(o: Order) { return o.total - o.cost; }

  @AdminBadge()
  pending(ctx: AdminContext) { return this.orders.countPending(ctx.user); }

  @AdminAction({ label: 'Approve', bulk: true, confirm: true, atomic: false })
  approve(ids: number[], ctx: AdminContext) { return this.orders.approve(ids, ctx.user); }

  @AdminAction({ label: 'Refund', input: RefundDto, variant: 'destructive', async: false })
  refund(id: number, input: RefundDto, ctx: AdminContext) { return this.orders.refund(id, input, ctx.user); }

  @BeforeSave() normalize(dto: unknown, ctx: AdminContext) {}   // only used by default create/update
  @AfterSave()  afterSave(entity: Order, ctx: AdminContext) {}
  @BeforeDelete() guard(entity: Order, ctx: AdminContext) {}
}
```

Other decorators: `@AdminPage()` (custom pages), `@AdminWidget()` (dashboard widgets), `@OnAdminEvent()` (§8.3), `@AdminField()` (hints on entity/DTO properties, §5.3).

**Typing:** `FieldsConfig<T>`, `ListConfig<T>`, `FormConfig<T>` accept field paths typed from the entity (`'customer.name'` autocompletes; typos fail to compile). Path typing is depth-limited to 3 levels.

**Zero-config:** with `autoRegister: true`, every entity without a resource gets a default `AdminResourceBase` (all columns listable, generated DTO, repository CRUD).

### 5.3 Field resolution order

Each field's schema is built in layers; later layers override earlier ones:

1. **TypeORM metadata:** type, nullable, length, precision, enum values, default, primary/generated, relations, embedded columns, inheritance, tree.
2. **DTO class-validator metadata:** required/optional, min/max, length, pattern, `@IsEmail` → email widget, `@ValidateNested` + `@Type` → sub-form / array of sub-forms.
3. **`@AdminField()` hints** on entity or DTO properties (reusable labels, widgets, help).
4. **Resource `fields` config.**
5. **Runtime permissions** of the current user — may only hide or make readonly, never grant.

Invariants:
- **The DTO defines what is writable; the entity defines what is readable.** A field absent from the relevant DTO can never be written through the admin (`whitelist` + `forbidNonWhitelisted`).
- With no DTO supplied, one is generated from entity metadata: all columns except primary/generated, `select: false`, and those marked `readonly`.
- Form inference only sees DTO properties carrying class-validator decorators (TypeScript types do not exist at runtime).
- Conditions: object-form conditions (`showIf: { status: 'draft' }`) are serialized and evaluated **live in the browser**; function-form conditions (`readonlyIf: (o) => …`) are evaluated **on the server**, returned per record as `_perm: { canUpdate, canDelete, canActions: [...], readonly: [...] }`, and re-checked on save.

### 5.4 TypeORM coverage

- Embedded columns → nested field group.
- Table inheritance (`@TableInheritance` / `@ChildEntity`) → one resource per child entity; discriminator handled automatically.
- `@Tree` entities → tree view in addition to list view.
- Composite primary keys → encoded record id in URLs.
- `bigint` and `decimal` → kept as strings end-to-end; never converted to JS floats.
- `@VersionColumn` → optimistic concurrency (409 + diff dialog).
- `@DeleteDateColumn` → soft delete, trash, restore, purge.
- Multiple DataSources → `dataSource` option per resource.
- Relations used in `list.columns` are joined automatically (no N+1).

### 5.5 AdminContext

Passed to every resource method and also available anywhere via `AdminContext.current()` (AsyncLocalStorage), including host services and TypeORM subscribers, so host code does not need signature changes to know the actor.

Fields: `user` (id, displayName, isSuperuser, attrs, `can(code)`), `permissions`, `locale`, `timezone`, `request`, `manager` (transactional `EntityManager`), `site`, `correlationId`.

Every mutation runs in a transaction; host services opt in by using `ctx.manager`.

### 5.6 Widgets

Built in: text, textarea, number, money (thousands separators), boolean/switch, select/enum, multi-select, date, datetime (Gregorian + Jalali), relation combobox (async search, "+ Create new"), many-to-many picker, JSON, file, image, rich text (Tiptap; sanitized server-side), color, badge (display), slug.

Widget contract (UI side): `{ value, onChange, field, readonly, ctx }`. Plugins (v1.1) may register new widgets or override built-ins by name.

## 6. Permissions

### 6.1 Model
- **Permission:** a code string. Auto-generated: `{r}.view`, `{r}.create`, `{r}.update`, `{r}.delete`, `{r}.import`, `{r}.export`, `{r}.purge`, `{r}.action.{name}`, `{r}.field.{field}.view|edit`, `page.{name}`, `widget.{name}`. Custom codes may be declared (e.g. `order.view_all`).
- **Role:** named bundle of permissions + field rules + scope assignments.
- **Group:** set of users; groups are assigned roles.
- **Effective permissions** = union of direct roles and group roles. **Grant-only** (no deny). `isSuperuser` bypasses all checks.

### 6.2 Field level
- Fields are editable/viewable by anyone with the entity permission unless a rule says otherwise.
- Roles can mark any field `hidden` or `readonly` per resource (Roles UI).
- `restricted: true` in code hides the field from everyone except roles explicitly granted `{r}.field.{f}.view` / `.edit`.
- Multiple roles → most permissive wins per field.

### 6.3 Record level
`@AdminCan('update' | 'delete' | '<action>')` methods decide per record; the UI disables controls using `_perm`, and the server re-checks on every mutation.

### 6.4 Row level
- Named scopes defined in code (`@AdminScope('own')`); the Roles UI assigns a scope per role, per resource, per operation (view/update/delete). Implicit `all` = no restriction. Multiple roles → scopes combined with OR.
- `globalScopes` in `forRoot` apply to every resource (multi-tenancy); they are ANDed with resource scopes.
- Scopes apply to: list, detail, update, delete, actions, inlines, exports, imports (upsert lookups), counts, badges, global search, **relation pickers**, and audit log views.

### 6.5 Enforcement
- A single `AdminPolicy` service used at every enforcement point.
- Meta is filtered per user. Responses strip hidden fields at serialization. Writes containing hidden/readonly fields are rejected with 403 `FORBIDDEN_FIELDS` listing them.
- **Anti-oracle:** filter, sort, search, export, and aggregates are only permitted on fields the user can view.
- **Anti-escalation:** a user can grant only permissions they hold; only superusers can grant superuser; "view as" impersonation is read-only and audited.
- Out-of-scope records return **404** (existence is not leaked).
- Effective permissions are cached per user and invalidated on change (`permissionsVersion`); cache is pluggable (memory default, Redis adapter).

### 6.6 Storage and seeding
- Package-owned tables (prefix `nma_`, configurable; optional Postgres schema): roles, groups, memberships, role permissions, field rules, scope assignments, sessions, jobs, audit, saved views, user preferences, files.
- `forRoot({ roles: [...] })` defines **system roles**, synced at boot, not deletable in the UI.
- Roles export/import as JSON.
- Auth adapters may implement `resolveRoles(user)` to map host-app roles to admin roles.

### 6.7 Tooling
- **Permission debugger:** explains which rule allowed or denied a given user/resource/record/field/operation.
- **View as user** (superuser only, read-only, audited).
- **Roles UI matrix:** resources × CRUD, expandable to fields, actions and scope selection.

## 7. Authentication

`AdminAuthAdapter` interface: `login(credentials, req)`, `logout(session)`, `validate(req) → AdminUser | null`, `getUser(id)`, optional `resolveRoles(user)`, optional `changePassword`.

`@nest-my-admin/auth` (built-in adapter):
- Own `nma_user` table; argon2/bcrypt password hashing; password policy.
- **Opaque session tokens**, stored hashed in `nma_session`, httpOnly + Secure + SameSite=Lax cookie, sliding expiry, session list and "log out everywhere".
- CSRF: custom header token required on mutating requests.
- Login rate limiting and lockout; TOTP 2FA with recovery codes.
- `nma createsuperuser` CLI command.

Custom adapters let hosts reuse their existing User entity and login flow.

## 8. Infrastructure services

### 8.1 Jobs
- Default: `nma_job` table + in-process worker; row claiming with `SKIP LOCKED` on Postgres and MySQL 8; single worker on SQLite. Optional BullMQ adapter.
- Used by: imports, large exports, `@AdminAction({ async: true })`, audit pruning, orphaned-file cleanup.
- Jobs page: progress, cancel, result download, error details. Job completion emits an event.

### 8.2 File storage
- `StorageAdapter { put, getStream, signedUrl, delete }`; built-in local disk and S3-compatible (S3, R2, MinIO, ArvanCloud).
- Upload flow: `POST /uploads` → temporary token → form submits token → resource method receives an `AdminFile` object (so host services handle files).
- MIME detection from content, size limits per field, private by default, downloads via permission-checked endpoint or short-lived signed URL, optional thumbnails via optional peer `sharp`, orphan cleanup job.

### 8.3 Events
Emitted with actor and diff: `{r}.created|updated|deleted|restored|purged`, `{r}.action.{name}`, `auth.login|login_failed|logout`, `role.changed`, `export.started|completed`, `import.completed`, `job.completed|failed`. Handlers: `@OnAdminEvent('order.updated')`.

## 9. UI

Built from crm-next's building blocks: shadcn (`radix-nova`, neutral), shadcn Sidebar, TanStack Table/Form/Query/Virtual, sonner, Sheets, async comboboxes, recharts.

### 9.1 Shell
- Sidebar: collapsible group per module, tab per resource with icon and live badge, filter box, pinned favorites, recents, icon-collapse, side follows direction; drawer on mobile.
- Header: breadcrumbs, ⌘K command palette (navigate, cross-resource record search, run actions), theme toggle, locale switch, user menu.
- Routes: `/:resource`, `/:resource/new`, `/:resource/:id`, `/p/:page`, `/jobs`, `/audit`, `/roles`, `/groups`, `/users`, `/trash/:resource`.
- Module landing page: resources in the group with counts.

### 9.2 List
- Server-side pagination (offset or keyset), sort, search; state in URL.
- Typed filter bar (enum multi-select, date range incl. Jalali with year/month drill-down, number range, relation, boolean) with removable chips.
- Column visibility/order/width and density, persisted per user.
- Saved views (personal or shared with a role).
- Row selection → bulk action bar; row actions menu; `list.editable` cell editing; quick-view Sheet on row click.
- Empty, skeleton-loading and error-with-retry states.

### 9.3 Mobile
- Cards from `list.mobile`, infinite scroll; filters/sort in a bottom drawer; select mode for bulk actions.
- Single-column forms, sticky save bar, inlines as stacked cards.
- Numeric inputs use `type="text" inputMode="numeric"` (a controlled `type="number"` can dismiss the mobile keyboard).

### 9.4 Detail and forms
- Header with title, status badges, actions, external links.
- Tabs: Details · Related (inlines, reverse relations) · History (audit diffs).
- TanStack Form with `layout` sections/tabs/columns; client validation compiled from DTO metadata; server errors mapped to fields; unsaved-changes guard; `Ctrl/⌘+S`; Duplicate and Save & new.
- Relation combobox with "+ Create new" opening the related resource's form in a Sheet and selecting the result.
- Concurrent edit conflict (409) → diff dialog.

### 9.5 Theming and i18n
- `branding` sets shadcn CSS variables at runtime; light/dark/system; optional host CSS file.
- Bundled fonts: Vazirmatn (fa), Geist/Inter (en).
- en + fa message bundles, overridable and extensible; labels as `{ en, fa }` or i18n keys.
- Direction from locale; logical Tailwind utilities only (`ms-/me-`, `start/end`).

### 9.6 Plugins (contract designed now, shipped in v1.1)
Host-built ESM bundle (via `@nest-my-admin/sdk` Vite preset) served by Nest from the same origin; registers widgets, list cells, form sections, detail tabs, pages. React and UI primitives are shared from the host SPA through an import map. Referenced by name, e.g. `component: 'my-plugin:OrderTimeline'`.

### 9.7 Performance
Route-level code splitting; lazy per-resource meta with ETags; virtualized lists; server-side joins.

## 10. Feature catalogue

### 10.1 Django parity

| Django | nest-my-admin |
|---|---|
| `list_display`, `list_filter`, `search_fields`, `ordering`, `list_per_page` | `list` |
| `fieldsets`, `readonly_fields`, `exclude` | `form.layout`, `readonly`/`readonlyIf`, DTO whitelist |
| `inlines` | `inline:` |
| `autocomplete_fields`, `raw_id_fields`, `filter_horizontal` | relation combobox, m2m picker |
| `formfield_for_foreignkey` | `relationOptions()` |
| `has_*_permission(obj)` | `@AdminCan()` |
| `prepopulated_fields` | `{ from: 'title' }` |
| `list_editable` | `list.editable` |
| `date_hierarchy` | date-range filter drill-down |
| `actions` | `@AdminAction` |
| `save_as`, save and add another | Duplicate, Save & new |
| `view_on_site` | `links` |
| `show_full_result_count` | `list.count` |
| `LogEntry` | audit log |
| multiple `AdminSite` | site-namespaced registry (UI v1.1) |
| `createsuperuser`, admindocs | `nma createsuperuser`, generated resource/permission docs page |

### 10.2 Beyond Django
- **Audit log:** field-level diffs; `source: 'admin'` or `'all'` (TypeORM subscriber + AsyncLocalStorage actor); respects field permissions and scopes; `sensitive` fields masked; auth, permission-change and export events audited; field revert via update DTO/service (disabled when the field is not in the DTO); retention pruning.
- **Soft delete:** trash, restore, purge (separate permission).
- **Export (CSV/XLSX):** streamed; honours filters, scope and field permissions; CSV formula-injection escaping; UTF-8 BOM; RTL sheets for `fa`; large exports as jobs.
- **Import:** column mapping, relation lookup by natural key, upsert by key, dry-run preview, per-row errors with downloadable failed rows, all-or-nothing or per-row mode, runs through the DTO + resource methods, runs as a job.
- Command palette, saved views, quick-view sheets, dashboards (`@AdminWidget`, per-user layout, permission-gated), tree view, jobs page, permission debugger, view-as.
- **v1.1:** live updates over SSE (presence + list refresh; pub/sub adapters: memory, Redis, Postgres NOTIFY), notifications.

## 11. API contract

- Base: `/{path}/api`. JSON. **Internal** — semver covers the TypeScript/decorator API, the auth adapter interface and the plugin SDK, not the REST layer. Meta carries `schemaVersion`.
- Endpoints (shape): `GET /meta`, `GET /meta/resources/:r`, `GET /resources/:r`, `GET /resources/:r/:id`, `POST /resources/:r`, `PATCH /resources/:r/:id`, `DELETE /resources/:r/:id`, `POST /resources/:r/actions/:action`, `GET /resources/:r/fields/:field/options`, `POST /resources/:r/import`, `POST /resources/:r/export`, `POST /uploads`, `GET /files/:id`, `GET /jobs`, `GET /audit`, `GET /search`, auth routes, RBAC routes.
- **List query:** `?page=1&pageSize=25&sort=-createdAt,name&search=ali&filter[status][in]=paid,draft&filter[total][gte]=100&filter[customer.id][eq]=42` (keyset: `&after=<cursor>`). Operators: `eq ne in nin lt lte gt gte between contains startsWith isNull`. Parsed by the package's own parser (Express 5 no longer parses brackets; Fastify differs). Field names are validated against metadata and the anti-oracle rule; values are always parameterized.
- **Bulk results:** `{ ok: [ids], failed: [{ id, code, message }] }`; `atomic: true` makes it all-or-nothing.
- **Error shape:** `{ code, message, fields?: Record<string, string[]>, correlationId }`.

| Code | Status | UI |
|---|---|---|
| `VALIDATION` | 422 | per-field messages |
| `FORBIDDEN` / `FORBIDDEN_FIELDS` | 403 | toast naming fields |
| `NOT_FOUND` | 404 | not-found page (also for out-of-scope records) |
| `CONFLICT` | 409 | diff dialog |
| `BUSINESS_RULE` | as thrown | host `HttpException` passed through (toast or field error) |
| `INTERNAL` | 500 | toast with correlation id; no stack traces sent |

Host code can throw `AdminFieldError({ field: 'message' })`; `errorMapper` maps domain exceptions.

## 12. Locale correctness

- **Persian search normalization:** Arabic ي/ك ↔ Persian ی/ک, Persian and Arabic-Indic digits → Latin, ZWNJ handling; queries match both character variants.
- Inputs accept all digit sets; optional Persian digit display.
- **Time:** stored in UTC, displayed in the user's timezone; Jalali filter ranges converted to UTC ranges; `date` columns never shifted.
- Money/decimal/bigint stay strings; display with thousands separators.

## 13. Developer experience

### 13.1 CLI (`nma`) and schematics
`nma init` (module + migration wiring), `nma g resource <Entity>` (also `nest g admin-resource`), `nma createsuperuser`, `nma doctor`, `nma migrations`.

### 13.2 Validation
- **Boot-time:** fail fast with precise messages and suggestions (unknown paths, unknown widgets, scopes never defined, DTO/entity mismatches, duplicate resource names).
- **`nma doctor`:** warnings for sort/filter on unindexed columns, relations without search fields, large tables with exact counts or offset pagination, restricted fields not granted to any role.

### 13.3 `@nest-my-admin/testing`
```ts
const admin = await createAdminTestingModule(AppModule);
await admin.as(operatorUser).list('order');
await admin.expectNoLeaks('employee', { role: 'operator' });   // crawls meta, list, detail, search, relation options, export, audit, filters
```

### 13.4 Migrations
Exported `AdminMigrations` for `synchronize: false` hosts; configurable table prefix and Postgres schema.

## 14. Testing strategy (package itself)

- **Unit (`bun test`):** resolution order, policy engine (grant/scope/field/record matrix), DTO → form-schema compiler, query parser, Persian normalization, error mapping.
- **Integration:** `examples/demo-api` against Postgres, MySQL and SQLite (Docker) × NestJS 10 and 11; CRUD through services, transactions, scopes, uploads, jobs.
- **Security conformance suite:** leak crawler for every demo resource × role; filter-oracle, escalation, CSRF and out-of-scope-404 tests.
- **E2E (Playwright):** desktop and mobile widths × LTR/RTL × light/dark, with screenshot comparison.
- **Type tests** for typed paths and config types.
- **Runtime matrix:** Bun (primary) and Node 20/22 (consumer compatibility) in CI.

## 15. Compatibility and packaging

- NestJS 10 (Express 4) and 11 (Express 5): SPA fallback route syntax handled internally. Fastify in v1.1.
- TypeORM 0.3.x. Postgres, MySQL 8, SQLite. Search strategy per driver (`ILIKE` vs `LOWER … LIKE`); overridable `search(qb, term)` for full-text/trigram.
- `core`, `auth`, `testing`, `cli` ship CommonJS + `.d.ts`; `ui` ships static assets.
- Built and tested with Bun; must run under Node 20+ for consumers.
- License: MIT. Securing the `@nest-my-admin` npm scope is a task in M0.

## 16. Milestones

| Milestone | Scope |
|---|---|
| **M0** | Monorepo scaffold (Bun workspaces), npm scope, CI. **Walking skeleton:** one entity list + create + edit end-to-end, SPA served by Nest from an installed tarball (proves meta contract and packaging). |
| **M1** | Core engine: registry, resolution order, typed configs, DTO compiler, query parser, service overrides + hooks, transactions, AdminContext, TypeORM coverage (§5.4), boot validation. |
| **M2** | UI: shell, list, filters, forms, detail, widgets, mobile, i18n/RTL/Jalali, theming, command-palette skeleton. |
| **M3** | Auth adapter + `@nest-my-admin/auth`, policy engine (entity/field/row/record/action), anti-oracle/escalation, Roles/Groups/Users UI, debugger, view-as, `@nest-my-admin/testing`. **→ v0.1, adopted in a new real project.** |
| **M4** | Actions (incl. async), inlines, jobs, storage/uploads, audit log, soft delete, events. |
| **M5** | Import/export, saved views, full command palette, dashboards, CLI + doctor, docs page. **→ v1.0.** |
| **v1.1** | Plugin SDK, live updates (SSE), Fastify, multiple admin sites UI, notifications, docs site. |
