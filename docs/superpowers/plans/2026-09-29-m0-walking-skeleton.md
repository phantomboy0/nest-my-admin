# M0 — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One TypeORM entity can be listed, created and edited end-to-end through an admin SPA that NestJS serves from the *installed* `@nest-my-admin/core` + `@nest-my-admin/ui` packages, proving the meta contract, the isolated HTTP mount and the ESM packaging before M1 builds the full engine.

**Architecture:** `@nest-my-admin/core` discovers `@AdminResource` providers with Nest's `DiscoveryService`, builds a JSON resource schema from TypeORM metadata and class-validator DTO metadata, and mounts a single request handler on the host's Express adapter at `/admin` (not Nest controllers — spec D12). That handler routes `/api/*` itself and serves the prebuilt `@nest-my-admin/ui` SPA (React + Vite + shadcn) for everything else, injecting `<base href>` and `window.__NMA__` into `index.html`. Writes validate against the resource's DTO and then call the resource's `create`/`update`, which host apps override to call their own services.

**Tech Stack:** Bun 1.4.2 (workspaces, scripts, `bun test`), TypeScript 7.0.2, NestJS 12.1.1 (ESM), TypeORM 1.1.1 with sql.js for tests/demo, class-validator 0.15.1, class-transformer 0.5.1, React 19.3, Vite 8.3, Tailwind 4.3, react-router 8.4, TanStack Query 5.104, Playwright 1.63, supertest 7.3.

**Spec:** `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md` (M0 row of §16; decisions D1, D2, D6, D10, D12, D13, D14).

## Global Constraints

- Runtime/tooling: Bun **1.4.2** for install, scripts and tests; consumers must work on **Node ≥ 20.19** (checked by the pack smoke test on Node and Bun).
- Versions (exact pins in devDependencies): `@nestjs/common|core|platform-express|testing` **12.1.1**, `@nestjs/typeorm` **12.0.2**, `typeorm` **1.1.1**, `class-validator` **0.15.1**, `class-transformer` **0.5.1**, `reflect-metadata` **0.2.2**, `rxjs` **7.8.2**, `sql.js` **1.14.2**, `supertest` **7.3.0**, `@types/supertest` **7.2.1**, `typescript` **7.0.2**, `@types/bun` **1.4.2**.
- M0 peer ranges declare only what M0 tests: `@nestjs/*` `^12.0.0`, `typeorm` `^1.0.0`. (Nest 11 and TypeORM 0.3 are added with a CI matrix in M1 — spec D14.)
- All packages are ESM (`"type": "module"`). Relative imports inside `packages/core` use the `.js` extension (NodeNext resolution).
- `tsconfig` must set `experimentalDecorators: true` and `emitDecoratorMetadata: true`; Nest DI depends on `design:paramtypes`.
- `@nest-my-admin/core` has exactly one runtime dependency: `@nest-my-admin/ui` (exact version). Everything else is a peer dependency.
- `@nest-my-admin/ui` publishes only `dist/` + `package.json`; React and all UI libraries are **devDependencies**.
- The admin HTTP surface is mounted on the Express adapter in `onModuleInit` (spec D12). Any other adapter → boot error `nest-my-admin: the "<type>" HTTP adapter is not supported yet; use @nestjs/platform-express`.
- Every admin API error body is exactly `{ code, message, fields?, correlationId }` with `code` ∈ `BAD_REQUEST | VALIDATION | FORBIDDEN | NOT_FOUND | CONFLICT | BUSINESS_RULE | INTERNAL`.
- `MetaResponse.schemaVersion` is the literal `1`.
- `decimal` and `bigint` values are always JSON **strings** in API responses.
- Do not copy crm-next's YekanBakh font (commercial licence) or its brand colours; M0 uses the system font stack.
- Playwright files end in `.pw.ts` (Bun's test runner would otherwise execute `*.spec.ts`).
- Git: never add `Co-Authored-By` or any AI-attribution trailer to commit messages.

## Review Focus

1. **Host app with a global guard and a global prefix** (e.g. `APP_GUARD` JWT guard + `app.setGlobalPrefix('api')`) — the admin must still answer at `/admin/api/*`, and host routes must keep their guard. → test in Task 10 (`isolation.test.ts`).
2. **Refreshing or deep-linking to a nested admin URL** (`/admin/product/new`) — the server must return `index.html` with `<base href="/admin/">` so relative assets resolve. → tests in Task 10 (`ui-serving.test.ts`) and Task 14 (direct `page.goto('/admin/product/new')`).
3. **Saving a duplicate value into a unique column** — must return `409 CONFLICT` with the error attached to that field, not `500 INTERNAL`. → tests in Task 8 (`error-response.test.ts`) and Task 12 (`catalog-admin.test.ts`).
4. **Garbage id in the URL for a numeric primary key** (`/admin/api/resources/widget/abc`) — must be `404 NOT_FOUND`, not a database error. → tests in Task 6 (`record-id.test.ts`) and Task 10 (`crud.test.ts`).
5. **SQLite returns `decimal` columns as JS numbers** (`1.5`) — the API must still return strings padded to the column scale (`"1.50"`). → tests in Task 6 (`serialize.test.ts`) and Task 12 (`catalog-admin.test.ts`).

## File Structure

```
package.json · tsconfig.base.json · tsconfig.json · .gitignore · LICENSE · README.md · CLAUDE.md
.github/workflows/ci.yml
scripts/pack-smoke.ts                      # packs core+ui, installs into a temp Node app, boots on node + bun
scripts/pack-fixture/{tsconfig.json,src/main.ts}
packages/core/
  package.json · tsconfig.json (typecheck incl. tests) · tsconfig.build.json (emit src → dist)
  src/index.ts                             # public API
  src/contract.ts                          # JSON contract with the UI — types only
  src/constants.ts                         # metadata keys, DI token
  src/errors.ts                            # AdminError + subclasses
  src/options.ts                           # AdminModuleOptions → ResolvedAdminOptions
  src/admin.module.ts                      # AdminModule.forRoot()
  src/decorators/admin-resource.ts         # @AdminResource
  src/decorators/admin-group.ts            # @AdminGroup (on Nest modules)
  src/resource/admin-context.ts            # AdminContext
  src/resource/admin-resource-base.ts      # AdminResourceBase + default repository CRUD
  src/schema/humanize.ts                   # labels / kebab-case
  src/schema/column-field.ts               # TypeORM column → FieldSchema
  src/schema/dto-fields.ts                 # class-validator DTO → field names / DTO-only fields
  src/schema/build-resource-schema.ts      # entity + resource + DTOs → ResourceSchema
  src/registry/resource-registry.ts        # discovery, DataSource wiring, groups
  src/crud/list-query.ts                   # ?page&pageSize&sort parsing
  src/crud/record-id.ts                    # URL id → typed id (or 404)
  src/crud/validate-write.ts               # body → validated DTO instance
  src/crud/serialize.ts                    # entity → JSON-safe record
  src/api/admin-api.service.ts             # meta / schema / list / get / create / update
  src/http/router.ts                       # tiny method+path router
  src/http/http-io.ts                      # sendJson, readJsonBody
  src/http/error-response.ts               # any error → { status, AdminErrorBody }
  src/http/ui-assets.ts                    # static SPA serving + runtime injection
  src/http/admin-http.server.ts            # mounts the handler on the adapter
  test/fixtures/widgets.ts · test/fixtures/ui-dist/{index.html,assets/app.js}
  test/helpers/create-app.ts
  test/*.test.ts                           # integration tests (unit tests sit next to src files)
packages/ui/
  package.json · tsconfig.json · vite.config.ts · index.html
  src/main.tsx · src/styles/globals.css
  src/lib/{utils,config,api,queries,form-values,format}.ts
  src/components/ui/{button,input,label,table,textarea}.tsx   # copied from crm-next
  src/components/page-message.tsx
  src/app/{admin-layout,home-page,list-page,form-page,field-input,not-found}.tsx
examples/demo-api/
  package.json · tsconfig.json · playwright.config.ts
  src/{main,app.module,seed}.ts
  src/catalog/{product.entity,product.dto,products.service,product.admin,catalog.module}.ts
  test/catalog-admin.test.ts · e2e/products.pw.ts
```

---

### Task 1: Monorepo scaffold and toolchain guard

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsconfig.build.json`, `packages/core/src/index.ts`
- Test: `packages/core/test/toolchain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace layout (`packages/*`, `examples/*`), root scripts `build`, `typecheck`, `test`, `e2e`, `pack:smoke`; `tsconfig.base.json` that every package extends.

- [ ] **Step 1: Human step — reserve the npm scope.** Ask the owner to create the free public npm organisation `nest-my-admin` at https://www.npmjs.com/org/create. If the name is taken, stop and ask which scope to use; the scope appears in every `package.json` name below. Continue with the remaining steps meanwhile.

- [ ] **Step 2: Write the root files**

`package.json`:
```json
{
  "name": "nest-my-admin",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "examples/*"],
  "scripts": {
    "build": "bun run --filter @nest-my-admin/ui build && bun run --filter @nest-my-admin/core build",
    "typecheck": "bun run --filter @nest-my-admin/core build && bun run --filter '*' typecheck",
    "test": "bun run build && bun test packages examples",
    "e2e": "bun run build && bun run --filter demo-api e2e",
    "pack:smoke": "bun scripts/pack-smoke.ts"
  },
  "devDependencies": {
    "@types/bun": "1.4.2",
    "@types/node": "^22.10.0",
    "typescript": "7.0.2"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "types": ["bun", "node"]
  }
}
```

`tsconfig.json` (so Bun's transpiler sees the decorator flags from the repo root):
```json
{ "extends": "./tsconfig.base.json", "files": [] }
```

`.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
*.tgz
.DS_Store
test-results/
playwright-report/
```

- [ ] **Step 3: Write the core package shell**

`packages/core/package.json`:
```json
{
  "name": "@nest-my-admin/core",
  "version": "0.0.0",
  "description": "Django-admin-class admin panel for NestJS + TypeORM",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" },
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "engines": { "node": ">=20.19.0" },
  "scripts": {
    "build": "rm -rf dist && tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "peerDependencies": {
    "@nestjs/common": "^12.0.0",
    "@nestjs/core": "^12.0.0",
    "@nestjs/typeorm": "^12.0.0",
    "class-transformer": ">=0.5.1",
    "class-validator": ">=0.14.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "typeorm": "^1.0.0"
  },
  "devDependencies": {
    "@nestjs/common": "12.1.1",
    "@nestjs/core": "12.1.1",
    "@nestjs/platform-express": "12.1.1",
    "@nestjs/testing": "12.1.1",
    "@nestjs/typeorm": "12.0.2",
    "@types/supertest": "7.2.1",
    "class-transformer": "0.5.1",
    "class-validator": "0.15.1",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "sql.js": "1.14.2",
    "supertest": "7.3.0",
    "typeorm": "1.1.1"
  }
}
```
(The `"default"` export condition lets CommonJS hosts load this ESM package through `require(esm)`.)

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test"] }
```

`packages/core/tsconfig.build.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "types": ["node"], "noEmit": false },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/core/src/index.ts`:
```ts
export {};
```

- [ ] **Step 4: Write the toolchain guard test**

`packages/core/test/toolchain.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class Probe {
  @PrimaryGeneratedColumn() id: number;
  @Column() label: string;
}

@Injectable()
class ProbeService {
  constructor(readonly dataSource: DataSource) {}
}

@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', entities: [Probe], synchronize: true })],
  providers: [ProbeService],
})
class ProbeModule {}

describe('toolchain', () => {
  test('emits decorator metadata so Nest can inject by type', () => {
    expect(Reflect.getMetadata('design:paramtypes', ProbeService)).toEqual([DataSource]);
  });

  test('boots Nest 12 + TypeORM 1 on sql.js', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    const service = moduleRef.get(ProbeService);
    expect(service.dataSource).toBe(moduleRef.get(getDataSourceToken()));
    const repository = service.dataSource.getRepository(Probe);
    await repository.save({ label: 'ok' });
    expect(await repository.count()).toBe(1);
    await moduleRef.close();
  });
});
```

- [ ] **Step 5: Install and run the test**

Run: `bun install && bun test packages/core/test/toolchain.test.ts`
Expected: `2 pass, 0 fail`. If `design:paramtypes` is `undefined`, Bun is not reading the decorator flags — check that `tsconfig.json` at the repo root extends `tsconfig.base.json`.

- [ ] **Step 6: Typecheck and build**

Run: `bun run --filter @nest-my-admin/core typecheck && bun run --filter @nest-my-admin/core build && ls packages/core/dist`
Expected: no type errors; `index.js` and `index.d.ts` listed.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json tsconfig.json .gitignore bun.lock packages/core
git commit -m "chore: scaffold bun monorepo and core package with toolchain guard test"
```

---

### Task 2: Contract types, errors and naming helpers

**Files:**
- Create: `packages/core/src/contract.ts`, `packages/core/src/constants.ts`, `packages/core/src/errors.ts`, `packages/core/src/schema/humanize.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/errors.test.ts`, `packages/core/src/schema/humanize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `contract.ts` types: `FieldType`, `FieldSchema`, `MetaResourceSummary`, `MetaGroup`, `MetaResponse`, `SortDirection`, `ResourceSchema`, `AdminRecord`, `ListResponse`, `AdminErrorCode`, `AdminErrorBody`, `AdminRuntimeConfig`.
  - `constants.ts`: `ADMIN_RESOURCE_METADATA`, `ADMIN_GROUP_METADATA`, `ADMIN_OPTIONS`.
  - `errors.ts`: `AdminError(code, status, message, fields?)`, `AdminValidationError(fields, message?)`, `AdminNotFoundError(message?)`, `AdminBadRequestError(message)`, `AdminFieldError(fields: Record<string, string | string[]>, message?)`.
  - `humanize(name: string): string`, `kebabCase(name: string): string`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/schema/humanize.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { humanize, kebabCase } from './humanize.js';

describe('humanize', () => {
  test.each([
    ['createdAt', 'Created at'],
    ['sku_code', 'Sku code'],
    ['OrderItem', 'Order item'],
    ['HTTPStatus', 'Http status'],
    ['name', 'Name'],
    ['releasedOn', 'Released on'],
  ])('%s → %s', (input, expected) => {
    expect(humanize(input)).toBe(expected);
  });
});

describe('kebabCase', () => {
  test.each([
    ['Product', 'product'],
    ['OrderItem', 'order-item'],
    ['HTTPLog', 'http-log'],
    ['Catalog', 'catalog'],
  ])('%s → %s', (input, expected) => {
    expect(kebabCase(input)).toBe(expected);
  });
});
```

`packages/core/src/errors.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { AdminBadRequestError, AdminError, AdminFieldError, AdminNotFoundError, AdminValidationError } from './errors.js';

describe('admin errors', () => {
  test('AdminValidationError carries 422 and per-field messages', () => {
    const error = new AdminValidationError({ name: ['is required'] });
    expect(error).toBeInstanceOf(AdminError);
    expect(error.code).toBe('VALIDATION');
    expect(error.status).toBe(422);
    expect(error.fields).toEqual({ name: ['is required'] });
    expect(error.message).toBe('Validation failed');
    expect(error.name).toBe('AdminValidationError');
  });

  test('AdminFieldError accepts single messages and normalises them to arrays', () => {
    const error = new AdminFieldError({ total: 'Exceeds credit limit', sku: ['taken', 'reserved'] });
    expect(error).toBeInstanceOf(AdminValidationError);
    expect(error.fields).toEqual({ total: ['Exceeds credit limit'], sku: ['taken', 'reserved'] });
  });

  test('AdminNotFoundError and AdminBadRequestError have their codes', () => {
    expect(new AdminNotFoundError()).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'Not found' });
    expect(new AdminBadRequestError('Nope')).toMatchObject({ code: 'BAD_REQUEST', status: 400, message: 'Nope' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/errors.test.ts packages/core/src/schema/humanize.test.ts`
Expected: FAIL — `Cannot find module './errors.js'` / `'./humanize.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/contract.ts`:
```ts
/**
 * The JSON contract between @nest-my-admin/core and @nest-my-admin/ui.
 * Types only: the UI imports this file from source with `import type`,
 * so it must never contain runtime code or import anything.
 */

export type FieldType =
  | 'string' | 'text' | 'number' | 'bigint' | 'decimal' | 'boolean'
  | 'date' | 'datetime' | 'enum' | 'json' | 'uuid';

export interface FieldSchema {
  name: string;
  label: string;
  type: FieldType;
  nullable: boolean;
  /** Part of the primary key. */
  primary: boolean;
  /** Set by the database or TypeORM (generated ids, create/update/delete dates, version). */
  readonly: boolean;
  /** Backed by an entity column (false for DTO-only fields such as `password`). */
  persisted: boolean;
  enumValues?: string[];
  /** Digits after the decimal point, for `decimal` fields. */
  scale?: number;
}

export interface MetaResourceSummary {
  name: string;
  label: string;
  icon?: string;
}

export interface MetaGroup {
  key: string;
  label: string;
  icon?: string;
  resources: MetaResourceSummary[];
}

export interface MetaResponse {
  schemaVersion: 1;
  title: string;
  groups: MetaGroup[];
}

export type SortDirection = 'asc' | 'desc';

export interface ResourceSchema {
  name: string;
  label: string;
  group: string;
  icon?: string;
  primaryKey: string;
  fields: FieldSchema[];
  list: {
    columns: string[];
    sortable: string[];
    defaultSort: { field: string; direction: SortDirection };
    pageSize: number;
  };
  form: {
    create: string[];
    update: string[];
    requiredOnCreate: string[];
  };
}

export type AdminRecord = Record<string, unknown>;

export interface ListResponse {
  items: AdminRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export type AdminErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'BUSINESS_RULE' | 'INTERNAL';

export interface AdminErrorBody {
  code: AdminErrorCode;
  message: string;
  fields?: Record<string, string[]>;
  correlationId: string;
}

/** Injected into index.html as `window.__NMA__`. */
export interface AdminRuntimeConfig {
  basePath: string;
  apiBase: string;
  title: string;
}
```

`packages/core/src/constants.ts`:
```ts
/** Reflect-metadata key holding an @AdminResource definition. String keys survive duplicate package copies. */
export const ADMIN_RESOURCE_METADATA = 'nest-my-admin:resource';

/** Reflect-metadata key holding @AdminGroup options on a Nest module class. */
export const ADMIN_GROUP_METADATA = 'nest-my-admin:group';

/** Injection token for the resolved AdminModule options. */
export const ADMIN_OPTIONS = 'NEST_MY_ADMIN_OPTIONS';
```

`packages/core/src/errors.ts`:
```ts
import type { AdminErrorCode } from './contract.js';

export class AdminError extends Error {
  constructor(
    readonly code: AdminErrorCode,
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AdminValidationError extends AdminError {
  constructor(fields: Record<string, string[]>, message = 'Validation failed') {
    super('VALIDATION', 422, message, fields);
  }
}

export class AdminNotFoundError extends AdminError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', 404, message);
  }
}

export class AdminBadRequestError extends AdminError {
  constructor(message: string) {
    super('BAD_REQUEST', 400, message);
  }
}

/** Throw from host code (e.g. a service called by a resource) to attach messages to form fields. */
export class AdminFieldError extends AdminValidationError {
  constructor(fields: Record<string, string | string[]>, message = 'Validation failed') {
    super(
      Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, Array.isArray(value) ? value : [value]])),
      message,
    );
  }
}
```

`packages/core/src/schema/humanize.ts`:
```ts
/** `createdAt` → `Created at`, `sku_code` → `Sku code`, `OrderItem` → `Order item`. */
export function humanize(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `OrderItem` → `order-item`, `HTTPLog` → `http-log`. */
export function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}
```

`packages/core/src/index.ts` (replace the whole file):
```ts
export { AdminBadRequestError, AdminError, AdminFieldError, AdminNotFoundError, AdminValidationError } from './errors.js';
export type * from './contract.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add UI contract types, admin errors and naming helpers"
```

---

### Task 3: TypeORM column and DTO field extraction

**Files:**
- Create: `packages/core/src/schema/column-field.ts`, `packages/core/src/schema/dto-fields.ts`
- Test: `packages/core/src/schema/column-field.test.ts`, `packages/core/src/schema/dto-fields.test.ts`

