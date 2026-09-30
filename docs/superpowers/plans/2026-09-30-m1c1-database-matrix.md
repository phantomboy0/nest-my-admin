# M1c-1 — Database Matrix and Host Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every integration test runs on SQLite (sql.js), Postgres and MySQL; database errors from all three map to the right fields; and the package is proven on the oldest supported host stack (NestJS 11.0 + TypeORM 0.3.20) and in a CommonJS host app.

**Architecture:** A test helper hands each test app its own freshly created database on the server chosen by `NMA_TEST_DB` (sql.js in memory by default), so apps never share rows and nothing needs cleaning between tests. The registry records how each entity's database names (columns, unique constraints and indexes, foreign keys) map back to entity properties, and `toErrorResponse` uses that map plus a few new driver codes to put errors on the right field. `scripts/compat.ts` copies the working tree to a temp directory, pins the oldest supported Nest/TypeORM, and runs the core test suite there; `pack:smoke` gains a CommonJS consumer on the same stack. CI runs the suite on each database.

**Tech Stack:** unchanged (Bun 1.4.2, TypeScript 7.0.2, NestJS 12.1.1, TypeORM 1.1.1, class-validator 0.15.1, React 19.3, Playwright 1.63) plus `pg` 8.23.0, `mysql2` 3.24.5, Docker images `postgres:17-alpine` and `mysql:8.4`. The compatibility stack is NestJS 11.0.0, `@nestjs/typeorm` 11.0.0, TypeORM 0.3.20, TypeScript 5.9.3 (CommonJS consumer only).

**Spec:** `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md` — D14 (Nest 11 and 12, TypeORM 0.3.x and 1.x, ESM loaded by CJS hosts via `require(esm)`, Node ≥ 20.19), §11 (error codes), §14 (integration against Postgres, MySQL and SQLite × Nest 11/12 × TypeORM 0.3/1.x), §15 (Postgres, MySQL 8, SQLite). Plan 1 of 4 for M1c: **M1c-1 database matrix** (this plan) → M1c-2 relations → M1c-3 entity shapes (embedded + nested DTOs, inheritance, composite keys, `@VersionColumn`, soft delete) → M1c-4 lists at scale (count modes, keyset, multiple DataSources) and follow-ups. Also `docs/superpowers/plans/m0-followups.md`.

