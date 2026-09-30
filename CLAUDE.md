# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

nest-my-admin: an npm-installable admin panel for NestJS + TypeORM (Django-admin parity and beyond). The design spec is `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md` (decisions D1–D14, milestones in §16); implementation plans live in `docs/superpowers/plans/`.

## Commands

```bash
bun install
bun run build                                   # packages/ui (vite) then packages/core (tsc); core serves ui/dist
bun run typecheck                               # every workspace package
bun run test                                    # all bun tests (unit next to src, integration in packages/core/test, examples/demo-api/test)
bun test packages/core/test/crud.test.ts        # one file
bun test -t "rejects unknown fields"            # tests matching a name
bun run db:up                                   # Postgres + MySQL in Docker for the lines below
bun run test:postgres                           # whole suite on Postgres (test:mysql for MySQL); or NMA_TEST_DB=postgres bun test <file>
bun run compat                                  # core suite on NestJS 11.0 + TypeORM 0.3.20 (scripts/oldest-supported.ts), in a temp copy
bun run e2e                                     # build + Playwright on examples/demo-api (desktop + mobile); needs `bunx playwright install chromium` once (or, if that download is blocked, `PW_CHANNEL=chrome bun run e2e` to use installed Chrome)
bun run pack:smoke                              # pack core+ui, npm-install into a temp app, boot on node and bun
cd examples/demo-api && bun src/main.ts         # demo at http://localhost:3000/admin
cd packages/ui && bun run dev                   # UI dev server :5173, proxies /admin/api to :3000
```

## Architecture

- `packages/core` (ESM Nest library). `ResourceRegistry` discovers `@AdminResource` providers via `DiscoveryService` in `onModuleInit`, attaches the TypeORM repository, and builds a `ResourceSchema` with `buildResourceSchema` (TypeORM column metadata + class-validator DTO metadata). The sidebar group of a resource is the Nest module that provides it (`@AdminGroup` customises it).
- The admin HTTP surface is **not** Nest controllers: `AdminHttpServer` mounts one handler on the Express adapter at `path` (spec D12), so host guards, interceptors, pipes, filters and `setGlobalPrefix` never affect it. `/api/*` goes through the package's own `Router` → `AdminApiService` → resource methods; everything else is served by `UiAssets` (SPA fallback, `<base href>` + JSON config (`<script type="application/json" id="nma-config">`) injected into `index.html`).
- Writes: `validateWrite` (DTO whitelist + class-validator) → the resource's `create`/`update`, which host apps override to call their services (spec D2). Errors always leave through `toErrorResponse` as `{ code, message, fields?, correlationId }`; TypeORM unique/not-null violations are mapped to field errors.
- Lists: `parseListQuery` turns `filter[field][op]=value` / `search=` into `FilterCondition`s using only the schema's allow-lists (`list.filters`, `list.search`, `list.sortable`); `applyListParams` puts them on a TypeORM `SelectQueryBuilder` (LIKE escaped with `!`, primary key as sort tie-breaker). Resources override `findMany` and extend `this.buildListQuery(params, ctx?, alias?)` to add restrictions; those apply to the list only, so mirror them in `findOne` (used by GET/PATCH/DELETE by id).
- Relations (M1c-2): `relationFields` (schema/relation-fields.ts) turns many-to-one, owning one-to-one and owning many-to-many relations into `type: 'relation'` fields. A to-one field is named by `relation.joinColumns[0].propertyName`, so an explicit `customerId` column becomes the field. `resolvePath` validates `customer.name` paths. `applyListParams(qb, params, metadata)` joins them as `<alias>_<relation>` and adds `addSelect` for sort paths, because skip/take with joins breaks otherwise. Many-to-many filters use `EXISTS` on the join table. `crud/references.ts` loads `{ id, title }` refs and path values after the finder runs. `relationIdsOf` + `AdminApiService.checkRelationsExist` (through `relationOptions()`) validate ids before the resource method runs, and the default `create`/`update` call `toRelationReferences`. Titles come from `compileTitle`; `registry.titleFor(metadata, dataSource)` also covers entities without a resource.
- Entity shapes (M1c-3):
  - `_id` is the encoded record id (`crud/record-id.ts`: `~0`/`~1` escapes, `~new`), and `parseRecordId` returns a scalar for one key, `{ key: value }` for composite keys.
  - Embedded columns and nested DTOs are `type: 'object'` fields with `fields` (and `many`), built by `schema/nested-fields.ts`. `nestedTypeOf` finds `@Type` classes by probing `plainToInstance`. Constraints and errors use dotted paths (`hours.*.day` in constraints).
  - Single-table inheritance: child resources hide the discriminator, and the root has `creatable: false`. `AdminApiService.records` fills the discriminator from each entity's class.
  - `If-Match` → `checkVersion` (row lock, 409 `AdminConflictError` with `current`).
  - Soft delete: `trashed` list param, and base `delete`/`restore`/`purge`.