**Interfaces:**
- Consumes: `FieldSchema`, `FieldType` (Task 2), `humanize` (Task 2).
- Produces:
  - `interface ColumnLike { propertyName; type; isNullable; isPrimary; isGenerated; isCreateDate; isUpdateDate; isDeleteDate; isVersion; isSelect; enum?; scale?; default?; relationMetadata?; embeddedMetadata? }` (structural subset of TypeORM's `ColumnMetadata`, which TypeORM 1 does not export from its root).
  - `fieldTypeOf(type: unknown): FieldType`, `isSupportedColumn(c: ColumnLike): boolean`, `columnToField(c: ColumnLike): FieldSchema`.
  - `type DtoClass = new (...args: any[]) => object`, `dtoPropertyNames(dto): string[]`, `isDtoPropertyOptional(dto, property): boolean`, `dtoOnlyField(dto, property): FieldSchema`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/schema/column-field.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { columnToField, fieldTypeOf, isSupportedColumn, type ColumnLike } from './column-field.js';

const column = (overrides: Partial<ColumnLike> = {}): ColumnLike => ({
  propertyName: 'title',
  type: String,
  isNullable: false,
  isPrimary: false,
  isGenerated: false,
  isCreateDate: false,
  isUpdateDate: false,
  isDeleteDate: false,
  isVersion: false,
  isSelect: true,
  ...overrides,
});

describe('fieldTypeOf', () => {
  test.each([
    [String, 'string'], [Number, 'number'], [Boolean, 'boolean'], [Date, 'datetime'], [Object, 'json'],
    ['varchar', 'string'], ['character varying', 'string'], ['text', 'text'], ['longtext', 'text'],
    ['int', 'number'], ['double precision', 'number'], ['bigint', 'bigint'], ['int8', 'bigint'],
    ['decimal', 'decimal'], ['numeric', 'decimal'], ['bool', 'boolean'], ['date', 'date'],
    ['timestamptz', 'datetime'], ['datetime', 'datetime'], ['jsonb', 'json'], ['simple-json', 'json'],
    ['uuid', 'uuid'], ['VARCHAR', 'string'], ['something-else', 'string'],
  ] as const)('%p → %s', (input, expected) => {
    expect(fieldTypeOf(input)).toBe(expected);
  });
});

describe('columnToField', () => {
  test('maps a plain column', () => {
    expect(columnToField(column({ propertyName: 'releasedOn', type: 'date', isNullable: true }))).toEqual({
      name: 'releasedOn', label: 'Released on', type: 'date', nullable: true, primary: false, readonly: false, persisted: true,
    });
  });

  test('generated primary keys and automatic dates are read-only', () => {
    expect(columnToField(column({ propertyName: 'id', type: Number, isPrimary: true, isGenerated: true }))).toMatchObject({ primary: true, readonly: true });
    expect(columnToField(column({ type: 'datetime', isCreateDate: true })).readonly).toBe(true);
    expect(columnToField(column({ type: 'datetime', isUpdateDate: true })).readonly).toBe(true);
    expect(columnToField(column({ type: Number, isVersion: true })).readonly).toBe(true);
  });

  test('enum columns expose their values as strings', () => {
    expect(columnToField(column({ type: 'simple-enum', enum: ['draft', 'live', 3] }))).toMatchObject({ type: 'enum', enumValues: ['draft', 'live', '3'] });
    expect(columnToField(column({ type: 'enum', enum: [] })).type).toBe('string');
  });

  test('decimal columns keep their scale', () => {
    expect(columnToField(column({ type: 'decimal', scale: 2 }))).toMatchObject({ type: 'decimal', scale: 2 });
    expect(columnToField(column({ type: 'decimal' })).scale).toBeUndefined();
  });
});

describe('isSupportedColumn', () => {
  test('skips relation, embedded and non-selectable columns', () => {
    expect(isSupportedColumn(column())).toBe(true);
    expect(isSupportedColumn(column({ relationMetadata: {} }))).toBe(false);
    expect(isSupportedColumn(column({ embeddedMetadata: {} }))).toBe(false);
    expect(isSupportedColumn(column({ isSelect: false }))).toBe(false);
  });
});
```

`packages/core/src/schema/dto-fields.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString } from 'class-validator';
import { dtoOnlyField, dtoPropertyNames, isDtoPropertyOptional } from './dto-fields.js';

class SignupDto {
  @IsString() name: string;
  @IsOptional() @IsEmail() email?: string;
  @IsInt() age: number;
  @IsOptional() @IsBoolean() newsletter?: boolean;
  @IsString() password: string;
}

class StaffSignupDto extends SignupDto {
  @IsString() role: string;
}