**Findings this plan is built on** (spike on 2026-09-30, throwaway worktree; nothing committed):
- With a per-app database, all 243 core integration/unit tests pass on Postgres 17 unchanged. MySQL 8.4 fails two: `registry.test.ts` "skips an entity whose schema cannot be built" (its fixture has a `simple-json` primary key, which MySQL cannot index: `BLOB/TEXT column 'key' used in key specification without a key length`) and `crud.test.ts` "database not-null violations become field errors" (MySQL answers a missing value with `ER_NO_DEFAULT_FOR_FIELD` 1364, which is unmapped → 500). The demo test fails one on MySQL: a duplicate SKU gets no `fields.sku` because MySQL names the unique **index** (`Duplicate entry 'X' for key 'product.IDX_…'`), not the column.
- Driver error shapes (inputs for Task 2's unit tests):
  - SQLite (sql.js): `NOT NULL constraint failed: parent.name`, `UNIQUE constraint failed: parent.code`, `FOREIGN KEY constraint failed` (same text for a missing parent on insert and a still-referenced row on delete). No `code`.
  - Postgres: not-null `{ code: '23502', column: 'name' }`; unique `{ code: '23505', constraint: 'UQ_…', detail: 'Key (code)=(A) already exists.' }`; FK on insert `{ code: '23503', constraint: 'FK_…', detail: 'Key (parentId)=(999) is not present in table "parent".', message: 'insert or update on table "child" violates foreign key constraint "FK_…"' }`; FK on delete `{ code: '23503', constraint: 'FK_…', detail: 'Key (id)=(1) is still referenced from table "child".' }`; too long `{ code: '22001', message: 'value too long for type character varying(20)' }` (no column).
  - MySQL: missing value `ER_NO_DEFAULT_FOR_FIELD` "Field 'name' doesn't have a default value"; explicit null `ER_BAD_NULL_ERROR` "Column 'name' cannot be null"; unique `ER_DUP_ENTRY` "Duplicate entry 'A' for key 'parent.IDX_f3cd…'"; FK on insert `ER_NO_REFERENCED_ROW_2` "Cannot add or update a child row: a foreign key constraint fails (`db`.`child`, CONSTRAINT `FK_8a2f…` FOREIGN KEY (`parentId`) REFERENCES `parent` (`id`) …)"; FK on delete `ER_ROW_IS_REFERENCED_2` "Cannot delete or update a parent row: …"; too long `ER_DATA_TOO_LONG` "Data too long for column 'name' at row 1" (unmapped → 500). `driverError.column` is a **number** on mysql2 and sql.js (ignore it).
  - MySQL turns `@Column({ unique: true })` and `@Unique(name, [...])` into unique **indexes** (`metadata.uniques` is empty, `metadata.indices` has them, with an explicit `@Unique` name kept).
- Through the admin API today: an FK pointing at a missing record is `409 CONFLICT` without a field on all three databases (should be `422 VALIDATION` on the FK field); a too-long value is `422` on Postgres, `500` on MySQL, accepted on SQLite.
- A column declared with both `@Column() widgetId` and `@ManyToOne … @JoinColumn({ name: 'widgetId' })` is one `ColumnMetadata` **with `relationMetadata` set**, so `isSupportedColumn` hides it from list/detail today (M1c-2 changes that). A DTO property of that name is still writable (it becomes a DTO-only field), which is how Task 2 exercises FK errors.
- The core suite passes unchanged (same two MySQL failures) on NestJS 11.0.0 + `@nestjs/typeorm` 11.0.0 + TypeORM 0.3.20 and on 11.2.7/11.0.3/0.3.31, including `tsc` typecheck. A CommonJS host (`"module": "commonjs"`, TypeScript 5.9.3, no `"type"` in package.json) compiled against the packed tarballs boots on Node and serves meta, create and search. npm resolves that stack without peer conflicts once core's peer ranges include it.

## Global Constraints

- All M0, M1a and M1b Global Constraints still apply: Bun 1.4.2; **exact** dependency pins; ESM with `.js` relative imports in core; the isolated Express mount; `{ code, message, fields?, correlationId }` error bodies; decimals/bigints as strings; `.pw.ts` Playwright files; E2E locally with `PW_CHANNEL=chrome bun run e2e`; never commit `.idea/` or `.serena/`; never add `Co-Authored-By` or any AI attribution to commits or PRs.
- New pins: `pg` `8.23.0`, `mysql2` `3.24.5` (devDependencies of `packages/core`; dependencies of `examples/demo-api`). CJS consumer fixture: `typescript` `5.9.3`, `@types/node` `22.10.0`.
- Test databases: `NMA_TEST_DB` is `sqljs` (default), `postgres` or `mysql`. Servers: Postgres 17 at `postgres://postgres:nma@127.0.0.1:55432/postgres`, MySQL 8.4 at `mysql://root:nma@127.0.0.1:53306/mysql` (overridable with `NMA_TEST_POSTGRES_URL` / `NMA_TEST_MYSQL_URL`). Test databases are named `nma_t_<pid>_<8 hex>`.
- Every integration test gets its database from `createTestApp` (core) or `testDatabase()` (demo). No test hardcodes `type: 'sqljs'` except `toolchain.test.ts`, which tests the toolchain itself.
- Peer ranges of `@nest-my-admin/core` become exactly: `"@nestjs/common": "^11.0.0 || ^12.0.0"`, `"@nestjs/core": "^11.0.0 || ^12.0.0"`, `"@nestjs/typeorm": "^11.0.0 || ^12.0.0"`, `"typeorm": "^0.3.20 || ^1.0.0"`; the others are unchanged. The oldest supported stack lives in one place, `scripts/oldest-supported.ts`.
- Error mapping stays conservative: a field is named only when the driver's error names a constraint or column the resource knows (or the raw column name when unknown, as today); raw driver messages never reach the response.

## Review Focus

1. **A test run killed half-way** (Ctrl-C, CI timeout) leaves `nma_t_*` databases on the server; the next run must clean them up without touching databases of a run that is still going. → Task 1 (`test-db.test.ts`: databases of dead pids are swept, live ones kept).
2. **An app that fails to boot on a real database** (schema sync error, bad resource config) must fail fast and leave no database behind, instead of retrying for 30 s. → Task 1 (`test-db.test.ts`: failed boot drops its database; `retryAttempts: 0`).
3. **A unique constraint over two columns** (`@Unique(['batch', 'serial'])`) — the 409 must name both fields on every database, including MySQL where the error names only the index. → Task 2 (`constraint-errors.test.ts`).
4. **A foreign-key column whose database name differs from its property** (`@Column({ name: 'widget_id' }) widgetId`) — the error must name `widgetId`, the field the form shows. → Task 2 (Gadget fixture uses `widget_id`).
5. **A CommonJS Nest 11 host with the default `nest new` tsconfig** (`"module": "commonjs"`) — must compile against the published types and boot, on Node and Bun. → Task 3 (`pack:smoke` CJS consumer).

## File Structure

```
docker-compose.test.yml                              (new: Postgres + MySQL for local test runs)
package.json                                         (modify: db:up, db:down, test:postgres, test:mysql, compat scripts)
packages/core/
  package.json                                       (modify: peer ranges; pg, mysql2 devDependencies)
  src/registry/db-names.ts                           (new: database names → entity properties)
  src/registry/db-names.test.ts                      (new)
  src/registry/resource-registry.ts                  (modify: dbNames replaces columnProperties)
  src/http/error-response.ts                         (modify: ErrorContext, FK direction, constraint names, MySQL codes)
  src/http/error-response.test.ts                    (modify)
  src/http/admin-http.server.ts                      (modify: pass ErrorContext)
  test/helpers/test-db.ts                            (new: per-app databases, stale sweep)
  test/helpers/create-app.ts                         (modify: use test-db, fail fast, drop on close)
  test/test-db.test.ts                               (new)
  test/fixtures/gadgets.ts                           (new: FK + composite unique fixture)
  test/constraint-errors.test.ts                     (new)
  test/registry.test.ts                              (modify: portable Opaque fixture, dbNames)
  test/toolchain.test.ts                             (modify: version-neutral title)
examples/demo-api/
  package.json                                       (modify: pg, mysql2)
  src/database.ts                                    (new: DATABASE_URL → TypeORM options)
  src/app.module.ts                                  (modify: forRootAsync(databaseOptions))
  test/catalog-admin.test.ts                         (modify: own test database)
scripts/
  oldest-supported.ts                                (new: the compat stack, one place)
  compat.ts                                          (new: core suite on the oldest stack)
  pack-smoke.ts                                      (modify: ESM + CJS consumers, free ports, asserted tarballs)
  pack-fixtures/esm/{tsconfig.json,src/main.ts}      (moved from scripts/pack-fixture)
  pack-fixtures/cjs/{tsconfig.json,src/main.ts}      (new)
.github/workflows/ci.yml                             (modify: compat step, Postgres/MySQL job)
README.md · CLAUDE.md · docs/superpowers/plans/m0-followups.md
```

---

### Task 1: Per-app test databases on sql.js, Postgres and MySQL

**Files:**
- Create: `docker-compose.test.yml`, `packages/core/test/helpers/test-db.ts`, `packages/core/test/test-db.test.ts`, `examples/demo-api/src/database.ts`
- Modify: `package.json`, `packages/core/package.json`, `packages/core/test/helpers/create-app.ts`, `packages/core/test/registry.test.ts`, `examples/demo-api/package.json`, `examples/demo-api/src/app.module.ts`, `examples/demo-api/test/catalog-admin.test.ts`

**Interfaces:**
- Produces (`packages/core/test/helpers/test-db.ts`):
  ```ts
  export type TestDb = 'sqljs' | 'postgres' | 'mysql';
  export const TEST_DB: TestDb;
  export interface TestDatabase { options: DataSourceOptions; url?: string; drop(): Promise<void> }
  export function testDatabase(entities: Function[]): Promise<TestDatabase>;
  export function testDatabaseNames(db: 'postgres' | 'mysql'): Promise<string[]>;
  export function sweepStaleDatabases(db: 'postgres' | 'mysql'): Promise<string[]>;
  ```
- Produces (`examples/demo-api/src/database.ts`): `export function databaseOptions(url?: string): TypeOrmModuleOptions`.
- `createTestApp(options)` keeps its signature; the returned app's `close()` also drops its database.

- [ ] **Step 1: Add the database servers and drivers**

`docker-compose.test.yml`:
```yaml
# Databases for `bun run test:postgres` and `bun run test:mysql`. Start with `bun run db:up`.
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: nma
    ports: ['55432:5432']
    tmpfs: [/var/lib/postgresql/data]
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', 'postgres']
      interval: 2s
      timeout: 3s
      retries: 30
  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: nma
    ports: ['53306:3306']
    tmpfs: [/var/lib/mysql]
    healthcheck:
      # TCP ping: the image's init phase runs a socket-only server, so this turns healthy only when the real one is up
      test: ['CMD', 'mysqladmin', 'ping', '-h', '127.0.0.1', '-pnma']
      interval: 2s
      timeout: 3s
      retries: 60
```

Root `package.json` — add to `"scripts"` (keep the existing ones):
```json
    "db:up": "docker compose -f docker-compose.test.yml up -d --wait",
    "db:down": "docker compose -f docker-compose.test.yml down",
    "test:postgres": "NMA_TEST_DB=postgres bun run test",
    "test:mysql": "NMA_TEST_DB=mysql bun run test",
```

Add the drivers (exact versions):
```bash
cd packages/core && bun add -d --exact pg@8.23.0 mysql2@3.24.5
cd ../../examples/demo-api && bun add --exact pg@8.23.0 mysql2@3.24.5
cd ../.. && bun run db:up
```
Expected: `docker compose ps` shows both services `healthy`.

- [ ] **Step 2: Write the failing test for the helper**

`packages/core/test/test-db.test.ts`:
```ts
import 'reflect-metadata';
import { afterAll, describe, expect, test } from 'bun:test';
import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminResource, AdminResourceBase } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB, sweepStaleDatabases, testDatabase, testDatabaseNames, type TestDatabase } from './helpers/test-db.js';

describe.skipIf(TEST_DB === 'sqljs')(`test databases (${TEST_DB})`, () => {
  const db = TEST_DB as 'postgres' | 'mysql';
  const leftovers: TestDatabase[] = [];
  afterAll(async () => {
    for (const database of leftovers) await database.drop();
  });

  test('each call creates its own empty database and drop() removes it', async () => {
    const first = await testDatabase([Widget]);
    const second = await testDatabase([Widget]);
    leftovers.push(first, second);
    expect(first.url).not.toBe(second.url);
    const connection = await new DataSource(first.options).initialize();
    await connection.getRepository(Widget).save({ name: 'only in first' });
    await connection.destroy();
    const other = await new DataSource(second.options).initialize();
    expect(await other.getRepository(Widget).count()).toBe(0);
    await other.destroy();

    const name = new URL(first.url!).pathname.slice(1);
    expect(await testDatabaseNames(db)).toContain(name);
    await first.drop();
    expect(await testDatabaseNames(db)).not.toContain(name);
  });

  test('sweeping drops databases of dead processes and keeps live ones (Review Focus 1)', async () => {
    const live = await testDatabase([]);
    leftovers.push(live);
    const liveName = new URL(live.url!).pathname.slice(1);
    const deadName = 'nma_t_2147483646_deadbeef'; // no process has this pid
    const server = new DataSource({ type: db, url: db === 'postgres' ? 'postgres://postgres:nma@127.0.0.1:55432/postgres' : 'mysql://root:nma@127.0.0.1:53306/mysql' });
    await server.initialize();
    await server.query(db === 'postgres' ? `CREATE DATABASE "${deadName}"` : `CREATE DATABASE \`${deadName}\``);
    await server.destroy();

    expect(await sweepStaleDatabases(db)).toContain(deadName);
    const names = await testDatabaseNames(db);
    expect(names).not.toContain(deadName);
    expect(names).toContain(liveName);
  });

  test('an app that fails to boot drops its database at once (Review Focus 2)', async () => {
    class Broken {}
    @AdminResource(Broken)
    class BrokenAdmin extends AdminResourceBase {}
    @Module({ providers: [BrokenAdmin] })
    class BrokenModule {}
    const before = await testDatabaseNames(db);
    const started = Date.now();
    await expect(createTestApp({ imports: [BrokenModule] })).rejects.toThrow('entity Broken is not registered');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(await testDatabaseNames(db)).toEqual(before);
  });
});