- Lists at scale (M1c-4):
  - `query(qb, ctx)` (base) restricts `buildListQuery`, `findOne` (now query-builder based with `setFindOptions`) and relation options and existence checks through the target resource.
  - `list.count` goes through `crud/count.ts` (`EXPLAIN` estimates, exact below 1000 rows).
  - `list.pagination: 'keyset'` goes through `crud/cursor.ts`: `after` is a base64url `{ s, v }`, and `applyKeyset` builds the WHERE clause.
  - `autoRegister` is a list of DataSource names.
  - `linkRelations` fills `schema.related`, adds the implied filters, and fills `sortPaths` (relation → title column).
  - `relationOptions` takes a 4th `values` argument (`?values=` JSON, or the body/stored record on writes).
- UI shell and i18n (M2-1):
  - Text lives in `packages/ui/src/i18n/{en,fa}.ts`. `fa` is typed as `Messages` from `en`, and a test checks keys, placeholders and physical Tailwind utilities.
  - React components use `useT()`; non-React code uses `translate()` (module locale from `applyLocale`).
  - Core resolves `LocalizedText` labels per request (`pickLocale(Accept-Language)` in `AdminHttpServer.handle`, `meta(locale)`/`schema(locale)`), and sets `Content-Language` and `Vary`.
  - Theme and branding are applied in `main.tsx` before render (`lib/theme.ts`).
  - Sidebar state lives in `lib/nav-state.ts`, and icons come from a curated map (`lib/icons.ts`).
  - `/g/:group` is a group landing page, and `/` shows every group with counts.
- Hooks (`@BeforeSave/@AfterSave/@BeforeDelete`) run only in `AdminResourceBase`'s default create/update/delete; resources that override those methods call their own services instead.
- Writes run inside `AdminApiService.write()`: one `dataSource.transaction()`, `ctx.manager` set, and `AdminContext.run()` re-entered so `AdminContext.current()` sees the transactional context. `AdminResourceBase` defaults use `repositoryFor(ctx)`. Reads get no manager. On Postgres/MySQL a service that ignores `ctx.manager` writes on another pooled connection (outside the transaction, can block on its locks); SQLite-family writes are serialized per DataSource.
- Form constraints: `dtoConstraints` compiles class-validator metadata (names like `isLength`, `matches`, `isIn`; `@IsOptional` is `name: 'isOptional'`; `@ValidateIf` properties get no client rules; DTO properties with a class initializer are not required) on top of entity facts into `form.constraints.{create,update}`; the UI's `validatePayload` checks them before submit. PATCH is always validated as partial.
- `packages/core/src/contract.ts` is the JSON contract with the UI. It is types only; the UI imports it from source through a tsconfig path.
- `packages/ui` is a Vite + React + shadcn SPA published as static `dist/` only (all its deps are devDependencies). The shadcn primitives and theme tokens were copied from crm-next (`radix-nova`, neutral).
- `examples/demo-api` is the reference host app used by integration and E2E tests. It imports `@nest-my-admin/core` through the package `exports` (the built `dist/`), so run `bun run build` (or `bun run --filter @nest-my-admin/core build`) after changing core; the root `test`, `typecheck` and `e2e` scripts do this for you.

## Conventions

- Relative imports in `packages/core` use `.js` extensions (NodeNext ESM).
- `decimal` and `bigint` values are always strings in API responses (`serializeValue`); drivers disagree, so never rely on the driver.
- Playwright files end in `.pw.ts`; Bun's test runner would otherwise pick up `*.spec.ts`.
- New UI inputs for numbers use `type="text"` with `inputMode`, not `type="number"`.
- Integration tests get their database from `createTestApp` (core) or `testDatabase()` (`packages/core/test/helpers/test-db.ts`): one fresh database per app on the server `NMA_TEST_DB` selects. Never hardcode `type: 'sqljs'` in a test. Assertions that differ by driver branch on `TEST_DB` and say why.
- Database errors are mapped in `http/error-response.ts` using the resource's `dbNames` (column, unique constraint/index and FK names → properties). MySQL reports unique constraints as index names; SQLite's FK error names no column and no side (the request method decides).
- In Bun 1.4.2, `expect(obj).toMatchObject({ x: expect.any(...) })` overwrites `obj.x` with the matcher — read values you need before such assertions.