describe('dto fields', () => {
  test('lists decorated properties once each', () => {
    expect(dtoPropertyNames(SignupDto)).toEqual(['name', 'email', 'age', 'newsletter', 'password']);
  });

  test('includes inherited properties', () => {
    expect([...dtoPropertyNames(StaffSignupDto)].sort()).toEqual(['age', 'email', 'name', 'newsletter', 'password', 'role']);
  });

  test('detects @IsOptional', () => {
    expect(isDtoPropertyOptional(SignupDto, 'email')).toBe(true);
    expect(isDtoPropertyOptional(SignupDto, 'name')).toBe(false);
  });

  test('builds a field for DTO-only properties from design:type', () => {
    expect(dtoOnlyField(SignupDto, 'age')).toEqual({
      name: 'age', label: 'Age', type: 'number', nullable: false, primary: false, readonly: false, persisted: false,
    });
    expect(dtoOnlyField(SignupDto, 'newsletter')).toMatchObject({ type: 'boolean', nullable: true });
    expect(dtoOnlyField(SignupDto, 'password')).toMatchObject({ type: 'string', nullable: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/schema`
Expected: FAIL — `Cannot find module './column-field.js'` and `'./dto-fields.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/schema/column-field.ts`:
```ts
import type { FieldSchema, FieldType } from '../contract.js';
import { humanize } from './humanize.js';

/** The subset of TypeORM's ColumnMetadata this package reads (TypeORM does not export ColumnMetadata from its root). */
export interface ColumnLike {
  propertyName: string;
  type: unknown;
  isNullable: boolean;
  isPrimary: boolean;
  isGenerated: boolean;
  isCreateDate: boolean;
  isUpdateDate: boolean;
  isDeleteDate: boolean;
  isVersion: boolean;
  isSelect: boolean;
  enum?: (string | number)[];
  scale?: number;
  default?: unknown;
  relationMetadata?: unknown;
  embeddedMetadata?: unknown;
}

const TYPE_BY_NAME: Record<string, FieldType> = {
  varchar: 'string', 'character varying': 'string', char: 'string', character: 'string',
  nvarchar: 'string', nchar: 'string', citext: 'string', varchar2: 'string',
  text: 'text', tinytext: 'text', mediumtext: 'text', longtext: 'text', ntext: 'text', clob: 'text',
  int: 'number', integer: 'number', int2: 'number', int4: 'number', smallint: 'number', tinyint: 'number',
  mediumint: 'number', float: 'number', float4: 'number', float8: 'number', double: 'number',
  'double precision': 'number', real: 'number',
  bigint: 'bigint', int8: 'bigint',
  decimal: 'decimal', numeric: 'decimal', dec: 'decimal', money: 'decimal',
  boolean: 'boolean', bool: 'boolean',
  date: 'date',
  datetime: 'datetime', datetime2: 'datetime', datetimeoffset: 'datetime', timestamp: 'datetime',
  timestamptz: 'datetime', 'timestamp with time zone': 'datetime', 'timestamp without time zone': 'datetime',
  json: 'json', jsonb: 'json', 'simple-json': 'json', 'simple-array': 'json',
  enum: 'enum', 'simple-enum': 'enum',
  uuid: 'uuid',
};

export function fieldTypeOf(type: unknown): FieldType {
  if (type === String) return 'string';
  if (type === Number) return 'number';
  if (type === Boolean) return 'boolean';
  if (type === Date) return 'datetime';
  if (type === Object || type === Array) return 'json';
  if (typeof type === 'string') return TYPE_BY_NAME[type.toLowerCase()] ?? 'string';
  return 'string';
}

/** Columns M0 renders: selectable, and not part of a relation or an embedded entity (both arrive in M1). */
export function isSupportedColumn(column: ColumnLike): boolean {
  return column.isSelect && !column.relationMetadata && !column.embeddedMetadata;
}

export function columnToField(column: ColumnLike): FieldSchema {
  let type = fieldTypeOf(column.type);
  if (column.enum && column.enum.length > 0) type = 'enum';
  else if (type === 'enum') type = 'string';

  const field: FieldSchema = {
    name: column.propertyName,
    label: humanize(column.propertyName),
    type,
    nullable: column.isNullable,
    primary: column.isPrimary,
    readonly: column.isGenerated || column.isCreateDate || column.isUpdateDate || column.isDeleteDate || column.isVersion,
    persisted: true,
  };
  if (type === 'enum') field.enumValues = column.enum!.map(String);
  if (type === 'decimal' && typeof column.scale === 'number') field.scale = column.scale;
  return field;
}
```

`packages/core/src/schema/dto-fields.ts`:
```ts
import 'reflect-metadata';
import { ValidationTypes, getMetadataStorage } from 'class-validator';
import type { FieldSchema, FieldType } from '../contract.js';
import { humanize } from './humanize.js';

export type DtoClass = new (...args: any[]) => object;

function validationMetadata(dto: DtoClass) {
  return getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
}

/** Properties that carry at least one class-validator decorator (own first, then inherited). */
export function dtoPropertyNames(dto: DtoClass): string[] {
  return [...new Set(validationMetadata(dto).map((meta) => meta.propertyName))];
}

/** True when the property is decorated with @IsOptional (or @ValidateIf). */
export function isDtoPropertyOptional(dto: DtoClass, property: string): boolean {
  return validationMetadata(dto).some(
    (meta) => meta.propertyName === property && meta.type === ValidationTypes.CONDITIONAL_VALIDATION,
  );
}

const DESIGN_TYPES = new Map<unknown, FieldType>([
  [String, 'string'],
  [Number, 'number'],
  [Boolean, 'boolean'],
  [Date, 'datetime'],
]);

/** Schema for a DTO property that has no entity column (e.g. `password`, hashed by the host service). */
export function dtoOnlyField(dto: DtoClass, property: string): FieldSchema {
  const designType: unknown = Reflect.getMetadata('design:type', dto.prototype, property);
  return {
    name: property,
    label: humanize(property),
    type: DESIGN_TYPES.get(designType) ?? 'string',
    nullable: isDtoPropertyOptional(dto, property),
    primary: false,
    readonly: false,
    persisted: false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src/schema`
Expected: all pass. If `dtoPropertyNames(SignupDto)` comes back in a different order, do not change the test: the form order promise (declaration order for a DTO without inheritance) is part of the contract. Investigate `getTargetValidationMetadatas` ordering instead.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema
git commit -m "feat(core): map TypeORM columns and class-validator DTOs to field schemas"
```

---

### Task 4: Decorators, resource base class and schema builder

**Files:**
- Create: `packages/core/src/decorators/admin-resource.ts`, `packages/core/src/decorators/admin-group.ts`, `packages/core/src/resource/admin-context.ts`, `packages/core/src/resource/admin-resource-base.ts`, `packages/core/src/schema/build-resource-schema.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/decorators/decorators.test.ts`, `packages/core/src/schema/build-resource-schema.test.ts`

**Interfaces:**
- Consumes: `ADMIN_RESOURCE_METADATA`, `ADMIN_GROUP_METADATA` (Task 2); `AdminNotFoundError` (Task 2); `columnToField`, `isSupportedColumn`, `ColumnLike`, `dtoPropertyNames`, `isDtoPropertyOptional`, `dtoOnlyField`, `DtoClass` (Task 3); `humanize`, `kebabCase` (Task 2).
- Produces:
  - `AdminResource(entity: Function, options?: AdminResourceOptions): ClassDecorator`; `AdminResourceOptions { name?; label?; group?; icon?; dataSource? }`; `AdminResourceDefinition extends AdminResourceOptions { entity: Function }`; `getAdminResourceDefinition(target): AdminResourceDefinition | undefined`.
  - `AdminGroup(options: AdminGroupOptions): ClassDecorator`; `AdminGroupOptions { key?; label?; icon?; order? }`; `getAdminGroupOptions(moduleClass): AdminGroupOptions | undefined`.
  - `AdminContext { correlationId: string; request: IncomingMessage }`, `createAdminContext(request): AdminContext`.
  - `abstract class AdminResourceBase<T>` with `list?: ListConfig<T>`, `form?: FormConfig`, `attachRepository(repo)`, `findMany(params: ListParams, ctx): Promise<FindManyResult<T>>`, `findOne(id: RecordId, ctx): Promise<T | null>`, `create(dto: object, ctx): Promise<T>`, `update(id: RecordId, dto: object, ctx): Promise<T>`; types `RecordId = string | number`, `ListParams { page; pageSize; sort: { field; direction: SortDirection } }`, `FindManyResult<T> { items: T[]; total: number }`, `ListConfig<T> { columns?; sort?; pageSize? }`, `FormConfig { create?: DtoClass; update?: DtoClass }`.
  - `buildResourceSchema(input: BuildResourceSchemaInput): ResourceSchema`; `BuildResourceSchemaInput { definition; resource; metadata: EntityMetadataLike; moduleGroup: string; className: string }`; `EntityMetadataLike { columns: ColumnLike[]; primaryColumns: ColumnLike[] }`; `DEFAULT_PAGE_SIZE = 25`, `MAX_PAGE_SIZE = 100`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/decorators/decorators.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { AdminGroup, getAdminGroupOptions } from './admin-group.js';
import { AdminResource, getAdminResourceDefinition } from './admin-resource.js';

class Thing {}

@AdminResource(Thing, { icon: 'box' })
class ThingAdmin extends AdminResourceBase {}

describe('@AdminResource', () => {
  test('stores the definition and makes the class injectable', () => {
    expect(getAdminResourceDefinition(ThingAdmin)).toEqual({ entity: Thing, icon: 'box' });
    expect(Reflect.getMetadata('__injectable__', ThingAdmin)).toBe(true);
  });

  test('is not inherited by subclasses (they would register twice)', () => {
    class SpecialThingAdmin extends ThingAdmin {}
    expect(getAdminResourceDefinition(SpecialThingAdmin)).toBeUndefined();
  });
});

describe('@AdminGroup', () => {
  test('stores options on a module class', () => {
    @AdminGroup({ label: 'Sales', icon: 'cart', order: 5 })
    class SalesModule {}
    expect(getAdminGroupOptions(SalesModule)).toEqual({ label: 'Sales', icon: 'cart', order: 5 });
    expect(getAdminGroupOptions(class Plain {})).toBeUndefined();
  });
});
```

`packages/core/src/schema/build-resource-schema.test.ts`:
```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { Column, CreateDateColumn, DataSource, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, getAdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminResourceBase, type ListConfig } from '../resource/admin-resource-base.js';
import { buildResourceSchema } from './build-resource-schema.js';

@Entity()
class Gadget {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ type: 'decimal', precision: 8, scale: 2 }) price: string;
  @Column({ type: 'simple-enum', enum: ['new', 'used'], default: 'new' }) condition: 'new' | 'used';
  @Column({ type: 'simple-json', nullable: true }) specs: Record<string, unknown> | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity()
class Pair {
  @PrimaryColumn() first: string;
  @PrimaryColumn() second: string;
}

class CreateGadgetDto {
  @IsString() @Length(1, 60) name: string;
  @IsString() price: string;
  @IsOptional() @IsString() secret?: string;
}

class StampedGadgetDto {
  @IsString() name: string;
  @IsDateString() createdAt: string;
}

let dataSource: DataSource;
beforeAll(async () => {
  dataSource = await new DataSource({ type: 'sqljs', entities: [Gadget, Pair], synchronize: true }).initialize();
});
afterAll(async () => {
  await dataSource.destroy();
});

function schemaFor(resource: AdminResourceBase<any>, entity: Function = Gadget) {
  const definition = getAdminResourceDefinition(resource.constructor)!;
  return buildResourceSchema({
    definition,
    resource,
    metadata: dataSource.getMetadata(entity),
    moduleGroup: 'catalog',
    className: resource.constructor.name,
  });
}

describe('buildResourceSchema', () => {
  test('derives fields, list and form from the entity', () => {
    @AdminResource(Gadget)
    class GadgetAdmin extends AdminResourceBase<Gadget> {}
    const schema = schemaFor(new GadgetAdmin());

    expect(schema).toMatchObject({ name: 'gadget', label: 'Gadget', group: 'catalog', primaryKey: 'id' });
    expect(schema.fields.map((f) => [f.name, f.type, f.readonly])).toEqual([
      ['id', 'number', true],
      ['name', 'string', false],
      ['price', 'decimal', false],
      ['condition', 'enum', false],
      ['specs', 'json', false],
      ['createdAt', 'datetime', true],
    ]);
    expect(schema.fields.find((f) => f.name === 'price')?.scale).toBe(2);
    expect(schema.fields.find((f) => f.name === 'condition')?.enumValues).toEqual(['new', 'used']);
    expect(schema.list).toEqual({
      columns: ['id', 'name', 'price', 'condition', 'createdAt'],
      sortable: ['id', 'name', 'price', 'condition', 'createdAt'],
      defaultSort: { field: 'id', direction: 'desc' },
      pageSize: 25,
    });
    expect(schema.form).toEqual({
      create: ['name', 'price', 'condition', 'specs'],
      update: ['name', 'price', 'condition', 'specs'],
      requiredOnCreate: ['name', 'price'],
    });
  });

  test('uses DTO properties for the form, including DTO-only fields', () => {
    @AdminResource(Gadget)
    class GadgetAdmin extends AdminResourceBase<Gadget> {
      form = { create: CreateGadgetDto };
    }
    const schema = schemaFor(new GadgetAdmin());
    expect(schema.form).toEqual({
      create: ['name', 'price', 'secret'],
      update: ['name', 'price', 'secret'],
      requiredOnCreate: ['name', 'price'],
    });
    expect(schema.fields.find((f) => f.name === 'secret')).toMatchObject({ type: 'string', persisted: false, nullable: true });
  });

  test('honours resource options and list config', () => {
    @AdminResource(Gadget, { name: 'toys', label: 'Toys', group: 'fun', icon: 'gift' })
    class ToyAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: ['name'], sort: 'name', pageSize: 10 };
    }
    const schema = schemaFor(new ToyAdmin());
    expect(schema).toMatchObject({ name: 'toys', label: 'Toys', group: 'fun', icon: 'gift' });
    expect(schema.list).toMatchObject({ columns: ['name'], defaultSort: { field: 'name', direction: 'asc' }, pageSize: 10 });
  });

  test('rejects unknown list columns', () => {
    @AdminResource(Gadget)
    class BrokenAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: ['nope' as 'name'] };
    }
    expect(() => schemaFor(new BrokenAdmin())).toThrow('BrokenAdmin: list.columns: unknown column "nope" on Gadget');
  });

  test('rejects DTOs that write read-only columns', () => {
    @AdminResource(Gadget)
    class StampedAdmin extends AdminResourceBase<Gadget> {
      form = { create: StampedGadgetDto };
    }
    expect(() => schemaFor(new StampedAdmin())).toThrow('DTO property "createdAt" maps to read-only column Gadget.createdAt');
  });

  test('rejects composite primary keys', () => {
    @AdminResource(Pair)
    class PairAdmin extends AdminResourceBase<Pair> {}
    expect(() => schemaFor(new PairAdmin(), Pair)).toThrow('PairAdmin: entity Pair has 2 primary columns; exactly one is supported');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/decorators packages/core/src/schema/build-resource-schema.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/decorators/admin-resource.ts`:
```ts
import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { ADMIN_RESOURCE_METADATA } from '../constants.js';

export interface AdminResourceOptions {
  /** URL segment and permission prefix. Defaults to kebab-case of the entity class name. */
  name?: string;
  label?: string;
  /** Sidebar group key. Defaults to the group of the Nest module that provides the resource. */
  group?: string;
  icon?: string;
  /** TypeORM DataSource name. Defaults to the default DataSource. */
  dataSource?: string;
}

export interface AdminResourceDefinition extends AdminResourceOptions {
  entity: Function;
}

/** Marks a provider as an admin resource for `entity`. The class must extend AdminResourceBase. */
export function AdminResource(entity: Function, options: AdminResourceOptions = {}): ClassDecorator {
  return (target) => {
    const definition: AdminResourceDefinition = { ...options, entity };
    Reflect.defineMetadata(ADMIN_RESOURCE_METADATA, definition, target);
    Injectable()(target);
  };
}

export function getAdminResourceDefinition(target: Function): AdminResourceDefinition | undefined {
  return Reflect.getOwnMetadata(ADMIN_RESOURCE_METADATA, target);
}
```

`packages/core/src/decorators/admin-group.ts`:
```ts
import 'reflect-metadata';
import { ADMIN_GROUP_METADATA } from '../constants.js';

export interface AdminGroupOptions {
  /** Defaults to kebab-case of the module class name without its `Module` suffix. */
  key?: string;
  label?: string;
  icon?: string;
  /** Lower comes first in the sidebar. Default 100. */
  order?: number;
}

/** Customises the sidebar group formed by the resources a Nest module provides. */
export function AdminGroup(options: AdminGroupOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(ADMIN_GROUP_METADATA, options, target);
  };
}

export function getAdminGroupOptions(moduleClass: Function): AdminGroupOptions | undefined {
  return Reflect.getOwnMetadata(ADMIN_GROUP_METADATA, moduleClass);
}
```

`packages/core/src/resource/admin-context.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Passed to every resource method. Grows in later milestones (user, permissions, transaction manager). */
export interface AdminContext {
  /** Echoed in error responses and logs. */
  correlationId: string;
  /** The underlying Node request (an Express request in v1). */
  request: IncomingMessage;
}

export function createAdminContext(request: IncomingMessage): AdminContext {
  return { correlationId: randomUUID(), request };
}
```

`packages/core/src/resource/admin-resource-base.ts`:
```ts
import type { DeepPartial, FindOptionsOrder, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';
import type { SortDirection } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { DtoClass } from '../schema/dto-fields.js';
import type { AdminContext } from './admin-context.js';

export type RecordId = string | number;

export interface ListParams {
  page: number;
  pageSize: number;
  sort: { field: string; direction: SortDirection };
}

export interface FindManyResult<T> {
  items: T[];
  total: number;
}

type EntityKey<T> = Extract<keyof T, string>;

export interface ListConfig<T> {
  columns?: EntityKey<T>[];
  /** `'name'` for ascending, `'-createdAt'` for descending. Defaults to `-<primary key>`. */
  sort?: EntityKey<T> | `-${EntityKey<T>}`;
  pageSize?: number;
}

export interface FormConfig {
  create?: DtoClass;
  /** Defaults to `create`, validated as a partial update. */
  update?: DtoClass;
}

/**
 * Base class for admin resources. Override `create`/`update` (and the finders) to route
 * admin operations through your own services, so business rules are never bypassed.
 */
export abstract class AdminResourceBase<T extends ObjectLiteral = ObjectLiteral> {
  list?: ListConfig<T>;
  form?: FormConfig;

  #repository?: Repository<T>;

  /** @internal Called once by the registry during bootstrap. */
  attachRepository(repository: Repository<T>): void {
    this.#repository = repository;
  }

  protected get repository(): Repository<T> {
    if (!this.#repository) {
      throw new Error(`${this.constructor.name} was used before nest-my-admin attached its repository`);
    }
    return this.#repository;
  }

  protected get primaryKey(): string {
    return this.repository.metadata.primaryColumns[0]!.propertyName;
  }

  async findMany(params: ListParams, _ctx: AdminContext): Promise<FindManyResult<T>> {
    const [items, total] = await this.repository.findAndCount({
      order: { [params.sort.field]: params.sort.direction.toUpperCase() } as FindOptionsOrder<T>,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    });
    return { items, total };
  }

  async findOne(id: RecordId, _ctx: AdminContext): Promise<T | null> {
    return this.repository.findOne({ where: { [this.primaryKey]: id } as FindOptionsWhere<T> });
  }

  async create(dto: object, _ctx: AdminContext): Promise<T> {
    return this.repository.save(this.repository.create({ ...dto } as DeepPartial<T>));
  }

  async update(id: RecordId, dto: object, ctx: AdminContext): Promise<T> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    this.repository.merge(existing, { ...dto } as DeepPartial<T>);
    return this.repository.save(existing);
  }
}
```

`packages/core/src/schema/build-resource-schema.ts`:
```ts
import type { FieldSchema, ResourceSchema, SortDirection } from '../contract.js';
import type { AdminResourceDefinition } from '../decorators/admin-resource.js';
import type { AdminResourceBase } from '../resource/admin-resource-base.js';
import { columnToField, isSupportedColumn, type ColumnLike } from './column-field.js';
import { dtoOnlyField, dtoPropertyNames, isDtoPropertyOptional } from './dto-fields.js';
import { humanize, kebabCase } from './humanize.js';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** The subset of TypeORM's EntityMetadata the builder reads. */
export interface EntityMetadataLike {
  columns: ColumnLike[];
  primaryColumns: ColumnLike[];
}

export interface BuildResourceSchemaInput {
  definition: AdminResourceDefinition;
  resource: AdminResourceBase<any>;
  metadata: EntityMetadataLike;
  /** Group key of the Nest module that provides the resource. */
  moduleGroup: string;
  /** Resource class name, used in configuration error messages. */
  className: string;
}

export function buildResourceSchema(input: BuildResourceSchemaInput): ResourceSchema {
  const { definition, resource, metadata, moduleGroup, className } = input;
  const entityName = definition.entity.name;
  const fail = (message: string): never => {
    throw new Error(`${className}: ${message}`);
  };

  if (metadata.primaryColumns.length !== 1) {
    fail(`entity ${entityName} has ${metadata.primaryColumns.length} primary columns; exactly one is supported`);
  }
  const primaryKey = metadata.primaryColumns[0]!.propertyName;

  const supportedColumns = metadata.columns.filter(isSupportedColumn);
  const entityFields = supportedColumns.map(columnToField);
  const byName = new Map(entityFields.map((field) => [field.name, field]));

  const createDto = resource.form?.create;
  const updateDto = resource.form?.update ?? createDto;
  const writable = entityFields.filter((field) => !field.readonly).map((field) => field.name);
  const create = createDto ? dtoPropertyNames(createDto) : writable;
  const update = (updateDto ? dtoPropertyNames(updateDto) : writable).filter((name) => name !== primaryKey);

  const dtoOnly: FieldSchema[] = [];
  for (const [dto, names] of [[createDto, create], [updateDto, update]] as const) {
    for (const name of names) {
      const field = byName.get(name);
      if (field?.readonly) fail(`DTO property "${name}" maps to read-only column ${entityName}.${name}`);
      if (!field && dto && !dtoOnly.some((extra) => extra.name === name)) dtoOnly.push(dtoOnlyField(dto, name));
    }
  }

  const requiredOnCreate = createDto
    ? create.filter((name) => !isDtoPropertyOptional(createDto, name))
    : supportedColumns
        .filter((c) => writable.includes(c.propertyName) && !c.isNullable && c.default === undefined)
        .map((c) => c.propertyName);

  const sortable = entityFields.filter((field) => field.type !== 'json').map((field) => field.name);
  const columns: string[] =
    resource.list?.columns ??
    entityFields.filter((field) => field.type !== 'json' && field.type !== 'text').map((field) => field.name);
  for (const column of columns) {
    if (!byName.has(column)) fail(`list.columns: unknown column "${column}" on ${entityName}`);
  }

  const rawSort: string = resource.list?.sort ?? `-${primaryKey}`;
  const direction: SortDirection = rawSort.startsWith('-') ? 'desc' : 'asc';
  const sortField = rawSort.replace(/^-/, '');
  if (!sortable.includes(sortField)) fail(`list.sort: cannot sort by "${sortField}"`);

  const pageSize = resource.list?.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    fail(`list.pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }

  return {
    name: definition.name ?? kebabCase(entityName),
    label: definition.label ?? humanize(entityName),
    group: definition.group ?? moduleGroup,
    ...(definition.icon ? { icon: definition.icon } : {}),
    primaryKey,
    fields: [...entityFields, ...dtoOnly],
    list: { columns, sortable, defaultSort: { field: sortField, direction }, pageSize },
    form: { create, update, requiredOnCreate },
  };
}
```

`packages/core/src/index.ts` (replace the whole file):
```ts
export { AdminGroup, type AdminGroupOptions } from './decorators/admin-group.js';
export { AdminResource, type AdminResourceOptions } from './decorators/admin-resource.js';
export {
  AdminResourceBase,
  type FindManyResult,
  type FormConfig,
  type ListConfig,
  type ListParams,
  type RecordId,
} from './resource/admin-resource-base.js';
export type { AdminContext } from './resource/admin-context.js';
export { AdminBadRequestError, AdminError, AdminFieldError, AdminNotFoundError, AdminValidationError } from './errors.js';
export type * from './contract.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): add @AdminResource, @AdminGroup, AdminResourceBase and resource schema builder"
```

---

### Task 5: List query parsing

**Files:**
- Create: `packages/core/src/crud/list-query.ts`
- Test: `packages/core/src/crud/list-query.test.ts`

**Interfaces:**
- Consumes: `ResourceSchema` (Task 2), `AdminValidationError` (Task 2), `ListParams` (Task 4), `MAX_PAGE_SIZE` (Task 4).
- Produces: `parseListQuery(query: URLSearchParams, schema: ResourceSchema): ListParams` — throws `AdminValidationError` (message `Invalid list query`) with per-parameter messages.

- [ ] **Step 1: Write the failing test**

`packages/core/src/crud/list-query.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import { parseListQuery } from './list-query.js';

const schema: ResourceSchema = {
  name: 'widget',
  label: 'Widget',
  group: 'widgets',
  primaryKey: 'id',
  fields: [],
  list: { columns: ['id', 'name'], sortable: ['id', 'name'], defaultSort: { field: 'id', direction: 'desc' }, pageSize: 25 },
  form: { create: [], update: [], requiredOnCreate: [] },
};

const parse = (query: string) => parseListQuery(new URLSearchParams(query), schema);

function errorsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdminValidationError) return error.fields ?? {};
    throw error;
  }
  throw new Error('expected an AdminValidationError');
}

describe('parseListQuery', () => {
  test('uses the resource defaults', () => {
    expect(parse('')).toEqual({ page: 1, pageSize: 25, sort: { field: 'id', direction: 'desc' } });
  });

  test('reads page, pageSize and sort', () => {
    expect(parse('page=3&pageSize=10&sort=name')).toEqual({ page: 3, pageSize: 10, sort: { field: 'name', direction: 'asc' } });
    expect(parse('sort=-name').sort).toEqual({ field: 'name', direction: 'desc' });
  });

  test('rejects invalid values with per-parameter messages', () => {
    expect(errorsOf(() => parse('page=0'))).toEqual({ page: ['must be a positive integer'] });
    expect(errorsOf(() => parse('page=abc&pageSize=2.5'))).toEqual({
      page: ['must be a positive integer'],
      pageSize: ['must be a positive integer'],
    });
    expect(errorsOf(() => parse('pageSize=101'))).toEqual({ pageSize: ['must be at most 100'] });
    expect(errorsOf(() => parse('sort=secret'))).toEqual({ sort: ['cannot sort by "secret"'] });
    expect(errorsOf(() => parse('page=1&page=2'))).toEqual({ page: ['must be given once'] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/crud/list-query.test.ts`
Expected: FAIL — `Cannot find module './list-query.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/crud/list-query.ts`:
```ts
import type { ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import type { ListParams } from '../resource/admin-resource-base.js';
import { MAX_PAGE_SIZE } from '../schema/build-resource-schema.js';

type Errors = Record<string, string[]>;

export function parseListQuery(query: URLSearchParams, schema: ResourceSchema): ListParams {
  const errors: Errors = {};
  const page = readPositiveInt(query, 'page', 1, errors);
  const pageSize = readPositiveInt(query, 'pageSize', schema.list.pageSize, errors);
  if (!errors.pageSize && pageSize > MAX_PAGE_SIZE) errors.pageSize = [`must be at most ${MAX_PAGE_SIZE}`];

  let sort = schema.list.defaultSort;
  const rawSort = readOne(query, 'sort', errors);
  if (rawSort !== undefined) {
    const field = rawSort.replace(/^-/, '');
    if (schema.list.sortable.includes(field)) sort = { field, direction: rawSort.startsWith('-') ? 'desc' : 'asc' };
    else errors.sort = [`cannot sort by "${field}"`];
  }

  if (Object.keys(errors).length > 0) throw new AdminValidationError(errors, 'Invalid list query');
  return { page, pageSize, sort };
}

function readOne(query: URLSearchParams, key: string, errors: Errors): string | undefined {
  const values = query.getAll(key);
  if (values.length > 1) {
    errors[key] = ['must be given once'];
    return undefined;
  }
  return values[0];
}

function readPositiveInt(query: URLSearchParams, key: string, fallback: number, errors: Errors): number {
  const raw = readOne(query, key, errors);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    errors[key] = ['must be a positive integer'];
    return fallback;
  }
  return Number(raw);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/crud/list-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/crud
git commit -m "feat(core): parse and validate list page, pageSize and sort"
```

---

### Task 6: Write validation, record ids and serialization

**Files:**
- Create: `packages/core/src/crud/validate-write.ts`, `packages/core/src/crud/record-id.ts`, `packages/core/src/crud/serialize.ts`
- Test: `packages/core/src/crud/validate-write.test.ts`, `packages/core/src/crud/record-id.test.ts`, `packages/core/src/crud/serialize.test.ts`

**Interfaces:**
- Consumes: `AdminValidationError`, `AdminBadRequestError`, `AdminNotFoundError` (Task 2); `ResourceSchema`, `FieldSchema`, `AdminRecord` (Task 2); `DtoClass` (Task 3); `RecordId` (Task 4).
- Produces:
  - `validateWrite(body: unknown, rules: WriteRules): Promise<object>`; `WriteRules { allowed: string[]; dto?: DtoClass; partial?: boolean }`; `flattenValidationErrors(errors: ValidationError[], prefix?): Record<string, string[]>`.
  - `parseRecordId(raw: string, schema: ResourceSchema): RecordId` — throws `AdminNotFoundError` for ids that cannot exist.
  - `serializeRecord(entity: object, fields: FieldSchema[]): AdminRecord`, `serializeValue(value: unknown, field: FieldSchema): unknown`, `formatDecimal(value: unknown, scale?: number): string`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/crud/validate-write.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { AdminBadRequestError, AdminValidationError } from '../errors.js';
import { validateWrite } from './validate-write.js';

class ItemDto {
  @IsString() @Length(1, 20) name: string;
  @IsOptional() @IsInt() @Min(0) qty?: number;
}

class AddressDto {
  @IsString() city: string;
}

class PersonDto {
  @ValidateNested() @Type(() => AddressDto) address: AddressDto;
}

async function fieldErrors(promise: Promise<unknown>): Promise<Record<string, string[]>> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AdminValidationError) return error.fields ?? {};
    throw error;
  }
  throw new Error('expected an AdminValidationError');
}

describe('validateWrite', () => {
  test('returns a DTO instance for a valid body', async () => {
    const result = await validateWrite({ name: 'Bolt', qty: 3 }, { allowed: ['name', 'qty'], dto: ItemDto });
    expect(result).toBeInstanceOf(ItemDto);
    expect(result).toMatchObject({ name: 'Bolt', qty: 3 });
  });

  test('rejects bodies that are not JSON objects', async () => {
    for (const body of [null, [], 'text', 42, undefined]) {
      await expect(validateWrite(body, { allowed: ['name'] })).rejects.toBeInstanceOf(AdminBadRequestError);
    }
  });

  test('rejects keys that are not writable', async () => {
    expect(await fieldErrors(validateWrite({ name: 'a', id: 1, extra: true }, { allowed: ['name', 'qty'], dto: ItemDto }))).toEqual({
      id: ['is not a writable field'],
      extra: ['is not a writable field'],
    });
  });

  test('reports DTO violations per field', async () => {
    const errors = await fieldErrors(validateWrite({ name: '', qty: -1 }, { allowed: ['name', 'qty'], dto: ItemDto }));
    expect(Object.keys(errors).sort()).toEqual(['name', 'qty']);
  });

  test('partial mode validates only the keys that were sent', async () => {
    await expect(validateWrite({ qty: 3 }, { allowed: ['name', 'qty'], dto: ItemDto, partial: true })).resolves.toMatchObject({ qty: 3 });
    expect(Object.keys(await fieldErrors(validateWrite({ name: null }, { allowed: ['name', 'qty'], dto: ItemDto, partial: true })))).toEqual(['name']);
  });

  test('flattens nested DTO errors to dotted paths', async () => {
    const errors = await fieldErrors(validateWrite({ address: { city: 5 } }, { allowed: ['address'], dto: PersonDto }));
    expect(Object.keys(errors)).toEqual(['address.city']);
  });

  test('without a DTO returns a plain copy of the allowed keys', async () => {
    expect(await validateWrite({ name: 'x' }, { allowed: ['name'] })).toEqual({ name: 'x' });
  });
});
```

`packages/core/src/crud/record-id.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { FieldType, ResourceSchema } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import { parseRecordId } from './record-id.js';

const schemaWithKey = (type: FieldType): ResourceSchema => ({
  name: 'thing',
  label: 'Thing',
  group: 'g',
  primaryKey: 'id',
  fields: [{ name: 'id', label: 'Id', type, nullable: false, primary: true, readonly: true, persisted: true }],
  list: { columns: ['id'], sortable: ['id'], defaultSort: { field: 'id', direction: 'desc' }, pageSize: 25 },
  form: { create: [], update: [], requiredOnCreate: [] },
});

describe('parseRecordId', () => {
  test('numeric keys become numbers', () => {
    expect(parseRecordId('42', schemaWithKey('number'))).toBe(42);
  });

  test('ids that cannot exist are 404, not database errors', () => {
    for (const raw of ['abc', '1.5', '9007199254740993', '']) {
      expect(() => parseRecordId(raw, schemaWithKey('number'))).toThrow(AdminNotFoundError);
    }
    expect(() => parseRecordId('not-a-uuid', schemaWithKey('uuid'))).toThrow(AdminNotFoundError);
  });

  test('string, uuid and bigint keys stay strings', () => {
    expect(parseRecordId('SKU-1', schemaWithKey('string'))).toBe('SKU-1');
    expect(parseRecordId('0b6f3c52-8f1e-4c1a-9b7e-2d5c6a7e8f90', schemaWithKey('uuid'))).toBe('0b6f3c52-8f1e-4c1a-9b7e-2d5c6a7e8f90');
    expect(parseRecordId('9007199254740993', schemaWithKey('bigint'))).toBe('9007199254740993');
  });
});
```

`packages/core/src/crud/serialize.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '../contract.js';
import { formatDecimal, serializeRecord, serializeValue } from './serialize.js';

const field = (name: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: true, primary: false, readonly: false, persisted: true, ...extra,
});

describe('formatDecimal', () => {
  test.each([
    [1.5, 2, '1.50'],
    ['1.5', 2, '1.50'],
    ['20', 2, '20.00'],
    ['-3.1', 2, '-3.10'],
    ['1.500', 2, '1.500'],
    [19.9, undefined, '19.9'],
    ['abc', 2, 'abc'],
  ] as const)('%p (scale %p) → %s', (value, scale, expected) => {
    expect(formatDecimal(value, scale)).toBe(expected);
  });
});

describe('serializeValue', () => {
  test('decimals from SQLite (numbers) become strings with the column scale', () => {
    expect(serializeValue(1.5, field('price', 'decimal', { scale: 2 }))).toBe('1.50');
  });

  test('bigints become strings', () => {
    expect(serializeValue(9007199254740993n, field('views', 'bigint'))).toBe('9007199254740993');
    expect(serializeValue(12, field('views', 'bigint'))).toBe('12');
  });

  test('dates and datetimes', () => {
    expect(serializeValue(new Date('2026-03-04T05:06:07.000Z'), field('at', 'datetime'))).toBe('2026-03-04T05:06:07.000Z');
    expect(serializeValue('2026-03-04', field('on', 'date'))).toBe('2026-03-04');
  });

  test('null and undefined become null', () => {
    expect(serializeValue(undefined, field('x', 'string'))).toBeNull();
    expect(serializeValue(null, field('x', 'json'))).toBeNull();
  });
});

describe('serializeRecord', () => {
  test('emits only persisted schema fields', () => {
    const record = serializeRecord(
      { id: 1, price: 2.5, passwordHash: 'secret', internal: { a: 1 } },
      [field('id', 'number'), field('price', 'decimal', { scale: 2 }), field('password', 'string', { persisted: false })],
    );
    expect(record).toEqual({ id: 1, price: '2.50' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/crud`
Expected: FAIL — `validate-write.js`, `record-id.js`, `serialize.js` not found.

- [ ] **Step 3: Implement**

`packages/core/src/crud/validate-write.ts`:
```ts
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { AdminBadRequestError, AdminValidationError } from '../errors.js';
import type { DtoClass } from '../schema/dto-fields.js';

export interface WriteRules {
  /** Field names the client may send for this operation. */
  allowed: string[];
  /** DTO to validate with. Without one, only `allowed` is enforced. */
  dto?: DtoClass;
  /** Validate only the properties present in the body (PATCH reusing a create DTO). */
  partial?: boolean;
}

export async function validateWrite(body: unknown, rules: WriteRules): Promise<object> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AdminBadRequestError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;

  const unknownKeys = Object.keys(input).filter((key) => !rules.allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new AdminValidationError(Object.fromEntries(unknownKeys.map((key) => [key, ['is not a writable field']])));
  }

  if (!rules.dto) return { ...input };

  const instance = plainToInstance(rules.dto, input);
  let errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
  if (rules.partial) errors = errors.filter((error) => Object.hasOwn(input, error.property));
  if (errors.length > 0) throw new AdminValidationError(flattenValidationErrors(errors));
  return instance;
}

export function flattenValidationErrors(errors: ValidationError[], prefix = ''): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const error of errors) {
    const key = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.constraints) out[key] = Object.values(error.constraints);
    if (error.children?.length) Object.assign(out, flattenValidationErrors(error.children, key));
  }
  return out;
}
```

`packages/core/src/crud/record-id.ts`:
```ts
import type { ResourceSchema } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { RecordId } from '../resource/admin-resource-base.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Converts the id from the URL to the primary key's type. Ids that cannot exist are 404s, never database errors. */
export function parseRecordId(raw: string, schema: ResourceSchema): RecordId {
  const notFound = () => new AdminNotFoundError(`${schema.label} "${raw}" not found`);
  const type = schema.fields.find((field) => field.name === schema.primaryKey)?.type;
  if (type === 'number') {
    if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw notFound();
    return Number(raw);
  }
  if (type === 'uuid' && !UUID.test(raw)) throw notFound();
  return raw;
}
```

`packages/core/src/crud/serialize.ts`:
```ts
import type { AdminRecord, FieldSchema } from '../contract.js';

/** Entity → JSON-safe record containing only the schema's persisted fields. */
export function serializeRecord(entity: object, fields: FieldSchema[]): AdminRecord {
  const source = entity as Record<string, unknown>;
  const out: AdminRecord = {};
  for (const field of fields) {
    if (field.persisted) out[field.name] = serializeValue(source[field.name], field);
  }
  return out;
}

export function serializeValue(value: unknown, field: FieldSchema): unknown {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case 'decimal':
      return formatDecimal(value, field.scale);
    case 'bigint':
      return String(value);
    case 'date':
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    case 'datetime':
      return value instanceof Date ? value.toISOString() : value;
    default:
      return value;
  }
}

/**
 * Decimals are always strings. Drivers differ (Postgres returns "1.50", SQLite returns 1.5),
 * so values are padded to the column scale with string arithmetic; never rounded.
 */
export function formatDecimal(value: unknown, scale?: number): string {
  if (typeof value === 'number') return scale === undefined ? String(value) : value.toFixed(scale);
  const text = String(value);
  if (scale === undefined || scale === 0 || !/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [integer, fraction = ''] = text.split('.');
  return fraction.length >= scale ? text : `${integer}.${fraction.padEnd(scale, '0')}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src/crud`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/crud
git commit -m "feat(core): validate writes against DTOs, parse record ids, serialize decimals as strings"
```

---

### Task 7: Options, resource registry and AdminModule

**Files:**
- Create: `packages/core/src/options.ts`, `packages/core/src/registry/resource-registry.ts`, `packages/core/src/admin.module.ts`
- Create: `packages/core/test/fixtures/widgets.ts`, `packages/core/test/helpers/create-app.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/options.test.ts`, `packages/core/test/registry.test.ts`

**Interfaces:**
- Consumes: `ADMIN_OPTIONS` (Task 2); `getAdminResourceDefinition`, `getAdminGroupOptions`, `AdminResourceBase`, `buildResourceSchema` (Task 4); `humanize`, `kebabCase` (Task 2); `AdminNotFoundError` (Task 2).
- Produces:
  - `AdminModuleOptions { path?; title?; uiDistPath? }`, `ResolvedAdminOptions { path; title; uiDistPath? }`, `resolveAdminOptions(options?): ResolvedAdminOptions`.
  - `ResourceRegistry` with `get(name): RegisteredResource` (throws `AdminNotFoundError`), `find(name): RegisteredResource | undefined`, `list(): RegisteredResource[]`, `groupList(): RegisteredGroup[]`; `RegisteredResource { schema: ResourceSchema; resource: AdminResourceBase<any>; className: string; columnProperties: ReadonlyMap<string, string> }` (database column name → property name); `RegisteredGroup { key; label; icon?; order }`.
  - `AdminModule.forRoot(options?: AdminModuleOptions): DynamicModule` (global).
  - Test helpers: `Widget`, `WidgetAdmin`, `WidgetsModule` (group `widgets`, label `Inventory`, icon `boxes`), `createTestApp(options?: TestAppOptions): Promise<INestApplication>`, `FIXTURE_UI_DIST`.

- [ ] **Step 1: Write the failing tests and fixtures**

`packages/core/src/options.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { resolveAdminOptions } from './options.js';

describe('resolveAdminOptions', () => {
  test('defaults', () => {
    expect(resolveAdminOptions()).toEqual({ path: '/admin', title: 'Admin', uiDistPath: undefined });
  });

  test('normalises the mount path', () => {
    expect(resolveAdminOptions({ path: 'backoffice/' }).path).toBe('/backoffice');
    expect(resolveAdminOptions({ path: '/ops/admin' }).path).toBe('/ops/admin');
  });

  test('refuses to mount at the root or on odd paths', () => {
    expect(() => resolveAdminOptions({ path: '/' })).toThrow('must not be "/"');
    expect(() => resolveAdminOptions({ path: '/a b' })).toThrow('invalid path');
  });
});
```

`packages/core/test/fixtures/widgets.ts`:
```ts
import { Module } from '@nestjs/common';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminGroup, AdminResource, AdminResourceBase, type ListConfig } from '../../src/index.js';

@Entity()
export class Widget {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: '0.00' }) price: string;
  @Column({ type: 'simple-enum', enum: ['draft', 'live'], default: 'draft' }) status: 'draft' | 'live';
  @Column({ default: true }) visible: boolean;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @CreateDateColumn() createdAt: Date;
}

@AdminResource(Widget)
export class WidgetAdmin extends AdminResourceBase<Widget> {
  list: ListConfig<Widget> = { columns: ['id', 'name', 'price', 'status', 'visible'] };
}

@AdminGroup({ label: 'Inventory', icon: 'boxes' })
@Module({ providers: [WidgetAdmin] })
export class WidgetsModule {}
```

`packages/core/test/helpers/create-app.ts`:
```ts
import 'reflect-metadata';
import type { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { fileURLToPath } from 'node:url';
import { AdminModule, type AdminModuleOptions } from '../../src/index.js';
import { Widget, WidgetsModule } from '../fixtures/widgets.js';

export const FIXTURE_UI_DIST = fileURLToPath(new URL('../fixtures/ui-dist', import.meta.url));

export interface TestAppOptions {
  admin?: AdminModuleOptions;
  imports?: Array<Type | DynamicModule>;
  providers?: Provider[];
  entities?: Function[];
  beforeInit?: (app: INestApplication) => void;
}

/** A Nest app with sql.js, AdminModule (serving the fixture UI) and the Widgets module. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot({ type: 'sqljs', entities: [Widget, ...(options.entities ?? [])], synchronize: true }),
      AdminModule.forRoot({ uiDistPath: FIXTURE_UI_DIST, ...options.admin }),
      WidgetsModule,
      ...(options.imports ?? []),
    ],
    providers: options.providers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  options.beforeInit?.(app);
  await app.init();
  return app;
}
```

`packages/core/test/registry.test.ts`:
```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, ResourceRegistry, type AdminContext } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const ctx = { correlationId: 'test', request: {} } as AdminContext;

describe('ResourceRegistry', () => {
  test('discovers resources and groups them by the module that provides them', async () => {
    app = await createTestApp();
    const registry = app.get(ResourceRegistry);
    expect(registry.list().map((entry) => entry.schema.name)).toEqual(['widget']);
    expect(registry.groupList()).toEqual([{ key: 'widgets', label: 'Inventory', icon: 'boxes', order: 100 }]);
    expect(registry.get('widget').schema.group).toBe('widgets');
    expect(registry.get('widget').columnProperties.get('createdAt')).toBe('createdAt');
  });

  test('attaches the repository so the default CRUD methods work', async () => {
    app = await createTestApp();
    const { resource } = app.get(ResourceRegistry).get('widget');
    const created = (await resource.create({ name: 'Bolt' }, ctx)) as Widget;
    expect(await resource.findOne(created.id, ctx)).toMatchObject({ name: 'Bolt' });
  });

  test('unknown names are AdminNotFoundError', async () => {
    app = await createTestApp();
    expect(() => app!.get(ResourceRegistry).get('nope')).toThrow('Unknown resource "nope"');
    expect(app.get(ResourceRegistry).find('nope')).toBeUndefined();
  });

  test('rejects duplicate resource names', async () => {
    @AdminResource(Widget)
    class SecondWidgetAdmin extends AdminResourceBase<Widget> {}
    @Module({ providers: [SecondWidgetAdmin] })
    class DuplicateModule {}
    await expect(createTestApp({ imports: [DuplicateModule] })).rejects.toThrow('Duplicate admin resource name "widget"');
  });

  test('rejects @AdminResource classes that do not extend AdminResourceBase', async () => {
    @AdminResource(Widget, { name: 'plain' })
    class PlainAdmin {}
    @Module({ providers: [PlainAdmin] })
    class PlainModule {}
    await expect(createTestApp({ imports: [PlainModule] })).rejects.toThrow(
      'PlainAdmin is decorated with @AdminResource but does not extend AdminResourceBase',
    );
  });

  test('rejects entities that are not registered in the DataSource', async () => {
    @Entity()
    class Orphan {
      @PrimaryGeneratedColumn() id: number;
      @Column() name: string;
    }
    @AdminResource(Orphan)
    class OrphanAdmin extends AdminResourceBase<Orphan> {}
    @Module({ providers: [OrphanAdmin] })
    class OrphanModule {}
    await expect(createTestApp({ imports: [OrphanModule] })).rejects.toThrow(
      'OrphanAdmin: entity Orphan is not registered in DataSource "default"',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/options.test.ts packages/core/test/registry.test.ts`
Expected: FAIL — `options.js` not found; `AdminModule` / `ResourceRegistry` not exported.

- [ ] **Step 3: Implement**

`packages/core/src/options.ts`:
```ts
export interface AdminModuleOptions {
  /** Mount path of the admin UI and API. Default `/admin`. */
  path?: string;
  /** Title shown in the UI. Default `Admin`. */
  title?: string;
  /** Advanced: serve the UI from this directory instead of @nest-my-admin/ui (tests, UI development). */
  uiDistPath?: string;
}

export interface ResolvedAdminOptions {
  path: string;
  title: string;
  uiDistPath?: string;
}

export function resolveAdminOptions(options: AdminModuleOptions = {}): ResolvedAdminOptions {
  const raw = (options.path ?? '/admin').trim();
  const path = '/' + raw.replace(/^\/+|\/+$/g, '');
  if (path === '/') {
    throw new Error('nest-my-admin: `path` must not be "/"; mount the admin under its own path such as "/admin"');
  }
  if (!/^\/[A-Za-z0-9\-._~/]+$/.test(path)) throw new Error(`nest-my-admin: invalid path "${options.path}"`);
  return { path, title: options.title ?? 'Admin', uiDistPath: options.uiDistPath };
}
```

`packages/core/src/registry/resource-registry.ts`:
```ts
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { ResourceSchema } from '../contract.js';
import { getAdminGroupOptions } from '../decorators/admin-group.js';
import { getAdminResourceDefinition, type AdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminNotFoundError } from '../errors.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { buildResourceSchema } from '../schema/build-resource-schema.js';
import { humanize, kebabCase } from '../schema/humanize.js';

export interface RegisteredResource {
  schema: ResourceSchema;
  resource: AdminResourceBase<any>;
  className: string;
  /** Database column name → entity property name (for mapping constraint errors to fields). */
  columnProperties: ReadonlyMap<string, string>;
}

export interface RegisteredGroup {
  key: string;
  label: string;
  icon?: string;
  order: number;
}

const DEFAULT_GROUP_ORDER = 100;

@Injectable()
export class ResourceRegistry implements OnModuleInit {
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly groups = new Map<string, RegisteredGroup>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    const seen = new Set<object>();
    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype;
      if (typeof metatype !== 'function') continue;
      const definition = getAdminResourceDefinition(metatype);
      if (!definition) continue;

      const instance: unknown = wrapper.instance;
      if (!wrapper.isDependencyTreeStatic() || !instance) {
        throw new Error(`${metatype.name}: admin resources must be singleton-scoped providers`);
      }
      if (seen.has(instance)) continue;
      seen.add(instance);
      if (!(instance instanceof AdminResourceBase)) {
        throw new Error(`${metatype.name} is decorated with @AdminResource but does not extend AdminResourceBase`);
      }
      const moduleGroup = this.registerModuleGroup(wrapper.host?.metatype);
      this.register(metatype.name, definition, instance, moduleGroup);
    }
  }

  get(name: string): RegisteredResource {
    const entry = this.resources.get(name);
    if (!entry) throw new AdminNotFoundError(`Unknown resource "${name}"`);
    return entry;
  }

  find(name: string): RegisteredResource | undefined {
    return this.resources.get(name);
  }

  list(): RegisteredResource[] {
    return [...this.resources.values()];
  }

  groupList(): RegisteredGroup[] {
    return [...this.groups.values()];
  }

  private registerModuleGroup(moduleClass: Function | undefined): string {
    const baseName = moduleClass ? moduleClass.name.replace(/Module$/, '') || moduleClass.name : 'General';
    const options = moduleClass ? getAdminGroupOptions(moduleClass) : undefined;
    const key = options?.key ?? kebabCase(baseName);
    if (!this.groups.has(key)) {
      this.groups.set(key, {
        key,
        label: options?.label ?? humanize(baseName),
        ...(options?.icon ? { icon: options.icon } : {}),
        order: options?.order ?? DEFAULT_GROUP_ORDER,
      });
    }
    return key;
  }

  private register(
    className: string,
    definition: AdminResourceDefinition,
    resource: AdminResourceBase<any>,
    moduleGroup: string,
  ): void {
    const dataSourceName = definition.dataSource ?? 'default';
    let dataSource: DataSource;
    try {
      dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(dataSourceName), { strict: false });
    } catch {
      throw new Error(`${className}: TypeORM DataSource "${dataSourceName}" not found; is TypeOrmModule.forRoot() imported?`);
    }
    if (!dataSource.hasMetadata(definition.entity)) {
      throw new Error(`${className}: entity ${definition.entity.name} is not registered in DataSource "${dataSourceName}"`);
    }
    const metadata = dataSource.getMetadata(definition.entity);
    resource.attachRepository(dataSource.getRepository(definition.entity));

    const schema = buildResourceSchema({ definition, resource, metadata, moduleGroup, className });
    const existing = this.resources.get(schema.name);
    if (existing) {
      throw new Error(
        `Duplicate admin resource name "${schema.name}" (${existing.className} and ${className}); set a unique @AdminResource({ name })`,
      );
    }
    if (!this.groups.has(schema.group)) {
      this.groups.set(schema.group, { key: schema.group, label: humanize(schema.group), order: DEFAULT_GROUP_ORDER });
    }
    this.resources.set(schema.name, {
      schema,
      resource,
      className,
      columnProperties: new Map(metadata.columns.map((column) => [column.databaseName, column.propertyName])),
    });
  }
}
```

`packages/core/src/admin.module.ts`:
```ts
import { Module, type DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ADMIN_OPTIONS } from './constants.js';
import { resolveAdminOptions, type AdminModuleOptions } from './options.js';
import { ResourceRegistry } from './registry/resource-registry.js';