test('sqljs needs no server', async () => {
  if (TEST_DB !== 'sqljs') return;
  const database = await testDatabase([Widget]);
  expect(database.options.type).toBe('sqljs');
  expect(database.url).toBeUndefined();
  await database.drop();
});
```

Note on the second test: the server URL literal duplicates the helper's defaults on purpose (the test must not depend on the helper to create the dead database). If you set `NMA_TEST_POSTGRES_URL`/`NMA_TEST_MYSQL_URL`, this test uses the defaults anyway; that is acceptable for a test-infrastructure test.

- [ ] **Step 3: Run it to make sure it fails**

Run: `NMA_TEST_DB=postgres bun test packages/core/test/test-db.test.ts`
Expected: FAIL — `Cannot find module './helpers/test-db.js'`.

- [ ] **Step 4: Write the helper**

`packages/core/test/helpers/test-db.ts`:
```ts
import { randomBytes } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';

export type TestDb = 'sqljs' | 'postgres' | 'mysql';
type Server = Exclude<TestDb, 'sqljs'>;

const SERVER_URLS: Record<Server, string> = {
  postgres: process.env.NMA_TEST_POSTGRES_URL ?? 'postgres://postgres:nma@127.0.0.1:55432/postgres',
  mysql: process.env.NMA_TEST_MYSQL_URL ?? 'mysql://root:nma@127.0.0.1:53306/mysql',
};

function parseTestDb(raw: string | undefined): TestDb {
  if (raw === undefined || raw === '' || raw === 'sqljs') return 'sqljs';
  if (raw === 'postgres' || raw === 'mysql') return raw;
  throw new Error(`NMA_TEST_DB must be sqljs, postgres or mysql (got "${raw}")`);
}

/** Where integration tests run: `NMA_TEST_DB=postgres|mysql` (servers from `bun run db:up`); default sql.js in memory. */
export const TEST_DB: TestDb = parseTestDb(process.env.NMA_TEST_DB);

export interface TestDatabase {
  options: DataSourceOptions;
  /** Connection URL of the new database; undefined for sql.js. */
  url?: string;
  drop(): Promise<void>;
}

const quote = (db: Server, name: string) => (db === 'postgres' ? `"${name}"` : `\`${name}\``);
const dropSql = (db: Server, name: string) =>
  `DROP DATABASE IF EXISTS ${quote(db, name)}${db === 'postgres' ? ' WITH (FORCE)' : ''}`;

async function withServer<T>(db: Server, work: (server: DataSource) => Promise<T>): Promise<T> {
  const server = new DataSource({ type: db, url: SERVER_URLS[db] } as DataSourceOptions);
  await server.initialize();
  try {
    return await work(server);
  } finally {
    await server.destroy();
  }
}

export async function testDatabaseNames(db: Server): Promise<string[]> {
  const rows: Array<{ name: string }> = await withServer(db, (server) =>
    server.query(
      db === 'postgres'
        ? `SELECT datname AS name FROM pg_database WHERE datname LIKE 'nma!_t!_%' ESCAPE '!'`
        : `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'nma!_t!_%' ESCAPE '!'`,
    ),
  );
  return rows.map((row) => row.name);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'; // exists, owned by someone else
  }
}

/** Drops databases of test processes that are gone (a killed run never reaches drop()). Returns their names. */
export async function sweepStaleDatabases(db: Server): Promise<string[]> {
  const stale = (await testDatabaseNames(db)).filter((name) => {
    const pid = Number(/^nma_t_(\d+)_/.exec(name)?.[1]);
    return !Number.isSafeInteger(pid) || !isAlive(pid);
  });
  await withServer(db, async (server) => {
    for (const name of stale) await server.query(dropSql(db, name));
  });
  return stale;
}

let swept: Promise<unknown> | undefined;

/** A new, empty database for one test app, so apps never see each other's rows. */
export async function testDatabase(entities: Function[]): Promise<TestDatabase> {
  if (TEST_DB === 'sqljs') return { options: { type: 'sqljs', entities, synchronize: true }, drop: async () => {} };
  const db = TEST_DB;
  swept ??= sweepStaleDatabases(db);
  await swept;
  const name = `nma_t_${process.pid}_${randomBytes(4).toString('hex')}`;
  await withServer(db, (server) => server.query(`CREATE DATABASE ${quote(db, name)}`));
  const url = new URL(SERVER_URLS[db]);
  url.pathname = `/${name}`;
  return {
    options: { type: db, url: url.toString(), entities, synchronize: true } as DataSourceOptions,
    url: url.toString(),
    drop: async () => {
      await withServer(db, (server) => server.query(dropSql(db, name)));
    },
  };
}
```

`packages/core/test/helpers/create-app.ts` — replace the body of `createTestApp` (keep imports, `FIXTURE_UI_DIST` and `TestAppOptions`; add `import { testDatabase } from './test-db.js';`):
```ts
/** A Nest app on its own test database (see test-db.ts), with AdminModule (serving the fixture UI) and the Widgets module. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  const db = await testDatabase([Widget, ...(options.entities ?? [])]);
  let app: INestApplication | undefined;
  try {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // retryAttempts: 0 — a schema that cannot be created fails the test at once instead of retrying for 30 s
        TypeOrmModule.forRoot({ ...db.options, retryAttempts: 0 }),
        AdminModule.forRoot({ uiDistPath: FIXTURE_UI_DIST, ...options.admin }),
        WidgetsModule,
        ...(options.imports ?? []),
      ],
      providers: options.providers ?? [],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    options.beforeInit?.(app);
    await app.init();
  } catch (error) {
    await app?.close().catch(() => undefined);
    await db.drop();
    throw error;
  }
  const close = app.close.bind(app);
  app.close = async () => {
    try {
      await close();
    } finally {
      await db.drop();
    }
  };
  return app;
}
```

- [ ] **Step 5: Make the registry fixture portable**

`packages/core/test/registry.test.ts` — replace the `Opaque` entity (MySQL cannot index a `simple-json` (TEXT) primary key; a primary key the admin cannot select still makes the schema unbuildable):
```ts
  @Entity()
  class Opaque {
    // select: false leaves the admin nothing to list or sort by, so its schema cannot be built
    @PrimaryColumn({ type: 'varchar', length: 40, select: false }) key: string;
  }
```

- [ ] **Step 6: Give the demo a configurable database**

`examples/demo-api/src/database.ts`:
```ts
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Product } from './catalog/product.entity.js';

/** DATABASE_URL=postgres://… or mysql://… runs the demo on that database; without it, on in-memory sql.js. */
export function databaseOptions(url = process.env.DATABASE_URL): TypeOrmModuleOptions {
  const entities = [Product];
  if (!url) return { type: 'sqljs', entities, synchronize: true };
  const scheme = new URL(url).protocol.slice(0, -1);
  if (scheme === 'postgres' || scheme === 'postgresql') return { type: 'postgres', url, entities, synchronize: true };
  if (scheme === 'mysql') return { type: 'mysql', url, entities, synchronize: true };
  throw new Error(`DATABASE_URL must start with postgres:// or mysql:// (got ${scheme}://)`);
}
```

`examples/demo-api/src/app.module.ts`:
```ts
import { AdminModule } from '@nest-my-admin/core';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module.js';
import { databaseOptions } from './database.js';

@Module({
  imports: [
    // Async so DATABASE_URL is read at boot, not when this file is imported (tests set it per run).
    TypeOrmModule.forRootAsync({ useFactory: () => databaseOptions() }),
    AdminModule.forRoot({ path: '/admin', title: 'Demo shop' }),
    CatalogModule,
  ],
})
export class AppModule {}
```

`examples/demo-api/test/catalog-admin.test.ts` — replace the imports block and the `beforeAll`/`afterAll` (the tests stay as they are):
```ts
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { testDatabase, type TestDatabase } from '../../../packages/core/test/helpers/test-db.js';
import { AppModule } from '../src/app.module.js';

let app: INestApplication;
let db: TestDatabase;
const base = '/admin/api/resources/product';
const post = (body: object) => request(app.getHttpServer()).post(base).send(body);

beforeAll(async () => {
  db = await testDatabase([]); // entities come from the demo's own databaseOptions()
  if (db.url) process.env.DATABASE_URL = db.url;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});
afterAll(async () => {
  await app.close();
  delete process.env.DATABASE_URL;
  await db.drop();
});
```

- [ ] **Step 7: Run the suite on every database**

Run:
```bash
bun run test
bun run test:postgres
bun run test:mysql
```
Expected:
- sql.js: all pass (the 273 from main plus the new `test-db.test.ts` "sqljs needs no server").
- Postgres: all pass, including the three `test databases (postgres)` tests.
- MySQL: all pass **except exactly two**, both fixed in Task 2: `crud.test.ts` › "database not-null violations become field errors" (500, `ER_NO_DEFAULT_FOR_FIELD`) and `catalog-admin.test.ts` › "a duplicate unique value is a 409 on that field, not a 500" (no `fields.sku`). Any other failure is a bug in this task.

Then: `bun run typecheck` → PASS. Also check nothing was left behind: `bun -e "import('./packages/core/test/helpers/test-db.ts').then(async (m) => console.log(await m.testDatabaseNames('postgres'), await m.testDatabaseNames('mysql')))"` → `[] []`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.test.yml package.json bun.lock packages/core/package.json packages/core/test examples/demo-api
git commit -m "test: run integration tests on per-app sql.js, Postgres or MySQL databases (NMA_TEST_DB)"
```