@Module({})
export class AdminModule {
  static forRoot(options: AdminModuleOptions = {}): DynamicModule {
    return {
      module: AdminModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [{ provide: ADMIN_OPTIONS, useValue: resolveAdminOptions(options) }, ResourceRegistry],
      exports: [ResourceRegistry],
    };
  }
}
```

`packages/core/src/index.ts` — add these lines at the top:
```ts
export { AdminModule } from './admin.module.js';
export type { AdminModuleOptions } from './options.js';
export { ResourceRegistry, type RegisteredGroup, type RegisteredResource } from './registry/resource-registry.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): discover @AdminResource providers into a registry grouped by Nest module"
```

---

### Task 8: HTTP primitives — router, body I/O, error mapping

**Files:**
- Create: `packages/core/src/http/router.ts`, `packages/core/src/http/http-io.ts`, `packages/core/src/http/error-response.ts`
- Test: `packages/core/src/http/router.test.ts`, `packages/core/src/http/http-io.test.ts`, `packages/core/src/http/error-response.test.ts`

**Interfaces:**
- Consumes: `AdminError`, `AdminBadRequestError` (Task 2); `AdminErrorBody`, `AdminErrorCode` (Task 2).
- Produces:
  - `class Router<S>` with `add(method, pattern, handler: RouteHandler<S>): this` and `match(method, pathname): { handler; params: Record<string, string> } | undefined`; `type RouteHandler<S> = (state: S, params: Record<string, string>) => void | Promise<void>`.
  - `type AdminRequest = IncomingMessage & { body?: unknown }`, `sendJson(res, status, body): void`, `readJsonBody(req): Promise<unknown>` (max 1 MiB).
  - `toErrorResponse(error, correlationId, logger: { error(message: string): void }, columnProperties?: ReadonlyMap<string, string>): { status: number; body: AdminErrorBody }`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/http/router.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { Router } from './router.js';

const noop = () => {};

describe('Router', () => {
  const router = new Router<null>()
    .add('GET', '/api/meta', noop)
    .add('GET', '/api/resources/:resource/:id', noop);

  test('matches static and parameterised paths', () => {
    expect(router.match('GET', '/api/meta')?.params).toEqual({});
    expect(router.match('GET', '/api/meta/')?.params).toEqual({});
    expect(router.match('GET', '/api/resources/order-item/12')?.params).toEqual({ resource: 'order-item', id: '12' });
  });

  test('decodes parameters', () => {
    expect(router.match('GET', '/api/resources/widget/a%20b')?.params.id).toBe('a b');
  });

  test('does not match other methods, lengths or malformed encodings', () => {
    expect(router.match('POST', '/api/meta')).toBeUndefined();
    expect(router.match('GET', '/api/resources/widget')).toBeUndefined();
    expect(router.match('GET', '/api/resources/widget/%E0%A4%A')).toBeUndefined();
  });
});
```

`packages/core/src/http/http-io.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { AdminBadRequestError } from '../errors.js';
import { readJsonBody, sendJson, type AdminRequest } from './http-io.js';

function fakeRequest(chunks: string[], body?: unknown): AdminRequest {
  const stream = Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
  return Object.assign(stream, { body }) as unknown as AdminRequest;
}

describe('readJsonBody', () => {
  test('returns the body already parsed by the host', async () => {
    expect(await readJsonBody(fakeRequest([], { a: 1 }))).toEqual({ a: 1 });
  });

  test('reads and parses the stream when nothing parsed it', async () => {
    expect(await readJsonBody(fakeRequest(['{"a":', '1}']))).toEqual({ a: 1 });
  });

  test('empty body is undefined', async () => {
    expect(await readJsonBody(fakeRequest([]))).toBeUndefined();
  });

  test('invalid JSON and oversized bodies are bad requests', async () => {
    await expect(readJsonBody(fakeRequest(['{nope']))).rejects.toBeInstanceOf(AdminBadRequestError);
    await expect(readJsonBody(fakeRequest(['x'.repeat(1_048_577)]))).rejects.toThrow('Request body is too large');
  });
});

describe('sendJson', () => {
  test('writes status, headers and body', () => {
    const headers: Record<string, unknown> = {};
    let written = '';
    const res = {
      statusCode: 0,
      setHeader: (name: string, value: unknown) => { headers[name.toLowerCase()] = value; },
      end: (chunk: string) => { written = chunk; },
    } as unknown as ServerResponse;
    sendJson(res, 201, { ok: true });
    expect(res.statusCode).toBe(201);
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(headers['cache-control']).toBe('no-store');
    expect(JSON.parse(written)).toEqual({ ok: true });
  });
});
```

`packages/core/src/http/error-response.test.ts`:
```ts
import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AdminFieldError, AdminNotFoundError } from '../errors.js';
import { toErrorResponse } from './error-response.js';

const logger = () => ({ error: mock((_message: string) => {}) });
const dbError = (driverError: Record<string, unknown>) =>
  new QueryFailedError('INSERT ...', [], Object.assign(new Error(String(driverError.message)), driverError));

describe('toErrorResponse', () => {
  test('admin errors keep their code, status and fields', () => {
    expect(toErrorResponse(new AdminFieldError({ total: 'too big' }), 'c1', logger())).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'Validation failed', fields: { total: ['too big'] }, correlationId: 'c1' },
    });
    expect(toErrorResponse(new AdminNotFoundError('Widget "9" not found'), 'c2', logger()).body).toEqual({
      code: 'NOT_FOUND', message: 'Widget "9" not found', correlationId: 'c2',
    });
  });

  test('HttpExceptions thrown by host services pass through by status', () => {
    expect(toErrorResponse(new BadRequestException('Active products need stock'), 'c', logger())).toEqual({
      status: 400,
      body: { code: 'BUSINESS_RULE', message: 'Active products need stock', correlationId: 'c' },
    });
    expect(toErrorResponse(new ConflictException('Archived'), 'c', logger()).body.code).toBe('CONFLICT');
    expect(toErrorResponse(new NotFoundException(), 'c', logger()).body.code).toBe('NOT_FOUND');
    expect(toErrorResponse(new BadRequestException(['a must be x', 'b must be y']), 'c', logger()).body.message).toBe(
      'a must be x; b must be y',
    );
  });

  test('5xx and unknown errors are logged and hidden', () => {
    const log = logger();
    expect(toErrorResponse(new Error('db password is hunter2'), 'c9', log)).toEqual({
      status: 500,
      body: { code: 'INTERNAL', message: 'Internal error', correlationId: 'c9' },
    });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(toErrorResponse(new InternalServerErrorException('secret detail'), 'c', logger()).body.message).toBe('Internal error');
  });

  test('unique violations become 409 CONFLICT on the field (SQLite, Postgres)', () => {
    const sqlite = toErrorResponse(dbError({ message: 'UNIQUE constraint failed: product.sku' }), 'c', logger());
    expect(sqlite).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: 'A record with this value already exists', fields: { sku: ['already exists'] }, correlationId: 'c' },
    });
    const postgres = toErrorResponse(
      dbError({ code: '23505', message: 'duplicate key value violates unique constraint "UQ_1"', detail: 'Key (sku_code)=(A1) already exists.' }),
      'c',
      logger(),
      new Map([['sku_code', 'skuCode']]),
    );
    expect(postgres.body.fields).toEqual({ skuCode: ['already exists'] });
  });

  test('not-null violations become 422 VALIDATION on the field (SQLite, MySQL)', () => {
    expect(toErrorResponse(dbError({ message: 'NOT NULL constraint failed: widget.name' }), 'c', logger())).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A required value is missing', fields: { name: ['is required'] }, correlationId: 'c' },
    });
    expect(
      toErrorResponse(dbError({ code: 'ER_BAD_NULL_ERROR', message: "Column 'name' cannot be null" }), 'c', logger()).body.fields,
    ).toEqual({ name: ['is required'] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/http`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/http/router.ts`:
```ts
export type RouteHandler<S> = (state: S, params: Record<string, string>) => void | Promise<void>;

interface Route<S> {
  method: string;
  segments: string[];
  handler: RouteHandler<S>;
}

/** Minimal router for the admin API. Independent of Express/path-to-regexp versions (spec D12). */
export class Router<S> {
  private readonly routes: Route<S>[] = [];

  add(method: string, pattern: string, handler: RouteHandler<S>): this {
    this.routes.push({ method, segments: split(pattern), handler });
    return this;
  }

  match(method: string, pathname: string): { handler: RouteHandler<S>; params: Record<string, string> } | undefined {
    const parts = split(pathname);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchSegments(route.segments, parts);
      if (params) return { handler: route.handler, params };
    }
    return undefined;
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | undefined {
  if (pattern.length !== parts.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i]!;
    const actual = parts[i]!;
    if (expected.startsWith(':')) {
      try {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } catch {
        return undefined;
      }
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
}
```

`packages/core/src/http/http-io.ts`:
```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AdminBadRequestError } from '../errors.js';

/** A Node request, possibly with a body already parsed by the host's body parser. */
export type AdminRequest = IncomingMessage & { body?: unknown };

const MAX_BODY_BYTES = 1_048_576;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.end(payload);
}

/** Uses the host-parsed body when present (Nest registers express.json()); otherwise reads the stream. */
export async function readJsonBody(req: AdminRequest): Promise<unknown> {
  if (req.body !== undefined && !Buffer.isBuffer(req.body) && typeof req.body !== 'string') return req.body;
  if (typeof req.body === 'string') return parseJson(req.body);
  if (req.readableEnded) return undefined;

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new AdminBadRequestError('Request body is too large');
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AdminBadRequestError('Request body is not valid JSON');
  }
}
```

`packages/core/src/http/error-response.ts`:
```ts
import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { AdminErrorBody, AdminErrorCode } from '../contract.js';
import { AdminError } from '../errors.js';

export interface ErrorResponse {
  status: number;
  body: AdminErrorBody;
}

export interface ErrorLogger {
  error(message: string): void;
}

/** Maps any thrown value to the admin error contract. Never leaks messages of 5xx/unknown errors. */
export function toErrorResponse(
  error: unknown,
  correlationId: string,
  logger: ErrorLogger,
  columnProperties?: ReadonlyMap<string, string>,
): ErrorResponse {
  if (error instanceof AdminError) {
    return {
      status: error.status,
      body: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}), correlationId },
    };
  }
  if (error instanceof HttpException && error.getStatus() < 500) {
    const status = error.getStatus();
    return { status, body: { code: codeForStatus(status), message: httpExceptionMessage(error), correlationId } };
  }
  if (error instanceof QueryFailedError) {
    const mapped = constraintError(error, columnProperties);
    if (mapped) return { status: mapped.status, body: { ...mapped.body, correlationId } };
  }
  logger.error(`[${correlationId}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal error', correlationId } };
}

function codeForStatus(status: number): AdminErrorCode {
  if (status === 401 || status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'VALIDATION';
  return 'BUSINESS_RULE';
}

function httpExceptionMessage(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  if (typeof message === 'string') return message;
  return error.message;
}

function constraintError(
  error: QueryFailedError,
  columnProperties?: ReadonlyMap<string, string>,
): { status: number; body: Omit<AdminErrorBody, 'correlationId'> } | undefined {
  const driver = (error.driverError ?? {}) as unknown as { code?: unknown; column?: unknown; detail?: unknown };
  const code = String(driver.code ?? '');
  const text = `${error.message} ${typeof driver.detail === 'string' ? driver.detail : ''}`;
  const column = typeof driver.column === 'string' ? driver.column : columnFromMessage(text);
  const field = column ? (columnProperties?.get(column) ?? column) : undefined;

  if (code === '23505' || code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(text)) {
    return {
      status: 409,
      body: { code: 'CONFLICT', message: 'A record with this value already exists', ...(field ? { fields: { [field]: ['already exists'] } } : {}) },
    };
  }
  if (code === '23502' || code === 'ER_BAD_NULL_ERROR' || /NOT NULL constraint failed/i.test(text)) {
    return {
      status: 422,
      body: { code: 'VALIDATION', message: 'A required value is missing', ...(field ? { fields: { [field]: ['is required'] } } : {}) },
    };
  }
  return undefined;
}

function columnFromMessage(text: string): string | undefined {
  return (
    /constraint failed: [\w"]+\."?(\w+)/i.exec(text)?.[1] ?? // SQLite: UNIQUE constraint failed: product.sku
    /Key \("?(\w+)"?\)=/.exec(text)?.[1] ?? // Postgres unique: Key (sku)=(A1) already exists.
    /Column '(\w+)' cannot be null/.exec(text)?.[1] ?? // MySQL not-null
    /column "(\w+)"/.exec(text)?.[1] // Postgres not-null message
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src/http`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/http
git commit -m "feat(core): add admin router, JSON body I/O and error-to-contract mapping"
```

---

### Task 9: Static UI serving

**Files:**
- Create: `packages/core/src/http/ui-assets.ts`
- Create: `packages/core/test/fixtures/ui-dist/index.html`, `packages/core/test/fixtures/ui-dist/assets/app.js`
- Test: `packages/core/src/http/ui-assets.test.ts`

**Interfaces:**
- Consumes: `AdminRuntimeConfig` (Task 2), `AdminRequest` (Task 8).
- Produces: `injectRuntime(html, runtime): string`, `resolveStaticFile(root, pathname): string | undefined`, `resolveUiDist(): string`, `class UiAssets(distDir: string, runtime: AdminRuntimeConfig)` with `serve(pathname, req, res): void`.

- [ ] **Step 1: Create the fixture UI build**

`packages/core/test/fixtures/ui-dist/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>fixture</title>
    <script type="module" crossorigin src="./assets/app.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
```

`packages/core/test/fixtures/ui-dist/assets/app.js`:
```js
console.log('fixture ui');
```

- [ ] **Step 2: Write the failing test**

`packages/core/src/http/ui-assets.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectRuntime, resolveStaticFile } from './ui-assets.js';

const root = fileURLToPath(new URL('../../test/fixtures/ui-dist', import.meta.url));
const runtime = { basePath: '/admin', apiBase: '/admin/api', title: 'Shop' };

describe('injectRuntime', () => {
  test('adds <base> and window.__NMA__ right after <head>', () => {
    const html = injectRuntime('<html><head lang="x"><title>t</title></head></html>', runtime);
    expect(html).toBe(
      '<html><head lang="x"><base href="/admin/"><script>window.__NMA__={"basePath":"/admin","apiBase":"/admin/api","title":"Shop"}</script><title>t</title></head></html>',
    );
  });

  test('escapes values that could close the script tag', () => {
    const html = injectRuntime('<head></head>', { ...runtime, title: '</script><script>alert(1)</script>' });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
  });

  test('fails loudly when index.html has no <head>', () => {
    expect(() => injectRuntime('<body></body>', runtime)).toThrow('has no <head>');
  });
});

describe('resolveStaticFile', () => {
  test('finds files inside the dist directory', () => {
    expect(resolveStaticFile(root, '/assets/app.js')).toBe(join(root, 'assets/app.js'));
  });

  test('never serves index.html raw, directories, or files outside the root', () => {
    expect(resolveStaticFile(root, '/index.html')).toBeUndefined();
    expect(resolveStaticFile(root, '/assets')).toBeUndefined();
    expect(resolveStaticFile(root, '/../ui-dist-secret.txt')).toBeUndefined();
    expect(resolveStaticFile(root, '/..%2f..%2fwidgets.ts')).toBeUndefined();
    expect(resolveStaticFile(root, '/%E0%A4%A')).toBeUndefined();
    expect(resolveStaticFile(root, '/assets/app.js%00.png')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test packages/core/src/http/ui-assets.test.ts`
Expected: FAIL — `Cannot find module './ui-assets.js'`.

- [ ] **Step 4: Implement**

`packages/core/src/http/ui-assets.ts`:
```ts
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, resolve, sep } from 'node:path';
import type { AdminRuntimeConfig } from '../contract.js';
import type { AdminRequest } from './http-io.js';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const MISSING_UI_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><title>Admin</title></head>' +
  '<body style="font-family:system-ui;padding:2rem"><h1>Admin UI assets not found</h1>' +
  '<p>Build <code>@nest-my-admin/ui</code> (<code>bun run build</code>) or reinstall your dependencies.</p></body></html>';

/** Directory of the installed @nest-my-admin/ui build. Resolved from this file so bundlers and monorepos work. */
export function resolveUiDist(): string {
  const require = createRequire(import.meta.url);
  try {
    return join(dirname(require.resolve('@nest-my-admin/ui/package.json')), 'dist');
  } catch {
    throw new Error('nest-my-admin: @nest-my-admin/ui is not installed. It is a dependency of @nest-my-admin/core; reinstall your dependencies.');
  }
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inserts `<base href>` (so relative assets load from deep links) and the runtime config. */
export function injectRuntime(html: string, runtime: AdminRuntimeConfig): string {
  const headOpen = /<head(\s[^>]*)?>/i;
  if (!headOpen.test(html)) throw new Error('nest-my-admin: UI index.html has no <head> element');
  const baseHref = runtime.basePath.endsWith('/') ? runtime.basePath : `${runtime.basePath}/`;
  const json = JSON.stringify(runtime).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const tags = `<base href="${escapeAttribute(baseHref)}"><script>window.__NMA__=${json}</script>`;
  return html.replace(headOpen, (match) => match + tags);
}

/** Absolute path of a regular file inside `root`, or undefined (traversal, directories, index.html). */
export function resolveStaticFile(root: string, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const base = resolve(root);
  const candidate = resolve(base, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (!candidate.startsWith(base + sep)) return undefined;
  if (candidate === join(base, 'index.html')) return undefined;
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export class UiAssets {
  private readonly root: string;
  private readonly indexHtml: string;

  constructor(distDir: string, runtime: AdminRuntimeConfig) {
    this.root = resolve(distDir);
    const indexPath = join(this.root, 'index.html');
    this.indexHtml = injectRuntime(existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : MISSING_UI_HTML, runtime);
  }

  /** Serves a file, 404s a missing /assets/* file, and falls back to index.html for client-side routes. */
  serve(pathname: string, req: AdminRequest, res: ServerResponse): void {
    const file = resolveStaticFile(this.root, pathname);
    if (file) {
      this.sendFile(file, pathname, req, res);
      return;
    }
    if (pathname.startsWith('/assets/')) {
      this.send(req, res, 404, 'text/plain; charset=utf-8', 'Not found', 'no-store');
      return;
    }
    this.send(req, res, 200, 'text/html; charset=utf-8', this.indexHtml, 'no-cache');
  }

  private sendFile(file: string, pathname: string, req: AdminRequest, res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', statSync(file).size);
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  }

  private send(req: AdminRequest, res: ServerResponse, status: number, contentType: string, body: string, cacheControl: string): void {
    res.statusCode = status;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : body);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test packages/core/src/http/ui-assets.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/http/ui-assets.ts packages/core/src/http/ui-assets.test.ts packages/core/test/fixtures/ui-dist
git commit -m "feat(core): serve the admin SPA with injected base href and runtime config"
```

---

### Task 10: Admin API service and the isolated HTTP mount

**Files:**
- Create: `packages/core/src/api/admin-api.service.ts`, `packages/core/src/http/admin-http.server.ts`
- Modify: `packages/core/src/admin.module.ts`
- Test: `packages/core/test/meta.test.ts`, `packages/core/test/crud.test.ts`, `packages/core/test/ui-serving.test.ts`, `packages/core/test/isolation.test.ts`

**Interfaces:**
- Consumes: `ResourceRegistry` (Task 7); `ADMIN_OPTIONS`, `ResolvedAdminOptions` (Tasks 2, 7); `parseListQuery` (Task 5); `validateWrite`, `parseRecordId`, `serializeRecord` (Task 6); `Router`, `sendJson`, `readJsonBody`, `AdminRequest`, `toErrorResponse` (Task 8); `UiAssets`, `resolveUiDist` (Task 9); `createAdminContext`, `AdminContext` (Task 4); `createTestApp`, `FIXTURE_UI_DIST` (Task 7).
- Produces:
  - `AdminApiService` with `meta(): MetaResponse`, `schema(name): ResourceSchema`, `list(name, query: URLSearchParams, ctx): Promise<ListResponse>`, `get(name, rawId, ctx): Promise<AdminRecord>`, `create(name, body, ctx): Promise<AdminRecord>`, `update(name, rawId, body, ctx): Promise<AdminRecord>`.
  - `AdminHttpServer` (mounts on `onModuleInit`).
  - HTTP API under `<path>/api`: `GET /meta`, `GET /meta/resources/:resource`, `GET /resources/:resource`, `GET /resources/:resource/:id`, `POST /resources/:resource` (201), `PATCH /resources/:resource/:id`.

- [ ] **Step 1: Write the failing integration tests**

`packages/core/test/meta.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({ admin: { title: 'Test shop' } });
});
afterAll(async () => {
  await app.close();
});

describe('meta API', () => {
  test('lists groups and their resources', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      schemaVersion: 1,
      title: 'Test shop',
      groups: [{ key: 'widgets', label: 'Inventory', icon: 'boxes', resources: [{ name: 'widget', label: 'Widget' }] }],
    });
  });

  test('returns the resource schema', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/widget');
    expect(res.status).toBe(200);
    expect(res.body.primaryKey).toBe('id');
    expect(res.body.list.columns).toEqual(['id', 'name', 'price', 'status', 'visible']);
    expect(res.body.form).toEqual({
      create: ['name', 'price', 'status', 'visible', 'notes'],
      update: ['name', 'price', 'status', 'visible', 'notes'],
      requiredOnCreate: ['name'],
    });
  });

  test('unknown resources are NOT_FOUND with a correlation id', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: 'Unknown resource "nope"', correlationId: expect.any(String) });
  });
});
```

`packages/core/test/crud.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

const base = '/admin/api/resources/widget';

describe('create', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  test('creates a record and returns decimals as strings', async () => {
    const res = await request(app.getHttpServer()).post(base).send({ name: 'Bolt', price: '12.5' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: expect.any(Number), name: 'Bolt', price: '12.50' });
    const read = await request(app.getHttpServer()).get(`${base}/${res.body.id}`);
    expect(read.body).toMatchObject({ name: 'Bolt', price: '12.50', status: 'draft', visible: true, notes: null });
  });

  test('rejects fields that are unknown or read-only', async () => {
    const res = await request(app.getHttpServer()).post(base).send({ name: 'x', id: 5, bogus: 1 });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ id: ['is not a writable field'], bogus: ['is not a writable field'] });
  });

  test('rejects non-object bodies', async () => {
    const res = await request(app.getHttpServer()).post(base).send([1, 2]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  test('database not-null violations become field errors', async () => {
    const res = await request(app.getHttpServer()).post(base).send({ price: '1' });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: 'VALIDATION', fields: { name: ['is required'] } });
  });
});

describe('read', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createTestApp();
    for (const name of ['Charlie', 'Alpha', 'Bravo']) {
      await request(app.getHttpServer()).post(base).send({ name });
    }
  });
  afterAll(async () => { await app.close(); });

  test('lists with the default sort (newest first)', async () => {
    const res = await request(app.getHttpServer()).get(base);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, page: 1, pageSize: 25 });
    expect(res.body.items.map((w: { name: string }) => w.name)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });

  test('paginates and sorts', async () => {
    const first = await request(app.getHttpServer()).get(`${base}?sort=name&pageSize=2&page=1`);
    expect(first.body.items.map((w: { name: string }) => w.name)).toEqual(['Alpha', 'Bravo']);
    const second = await request(app.getHttpServer()).get(`${base}?sort=name&pageSize=2&page=2`);
    expect(second.body.items.map((w: { name: string }) => w.name)).toEqual(['Charlie']);
  });

  test('rejects invalid list queries', async () => {
    const res = await request(app.getHttpServer()).get(`${base}?sort=bogus&pageSize=500`);
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['pageSize', 'sort']);
  });

  test('ids that cannot exist are 404, not 500', async () => {
    expect((await request(app.getHttpServer()).get(`${base}/abc`)).status).toBe(404);
    expect((await request(app.getHttpServer()).get(`${base}/99999`)).status).toBe(404);
  });
});

describe('update', () => {
  let app: INestApplication;
  let id: number;
  beforeAll(async () => {
    app = await createTestApp();
    id = (await request(app.getHttpServer()).post(base).send({ name: 'Nut' })).body.id;
  });
  afterAll(async () => { await app.close(); });

  test('patches only the sent fields', async () => {
    const res = await request(app.getHttpServer()).patch(`${base}/${id}`).send({ status: 'live' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, name: 'Nut', status: 'live' });
  });

  test('clearing a required column is a field error', async () => {
    const res = await request(app.getHttpServer()).patch(`${base}/${id}`).send({ name: null });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ name: ['is required'] });
  });

  test('the primary key is not writable and missing records are 404', async () => {
    expect((await request(app.getHttpServer()).patch(`${base}/${id}`).send({ id: 7 })).status).toBe(422);
    expect((await request(app.getHttpServer()).patch(`${base}/99999`).send({ name: 'x' })).status).toBe(404);
  });
});

describe('routing', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); });
  afterAll(async () => { await app.close(); });

  test('unknown API routes are JSON 404s', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect((await request(app.getHttpServer()).delete(`${base}/1`)).status).toBe(404);
  });

  test('the mount does not swallow sibling paths', async () => {
    expect((await request(app.getHttpServer()).get('/administrator')).status).toBe(404);
  });
});
```

`packages/core/test/ui-serving.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

describe('UI serving', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp({ admin: { title: 'Shop' } }); });
  afterAll(async () => { await app.close(); });

  test('serves index.html with base href and runtime config', async () => {
    for (const path of ['/admin', '/admin/']) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain('<base href="/admin/">');
      expect(res.text).toContain('window.__NMA__={"basePath":"/admin","apiBase":"/admin/api","title":"Shop"}');
    }
  });

  test('deep links get index.html so a refresh works', async () => {
    const res = await request(app.getHttpServer()).get('/admin/widget/5');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<base href="/admin/">');
  });

  test('serves hashed assets with long-lived caching and 404s missing ones', async () => {
    const asset = await request(app.getHttpServer()).get('/admin/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toContain('javascript');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await request(app.getHttpServer()).get('/admin/assets/missing.js')).status).toBe(404);
  });

  test('path traversal never escapes the dist directory', async () => {
    const res = await request(app.getHttpServer()).get('/admin/..%2f..%2f..%2fpackage.json');
    expect(res.text).not.toContain('"devDependencies"');
    expect((await request(app.getHttpServer()).get('/admin/assets/..%2f..%2f..%2fpackage.json')).status).toBe(404);
  });

  test('HEAD has headers but no body; non-GET UI requests fall through to the host', async () => {
    const head = await request(app.getHttpServer()).head('/admin');
    expect(head.status).toBe(200);
    expect(head.text ?? '').toBe('');
    expect((await request(app.getHttpServer()).post('/admin/widget').send({})).status).toBe(404);
  });
});