---

### Task 2: Database errors land on the right field on every driver

**Files:**
- Create: `packages/core/src/registry/db-names.ts`, `packages/core/src/registry/db-names.test.ts`, `packages/core/test/fixtures/gadgets.ts`, `packages/core/test/constraint-errors.test.ts`
- Modify: `packages/core/src/http/error-response.ts`, `packages/core/src/http/error-response.test.ts`, `packages/core/src/http/admin-http.server.ts`, `packages/core/src/registry/resource-registry.ts`, `packages/core/test/registry.test.ts`

**Interfaces:**
- Consumes: `TEST_DB` and `createTestApp` from Task 1.
- Produces (`packages/core/src/registry/db-names.ts`):
  ```ts
  export interface DbNames { columns: ReadonlyMap<string, string>; constraints: ReadonlyMap<string, string[]> }
  export function dbNamesFor(metadata: NamedMetadataLike): DbNames;
  ```
- `RegisteredResource.columnProperties` is replaced by `RegisteredResource.dbNames: DbNames`.
- `toErrorResponse(error, correlationId, logger, context?: ErrorContext)` where
  `export interface ErrorContext { dbNames?: DbNames; errorMapper?: ErrorMapper; deleting?: boolean }` (replaces the 4th and 5th positional parameters).
- Contract behaviour: an FK that points at a missing record → `422 VALIDATION`, message `A related record does not exist`, `fields: { <fk property>: ['does not exist'] }` when the driver names it. A row still referenced by others → `409 CONFLICT` `The change conflicts with related records` (unchanged). MySQL `ER_NO_DEFAULT_FOR_FIELD` → `422 VALIDATION` `is required`; `ER_DATA_TOO_LONG` → `422 VALIDATION` `is invalid`.

- [ ] **Step 1: Write the failing unit test for the name map**

`packages/core/src/registry/db-names.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { Column, DataSource, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { dbNamesFor } from './db-names.js';

@Entity()
class Maker {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20, unique: true }) code: string;
}

@Entity()
@Unique('UQ_part_lot_serial', ['lot', 'serial'])
class Part {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) lot: string;
  @Column({ length: 20, name: 'serial_no' }) serial: string;
  @Column({ type: 'int', name: 'maker_id' }) makerId: number;
  @ManyToOne(() => Maker) @JoinColumn({ name: 'maker_id' }) maker: Maker;
}

describe('dbNamesFor', () => {
  test('maps columns, unique constraints and foreign keys to properties (real TypeORM metadata)', async () => {
    const dataSource = await new DataSource({ type: 'sqljs', entities: [Maker, Part], synchronize: true }).initialize();
    const names = dbNamesFor(dataSource.getMetadata(Part));
    expect(names.columns.get('serial_no')).toBe('serial');
    expect(names.columns.get('maker_id')).toBe('makerId');
    expect(names.constraints.get('UQ_part_lot_serial')).toEqual(['lot', 'serial']);
    const foreignKey = dataSource.getMetadata(Part).foreignKeys[0]!.name;
    expect(names.constraints.get(foreignKey)).toEqual(['makerId']);
    const unique = dataSource.getMetadata(Maker).uniques[0]!.name;
    expect(dbNamesFor(dataSource.getMetadata(Maker)).constraints.get(unique)).toEqual(['code']);
    await dataSource.destroy();
  });

  test('unique indexes count (MySQL stores unique constraints as indexes); plain indexes do not', () => {
    const names = dbNamesFor({
      columns: [],
      uniques: [],
      indices: [
        { name: 'IDX_unique', isUnique: true, columns: [{ propertyName: 'sku' }] },
        { name: 'IDX_plain', isUnique: false, columns: [{ propertyName: 'name' }] },
      ],
      foreignKeys: [],
    });
    expect(names.constraints.get('IDX_unique')).toEqual(['sku']);
    expect(names.constraints.has('IDX_plain')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun test packages/core/src/registry/db-names.test.ts`
Expected: FAIL — `Cannot find module './db-names.js'`.

- [ ] **Step 3: Implement `dbNamesFor`**

`packages/core/src/registry/db-names.ts`:
```ts
interface PropertyColumns {
  columns: Array<{ propertyName: string }>;
}

/** The subset of TypeORM's EntityMetadata needed to read database names in driver errors. */
export interface NamedMetadataLike {
  columns: Array<{ databaseName: string; propertyName: string }>;
  uniques: Array<PropertyColumns & { name: string }>;
  indices: Array<PropertyColumns & { name: string; isUnique: boolean }>;
  foreignKeys: Array<PropertyColumns & { name: string }>;
}

/** Names that database errors use, mapped back to entity property names. */
export interface DbNames {
  /** Column name → property name. */
  columns: ReadonlyMap<string, string>;
  /** Unique constraint, unique index or foreign key name → property names. */
  constraints: ReadonlyMap<string, string[]>;
}

export function dbNamesFor(metadata: NamedMetadataLike): DbNames {
  const constraints = new Map<string, string[]>();
  const add = (name: string, { columns }: PropertyColumns) => constraints.set(name, columns.map((column) => column.propertyName));
  for (const unique of metadata.uniques) add(unique.name, unique);
  for (const index of metadata.indices) if (index.isUnique) add(index.name, index);
  for (const foreignKey of metadata.foreignKeys) add(foreignKey.name, foreignKey);
  return { columns: new Map(metadata.columns.map((column) => [column.databaseName, column.propertyName])), constraints };
}
```

Run: `bun test packages/core/src/registry/db-names.test.ts` → PASS.

- [ ] **Step 4: Write the failing unit tests for the error mapping**

`packages/core/src/http/error-response.test.ts`:

(a) Add below the `dbError` helper:
```ts
const dbNames = (columns: Record<string, string>, constraints: Record<string, string[]> = {}) => ({
  columns: new Map(Object.entries(columns)),
  constraints: new Map(Object.entries(constraints)),
});
```

(b) Replace the test `'foreign-key violations become 409 CONFLICT'` with:
```ts
  test('deleting a record other records still reference is 409 CONFLICT', () => {
    const conflict = { status: 409, body: { code: 'CONFLICT', message: 'The change conflicts with related records', correlationId: 'c' } };
    expect(toErrorResponse(dbError({ message: 'FOREIGN KEY constraint failed' }), 'c', logger(), { deleting: true })).toEqual(conflict);
    expect(
      toErrorResponse(
        dbError({ code: '23503', constraint: 'FK_1', message: 'update or delete on table "widget" violates foreign key constraint "FK_1" on table "gadget"', detail: 'Key (id)=(1) is still referenced from table "gadget".' }),
        'c',
        logger(),
        { deleting: true },
      ),
    ).toEqual(conflict);
    for (const code of ['ER_ROW_IS_REFERENCED_2', 'ER_ROW_IS_REFERENCED']) {
      expect(toErrorResponse(dbError({ code, message: 'Cannot delete or update a parent row' }), 'c', logger()).status).toBe(409);
    }
  });

  test('a foreign key pointing at a missing record is 422 on that field', () => {
    const names = dbNames({ widget_id: 'widgetId' }, { FK_8a2f: ['widgetId'] });
    const expected = {
      status: 422,
      body: { code: 'VALIDATION', message: 'A related record does not exist', fields: { widgetId: ['does not exist'] }, correlationId: 'c' },
    };
    // Postgres names the constraint
    const postgres = dbError({
      code: '23503',
      constraint: 'FK_8a2f',
      message: 'insert or update on table "gadget" violates foreign key constraint "FK_8a2f"',
      detail: 'Key (widget_id)=(999) is not present in table "widget".',
    });
    expect(toErrorResponse(postgres, 'c', logger(), { dbNames: names })).toEqual(expected);
    // MySQL, with and without the _2 suffix
    const mysqlMessage =
      'Cannot add or update a child row: a foreign key constraint fails (`db`.`gadget`, CONSTRAINT `FK_8a2f` FOREIGN KEY (`widget_id`) REFERENCES `widget` (`id`) ON DELETE RESTRICT)';
    expect(toErrorResponse(dbError({ code: 'ER_NO_REFERENCED_ROW_2', message: mysqlMessage }), 'c', logger(), { dbNames: names })).toEqual(expected);
    expect(toErrorResponse(dbError({ code: 'ER_NO_REFERENCED_ROW', message: 'Cannot add or update a child row' }), 'c', logger()).status).toBe(422);
    // SQLite does not say which side failed or which column: a write that is not a delete means a missing parent
    expect(toErrorResponse(dbError({ message: 'FOREIGN KEY constraint failed' }), 'c', logger(), { dbNames: names })).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A related record does not exist', correlationId: 'c' },
    });
  });

  test('without a known constraint name the column in the message is used (Postgres detail, MySQL FOREIGN KEY)', () => {
    const detailOnly = dbError({ code: '23503', message: 'insert or update on table "gadget"', detail: 'Key (widget_id)=(9) is not present in table "widget".' });
    expect(toErrorResponse(detailOnly, 'c', logger(), { dbNames: dbNames({ widget_id: 'widgetId' }) }).body.fields).toEqual({ widgetId: ['does not exist'] });
    const mysql = dbError({ code: 'ER_NO_REFERENCED_ROW_2', message: 'a foreign key constraint fails (`db`.`gadget`, CONSTRAINT `FK_x` FOREIGN KEY (`widget_id`) REFERENCES `widget` (`id`))' });
    expect(toErrorResponse(mysql, 'c', logger()).body.fields).toEqual({ widget_id: ['does not exist'] });
  });
```