describe('UI serving edge cases', () => {
  test('a title cannot break out of the config script', async () => {
    const app = await createTestApp({ admin: { title: '</script><script>alert(1)</script>' } });
    const res = await request(app.getHttpServer()).get('/admin');
    expect(res.text).not.toContain('</script><script>alert(1)');
    await app.close();
  });

  test('a missing UI build shows a helpful page instead of crashing', async () => {
    const app = await createTestApp({ admin: { uiDistPath: '/definitely/not/here' } });
    const res = await request(app.getHttpServer()).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Admin UI assets not found');
    await app.close();
  });
});
```

`packages/core/test/isolation.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { Controller, Get, Injectable, Module, type CanActivate } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

@Injectable()
class DenyAllGuard implements CanActivate {
  canActivate() {
    return false;
  }
}

@Controller('ping')
class PingController {
  @Get()
  ping() {
    return 'pong';
  }
}

@Module({ controllers: [PingController] })
class HostModule {}

describe('isolation from the host app (spec D12)', () => {
  test('host global guards and global prefix do not apply to the admin', async () => {
    const app = await createTestApp({
      imports: [HostModule],
      providers: [{ provide: APP_GUARD, useClass: DenyAllGuard }],
      beforeInit: (a) => a.setGlobalPrefix('api'),
    });
    const http = app.getHttpServer();
    expect((await request(http).get('/api/ping')).status).toBe(403);
    expect((await request(http).get('/admin/api/meta')).status).toBe(200);
    expect((await request(http).get('/api/admin/api/meta')).status).toBe(404);
    await app.close();
  });

  test('a custom mount path moves both the API and the UI', async () => {
    const app = await createTestApp({ admin: { path: '/backoffice/' } });
    const http = app.getHttpServer();
    expect((await request(http).get('/backoffice/api/meta')).status).toBe(200);
    expect((await request(http).get('/admin/api/meta')).status).toBe(404);
    expect((await request(http).get('/backoffice/widget')).text).toContain('<base href="/backoffice/">');
    await app.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/test/meta.test.ts packages/core/test/crud.test.ts packages/core/test/ui-serving.test.ts packages/core/test/isolation.test.ts`
Expected: FAIL — requests to `/admin/...` return 404 because nothing is mounted yet.

- [ ] **Step 3: Implement**

`packages/core/src/api/admin-api.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import type { AdminRecord, ListResponse, MetaResponse, ResourceSchema } from '../contract.js';
import { ADMIN_OPTIONS } from '../constants.js';
import { parseListQuery } from '../crud/list-query.js';
import { parseRecordId } from '../crud/record-id.js';
import { serializeRecord } from '../crud/serialize.js';
import { validateWrite } from '../crud/validate-write.js';
import { AdminNotFoundError } from '../errors.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';

@Injectable()
export class AdminApiService {
  constructor(
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  meta(): MetaResponse {
    const resources = this.registry.list();
    const groups = this.registry
      .groupList()
      .map((group) => ({
        group,
        resources: resources
          .filter((entry) => entry.schema.group === group.key)
          .map(({ schema }) => ({ name: schema.name, label: schema.label, ...(schema.icon ? { icon: schema.icon } : {}) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .filter((entry) => entry.resources.length > 0)
      .sort((a, b) => a.group.order - b.group.order || a.group.label.localeCompare(b.group.label))
      .map(({ group, resources: items }) => ({
        key: group.key,
        label: group.label,
        ...(group.icon ? { icon: group.icon } : {}),
        resources: items,
      }));
    return { schemaVersion: 1, title: this.options.title, groups };
  }

  schema(name: string): ResourceSchema {
    return this.registry.get(name).schema;
  }

  async list(name: string, query: URLSearchParams, ctx: AdminContext): Promise<ListResponse> {
    const { schema, resource } = this.registry.get(name);
    const params = parseListQuery(query, schema);
    const { items, total } = await resource.findMany(params, ctx);
    return { items: items.map((item) => serializeRecord(item, schema.fields)), total, page: params.page, pageSize: params.pageSize };
  }

  async get(name: string, rawId: string, ctx: AdminContext): Promise<AdminRecord> {
    const { schema, resource } = this.registry.get(name);
    const entity = await resource.findOne(parseRecordId(rawId, schema), ctx);
    if (!entity) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    return serializeRecord(entity, schema.fields);
  }

  async create(name: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const dto = await validateWrite(body, { allowed: schema.form.create, dto: resource.form?.create });
    const created: unknown = await resource.create(dto, ctx);
    if (typeof created !== 'object' || created === null) {
      throw new Error(`${entry.className}.create() must return the created entity`);
    }
    return serializeRecord(created, schema.fields);
  }

  async update(name: string, rawId: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    if (!(await resource.findOne(id, ctx))) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    const updateDto = resource.form?.update;
    const dto = await validateWrite(body, {
      allowed: schema.form.update,
      dto: updateDto ?? resource.form?.create,
      partial: !updateDto,
    });
    const updated: unknown = await resource.update(id, dto, ctx);
    return serializeRecord(await this.reloadIfEmpty(entry, updated, id, ctx), schema.fields);
  }

  /** Host services often return nothing from update(); fall back to reading the record. */
  private async reloadIfEmpty(entry: RegisteredResource, result: unknown, id: string | number, ctx: AdminContext): Promise<object> {
    if (typeof result === 'object' && result !== null) return result;
    const reloaded = await entry.resource.findOne(id, ctx);
    if (!reloaded) throw new AdminNotFoundError(`${entry.schema.label} "${id}" not found`);
    return reloaded;
  }
}
```

`packages/core/src/http/admin-http.server.ts`:
```ts
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { ServerResponse } from 'node:http';
import { AdminApiService } from '../api/admin-api.service.js';
import { ADMIN_OPTIONS } from '../constants.js';
import { AdminNotFoundError } from '../errors.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry } from '../registry/resource-registry.js';
import { createAdminContext, type AdminContext } from '../resource/admin-context.js';
import { toErrorResponse } from './error-response.js';
import { readJsonBody, sendJson, type AdminRequest } from './http-io.js';
import { Router } from './router.js';
import { UiAssets, resolveUiDist } from './ui-assets.js';

interface RequestState {
  req: AdminRequest;
  res: ServerResponse;
  url: URL;
  ctx: AdminContext;
}

/**
 * Mounts one handler on the host's HTTP adapter (spec D12). Registered during onModuleInit, which runs
 * after host middleware added in main.ts and before Nest's 404 handler. Host guards, interceptors,
 * pipes, filters and the global prefix do not apply.
 */
@Injectable()
export class AdminHttpServer implements OnModuleInit {
  private readonly logger = new Logger('NestMyAdmin');
  private readonly router = new Router<RequestState>();
  private ui?: UiAssets;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly api: AdminApiService,
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {
    this.router
      .add('GET', '/api/meta', ({ res }) => sendJson(res, 200, this.api.meta()))
      .add('GET', '/api/meta/resources/:resource', ({ res }, p) => sendJson(res, 200, this.api.schema(p.resource)))
      .add('GET', '/api/resources/:resource', async ({ res, url, ctx }, p) =>
        sendJson(res, 200, await this.api.list(p.resource, url.searchParams, ctx)),
      )
      .add('GET', '/api/resources/:resource/:id', async ({ res, ctx }, p) =>
        sendJson(res, 200, await this.api.get(p.resource, p.id, ctx)),
      )
      .add('POST', '/api/resources/:resource', async ({ req, res, ctx }, p) =>
        sendJson(res, 201, await this.api.create(p.resource, await readJsonBody(req), ctx)),
      )
      .add('PATCH', '/api/resources/:resource/:id', async ({ req, res, ctx }, p) =>
        sendJson(res, 200, await this.api.update(p.resource, p.id, await readJsonBody(req), ctx)),
      );
  }

  onModuleInit(): void {
    const adapter = this.adapterHost.httpAdapter;
    if (!adapter) return; // standalone application context: nothing to mount
    const type = adapter.getType();
    if (type !== 'express') {
      throw new Error(`nest-my-admin: the "${type}" HTTP adapter is not supported yet; use @nestjs/platform-express`);
    }
    this.ui = new UiAssets(this.options.uiDistPath ?? resolveUiDist(), {
      basePath: this.options.path,
      apiBase: `${this.options.path}/api`,
      title: this.options.title,
    });
    adapter.use(this.options.path, (req: AdminRequest, res: ServerResponse, next: (error?: unknown) => void) => {
      void this.handle(req, res, next);
    });
    this.logger.log(`Admin mounted at ${this.options.path}`);
  }

  private async handle(req: AdminRequest, res: ServerResponse, next: (error?: unknown) => void): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://admin.local');
    const ctx = createAdminContext(req);
    let resourceName: string | undefined;
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        const match = this.router.match(req.method ?? 'GET', url.pathname);
        if (!match) throw new AdminNotFoundError(`No admin API route for ${req.method} ${url.pathname}`);
        resourceName = match.params.resource;
        await match.handler({ req, res, url, ctx }, match.params);
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      this.ui!.serve(url.pathname, req, res);
    } catch (error) {
      if (res.headersSent) {
        this.logger.error(`[${ctx.correlationId}] error after response started: ${String(error)}`);
        res.end();
        return;
      }
      const columns = resourceName ? this.registry.find(resourceName)?.columnProperties : undefined;
      const { status, body } = toErrorResponse(error, ctx.correlationId, this.logger, columns);
      sendJson(res, status, body);
    }
  }
}
```

`packages/core/src/admin.module.ts` (replace the whole file):
```ts
import { Module, type DynamicModule } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AdminApiService } from './api/admin-api.service.js';
import { ADMIN_OPTIONS } from './constants.js';
import { AdminHttpServer } from './http/admin-http.server.js';
import { resolveAdminOptions, type AdminModuleOptions } from './options.js';
import { ResourceRegistry } from './registry/resource-registry.js';

@Module({})
export class AdminModule {
  static forRoot(options: AdminModuleOptions = {}): DynamicModule {
    return {
      module: AdminModule,
      global: true,
      imports: [DiscoveryModule],
      providers: [
        { provide: ADMIN_OPTIONS, useValue: resolveAdminOptions(options) },
        ResourceRegistry,
        AdminApiService,
        AdminHttpServer,
      ],
      exports: [ResourceRegistry],
    };
  }
}
```

- [ ] **Step 4: Run all core tests and the typecheck**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck && bun run --filter @nest-my-admin/core build`
Expected: all pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): mount the isolated admin API and UI on the Express adapter"
```

---

### Task 11: UI package scaffold, API client and form logic

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vite.config.ts`, `packages/ui/index.html`
- Create: `packages/ui/src/main.tsx` (placeholder, replaced in Task 13), `packages/ui/src/styles/globals.css` (copied), `packages/ui/src/components/ui/{button,input,label,table,textarea}.tsx` (copied)
- Create: `packages/ui/src/lib/utils.ts`, `packages/ui/src/lib/config.ts`, `packages/ui/src/lib/api.ts`, `packages/ui/src/lib/form-values.ts`, `packages/ui/src/lib/format.ts`
- Modify: `packages/core/package.json` (add the `@nest-my-admin/ui` dependency)
- Test: `packages/ui/src/lib/form-values.test.ts`, `packages/ui/src/lib/format.test.ts`

**Interfaces:**
- Consumes: contract types from `packages/core/src/contract.ts` via the TS path `@nest-my-admin/core/contract` (type-only imports).
- Produces:
  - `runtimeConfig: AdminRuntimeConfig`.
  - `class ApiError(status, body: AdminErrorBody)` with `.fields`; `api.meta()`, `api.schema(resource)`, `api.list(resource, { page, pageSize?, sort? })`, `api.get(resource, id)`, `api.create(resource, body)`, `api.update(resource, id, body)`.
  - `type FormValues = Record<string, string | boolean>`, `toFormValues(fields, record?)`, `toPayload(fields, values, initial?): { payload; errors }`.
  - `formatCell(value, field): string`, `cn(...classes)`.
  - `packages/ui/dist/` containing `index.html` and `assets/*` after `bun run build`.

- [ ] **Step 1: Write the package files**

`packages/ui/package.json`:
```json
{
  "name": "@nest-my-admin/ui",
  "version": "0.0.0",
  "description": "Prebuilt admin UI served by @nest-my-admin/core",
  "license": "MIT",
  "type": "module",
  "files": ["dist"],
  "exports": { "./package.json": "./package.json" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "@tailwindcss/vite": "4.3.3",
    "@tanstack/react-query": "5.104.0",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.1",
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "lucide-react": "1.48.0",
    "radix-ui": "1.6.7",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "react-router": "8.4.0",
    "shadcn": "4.21.0",
    "tailwind-merge": "3.7.0",
    "tailwindcss": "4.3.3",
    "tw-animate-css": "1.4.0",
    "vite": "8.3.1"
  }
}
```

`packages/ui/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true,
    "types": ["bun", "node", "vite/client"],
    "paths": {
      "@/*": ["./src/*"],
      "@nest-my-admin/core/contract": ["../core/src/contract.ts"]
    }
  },
  "include": ["src", "vite.config.ts"]
}
```

`packages/ui/vite.config.ts`:
```ts
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs; core injects <base href="<mount path>/"> so any mount path works without a rebuild.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/admin/api': 'http://localhost:3000' } },
});
```

`packages/ui/index.html`:
```html
<!doctype html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/ui/src/main.tsx` (placeholder until Task 13):
```tsx
import './styles/globals.css';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<p className="p-6 text-muted-foreground">nest-my-admin</p>);
```

- [ ] **Step 2: Copy the crm-next look (theme tokens and primitives)**

```bash
mkdir -p packages/ui/src/styles packages/ui/src/components/ui
cp /Users/hooman/Develop/crm-next/src/app/globals.css packages/ui/src/styles/globals.css
perl -pi -e 's/var\(--font-yekanbakh\)/ui-sans-serif, system-ui, sans-serif/; s/var\(--font-geist-mono\)/ui-monospace, SFMono-Regular, monospace/' packages/ui/src/styles/globals.css
perl -0pi -e 's/\n\.styled-scrollbar \{.*\z/\n/s' packages/ui/src/styles/globals.css
for c in button input label table textarea; do cp /Users/hooman/Develop/crm-next/src/components/ui/$c.tsx packages/ui/src/components/ui/; done
perl -0pi -e 's/\A"use client"\n+//' packages/ui/src/components/ui/*.tsx
grep -c "yekanbakh\|styled-scrollbar\|EF3A41\|use client" packages/ui/src/styles/globals.css packages/ui/src/components/ui/*.tsx
grep -n "outline:\|ghost:\|\"icon-sm\"" packages/ui/src/components/ui/button.tsx
```
Expected: the first `grep -c` prints `0` for every file (no crm font, brand colours or `"use client"` left); the second finds the `outline`, `ghost` variants and `icon-sm` size used by the screens.

- [ ] **Step 3: Write the failing tests**

`packages/ui/src/lib/form-values.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { toFormValues, toPayload } from './form-values';

process.env.TZ = 'UTC';

const field = (name: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});

const fields = [
  field('name', 'string'),
  field('stock', 'number'),
  field('price', 'decimal', { scale: 2 }),
  field('active', 'boolean'),
  field('notes', 'text', { nullable: true }),
  field('specs', 'json', { nullable: true }),
  field('at', 'datetime', { nullable: true }),
];

describe('toFormValues', () => {
  test('turns a record into editable strings and booleans', () => {
    expect(
      toFormValues(fields, { name: 'Lamp', stock: 3, price: '19.90', active: true, notes: null, specs: { w: 2 }, at: '2026-01-02T03:04:00.000Z' }),
    ).toEqual({ name: 'Lamp', stock: '3', price: '19.90', active: true, notes: '', specs: '{\n  "w": 2\n}', at: '2026-01-02T03:04' });
  });

  test('empty form for create', () => {
    expect(toFormValues(fields)).toMatchObject({ name: '', stock: '', active: false });
  });
});

describe('toPayload', () => {
  test('types values and omits empty required inputs on create', () => {
    const { payload, errors } = toPayload(fields, {
      name: 'Lamp', stock: '1,200', price: '1,234.50', active: true, notes: '', specs: '', at: '2026-01-02T03:04',
    });
    expect(errors).toEqual({});
    expect(payload).toEqual({ name: 'Lamp', stock: 1200, price: '1234.50', active: true, notes: null, specs: null, at: '2026-01-02T03:04:00.000Z' });
    expect(toPayload(fields, { name: '', stock: '' }).payload).not.toHaveProperty('stock');
  });

  test('reports values the browser cannot convert', () => {
    expect(toPayload(fields, { stock: 'abc', specs: '{oops', at: 'never' }).errors).toEqual({
      stock: ['must be a number'],
      specs: ['must be valid JSON'],
      at: ['must be a valid date and time'],
    });
  });

  test('on update sends only changed values, and a cleared field as null', () => {
    const initial = toFormValues(fields, { name: 'Lamp', stock: 3, price: '1.00', active: false });
    const { payload } = toPayload(fields, { ...initial, stock: '4', name: '' }, initial);
    expect(payload).toEqual({ stock: 4, name: null });
  });
});
```

`packages/ui/src/lib/format.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { formatCell } from './format';

const field = (type: FieldType): FieldSchema => ({
  name: 'x', label: 'X', type, nullable: true, primary: false, readonly: false, persisted: true,
});

describe('formatCell', () => {
  test('renders values for display', () => {
    expect(formatCell(null, field('string'))).toBe('—');
    expect(formatCell(true, field('boolean'))).toBe('Yes');
    expect(formatCell(false, field('boolean'))).toBe('No');
    expect(formatCell({ a: 1 }, field('json'))).toBe('{"a":1}');
    expect(formatCell('19.90', field('decimal'))).toBe('19.90');
    expect(formatCell(7, field('number'))).toBe('7');
  });
});
```

- [ ] **Step 4: Install and run the tests to verify they fail**

Run: `bun install && bun test packages/ui`
Expected: FAIL — `Cannot find module './form-values'` and `'./format'`.

- [ ] **Step 5: Implement the lib files**

`packages/ui/src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`packages/ui/src/lib/config.ts`:
```ts
import type { AdminRuntimeConfig } from '@nest-my-admin/core/contract';

declare global {
  interface Window {
    __NMA__?: AdminRuntimeConfig;
  }
}

/** Injected by @nest-my-admin/core; the fallback is for `vite` dev mode (proxied to a local Nest app). */
export const runtimeConfig: AdminRuntimeConfig = window.__NMA__ ?? {
  basePath: '/',
  apiBase: '/admin/api',
  title: 'Admin (dev)',
};
```

`packages/ui/src/lib/api.ts`:
```ts
import type { AdminErrorBody, AdminRecord, ListResponse, MetaResponse, ResourceSchema } from '@nest-my-admin/core/contract';
import { runtimeConfig } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: AdminErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }

  get fields(): Record<string, string[]> {
    return this.body.fields ?? {};
  }
}

function isErrorBody(value: unknown): value is AdminErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${runtimeConfig.apiBase}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      isErrorBody(data) ? data : { code: 'INTERNAL', message: `Request failed (${res.status})`, correlationId: '' },
    );
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  meta: () => request<MetaResponse>('/meta'),
  schema: (resource: string) => request<ResourceSchema>(`/meta/resources/${enc(resource)}`),
  list: (resource: string, params: { page: number; pageSize?: number; sort?: string }) => {
    const query = new URLSearchParams({ page: String(params.page) });
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.sort) query.set('sort', params.sort);
    return request<ListResponse>(`/resources/${enc(resource)}?${query}`);
  },
  get: (resource: string, id: string) => request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`),
  create: (resource: string, body: Record<string, unknown>) =>
    request<AdminRecord>(`/resources/${enc(resource)}`, { method: 'POST', body: JSON.stringify(body) }),
  update: (resource: string, id: string, body: Record<string, unknown>) =>
    request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
};
```

`packages/ui/src/lib/form-values.ts`:
```ts
import type { AdminRecord, FieldSchema } from '@nest-my-admin/core/contract';

export type FormValues = Record<string, string | boolean>;

export interface PayloadResult {
  payload: Record<string, unknown>;
  errors: Record<string, string[]>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string → value for <input type="datetime-local"> in the browser's timezone. */
function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Record → the string/boolean values the inputs edit. */
export function toFormValues(fields: FieldSchema[], record?: AdminRecord): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const value = record?.[field.name];
    if (field.type === 'boolean') values[field.name] = value === true;
    else if (value === null || value === undefined) values[field.name] = '';
    else if (field.type === 'json') values[field.name] = JSON.stringify(value, null, 2);
    else if (field.type === 'datetime') values[field.name] = toDatetimeLocal(String(value));
    else values[field.name] = String(value);
  }
  return values;
}

/**
 * Input values → JSON payload for `fields`. With `initial` (edit mode) only changed values are sent and a
 * cleared input is sent as null. On create, an empty input is null for nullable fields and omitted otherwise,
 * so the server reports "required" (or applies the column default) instead of receiving "" or 0.
 */
export function toPayload(fields: FieldSchema[], values: FormValues, initial?: FormValues): PayloadResult {
  const payload: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (initial && raw === initial[field.name]) continue;
    if (field.type === 'boolean') {
      payload[field.name] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw : '';
    const trimmed = text.trim();
    if (trimmed === '') {
      if (field.nullable || initial) payload[field.name] = null;
      continue;
    }
    switch (field.type) {
      case 'number': {
        const number = Number(trimmed.replace(/,/g, ''));
        if (Number.isFinite(number)) payload[field.name] = number;
        else errors[field.name] = ['must be a number'];
        break;
      }
      case 'decimal':
      case 'bigint':
        payload[field.name] = trimmed.replace(/,/g, '');
        break;
      case 'json':
        try {
          payload[field.name] = JSON.parse(trimmed);
        } catch {
          errors[field.name] = ['must be valid JSON'];
        }
        break;
      case 'datetime': {
        const date = new Date(trimmed);
        if (Number.isNaN(date.getTime())) errors[field.name] = ['must be a valid date and time'];
        else payload[field.name] = date.toISOString();
        break;
      }
      default:
        payload[field.name] = text;
    }
  }
  return { payload, errors };
}
```

`packages/ui/src/lib/format.ts`:
```ts
import type { FieldSchema } from '@nest-my-admin/core/contract';

export function formatCell(value: unknown, field: FieldSchema): string {
  if (value === null || value === undefined) return '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'json') return JSON.stringify(value);
  if (field.type === 'datetime') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  return String(value);
}
```

- [ ] **Step 6: Make core depend on the UI package**

In `packages/core/package.json`, add after `"scripts"`:
```json
  "dependencies": { "@nest-my-admin/ui": "workspace:*" },
```

- [ ] **Step 7: Run tests, typecheck and build**

Run: `bun install && bun test packages/ui && bun run --filter @nest-my-admin/ui typecheck && bun run --filter @nest-my-admin/ui build && grep -o 'src="./assets/[^"]*"' packages/ui/dist/index.html`
Expected: tests pass; no type errors; the grep prints one relative `./assets/index-<hash>.js` reference.

- [ ] **Step 8: Commit**

```bash
git add packages/ui packages/core/package.json bun.lock
git commit -m "feat(ui): scaffold Vite SPA with crm-next theme, API client and form value logic"
```

---

### Task 12: Demo API with service-first business rules

**Files:**
- Create: `examples/demo-api/package.json`, `examples/demo-api/tsconfig.json`
- Create: `examples/demo-api/src/catalog/product.entity.ts`, `product.dto.ts`, `products.service.ts`, `product.admin.ts`, `catalog.module.ts`
- Create: `examples/demo-api/src/app.module.ts`, `examples/demo-api/src/seed.ts`, `examples/demo-api/src/main.ts`
- Test: `examples/demo-api/test/catalog-admin.test.ts`

**Interfaces:**
- Consumes: `AdminModule`, `AdminResource`, `AdminGroup`, `AdminResourceBase`, `ListConfig`, `FormConfig`, `AdminContext`, `RecordId` from `@nest-my-admin/core` (Tasks 4, 7, 10).
- Produces: `AppModule`; running server `bun src/main.ts` on `PORT` (default 3000) with the admin at `/admin`, seeded products `DEMO-1..3`; resource `product` (group `catalog`, label `Catalog`).

- [ ] **Step 1: Write the package files**

`examples/demo-api/package.json`:
```json
{
  "name": "demo-api",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun src/main.ts",
    "dev": "bun --watch src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@nest-my-admin/core": "workspace:*",
    "@nestjs/common": "12.1.1",
    "@nestjs/core": "12.1.1",
    "@nestjs/platform-express": "12.1.1",
    "@nestjs/typeorm": "12.0.2",
    "class-transformer": "0.5.1",
    "class-validator": "0.15.1",
    "reflect-metadata": "0.2.2",
    "rxjs": "7.8.2",
    "sql.js": "1.14.2",
    "typeorm": "1.1.1"
  },
  "devDependencies": {
    "@nestjs/testing": "12.1.1",
    "@playwright/test": "1.63.0",
    "@types/supertest": "7.2.1",
    "supertest": "7.3.0"
  }
}
```

`examples/demo-api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test", "e2e", "playwright.config.ts"]
}
```

- [ ] **Step 2: Write the failing test**

`examples/demo-api/test/catalog-admin.test.ts`:
```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

let app: INestApplication;
const base = '/admin/api/resources/product';
const post = (body: object) => request(app.getHttpServer()).post(base).send(body);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});
afterAll(async () => {
  await app.close();
});

describe('product admin (service-first)', () => {
  test('the form comes from the DTOs', async () => {
    const res = await request(app.getHttpServer()).get('/admin/api/meta/resources/product');
    expect(res.body.form).toEqual({
      create: ['name', 'sku', 'price', 'stock', 'status', 'releasedOn'],
      update: ['name', 'price', 'stock', 'status', 'releasedOn'],
      requiredOnCreate: ['name', 'sku', 'price'],
    });
  });

  test('create runs ProductsService and decimals stay strings even on SQLite', async () => {
    const res = await post({ name: 'Lamp', sku: 'lamp-1', price: '19.9', stock: 4, status: 'active' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Lamp', sku: 'LAMP-1', price: '19.90', stock: 4, status: 'active' });
    const read = await request(app.getHttpServer()).get(`${base}/${res.body.id}`);
    expect(read.body.price).toBe('19.90');
  });

  test('a rule enforced by the service surfaces as BUSINESS_RULE', async () => {
    const res = await post({ name: 'Ghost', sku: 'ghost-1', price: '5', status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'BUSINESS_RULE', message: 'Active products need stock' });
  });

  test('DTO validation errors are reported per field', async () => {
    const res = await post({ name: '', sku: 'ok-1', price: 'abc' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['name', 'price']);
    expect(res.body.fields.price[0]).toContain('decimal');
  });

  test('fields outside the DTO are rejected', async () => {
    const res = await post({ name: 'Sneaky', sku: 'sneaky-1', price: '1', createdAt: '2020-01-01' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ createdAt: ['is not a writable field'] });
  });

  test('a duplicate unique value is a 409 on that field, not a 500', async () => {
    expect((await post({ name: 'One', sku: 'dup-1', price: '1' })).status).toBe(201);
    const res = await post({ name: 'Two', sku: 'dup-1', price: '1' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', fields: { sku: ['already exists'] } });
  });

  test('update uses the update DTO and the service', async () => {
    const { body } = await post({ name: 'Mug', sku: 'mug-1', price: '8' });
    const res = await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ stock: 9 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stock: 9, sku: 'MUG-1' });
    const sku = await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ sku: 'NEW' });
    expect(sku.status).toBe(422);
  });

  test('service exceptions keep their meaning (archived → CONFLICT)', async () => {
    const { body } = await post({ name: 'Old', sku: 'old-1', price: '2' });
    await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ status: 'archived' });
    const res = await request(app.getHttpServer()).patch(`${base}/${body.id}`).send({ name: 'Renamed' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'Archived products are read-only' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun install && bun test examples/demo-api`
Expected: FAIL — `Cannot find module '../src/app.module.js'`.

- [ ] **Step 4: Implement the demo**

`examples/demo-api/src/catalog/product.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

@Entity()
export class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) name: string;
  @Column({ length: 40, unique: true }) sku: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) price: string;
  @Column({ type: 'int', default: 0 }) stock: number;
  @Column({ type: 'simple-enum', enum: [...PRODUCT_STATUSES], default: 'draft' }) status: ProductStatus;
  @Column({ type: 'date', nullable: true }) releasedOn: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
```

`examples/demo-api/src/catalog/product.dto.ts`:
```ts
import { IsDateString, IsDecimal, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PRODUCT_STATUSES, type ProductStatus } from './product.entity.js';

export class CreateProductDto {
  @IsString() @Length(1, 120) name: string;
  @IsString() @Matches(/^[A-Za-z0-9-]{2,40}$/, { message: 'sku must be 2-40 letters, digits or dashes' }) sku: string;
  @IsDecimal({ decimal_digits: '0,2' }) price: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
  @IsOptional() @IsDateString({ strict: true }) releasedOn?: string | null;
}

/** SKU is fixed after creation, so it is not part of the update DTO. */
export class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsDecimal({ decimal_digits: '0,2' }) price?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number;
  @IsOptional() @IsIn(PRODUCT_STATUSES) status?: ProductStatus;
  @IsOptional() @IsDateString({ strict: true }) releasedOn?: string | null;
}
```

`examples/demo-api/src/catalog/products.service.ts`:
```ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';

/** The app's own business logic. The admin calls it instead of writing to the table directly. */
@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}

  async create(dto: CreateProductDto): Promise<Product> {
    const product = this.products.create({ ...dto, sku: dto.sku.toUpperCase() });
    this.assertSellable(product);
    return this.products.save(product);
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product> {
    const product = await this.products.findOneByOrFail({ id });
    if (product.status === 'archived') throw new ConflictException('Archived products are read-only');
    this.products.merge(product, dto);
    this.assertSellable(product);
    return this.products.save(product);
  }

  private assertSellable(product: Product): void {
    if (product.status === 'active' && (product.stock ?? 0) <= 0) {
      throw new BadRequestException('Active products need stock');
    }
  }
}
```

`examples/demo-api/src/catalog/product.admin.ts`:
```ts
import { AdminResource, AdminResourceBase, type AdminContext, type FormConfig, type ListConfig, type RecordId } from '@nest-my-admin/core';
import { CreateProductDto, UpdateProductDto } from './product.dto.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';

@AdminResource(Product, { icon: 'package' })
export class ProductAdmin extends AdminResourceBase<Product> {
  constructor(private readonly products: ProductsService) {
    super();
  }

  list: ListConfig<Product> = { columns: ['id', 'name', 'sku', 'price', 'stock', 'status'], sort: '-id', pageSize: 20 };
  form: FormConfig = { create: CreateProductDto, update: UpdateProductDto };

  create(dto: CreateProductDto, _ctx: AdminContext) {
    return this.products.create(dto);
  }

  update(id: RecordId, dto: UpdateProductDto, _ctx: AdminContext) {
    return this.products.update(Number(id), dto);
  }
}
```

`examples/demo-api/src/catalog/catalog.module.ts`:
```ts
import { AdminGroup } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductAdmin } from './product.admin.js';
import { Product } from './product.entity.js';
import { ProductsService } from './products.service.js';

@AdminGroup({ label: 'Catalog', icon: 'boxes' })
@Module({
  imports: [TypeOrmModule.forFeature([Product])],
  providers: [ProductsService, ProductAdmin],
})
export class CatalogModule {}
```

`examples/demo-api/src/app.module.ts`:
```ts
import { AdminModule } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module.js';
import { Product } from './catalog/product.entity.js';

@Module({
  imports: [
    TypeOrmModule.forRoot({ type: 'sqljs', entities: [Product], synchronize: true }),
    AdminModule.forRoot({ path: '/admin', title: 'Demo shop' }),
    CatalogModule,
  ],
})
export class AppModule {}
```

`examples/demo-api/src/seed.ts`:
```ts
import type { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Product } from './catalog/product.entity.js';

export async function seedProducts(app: INestApplication): Promise<void> {
  const products = app.get<Repository<Product>>(getRepositoryToken(Product));
  if ((await products.count()) > 0) return;
  await products.save([
    { name: 'Desk lamp', sku: 'DEMO-1', price: '24.90', stock: 12, status: 'active' },
    { name: 'Notebook', sku: 'DEMO-2', price: '3.50', stock: 200, status: 'active' },
    { name: 'Standing desk', sku: 'DEMO-3', price: '499.00', stock: 0, status: 'draft' },
  ]);
}
```

`examples/demo-api/src/main.ts`:
```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { seedProducts } from './seed.js';

const app = await NestFactory.create(AppModule);
await seedProducts(app);
const port = Number(process.env.PORT ?? 3000);
await app.listen(port);
console.log(`Demo API on http://localhost:${port}; admin at http://localhost:${port}/admin`);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run --filter @nest-my-admin/core build && bun test examples/demo-api && bun run --filter demo-api typecheck`
Expected: all pass, no type errors. (The demo imports `@nest-my-admin/core` through its package `exports`, i.e. the built `dist/`; rebuild core after changing it.) If the duplicate-SKU test gets `500`, print `res.body` and the server log: the sql.js error text must match `/UNIQUE constraint failed/` for the mapping in Task 8. Adjust `columnFromMessage` in `error-response.ts` (and add the new text as a case in `error-response.test.ts`) rather than weakening this test.

- [ ] **Step 6: Run the demo once by hand**

Run: `bun run --filter @nest-my-admin/core build && cd examples/demo-api && PORT=3000 bun src/main.ts` (in a second terminal: `curl -s localhost:3000/admin/api/resources/product | head -c 300`), then stop the server.
Expected: JSON with the three seeded `DEMO-*` products.

- [ ] **Step 7: Commit**

```bash
git add examples/demo-api bun.lock
git commit -m "feat(demo): catalog demo whose admin writes go through ProductsService"
```

---

### Task 13: UI screens — shell, list, create and edit

**Files:**
- Modify: `packages/ui/src/main.tsx` (replace the placeholder)
- Create: `packages/ui/src/lib/queries.ts`, `packages/ui/src/components/page-message.tsx`
- Create: `packages/ui/src/app/admin-layout.tsx`, `home-page.tsx`, `list-page.tsx`, `form-page.tsx`, `field-input.tsx`, `not-found.tsx`

**Interfaces:**
- Consumes: `api`, `ApiError` (Task 11); `runtimeConfig` (Task 11); `toFormValues`, `toPayload`, `FormValues` (Task 11); `formatCell` (Task 11); `cn` and the copied `Button`, `Input`, `Label`, `Table*`, `Textarea` components (Task 11).
- Produces: routes under the runtime base path: `/` (redirects to the first resource), `/:resource` (list), `/:resource/new`, `/:resource/:id`; stable accessibility hooks the E2E test uses: a `Menu` button (mobile), resource links named by label, inputs labelled by field label, field errors in `#field-<name>-error`, form-level errors in `role="alert"`, a `Save` submit button and a `New` link.

- [ ] **Step 1: Write the data hooks and shared message component**

`packages/ui/src/lib/queries.ts`:
```ts
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: api.meta });

export const useSchema = (resource: string) =>
  useQuery({ queryKey: ['schema', resource], queryFn: () => api.schema(resource) });

export const useList = (resource: string, page: number, sort?: string) =>
  useQuery({
    queryKey: ['list', resource, page, sort],
    queryFn: () => api.list(resource, { page, sort }),
    placeholderData: keepPreviousData,
  });

export const useRecord = (resource: string, id: string | undefined) =>
  useQuery({ queryKey: ['record', resource, id], queryFn: () => api.get(resource, id!), enabled: id !== undefined });
```

`packages/ui/src/components/page-message.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageMessage({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-lg border p-6 text-sm', tone === 'error' ? 'border-destructive/40 text-destructive' : 'text-muted-foreground')}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write the layout, home and not-found pages**

`packages/ui/src/app/admin-layout.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import type { MetaGroup } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { runtimeConfig } from '@/lib/config';
import { useMeta } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function AdminLayout() {
  const meta = useMeta();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const title = meta.data?.title ?? runtimeConfig.title;
  const groups = meta.data?.groups ?? [];

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-e bg-sidebar text-sidebar-foreground md:block">
        <ResourceNav title={title} groups={groups} />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" aria-hidden onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] border-e bg-sidebar text-sidebar-foreground shadow-xl">
            <ResourceNav title={title} groups={groups} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" onClick={() => setNavOpen(true)}>
            <Menu />
          </Button>
          <span className="font-semibold md:hidden">{title}</span>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ResourceNav({ title, groups }: { title: string; groups: MetaGroup[] }) {
  return (
    <nav aria-label="Resources" className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div className="px-2 py-1 text-lg font-semibold">{title}</div>
      {groups.map((group) => (
        <div key={group.key}>
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
          <ul className="flex flex-col gap-0.5">
            {group.resources.map((resource) => (
              <li key={resource.name}>
                <NavLink
                  to={`/${resource.name}`}
                  className={({ isActive }) =>
                    cn('block rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent', isActive && 'bg-sidebar-accent font-medium')
                  }
                >
                  {resource.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

`packages/ui/src/app/home-page.tsx`:
```tsx
import { Navigate } from 'react-router';
import { PageMessage } from '@/components/page-message';
import { useMeta } from '@/lib/queries';

export function HomePage() {
  const meta = useMeta();
  if (meta.isPending) return <PageMessage>Loading…</PageMessage>;
  if (meta.isError) return <PageMessage tone="error">{meta.error.message}</PageMessage>;
  const first = meta.data.groups[0]?.resources[0];
  if (!first) return <PageMessage>No admin resources are registered yet. Decorate a provider with @AdminResource.</PageMessage>;
  return <Navigate to={`/${first.name}`} replace />;
}
```

`packages/ui/src/app/not-found.tsx`:
```tsx
import { PageMessage } from '@/components/page-message';

export function NotFound() {
  return <PageMessage>Page not found.</PageMessage>;
}
```

- [ ] **Step 3: Write the list page (table on desktop, cards on mobile)**

`packages/ui/src/app/list-page.tsx`:
```tsx
import { Fragment } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { AdminRecord, FieldSchema } from '@nest-my-admin/core/contract';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCell } from '@/lib/format';
import { useList, useSchema } from '@/lib/queries';

export function ListPage() {
  const { resource = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const sortParam = searchParams.get('sort') ?? undefined;
  const schema = useSchema(resource);
  const list = useList(resource, page, sortParam);

  if (schema.isPending) return <PageMessage>Loading…</PageMessage>;
  if (schema.isError) return <PageMessage tone="error">{schema.error.message}</PageMessage>;

  const s = schema.data;
  const columns = s.list.columns
    .map((name) => s.fields.find((field) => field.name === name))
    .filter((field): field is FieldSchema => field !== undefined);
  const titleColumn = columns.find((column) => column.name !== s.primaryKey) ?? columns[0];
  const detailColumns = columns.filter((column) => column !== titleColumn);
  const sort = sortParam
    ? { field: sortParam.replace(/^-/, ''), direction: sortParam.startsWith('-') ? 'desc' : 'asc' }
    : s.list.defaultSort;
  const items = list.data?.items ?? [];
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const recordPath = (item: AdminRecord) => `/${s.name}/${encodeURIComponent(String(item[s.primaryKey]))}`;

  function updateParams(changes: Record<string, string | null>) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      return next;
    });
  }

  function toggleSort(field: string) {
    const ascending = sort.field === field && sort.direction === 'asc';
    updateParams({ sort: ascending ? `-${field}` : field, page: null });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{s.label}</h1>
        <Button asChild>
          <Link to={`/${s.name}/new`}>
            <Plus />
            New
          </Link>
        </Button>
      </div>

      {list.isError && <PageMessage tone="error">{list.error.message}</PageMessage>}

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.name}>
                  <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(column.name)}>
                    {column.label}
                    {sort.field === column.name &&
                      (sort.direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item[s.primaryKey])} className="cursor-pointer" onClick={() => navigate(recordPath(item))}>
                {columns.map((column) => (
                  <TableCell key={column.name}>{formatCell(item[column.name], column)}</TableCell>
                ))}
              </TableRow>
            ))}
            {list.isSuccess && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  No records yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((item) => (
          <li key={String(item[s.primaryKey])}>
            <Link to={recordPath(item)} className="block rounded-lg border p-3 active:bg-muted">
              <div className="font-medium">
                {titleColumn ? formatCell(item[titleColumn.name], titleColumn) : String(item[s.primaryKey])}
              </div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                {detailColumns.map((column) => (
                  <Fragment key={column.name}>
                    <dt className="text-muted-foreground">{column.label}</dt>
                    <dd className="truncate">{formatCell(item[column.name], column)}</dd>
                  </Fragment>
                ))}
              </dl>
            </Link>
          </li>
        ))}
        {list.isSuccess && items.length === 0 && <li className="text-center text-sm text-muted-foreground">No records yet.</li>}
      </ul>

      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{list.data ? `${list.data.total} total` : ''}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= totalPages} onClick={() => updateParams({ page: String(page + 1) })}>
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the field input and the form page**

`packages/ui/src/app/field-input.tsx`:
```tsx
import type { ReactNode } from 'react';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface FieldInputProps {
  field: FieldSchema;
  value: string | boolean | undefined;
  required: boolean;
  errors?: string[];
  onChange: (value: string | boolean) => void;
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

export function FieldInput({ field, value, required, errors, onChange }: FieldInputProps) {
  const id = `field-${field.name}`;
  const errorId = `${id}-error`;
  const invalid = (errors?.length ?? 0) > 0;
  const aria = { 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? errorId : undefined };
  const text = typeof value === 'string' ? value : '';

  const label = (
    <Label htmlFor={id}>
      {field.label}
      {required && (
        <span aria-hidden className="text-destructive">
          *
        </span>
      )}
    </Label>
  );

  if (field.type === 'boolean') {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <input id={id} type="checkbox" className="size-4 accent-primary" checked={value === true} onChange={(e) => onChange(e.target.checked)} {...aria} />
          {label}
        </div>
        <FieldErrors id={errorId} errors={errors} />
      </div>
    );
  }

  let control: ReactNode;
  if (field.type === 'enum') {
    control = (
      <select id={id} className={selectClass} value={text} onChange={(e) => onChange(e.target.value)} {...aria}>
        <option value="">—</option>
        {field.enumValues?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === 'text' || field.type === 'json') {
    control = (
      <Textarea
        id={id}
        value={text}
        rows={field.type === 'json' ? 6 : 4}
        className={cn(field.type === 'json' && 'font-mono')}
        onChange={(e) => onChange(e.target.value)}
        {...aria}
      />
    );
  } else {
    control = <Input id={id} value={text} onChange={(e) => onChange(e.target.value)} {...inputProps(field)} {...aria} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {control}
      <FieldErrors id={errorId} errors={errors} />
    </div>
  );
}

/** Numeric fields use text inputs with inputMode: a controlled type="number" can drop focus on mobile keyboards. */
function inputProps(field: FieldSchema): { type: string; inputMode?: 'decimal' | 'numeric' } {
  switch (field.type) {
    case 'number':
    case 'decimal':
      return { type: 'text', inputMode: 'decimal' };
    case 'bigint':
      return { type: 'text', inputMode: 'numeric' };
    case 'date':
      return { type: 'date' };
    case 'datetime':
      return { type: 'datetime-local' };
    default:
      return { type: 'text' };
  }
}

function FieldErrors({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {errors.join(' ')}
    </p>
  );
}
```

`packages/ui/src/app/form-page.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminRecord, FieldSchema, ResourceSchema } from '@nest-my-admin/core/contract';
import { FieldInput } from '@/app/field-input';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { toFormValues, toPayload, type FormValues } from '@/lib/form-values';
import { useRecord, useSchema } from '@/lib/queries';

type Mode = 'create' | 'edit';

export function FormPage({ mode }: { mode: Mode }) {
  const { resource = '', id } = useParams();
  const schema = useSchema(resource);
  const record = useRecord(resource, mode === 'edit' ? id : undefined);

  if (schema.isPending || (mode === 'edit' && record.isPending)) return <PageMessage>Loading…</PageMessage>;
  if (schema.isError) return <PageMessage tone="error">{schema.error.message}</PageMessage>;
  if (mode === 'edit' && record.isError) return <PageMessage tone="error">{record.error.message}</PageMessage>;
  return <RecordForm key={`${resource}:${id ?? 'new'}`} schema={schema.data} mode={mode} id={id} record={record.data} />;
}

interface RecordFormProps {
  schema: ResourceSchema;
  mode: Mode;
  id?: string;
  record?: AdminRecord;
}

function RecordForm({ schema, mode, id, record }: RecordFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const names = mode === 'create' ? schema.form.create : schema.form.update;
  const fields = names
    .map((name) => schema.fields.find((field) => field.name === name))
    .filter((field): field is FieldSchema => field !== undefined);
  const [initial] = useState<FormValues>(() => toFormValues(fields, record));
  const [values, setValues] = useState<FormValues>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      mode === 'create' ? api.create(schema.name, payload) : api.update(schema.name, id!, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['list', schema.name] });
      queryClient.removeQueries({ queryKey: ['record', schema.name] });
      navigate(`/${schema.name}`);
    },
    onError: (error) => {
      if (!(error instanceof ApiError)) {
        setFormError(error.message);
        return;
      }
      const entries = Object.entries(error.fields);
      const shown = Object.fromEntries(entries.filter(([name]) => names.includes(name)));
      const hidden = entries.filter(([name]) => !names.includes(name)).map(([name, messages]) => `${name}: ${messages.join(', ')}`);
      setFieldErrors(shown);
      setFormError(Object.keys(shown).length > 0 && hidden.length === 0 ? null : [error.message, ...hidden].join(' — '));
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const { payload, errors } = toPayload(fields, values, mode === 'edit' ? initial : undefined);
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length === 0) save.mutate(payload);
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold">{mode === 'create' ? `New ${schema.label.toLowerCase()}` : `${schema.label} #${id}`}</h1>
      {formError && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError}
        </div>
      )}
      {fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          required={mode === 'create' && schema.form.requiredOnCreate.includes(field.name)}
          errors={fieldErrors[field.name]}
          onChange={(value) => setValues((previous) => ({ ...previous, [field.name]: value }))}
        />
      ))}
      <div className="sticky bottom-0 flex gap-2 border-t bg-background py-3 md:static md:border-0 md:py-0">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="outline" onClick={() => navigate(`/${schema.name}`)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: Replace the entry point with the router**

`packages/ui/src/main.tsx` (replace the whole file):
```tsx
import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AdminLayout } from '@/app/admin-layout';
import { FormPage } from '@/app/form-page';
import { HomePage } from '@/app/home-page';
import { ListPage } from '@/app/list-page';
import { NotFound } from '@/app/not-found';
import { runtimeConfig } from '@/lib/config';

document.title = runtimeConfig.title;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

const router = createBrowserRouter(
  [
    {
      element: <AdminLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: ':resource', element: <ListPage /> },
        { path: ':resource/new', element: <FormPage mode="create" /> },
        { path: ':resource/:id', element: <FormPage mode="edit" /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: runtimeConfig.basePath },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: Typecheck, build and smoke-check against the demo**

Run: `bun run --filter @nest-my-admin/ui typecheck && bun run build && bun test packages/ui`
Expected: no type errors; build succeeds; UI unit tests still pass.

Then run `cd examples/demo-api && PORT=3000 bun src/main.ts`, open http://localhost:3000/admin in a browser, and check: it redirects to `/admin/product`; the three `DEMO-*` rows show; **New** opens a form; saving with an empty **Price** shows an error under the field; the layout collapses to cards with a **Menu** button at a phone width. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): add admin shell, list (table + mobile cards), create and edit screens"
```

---

### Task 14: End-to-end tests with Playwright

**Files:**
- Create: `examples/demo-api/playwright.config.ts`, `examples/demo-api/e2e/products.pw.ts`

**Interfaces:**
- Consumes: the demo server (Task 12) and the UI's accessibility hooks (Task 13).
- Produces: `bun run e2e` (root) — builds, then runs the Playwright suite on a desktop and a mobile device profile.

- [ ] **Step 1: Write the config and the failing tests**

`examples/demo-api/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  workers: 1,
  use: { baseURL: 'http://localhost:3310', trace: 'retain-on-failure' },
  webServer: {
    command: 'bun src/main.ts',
    env: { PORT: '3310' },
    url: 'http://localhost:3310/admin/api/meta',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
```

`examples/demo-api/e2e/products.pw.ts`:
```ts
import { expect, test } from '@playwright/test';

test('opens the first resource and navigates with the sidebar', async ({ page, isMobile }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/product$/);
  await expect(page.getByRole('heading', { name: 'Product' })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toBeVisible();

  if (isMobile) await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Product' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);
});

test('creates a product through the service and edits it', async ({ page }, testInfo) => {
  const sku = `E2E-${testInfo.project.name.toUpperCase()}`;

  await page.goto('/admin/product');
  await page.getByRole('link', { name: 'New' }).click();
  await page.getByLabel('Name').fill('Playwright lamp');
  await page.getByLabel('Sku').fill(sku.toLowerCase());
  await page.getByLabel('Price').fill('19.9');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/admin\/product$/);
  const created = page.getByText(sku, { exact: true }).filter({ visible: true }); // upper-cased by ProductsService
  await expect(created).toBeVisible();

  await created.click();
  await expect(page).toHaveURL(/\/admin\/product\/\d+$/);
  const editUrl = page.url();
  await page.getByLabel('Stock').fill('3');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  await page.goto(editUrl);
  await expect(page.getByLabel('Stock')).toHaveValue('3');
  await expect(page.getByLabel('Price')).toHaveValue('19.90');
});

test('deep link refresh works and errors are shown where they belong', async ({ page }) => {
  await page.goto('/admin/product/new'); // served index.html + <base href> (Review Focus 2)

  await page.getByLabel('Name').fill('Bad price');
  await page.getByLabel('Sku').fill('bad-price');
  await page.getByLabel('Price').fill('abc');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#field-price-error')).toContainText('decimal');

  await page.getByLabel('Price').fill('10');
  await page.getByLabel('Status').selectOption('active');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert')).toContainText('Active products need stock');
  await expect(page).toHaveURL(/\/admin\/product\/new$/);
});
```

- [ ] **Step 2: Install the browser and run the suite**

Run: `cd examples/demo-api && bunx playwright install chromium && cd ../.. && bun run e2e`
Expected: `6 passed` (3 tests × desktop + mobile). On failure, open `examples/demo-api/playwright-report` or the retained trace; fix the UI or server rather than loosening the assertions.

- [ ] **Step 3: Confirm Bun's test runner ignores the Playwright files**

Run: `bun test examples`
Expected: only `catalog-admin.test.ts` runs; no `products.pw.ts`.

- [ ] **Step 4: Commit**

```bash
git add examples/demo-api/playwright.config.ts examples/demo-api/e2e
git commit -m "test(e2e): cover list, create, edit, deep links and error display on desktop and mobile"
```

---

### Task 15: Packaging smoke test on Node and Bun

**Files:**
- Create: `scripts/pack-smoke.ts`, `scripts/pack-fixture/tsconfig.json`, `scripts/pack-fixture/src/main.ts`

**Interfaces:**
- Consumes: `bun run build` (root); the packages' `files`/`exports` (Tasks 1, 11); the public API `AdminModule`, `AdminResource`, `AdminResourceBase`, `AdminGroup`.
- Produces: `bun run pack:smoke` — exits non-zero unless the packed tarballs install into a fresh **npm** project, compile with `tsc`, and serve UI + API under both `node` and `bun`.

- [ ] **Step 1: Write the consumer fixture**

`scripts/pack-fixture/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

`scripts/pack-fixture/src/main.ts`:
```ts
import 'reflect-metadata';
import { AdminGroup, AdminModule, AdminResource, AdminResourceBase } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
}

@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}

@AdminGroup({ label: 'Notes' })
@Module({ providers: [NoteAdmin] })
class NotesModule {}

@Module({
  imports: [TypeOrmModule.forRoot({ type: 'sqljs', entities: [Note], synchronize: true }), AdminModule.forRoot({ title: 'Smoke' }), NotesModule],
})
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: ['error'] });
await app.listen(Number(process.env.PORT));
console.log('READY');
```

- [ ] **Step 2: Write the smoke script**

`scripts/pack-smoke.ts`:
```ts
import { $ } from 'bun';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`pack-smoke: ${message}`);
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // server not up yet
    }
    await Bun.sleep(250);
  }
  throw new Error(`pack-smoke: timed out waiting for ${url}`);
}

const root = resolve(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'nma-pack-'));
const tarballs = join(work, 'tarballs');
console.log(`pack-smoke: working in ${work}`);

await $`bun run build`.cwd(root);
await $`bun pm pack --destination ${tarballs} --quiet`.cwd(join(root, 'packages/ui'));
await $`bun pm pack --destination ${tarballs} --quiet`.cwd(join(root, 'packages/core'));
const files = readdirSync(tarballs);
const uiTgz = join(tarballs, files.find((f) => f.startsWith('nest-my-admin-ui-'))!);
const coreTgz = join(tarballs, files.find((f) => f.startsWith('nest-my-admin-core-'))!);

// 1. The packed core depends on an exact ui version, never on a workspace: range.
const corePackage = await $`tar -xzOf ${coreTgz} package/package.json`.text();
assert(!corePackage.includes('workspace:'), 'core tarball still contains a workspace: range');
assert(/"@nest-my-admin\/ui":\s*"\d+\.\d+\.\d+/.test(corePackage), 'core tarball does not pin @nest-my-admin/ui');

// 2. The ui tarball ships only the build (no React, no sources).
const uiEntries = (await $`tar -tzf ${uiTgz}`.text()).trim().split('\n');
assert(uiEntries.includes('package/dist/index.html'), 'ui tarball has no dist/index.html');
const unexpected = uiEntries.filter(
  (entry) => !entry.endsWith('/') && entry !== 'package/package.json' && !entry.startsWith('package/dist/') && !/^package\/(README|LICENSE)/i.test(entry),
);
assert(unexpected.length === 0, `unexpected files in ui tarball: ${unexpected.join(', ')}`);

// 3. A fresh consumer project installs the tarballs with npm and compiles with tsc.
const app = join(work, 'consumer');
cpSync(join(root, 'scripts/pack-fixture'), app, { recursive: true });
const coreDev = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).devDependencies as Record<string, string>;
const rootDev = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies as Record<string, string>;
const pick = (names: string[], from: Record<string, string>) => Object.fromEntries(names.map((name) => [name, from[name]!]));
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: 'nma-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@nest-my-admin/ui': `file:${uiTgz}`,
        '@nest-my-admin/core': `file:${coreTgz}`,
        ...pick(
          ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', '@nestjs/typeorm', 'typeorm', 'sql.js', 'reflect-metadata', 'rxjs', 'class-validator', 'class-transformer'],
          coreDev,
        ),
      },
      devDependencies: pick(['typescript', '@types/node'], rootDev),
      overrides: { '@nest-my-admin/ui': '$@nest-my-admin/ui' },
    },
    null,
    2,
  ),
);
await $`npm install --no-audit --no-fund`.cwd(app);
await $`npx tsc -p tsconfig.json`.cwd(app);