(c) Replace the whole test `'unique violations become 409 CONFLICT on the field (SQLite, Postgres)'` with these two tests:
```ts
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
      { dbNames: dbNames({ sku_code: 'skuCode' }) },
    );
    expect(postgres.body.fields).toEqual({ skuCode: ['already exists'] });
  });

  test('unique violations name every column of the constraint (MySQL index names, Postgres constraint names, SQLite column lists)', () => {
    const names = dbNames({ serial_no: 'serial' }, { UQ_gadget_batch_serial: ['batch', 'serial'], IDX_f3cd: ['sku'] });
    const both = { batch: ['already exists'], serial: ['already exists'] };
    const mysql = dbError({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'a-b' for key 'gadget.UQ_gadget_batch_serial'" });
    expect(toErrorResponse(mysql, 'c', logger(), { dbNames: names }).body.fields).toEqual(both);
    const postgres = dbError({ code: '23505', constraint: 'UQ_gadget_batch_serial', message: 'duplicate key', detail: 'Key (batch, serial)=(a, b) already exists.' });
    expect(toErrorResponse(postgres, 'c', logger(), { dbNames: names }).body.fields).toEqual(both);
    const sqlite = dbError({ message: 'UNIQUE constraint failed: gadget.batch, gadget.serial_no' });
    expect(toErrorResponse(sqlite, 'c', logger(), { dbNames: names }).body.fields).toEqual(both);
    const single = dbError({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'X' for key 'product.IDX_f3cd'" });
    expect(toErrorResponse(single, 'c', logger(), { dbNames: names }).body.fields).toEqual({ sku: ['already exists'] });
  });
```

(d) In `'not-null violations become 422 VALIDATION on the field (SQLite, MySQL)'`, add before its closing `});`:
```ts
    expect(
      toErrorResponse(dbError({ code: 'ER_NO_DEFAULT_FOR_FIELD', message: "Field 'name' doesn't have a default value" }), 'c', logger()),
    ).toEqual({
      status: 422,
      body: { code: 'VALIDATION', message: 'A required value is missing', fields: { name: ['is required'] }, correlationId: 'c' },
    });
```

(e) In the `test.each` of `'toErrorResponse: invalid values reaching the database'`, add a row:
```ts
    [{ code: 'ER_DATA_TOO_LONG', message: 'Data too long' }],
```
and add a test after `'names the column when the driver reports it'`:
```ts
  test('MySQL names the column in the message', () => {
    const tooLong = dbError({ code: 'ER_DATA_TOO_LONG', message: "Data too long for column 'name' at row 1" });
    expect(toErrorResponse(tooLong, 'c', logger()).body.fields).toEqual({ name: ['is invalid'] });
    const range = dbError({ code: 'ER_WARN_DATA_OUT_OF_RANGE', message: "Out of range value for column 'stock' at row 1" });
    expect(toErrorResponse(range, 'c', logger()).body.fields).toEqual({ stock: ['is invalid'] });
  });

  test('a numeric driverError.column (mysql2, sql.js report a position) is ignored', () => {
    const res = toErrorResponse(dbError({ code: '23502', column: 21, message: 'null value' }), 'c', logger());
    expect(res.body.fields).toBeUndefined();
  });
```

(f) Every remaining call that passes `undefined, mapper` / `undefined, throwing` / `undefined, bogus` / `undefined, () => …` as 4th and 5th arguments becomes a context object: `toErrorResponse(x, 'c', logger(), { errorMapper: mapper })` (and likewise for `throwing`, `bogus` and the inline arrow functions).

- [ ] **Step 5: Run them to make sure they fail**

Run: `bun test packages/core/src/http/error-response.test.ts`
Expected: FAIL — the new FK, MySQL-index, `ER_NO_DEFAULT_FOR_FIELD` and `ER_DATA_TOO_LONG` expectations fail (e.g. `Expected: 422, Received: 409`), and TypeScript-shaped calls with a context object are not understood yet.

- [ ] **Step 6: Implement the mapping**

`packages/core/src/http/error-response.ts` — full new version:
```ts
import { HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { AdminErrorBody, AdminErrorCode } from '../contract.js';
import { AdminError } from '../errors.js';
import type { ErrorMapper } from '../options.js';
import type { DbNames } from '../registry/db-names.js';

export interface ErrorResponse {
  status: number;
  body: AdminErrorBody;
}

export interface ErrorLogger {
  error(message: string): void;
}

export interface ErrorContext {
  /** Database names of the resource the request was for, to put constraint errors on fields. */
  dbNames?: DbNames;
  errorMapper?: ErrorMapper;
  /** The request deletes a record. SQLite's foreign-key error does not say which side failed; this does. */
  deleting?: boolean;
}

/** Maps any thrown value to the admin error contract. Never leaks messages of 5xx/unknown errors. */
export function toErrorResponse(error: unknown, correlationId: string, logger: ErrorLogger, context: ErrorContext = {}): ErrorResponse {
  const { errorMapper } = context;
  if (errorMapper && !(error instanceof AdminError)) {
    try {
      const mapped = errorMapper(error);
      if (mapped instanceof AdminError) {
        if (mapped.status >= 500) {
          logger.error(`[${correlationId}] errorMapper answered ${mapped.status} for: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        }
        error = mapped;
      }
    } catch (mapperError) {
      logger.error(`[${correlationId}] errorMapper threw: ${mapperError instanceof Error ? (mapperError.stack ?? mapperError.message) : String(mapperError)}`);
    }
  }
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
    const mapped = constraintError(error, context);
    if (mapped) return { status: mapped.status, body: { ...mapped.body, correlationId } };
  }
  logger.error(`[${correlationId}] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return { status: 500, body: { code: 'INTERNAL', message: 'Internal error', correlationId } };
}

export function codeForStatus(status: number): AdminErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413 || status === 415) return 'BAD_REQUEST';
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

interface DriverError {
  code?: unknown;
  column?: unknown;
  constraint?: unknown;
  detail?: unknown;
}

const MYSQL_FK_MISSING_PARENT = new Set(['ER_NO_REFERENCED_ROW', 'ER_NO_REFERENCED_ROW_2']);
const MYSQL_FK_REFERENCED = new Set(['ER_ROW_IS_REFERENCED', 'ER_ROW_IS_REFERENCED_2']);
const MYSQL_NOT_NULL = new Set(['ER_BAD_NULL_ERROR', 'ER_NO_DEFAULT_FOR_FIELD']);
const MYSQL_INVALID_VALUE = new Set([
  'ER_WARN_DATA_OUT_OF_RANGE', 'ER_TRUNCATED_WRONG_VALUE', 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', 'ER_DATA_TOO_LONG',
]);

function constraintError(error: QueryFailedError, context: ErrorContext): { status: number; body: Omit<AdminErrorBody, 'correlationId'> } | undefined {
  const driver = (error.driverError ?? {}) as unknown as DriverError;
  const code = String(driver.code ?? '');
  const detail = typeof driver.detail === 'string' ? driver.detail : '';
  const text = `${error.message} ${detail}`;
  const onFields = (message: string) => fieldErrors(driver, text, context.dbNames, message);

  const sqliteForeignKey = /FOREIGN KEY constraint failed/i.test(text);
  if (code === '23503' || MYSQL_FK_MISSING_PARENT.has(code) || MYSQL_FK_REFERENCED.has(code) || sqliteForeignKey) {
    const missingParent =
      MYSQL_FK_MISSING_PARENT.has(code) || /is not present in table/.test(detail) || (sqliteForeignKey && !context.deleting);
    if (missingParent) {
      return { status: 422, body: { code: 'VALIDATION', message: 'A related record does not exist', ...onFields('does not exist') } };
    }
    return { status: 409, body: { code: 'CONFLICT', message: 'The change conflicts with related records' } };
  }
  if (code === '23505' || code === 'ER_DUP_ENTRY' || /UNIQUE constraint failed/i.test(text)) {
    return { status: 409, body: { code: 'CONFLICT', message: 'A record with this value already exists', ...onFields('already exists') } };
  }
  if (code === '23502' || MYSQL_NOT_NULL.has(code) || /NOT NULL constraint failed/i.test(text)) {
    return { status: 422, body: { code: 'VALIDATION', message: 'A required value is missing', ...onFields('is required') } };
  }
  if (/^22/.test(code) || MYSQL_INVALID_VALUE.has(code)) {
    return { status: 422, body: { code: 'VALIDATION', message: 'A value is invalid for its column', ...onFields('is invalid') } };
  }
  return undefined;
}

/** `{ fields }` for the properties behind the constraint or column the driver names; `{}` when it names none. */
function fieldErrors(driver: DriverError, text: string, names: DbNames | undefined, message: string): { fields?: Record<string, string[]> } {
  const constraint = typeof driver.constraint === 'string' ? driver.constraint : constraintFromMessage(text);
  let properties = constraint ? names?.constraints.get(constraint) : undefined;
  if (!properties?.length) {
    const columns = typeof driver.column === 'string' ? [driver.column] : columnsFromMessage(text);
    if (columns.length === 0) return {};
    properties = columns.map((column) => names?.columns.get(column) ?? column);
  }
  return { fields: Object.fromEntries(properties.map((property) => [property, [message]])) };
}

function constraintFromMessage(text: string): string | undefined {
  return (
    /for key '(?:[^'.]+\.)?([^'.]+)'/.exec(text)?.[1] ?? // MySQL unique: Duplicate entry 'A' for key 'product.IDX_…'
    /CONSTRAINT `([^`]+)`/.exec(text)?.[1] // MySQL foreign key: … CONSTRAINT `FK_…` FOREIGN KEY (`widget_id`) …
  );
}

function columnsFromMessage(text: string): string[] {
  // SQLite: "UNIQUE constraint failed: gadget.batch, gadget.serial" / "NOT NULL constraint failed: widget.name"
  const sqlite = /constraint failed: ("?\w+"?\."?\w+"?(?:, "?\w+"?\."?\w+"?)*)/i.exec(text)?.[1];
  if (sqlite) return sqlite.split(', ').map((qualified) => qualified.replace(/"/g, '').split('.')[1]!);
  const column = columnFromMessage(text);
  return column ? [column] : [];
}

function columnFromMessage(text: string): string | undefined {
  return (
    /Key \("?(\w+)"?\)=/.exec(text)?.[1] ?? // Postgres: Key (sku)=(A1) already exists. / … is not present in table
    /FOREIGN KEY \(`(\w+)`\)/.exec(text)?.[1] ?? // MySQL foreign key (single column)
    /Column '(\w+)' cannot be null/.exec(text)?.[1] ?? // MySQL explicit null
    /Field '(\w+)' doesn't have a default value/.exec(text)?.[1] ?? // MySQL missing value
    /for column '(\w+)'/.exec(text)?.[1] ?? // MySQL: Data too long for column 'name' / Out of range value for column 'stock'
    /column "(\w+)"/.exec(text)?.[1] // Postgres not-null message
  );
}
```

`packages/core/src/registry/resource-registry.ts`:
- `import { dbNamesFor, type DbNames } from './db-names.js';`
- In `RegisteredResource`, replace the `columnProperties` member and its comment with:
  ```ts
  /** Database column and constraint names → entity properties (for mapping constraint errors to fields). */
  dbNames: DbNames;
  ```
- In `register()`, replace `columnProperties: new Map(metadata.columns.map((column) => [column.databaseName, column.propertyName])),` with `dbNames: dbNamesFor(metadata),`.

`packages/core/src/http/admin-http.server.ts`:
- The two calls in the error middleware become `toErrorResponse(error, correlationId, this.logger, { errorMapper: this.options.errorMapper })`.
- In `handle()`'s catch block replace the two lines starting `const columns = …` with:
  ```ts
      const { status, body } = toErrorResponse(error, correlationId, this.logger, {
        dbNames: resourceName ? this.registry.find(resourceName)?.dbNames : undefined,
        errorMapper: this.options.errorMapper,
        deleting: req.method === 'DELETE',
      });
  ```

`packages/core/test/registry.test.ts` line 24 becomes:
```ts
    expect(registry.get('widget').dbNames.columns.get('createdAt')).toBe('createdAt');
```

Run: `bun test packages/core/src` → PASS.

- [ ] **Step 7: Write the failing integration test**

`packages/core/test/fixtures/gadgets.ts`:
```ts
import { Module } from '@nestjs/common';
import { IsInt, IsString, Length } from 'class-validator';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { AdminResource, AdminResourceBase, type FormConfig } from '../../src/index.js';
import { Widget } from './widgets.js';

/** A foreign key whose column name differs from its property, and a unique constraint over two columns. */
@Entity()
@Unique('UQ_gadget_batch_serial', ['batch', 'serial'])
export class Gadget {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) batch: string;
  @Column({ length: 20 }) serial: string;
  @Column({ type: 'int', name: 'widget_id' }) widgetId: number;
  @ManyToOne(() => Widget, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'widget_id' }) widget: Widget;
}

export class GadgetDto {
  @IsString() @Length(1, 20) batch: string;
  @IsString() @Length(1, 20) serial: string;
  @IsInt() widgetId: number;
}

@AdminResource(Gadget)
export class GadgetAdmin extends AdminResourceBase<Gadget> {
  form: FormConfig = { create: GadgetDto };
}

@Module({ providers: [GadgetAdmin] })
export class GadgetsModule {}
```

`packages/core/test/constraint-errors.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Gadget, GadgetsModule } from './fixtures/gadgets.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

const widgets = '/admin/api/resources/widget';
const gadgets = '/admin/api/resources/gadget';