// 4. Boot on each runtime and exercise UI + API.
for (const [runtime, port] of [['node', 4311], ['bun', 4312]] as const) {
  const server = Bun.spawn([runtime, 'dist/main.js'], { cwd: app, env: { ...process.env, PORT: String(port) }, stdout: 'inherit', stderr: 'inherit' });
  try {
    const origin = `http://localhost:${port}`;
    await waitFor(`${origin}/admin/api/meta`);

    const html = await (await fetch(`${origin}/admin/note/42`)).text();
    assert(html.includes('<base href="/admin/">') && html.includes('window.__NMA__'), `${runtime}: index.html missing runtime injection`);
    const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert(asset, `${runtime}: index.html references no JS asset`);
    const js = await fetch(`${origin}/admin/${asset}`);
    assert(js.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'), `${runtime}: asset not served`);

    const meta = (await (await fetch(`${origin}/admin/api/meta`)).json()) as { groups: { resources: { name: string }[] }[] };
    assert(meta.groups[0]?.resources[0]?.name === 'note', `${runtime}: meta does not list the note resource`);
    const created = await fetch(`${origin}/admin/api/resources/note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'hello' }),
    });
    assert(created.status === 201, `${runtime}: create returned ${created.status}`);
    console.log(`pack-smoke: ✓ ${runtime}`);
  } finally {
    server.kill();
    await server.exited;
  }
}

rmSync(work, { recursive: true, force: true });
console.log('pack-smoke: all checks passed');
```

- [ ] **Step 3: Run it**

Run: `bun run pack:smoke`
Expected: ends with `pack-smoke: ✓ node`, `pack-smoke: ✓ bun`, `pack-smoke: all checks passed`. If `npm install` tries to fetch `@nest-my-admin/ui` from the registry, the `overrides` entry is not applying; check the generated `package.json` in the printed working directory (it is kept on failure).

- [ ] **Step 4: Commit**

```bash
git add scripts
git commit -m "test: pack core and ui, install into a fresh npm project, boot on node and bun"
```

---

### Task 16: CI, licence, README and CLAUDE.md

**Files:**
- Create: `.github/workflows/ci.yml`, `LICENSE`, `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: root scripts `typecheck`, `build`, `test`, `pack:smoke`, `e2e`.
- Produces: CI on every push and pull request; contributor docs.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run build
      - run: bun test packages examples
      - run: bun run pack:smoke
      - run: bunx playwright install --with-deps chromium
        working-directory: examples/demo-api
      - run: bun run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: examples/demo-api/playwright-report
```

- [ ] **Step 2: Write LICENSE, README and CLAUDE.md**

`LICENSE`:
```
MIT License

Copyright (c) 2026 nest-my-admin contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`README.md`:
````markdown
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

## Develop

```bash
bun install
bun run build        # UI then core
bun run test         # unit + integration
bun run e2e          # Playwright (run `bunx playwright install chromium` in examples/demo-api once)
cd examples/demo-api && bun src/main.ts
```

Design: `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md`.
````

`CLAUDE.md`:
```markdown
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
bun run e2e                                     # build + Playwright on examples/demo-api (desktop + mobile); needs `bunx playwright install chromium` once
bun run pack:smoke                              # pack core+ui, npm-install into a temp app, boot on node and bun
cd examples/demo-api && bun src/main.ts         # demo at http://localhost:3000/admin
cd packages/ui && bun run dev                   # UI dev server :5173, proxies /admin/api to :3000
```

## Architecture

- `packages/core` (ESM Nest library). `ResourceRegistry` discovers `@AdminResource` providers via `DiscoveryService` in `onModuleInit`, attaches the TypeORM repository, and builds a `ResourceSchema` with `buildResourceSchema` (TypeORM column metadata + class-validator DTO metadata). The sidebar group of a resource is the Nest module that provides it (`@AdminGroup` customises it).
- The admin HTTP surface is **not** Nest controllers: `AdminHttpServer` mounts one handler on the Express adapter at `path` (spec D12), so host guards, interceptors, pipes, filters and `setGlobalPrefix` never affect it. `/api/*` goes through the package's own `Router` → `AdminApiService` → resource methods; everything else is served by `UiAssets` (SPA fallback, `<base href>` + `window.__NMA__` injected into `index.html`).
- Writes: `validateWrite` (DTO whitelist + class-validator) → the resource's `create`/`update`, which host apps override to call their services (spec D2). Errors always leave through `toErrorResponse` as `{ code, message, fields?, correlationId }`; TypeORM unique/not-null violations are mapped to field errors.
- `packages/core/src/contract.ts` is the JSON contract with the UI. It is types only; the UI imports it from source through a tsconfig path.
- `packages/ui` is a Vite + React + shadcn SPA published as static `dist/` only (all its deps are devDependencies). The shadcn primitives and theme tokens were copied from crm-next (`radix-nova`, neutral).
- `examples/demo-api` is the reference host app used by integration and E2E tests. It imports `@nest-my-admin/core` through the package `exports` (the built `dist/`), so run `bun run build` (or `bun run --filter @nest-my-admin/core build`) after changing core; the root `test`, `typecheck` and `e2e` scripts do this for you.

## Conventions

- Relative imports in `packages/core` use `.js` extensions (NodeNext ESM).
- `decimal` and `bigint` values are always strings in API responses (`serializeValue`); drivers disagree, so never rely on the driver.
- Playwright files end in `.pw.ts`; Bun's test runner would otherwise pick up `*.spec.ts`.
- New UI inputs for numbers use `type="text"` with `inputMode`, not `type="number"`.
```

- [ ] **Step 3: Run the full local pipeline**

Run: `bun install --frozen-lockfile && bun run typecheck && bun run build && bun run test && bun run pack:smoke && bun run e2e`
Expected: every step succeeds.

- [ ] **Step 4: Commit**

```bash
git add .github LICENSE README.md CLAUDE.md
git commit -m "chore: add CI, MIT licence, README and CLAUDE.md"
```

---

## Out of scope for M0 (planned in M1+)

Relations and embedded columns in forms/lists, delete, filters and search, auto-registration of entities without a resource, typed nested paths in `ListConfig`, transactions/`ctx.manager`, `AsyncLocalStorage` context, Nest 11 / TypeORM 0.3 matrix, composite keys, i18n/RTL/Jalali, the full shadcn sidebar and theming, auth and permissions.