describe(`database constraint errors (${TEST_DB})`, () => {
  let app: INestApplication;
  let widgetId: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({ entities: [Gadget], imports: [GadgetsModule] });
    widgetId = (await http().post(widgets).send({ name: 'Parent' })).body.id;
    expect((await http().post(gadgets).send({ batch: 'B1', serial: 'S1', widgetId })).status).toBe(201);
  });
  afterAll(async () => {
    await app.close();
  });

  test('creating with a foreign key to a missing record is 422 on the property (Review Focus 4)', async () => {
    const res = await http().post(gadgets).send({ batch: 'B1', serial: 'S2', widgetId: 999999 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.message).toBe('A related record does not exist');
    // SQLite does not name the column; Postgres and MySQL do, and it must be the property, not widget_id
    if (TEST_DB !== 'sqljs') expect(res.body.fields).toEqual({ widgetId: ['does not exist'] });
  });

  test('updating to a missing record is 422 too', async () => {
    const created = await http().post(gadgets).send({ batch: 'B2', serial: 'S1', widgetId });
    const res = await http().patch(`${gadgets}/${created.body.id}`).send({ widgetId: 999999 });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
  });

  test('deleting a record that others reference is 409 and keeps it', async () => {
    const res = await http().delete(`${widgets}/${widgetId}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CONFLICT', message: 'The change conflicts with related records' });
    expect((await http().get(`${widgets}/${widgetId}`)).status).toBe(200);
  });

  test('a duplicate across a two-column unique constraint names both fields (Review Focus 3)', async () => {
    const res = await http().post(gadgets).send({ batch: 'B1', serial: 'S1', widgetId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
    // Postgres and MySQL name the constraint/index; SQLite lists both columns
    expect(res.body.fields).toEqual({ batch: ['already exists'], serial: ['already exists'] });
  });

  test.skipIf(TEST_DB === 'sqljs')('a value longer than its column is 422, not 500 (SQLite ignores lengths)', async () => {
    const res = await http().post(widgets).send({ name: 'x'.repeat(81) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION');
    // Postgres does not name the column for this error; MySQL does
    if (TEST_DB === 'mysql') expect(res.body.fields).toEqual({ name: ['is invalid'] });
  });
});
```

- [ ] **Step 8: Run it on every database**

Run:
```bash
bun run build
bun test packages/core/test/constraint-errors.test.ts
NMA_TEST_DB=postgres bun test packages/core/test/constraint-errors.test.ts
NMA_TEST_DB=mysql bun test packages/core/test/constraint-errors.test.ts
```
Expected: PASS on all three.

- [ ] **Step 9: Run the whole suite on every database**

Run: `bun run test && bun run test:postgres && bun run test:mysql && bun run typecheck`
Expected: all pass on all three, including the two MySQL failures left by Task 1.

- [ ] **Step 10: Commit**

```bash
git add packages/core
git commit -m "fix: map FK, unique-index and MySQL not-null/too-long errors to fields on every driver"
```

---

### Task 3: NestJS 11 + TypeORM 0.3 and CommonJS hosts

**Files:**
- Create: `scripts/oldest-supported.ts`, `scripts/compat.ts`, `scripts/pack-fixtures/cjs/tsconfig.json`, `scripts/pack-fixtures/cjs/src/main.ts`
- Move: `scripts/pack-fixture/` → `scripts/pack-fixtures/esm/`
- Modify: `packages/core/package.json`, `package.json`, `scripts/pack-smoke.ts`, `packages/core/test/toolchain.test.ts`

**Interfaces:**
- Produces (`scripts/oldest-supported.ts`): `export const OLDEST_SUPPORTED: Readonly<Record<string, string>>` — package → exact version.
- `bun run compat` runs the core typecheck and test suite on `OLDEST_SUPPORTED` against the current `NMA_TEST_DB`; exit code 0 only if both pass.

- [ ] **Step 1: Widen the peer ranges and record the oldest stack**

`packages/core/package.json` — `peerDependencies` becomes:
```json
  "peerDependencies": {
    "@nestjs/common": "^11.0.0 || ^12.0.0",
    "@nestjs/core": "^11.0.0 || ^12.0.0",
    "@nestjs/typeorm": "^11.0.0 || ^12.0.0",
    "class-transformer": ">=0.5.1",
    "class-validator": ">=0.14.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "typeorm": "^0.3.20 || ^1.0.0"
  },
```

`scripts/oldest-supported.ts`:
```ts
/**
 * The oldest host stack @nest-my-admin/core supports: the lower bounds of its peer ranges.
 * `bun run compat` runs the core suite on it; pack:smoke's CommonJS consumer installs it.
 */
export const OLDEST_SUPPORTED: Readonly<Record<string, string>> = {
  '@nestjs/common': '11.0.0',
  '@nestjs/core': '11.0.0',
  '@nestjs/platform-express': '11.0.0',
  '@nestjs/testing': '11.0.0',
  '@nestjs/typeorm': '11.0.0',
  typeorm: '0.3.20',
};
```

`packages/core/test/toolchain.test.ts` — rename `'boots Nest 12 + TypeORM 1 on sql.js'` to `'boots Nest + TypeORM on sql.js'` (the same test runs on both stacks now).

- [ ] **Step 2: Write the compat runner**

`scripts/compat.ts`:
```ts
/**
 * Runs the core typecheck and test suite on the oldest supported NestJS/TypeORM (scripts/oldest-supported.ts).
 * Works on a copy of the working tree (committed or not) in a temp directory; the repository is never modified.
 * Honours NMA_TEST_DB. KEEP_COMPAT_DIR=1 keeps the copy for debugging.
 */
import { $ } from 'bun';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { OLDEST_SUPPORTED } from './oldest-supported.ts';

const root = resolve(import.meta.dir, '..');
const work = mkdtempSync(join(tmpdir(), 'nma-compat-'));
console.log(`compat: ${Object.entries(OLDEST_SUPPORTED).map(([name, version]) => `${name}@${version}`).join(' ')}`);
console.log(`compat: working in ${work}`);

try {
  const files = (await $`git ls-files -z --cached --others --exclude-standard`.cwd(root).text()).split('\0').filter(Boolean);
  for (const file of files) {
    if (!existsSync(join(root, file))) continue; // deleted in the working tree
    mkdirSync(dirname(join(work, file)), { recursive: true });
    copyFileSync(join(root, file), join(work, file));
  }

  const manifestPath = join(work, 'packages/core/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { devDependencies: Record<string, string> };
  for (const [name, version] of Object.entries(OLDEST_SUPPORTED)) {
    if (!(name in manifest.devDependencies)) throw new Error(`compat: ${name} is not a devDependency of core`);
    manifest.devDependencies[name] = version;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  await $`bun install`.cwd(work);
  const core = join(work, 'packages/core');
  const typeorm = (await $`bun -e "console.log(require('typeorm/package.json').version)"`.cwd(core).text()).trim();
  if (typeorm !== OLDEST_SUPPORTED.typeorm) throw new Error(`compat: core resolved typeorm ${typeorm}, expected ${OLDEST_SUPPORTED.typeorm}`);
  await $`bun run typecheck`.cwd(core);
  await $`bun test`.cwd(core);
  console.log('compat: all checks passed');
} finally {
  if (process.env.KEEP_COMPAT_DIR) console.log(`compat: kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
```

Root `package.json` scripts — add:
```json
    "compat": "bun scripts/compat.ts",
```

- [ ] **Step 3: Run it**

Run: `bun run compat && NMA_TEST_DB=postgres bun run compat && NMA_TEST_DB=mysql bun run compat`
Expected: each ends with `compat: all checks passed` (the core suite, including Task 2's tests, on NestJS 11.0.0 + TypeORM 0.3.20).

- [ ] **Step 4: Split the pack-smoke fixture into ESM and CJS consumers**

```bash
git mv scripts/pack-fixture scripts/pack-fixtures/esm
mkdir -p scripts/pack-fixtures/cjs/src
```

`scripts/pack-fixtures/cjs/tsconfig.json` (the shape `nest new` generates for Nest 11):
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "commonjs",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

`scripts/pack-fixtures/cjs/src/main.ts`:
```ts
// A CommonJS host: tsc emits require() calls, and Node loads the ESM @nest-my-admin/core through require(esm).
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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.listen(Number(process.env.PORT));
  console.log('READY');
}
void bootstrap();
```

- [ ] **Step 5: Run both consumers from pack-smoke**

`scripts/pack-smoke.ts` — replace everything from `// 3. A fresh consumer project installs the tarballs…` to the end, and the tarball lookups, as follows.

Imports at the top become:
```ts
import { $ } from 'bun';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { OLDEST_SUPPORTED } from './oldest-supported.ts';
```

Add after `waitFor`:
```ts
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
```

Replace the two `const uiTgz = …` / `const coreTgz = …` lines with:
```ts
function tarball(prefix: string): string {
  const file = files.find((name) => name.startsWith(prefix));
  assert(file, `no ${prefix}*.tgz in ${tarballs}`);
  return join(tarballs, file);
}
const uiTgz = tarball('nest-my-admin-ui-');
const coreTgz = tarball('nest-my-admin-core-');
```

Replace sections 3 and 4 (from the `// 3.` comment to the end of the file) with:
```ts
// 3. Fresh consumer projects install the tarballs with npm, compile with tsc and boot on Node and Bun:
//    an ESM host on the stack we develop against, and a CommonJS host on the oldest supported stack.
const coreDev = JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8')).devDependencies as Record<string, string>;
const rootDev = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies as Record<string, string>;
const pick = (names: string[], from: Record<string, string>) => Object.fromEntries(names.map((name) => [name, from[name]!]));
const runtimeDeps = ['sql.js', 'reflect-metadata', 'rxjs', 'class-validator', 'class-transformer'];
const hostDeps = ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', '@nestjs/typeorm', 'typeorm'];

const consumers = [
  {
    name: 'esm',
    type: 'module' as const,
    dependencies: pick([...hostDeps, ...runtimeDeps], coreDev),
    devDependencies: pick(['typescript', '@types/node'], rootDev),
  },
  {
    name: 'cjs',
    type: undefined, // no "type": CommonJS
    dependencies: { ...pick(hostDeps, OLDEST_SUPPORTED), ...pick(runtimeDeps, coreDev) },
    devDependencies: { typescript: '5.9.3', '@types/node': '22.10.0' },
  },
];

for (const consumer of consumers) {
  const app = join(work, `consumer-${consumer.name}`);
  cpSync(join(root, 'scripts/pack-fixtures', consumer.name), app, { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: `nma-consumer-${consumer.name}`,
        private: true,
        ...(consumer.type ? { type: consumer.type } : {}),
        dependencies: { '@nest-my-admin/ui': `file:${uiTgz}`, '@nest-my-admin/core': `file:${coreTgz}`, ...consumer.dependencies },
        devDependencies: consumer.devDependencies,
        overrides: { '@nest-my-admin/ui': '$@nest-my-admin/ui' },
      },
      null,
      2,
    ),
  );
  await $`npm install --no-audit --no-fund`.cwd(app);
  await $`npx tsc -p tsconfig.json`.cwd(app);

  for (const runtime of ['node', 'bun'] as const) {
    const label = `${consumer.name}/${runtime}`;
    const port = await freePort();
    const server = Bun.spawn([runtime, 'dist/main.js'], { cwd: app, env: { ...process.env, PORT: String(port) }, stdout: 'inherit', stderr: 'inherit' });
    try {
      const origin = `http://localhost:${port}`;
      await waitFor(`${origin}/admin/api/meta`);

      const html = await (await fetch(`${origin}/admin/note/42`)).text();
      assert(html.includes('<base href="/admin/">') && html.includes('id="nma-config"'), `${label}: index.html missing runtime injection`);
      const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
      assert(asset, `${label}: index.html references no JS asset`);
      const js = await fetch(`${origin}/admin/${asset}`);
      assert(js.status === 200 && (js.headers.get('content-type') ?? '').includes('javascript'), `${label}: asset not served`);

      const meta = (await (await fetch(`${origin}/admin/api/meta`)).json()) as { groups: { resources: { name: string }[] }[] };
      assert(meta.groups[0]?.resources[0]?.name === 'note', `${label}: meta does not list the note resource`);
      const created = await fetch(`${origin}/admin/api/resources/note`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'hello' }),
      });
      assert(created.status === 201, `${label}: create returned ${created.status}`);
      const found = (await (await fetch(`${origin}/admin/api/resources/note?search=hel`)).json()) as { total: number };
      assert(found.total === 1, `${label}: search found ${found.total} notes`);
      console.log(`pack-smoke: ✓ ${label}`);
    } finally {
      server.kill();
      await server.exited;
    }
  }
}

rmSync(work, { recursive: true, force: true });
console.log('pack-smoke: all checks passed');
```

Run: `bun run pack:smoke`
Expected: `pack-smoke: ✓ esm/node`, `✓ esm/bun`, `✓ cjs/node`, `✓ cjs/bun`, then `pack-smoke: all checks passed`. (npm prints an `install-scripts` warning for `@nestjs/core`'s opencollective postinstall; harmless.)

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json packages/core/test/toolchain.test.ts package.json scripts
git commit -m "feat: support NestJS 11 + TypeORM 0.3.20 and CommonJS hosts; compat runner and CJS pack-smoke consumer"
```

---

### Task 4: CI on every database, docs and follow-ups

**Files:**
- Modify: `.github/workflows/ci.yml`, `README.md`, `CLAUDE.md`, `docs/superpowers/plans/m0-followups.md`

**Interfaces:**
- Consumes: `NMA_TEST_DB`, ports and credentials from Task 1; `bun run compat` from Task 3.

- [ ] **Step 1: Add the compat step and the database job to CI**

`.github/workflows/ci.yml` — in job `test`, add after `- run: bun test packages examples`:
```yaml
      - run: bun run compat
```
and add a second job after `test`:
```yaml
  databases:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - db: postgres
            image: postgres:17-alpine
            ports: '55432:5432'
            health: pg_isready -U postgres
          - db: mysql
            image: mysql:8.4
            ports: '53306:3306'
            health: mysqladmin ping -h 127.0.0.1 -pnma
    services:
      db:
        image: ${{ matrix.image }}
        env:
          POSTGRES_PASSWORD: nma
          MYSQL_ROOT_PASSWORD: nma
        ports: ['${{ matrix.ports }}']
        options: >-
          --health-cmd "${{ matrix.health }}" --health-interval 2s --health-timeout 3s --health-retries 60
    env:
      NMA_TEST_DB: ${{ matrix.db }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.4.2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: bun test packages examples
      - run: bun run compat
```

Run: `docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:1.7.7 -color`
Expected: no output (exit 0). If the image cannot be pulled, run `bun -e "console.log(Object.keys(Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text()).jobs))"` → `[ "test", "databases" ]`.

- [ ] **Step 2: Document requirements and the database commands**

`README.md` — after the status line (`> Status: pre-alpha …`), add:
```markdown
Requires NestJS 11 or 12, TypeORM 0.3.20+ or 1.x, Node 20.19+ (or Bun), and Postgres, MySQL 8 or SQLite.
The package is ESM; CommonJS apps load it through Node's `require(esm)`.
```

In `## Develop`, replace the code block with:
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

`CLAUDE.md` — in `## Commands`, add after `bun test -t "rejects unknown fields"`:
```bash
bun run db:up                                   # Postgres + MySQL in Docker for the lines below
bun run test:postgres                           # whole suite on Postgres (test:mysql for MySQL); or NMA_TEST_DB=postgres bun test <file>
bun run compat                                  # core suite on NestJS 11.0 + TypeORM 0.3.20 (scripts/oldest-supported.ts), in a temp copy
```
and in `## Conventions`, add:
```markdown
- Integration tests get their database from `createTestApp` (core) or `testDatabase()` (`packages/core/test/helpers/test-db.ts`): one fresh database per app on the server `NMA_TEST_DB` selects. Never hardcode `type: 'sqljs'` in a test. Assertions that differ by driver branch on `TEST_DB` and say why.
- Database errors are mapped in `http/error-response.ts` using the resource's `dbNames` (column, unique constraint/index and FK names → properties). MySQL reports unique constraints as index names; SQLite's FK error names no column and no side (the request method decides).
```

- [ ] **Step 3: Update the follow-ups**

`docs/superpowers/plans/m0-followups.md`:
- In "## Promoted by the final review", delete the line `- pack-smoke only proves an ESM consumer: add a CJS consumer with the Nest 11 / TypeORM 0.3 matrix.`
- In "## Deferred minors", change the Task 7 line to `- Task 7: minor (deferred): path regex allows '..'/'//' segments; group key collisions first-wins silently; test asserts message not class` and the Task 15 line to `- Task 15: minor (deferred): asset regex tied to Vite output`.
- In "## M1a follow-ups", delete `- -> M1c: run the suite on Postgres/MySQL; non-_2 MySQL FK codes; FK-on-delete e2e.` and `- -> M1c: FK violation on insert/update should be a VALIDATION field error on the FK field.`
- Append a new section:
```markdown
## M1c-1 follow-ups
- -> M1c-2: a column declared with both `@Column()` and `@JoinColumn` carries `relationMetadata` and is hidden by `isSupportedColumn`; relations must show it (as the relation field).
- -> M1c-2: FK-on-delete E2E once the demo has related entities.
- Postgres `22001` (value too long) names no column, so that 422 has no field; the client's `maxLength` usually catches it first.
- `bun run compat` tests the oldest supported stack; the newest is what the workspace pins. Versions in between (and Nest 12.0 / TypeORM 1.0 exactly) are assumed.
```

- [ ] **Step 4: Verify everything**

Run:
```bash
bun run typecheck
bun run test && bun run test:postgres && bun run test:mysql
bun run compat
bun run pack:smoke
PW_CHANNEL=chrome bun run e2e
```
Expected: all green. Then `bun run db:down`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md CLAUDE.md docs/superpowers/plans/m0-followups.md
git commit -m "ci: run the suite on Postgres and MySQL and on the oldest supported stack; document it"
```

---

## After this plan

- **M1c-2 Relations:** ManyToOne/OneToOne fields (FK column shown as the relation), `GET /resources/:r/fields/:field/options` with `relationOptions()` and scope-ready search, record titles (`title` option), `customer.name` paths in `list.columns`/filters/search/sort with automatic joins, many-to-many as id arrays with a basic multi-select, FK-on-delete E2E in the demo.
- **M1c-3 Entity shapes:** embedded columns and nested DTOs as sub-forms, table inheritance, composite keys (encoded ids; also fixes the `new` id route shadowing), `@VersionColumn` 409 `CONFLICT` with a distinguishable code path, soft delete mechanics (restore/purge endpoints, `trashed` filter; trash UI in M4).
- **M1c-4 Lists at scale:** `list.count` (`exact | estimate | none`) and keyset pagination per driver, multiple-DataSource coverage (autoRegister per DataSource, transactions per DataSource), the `query(qb, ctx)` hook decision with restrictions applied to `findOne`, remaining deferred minors.
