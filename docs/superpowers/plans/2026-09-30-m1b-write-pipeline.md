# M1b — Write Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin writes run in a transaction your services can join, your code can ask "which admin request am I in?", domain exceptions map to the error contract, and forms validate in the browser with the same rules as your DTOs.

**Architecture:** `AdminContext` becomes a value as well as a type: `AdminContext.current()` reads an `AsyncLocalStorage` that the HTTP handler fills for each request. `AdminApiService` wraps create/update/delete in `dataSource.transaction()`, puts the transactional `EntityManager` on `ctx.manager`, and re-enters the storage with that context; `AdminResourceBase`'s defaults use `ctx.manager`, so hooks and saves commit or roll back together. `forRoot({ errorMapper })` lets hosts translate their own exceptions. A new compiler turns class-validator metadata (plus entity column facts) into `FieldConstraints` per form field; the UI checks them before submitting.

**Tech Stack:** unchanged — Bun 1.4.2, TypeScript 7.0.2, NestJS 12.1.1, TypeORM 1.1.1 (sql.js in tests), class-validator 0.15.1, React 19.3, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md` — §5.3 (resolution order: entity → DTO), §5.5 (AdminContext, `AdminContext.current()`, transactional `manager`), §5.1 (`errorMapper`), §9.4 (client validation compiled from DTO metadata), §11 (error contract). Plan 2 of 3 for M1 (after `2026-09-30-m1a-query-engine.md`; M1c = TypeORM coverage + database matrix). Also `docs/superpowers/plans/m0-followups.md` ("hooks are skipped when create/update/delete is overridden: consider a boot warning").

## Global Constraints

- All M0 and M1a Global Constraints still apply (see those plans): Bun 1.4.2; exact dependency pins; ESM with `.js` relative imports in core; the isolated Express mount; `{ code, message, fields?, correlationId }` error bodies with codes `BAD_REQUEST | VALIDATION | UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | BUSINESS_RULE | INTERNAL`; decimals/bigints as strings; `.pw.ts` Playwright files; E2E locally with `PW_CHANNEL=chrome bun run e2e`; never commit `.idea/`; never add `Co-Authored-By` or AI attribution.
- Every create, update and delete runs in one database transaction by default (`forRoot({ transactions: false })` turns it off). `ctx.manager` is the transaction's `EntityManager` during writes and `undefined` during reads. Host services join the transaction only by using `ctx.manager` (or `AdminContext.current()?.manager`); on Postgres/MySQL a service that uses its own injected repository writes on a separate connection, outside the transaction.
- `AdminContext.current()` returns `undefined` outside an admin request and never returns another request's context.
- Server-side validation stays the authority; client-side constraints only save a round trip and must never reject a value the server would accept.
- Constraint resolution follows spec §5.3: entity column facts first, DTO metadata on top. On update, a field is required only when a dedicated update DTO declares it without `@IsOptional`.

## Review Focus

1. **A hook or service throws after a write** (e.g. `@AfterSave` validates something and throws) — the record must not stay half-saved. → Task 2 (`transactions.test.ts`).
2. **Concurrent admin requests** — each must see its own `AdminContext.current()`, never a neighbour's. → Task 1 (`admin-context.test.ts`).
3. **Host code outside the admin** (its own controllers) calling `AdminContext.current()` — must get `undefined`, not the last admin request. → Task 1.
4. **An `errorMapper` that throws or returns something that is not an `AdminError`** — the request must still get a contract response (the original error handled normally), never a crash. → Task 3.
5. **A DTO `@Matches` with flags and a custom message** (`/^[a-z]+$/i`, `{ message: 'letters only' }`) — the browser must reach the same verdict and show the same message. → Task 5 (compiler) and Task 6 (validator).

## File Structure

```
packages/core/src/
  resource/admin-context.ts          (modify: manager, AsyncLocalStorage, AdminContext.current/run)
  resource/admin-resource-base.ts    (modify: repositoryFor(ctx) in default writes/findOne)
  options.ts                         (modify: transactions, errorMapper, ErrorMapper type)
  registry/resource-registry.ts      (modify: dataSource on entries, hook-override warnings)
  registry/hook-warnings.ts          (new: pure check, unit-tested)
  api/admin-api.service.ts           (modify: write() transaction wrapper)
  http/admin-http.server.ts          (modify: run handlers inside AdminContext; pass errorMapper)
  http/error-response.ts             (modify: errorMapper)
  contract.ts                        (modify: FieldConstraints, form.constraints)
  schema/column-field.ts             (modify: ColumnLike.length)
  schema/dto-constraints.ts          (new: class-validator → FieldConstraints)
  schema/dto-fields.ts               (modify: DTO-only fields pick up enum/integer)
  schema/build-resource-schema.ts    (modify: form.constraints)
  index.ts                           (modify: export AdminContext value, ErrorMapper)
packages/core/test/  admin-context.test.ts · transactions.test.ts · error-mapper.test.ts (new)
packages/ui/src/  lib/validate.ts (new) · app/form-page.tsx · app/field-input.tsx
examples/demo-api/src/catalog/  products.service.ts · product.admin.ts ; test/catalog-admin.test.ts ; e2e/products.pw.ts
README.md · CLAUDE.md · docs/superpowers/plans/m0-followups.md
```

---

### Task 1: `AdminContext.current()` via AsyncLocalStorage

**Files:**
- Modify: `packages/core/src/resource/admin-context.ts`, `packages/core/src/http/admin-http.server.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/admin-context.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export interface AdminContext { correlationId: string; request: IncomingMessage; manager?: EntityManager }
  export const AdminContext: { current(): AdminContext | undefined; run<T>(ctx: AdminContext, fn: () => T): T }
  ```
  (same name for the type and the value; `run` is internal). The package index exports `AdminContext` as a value (`export { AdminContext }`), so `import { AdminContext }` gives both.

- [ ] **Step 1: Write the failing test**

`packages/core/test/admin-context.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Controller, Get, Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminContext, AdminResource, AdminResourceBase } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

@Injectable()
class Stamp {
  readonly seen: Array<string | undefined> = [];
  note() {
    this.seen.push(AdminContext.current()?.correlationId);
  }
}

@AdminResource(Widget, { name: 'context-widget' })
class ContextWidgetAdmin extends AdminResourceBase<Widget> {
  mismatches = 0;
  constructor(private readonly stamp: Stamp) {
    super();
  }

  async create(dto: object, ctx: AdminContext) {
    await Bun.sleep(Math.floor(Math.random() * 20));
    if (AdminContext.current() !== ctx) this.mismatches++;
    this.stamp.note(); // a service with no ctx parameter can still find the request
    return super.create(dto, ctx);
  }
}

@Controller('whoami')
class WhoAmIController {
  @Get()
  who() {
    return { inAdmin: AdminContext.current() !== undefined };
  }
}

@Module({ controllers: [WhoAmIController], providers: [Stamp, ContextWidgetAdmin] })
class ContextModule {}

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({ imports: [ContextModule] });
});
afterAll(async () => {
  await app.close();
});

describe('AdminContext.current()', () => {
  test('concurrent admin requests each see their own context (Review Focus 2)', async () => {
    const http = app.getHttpServer();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) => request(http).post('/admin/api/resources/context-widget').send({ name: `W${i}` })),
    );
    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(app.get(ContextWidgetAdmin).mismatches).toBe(0);
    const seen = app.get(Stamp).seen;
    expect(seen).toHaveLength(8);
    expect(seen.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(seen).size).toBe(8);
  });

  test('is undefined in host code outside the admin (Review Focus 3)', async () => {
    const http = app.getHttpServer();
    await request(http).post('/admin/api/resources/context-widget').send({ name: 'before' });
    expect((await request(http).get('/whoami')).body).toEqual({ inAdmin: false });
    expect(AdminContext.current()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/core/test/admin-context.test.ts`
Expected: FAIL — `AdminContext` is only a type (`AdminContext.current` is not a function / import error).

- [ ] **Step 3: Implement**

`packages/core/src/resource/admin-context.ts` (replace the whole file):
```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { EntityManager } from 'typeorm';

/** Passed to every resource method. Grows in later milestones (user, permissions, locale). */
export interface AdminContext {
  /** Echoed in error responses and logs. */
  correlationId: string;
  /** The underlying Node request (an Express request in v1). */
  request: IncomingMessage;
  /**
   * The transaction's EntityManager while a create/update/delete runs (undefined for reads).
   * Use it in your services to write inside the admin's transaction.
   */
  manager?: EntityManager;
}

const storage = new AsyncLocalStorage<AdminContext>();

export const AdminContext = {
  /** The admin request being handled, or undefined outside one (for example in your own controllers). */
  current(): AdminContext | undefined {
    return storage.getStore();
  },
  /** @internal Runs `fn` with `ctx` as the current admin context. */
  run<T>(ctx: AdminContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
};

export function createAdminContext(request: IncomingMessage): AdminContext {
  return { correlationId: randomUUID(), request };
}
```

`packages/core/src/http/admin-http.server.ts`:
1. Change the import to `import { AdminContext, createAdminContext } from '../resource/admin-context.js';` (drop the `type` import of `AdminContext`; it is used both as a type and a value now).
2. In `handle()`, replace
```ts
        await match.handler({ req, res, url, ctx }, match.params);
```
with
```ts
        const requestCtx = ctx;
        await AdminContext.run(requestCtx, () => match.handler({ req, res, url, ctx: requestCtx }, match.params));
```

`packages/core/src/index.ts` — replace `export type { AdminContext } from './resource/admin-context.js';` with:
```ts
export { AdminContext } from './resource/admin-context.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass (existing `import { type AdminContext }` usages keep working).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): AdminContext.current() via AsyncLocalStorage"
```

---

### Task 2: Transactions for create, update and delete

**Files:**
- Modify: `packages/core/src/options.ts`, `packages/core/src/registry/resource-registry.ts`, `packages/core/src/api/admin-api.service.ts`, `packages/core/src/resource/admin-resource-base.ts`
- Test: `packages/core/test/transactions.test.ts` (new), `packages/core/src/options.test.ts` (modify)

**Interfaces:**
- Consumes: `AdminContext`, `AdminContext.run` (Task 1).
- Produces: `AdminModuleOptions.transactions?: boolean` (default `true`) → `ResolvedAdminOptions.transactions: boolean`; `RegisteredResource.dataSource: DataSource`; `AdminResourceBase.repositoryFor(ctx: AdminContext): Repository<T>` (protected) — the transaction's repository when `ctx.manager` is set, otherwise the plain one. The default `findOne`, `create`, `update` and `delete` use it.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/options.test.ts` — change the defaults expectation to:
```ts
    expect(resolveAdminOptions()).toEqual({
      path: '/admin', title: 'Admin', uiDistPath: undefined, autoRegister: false, transactions: true, errorMapper: undefined,
    });
```
(`errorMapper` is added in Task 3; `toEqual` treats an `undefined` property as absent, so this passes as soon as `transactions` exists.)

`packages/core/test/transactions.test.ts`:
```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AdminContext, AdminFieldError, AdminResource, AdminResourceBase, AfterSave } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

@AdminResource(Widget, { name: 'strict-widget' })
class StrictWidgetAdmin extends AdminResourceBase<Widget> {
  @AfterSave()
  refuse(entity: Widget) {
    if (entity.name === 'explode') throw new AdminFieldError({ name: 'rejected after saving' });
  }
}

@AdminResource(Widget, { name: 'pair-widget' })
class PairWidgetAdmin extends AdminResourceBase<Widget> {
  sawManagerOnRead: boolean | undefined;

  // A host-style override that writes two rows through ctx.manager, then fails.
  async create(dto: { name?: string }, ctx: AdminContext) {
    const repo = ctx.manager!.getRepository(Widget);
    const first = await repo.save(repo.create({ name: `${dto.name}-a` }));
    await repo.save(repo.create({ name: `${dto.name}-b` }));
    if (dto.name === 'fail') throw new AdminFieldError({ name: 'second step failed' });
    return first;
  }

  async findMany(params: Parameters<AdminResourceBase<Widget>['findMany']>[0], ctx: AdminContext) {
    this.sawManagerOnRead = ctx.manager !== undefined;
    return super.findMany(params, ctx);
  }
}

@AdminResource(Widget, { name: 'own-repo-widget' })
class OwnRepoWidgetAdmin extends AdminResourceBase<Widget> {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  // A service that ignores ctx.manager and uses its own repository must still work.
  async create(dto: { name?: string }) {
    return this.dataSource.getRepository(Widget).save({ name: dto.name ?? 'own' });
  }
}

@Module({ providers: [StrictWidgetAdmin, PairWidgetAdmin, OwnRepoWidgetAdmin] })
class TxModule {}

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const count = async (http: unknown) => (await request(http as never).get('/admin/api/resources/widget')).body.total as number;

describe('transactions', () => {
  test('a throwing @AfterSave rolls the create back (Review Focus 1)', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    const res = await request(http).post('/admin/api/resources/strict-widget').send({ name: 'explode' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ name: ['rejected after saving'] });
    expect(await count(http)).toBe(0);
    expect((await request(http).post('/admin/api/resources/strict-widget').send({ name: 'fine' })).status).toBe(201);
    expect(await count(http)).toBe(1);
  });

  test('a throwing @AfterSave rolls the update back too', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    const { id } = (await request(http).post('/admin/api/resources/strict-widget').send({ name: 'keep' })).body;
    const res = await request(http).patch(`/admin/api/resources/strict-widget/${id}`).send({ name: 'explode' });
    expect(res.status).toBe(422);
    expect((await request(http).get(`/admin/api/resources/widget/${id}`)).body.name).toBe('keep');
  });

  test('host code writing through ctx.manager commits or rolls back as one unit', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const http = app.getHttpServer();
    expect((await request(http).post('/admin/api/resources/pair-widget').send({ name: 'fail' })).status).toBe(422);
    expect(await count(http)).toBe(0);
    expect((await request(http).post('/admin/api/resources/pair-widget').send({ name: 'ok' })).status).toBe(201);
    expect(await count(http)).toBe(2);
  });

  test('reads get no transaction manager', async () => {
    app = await createTestApp({ imports: [TxModule] });
    await request(app.getHttpServer()).get('/admin/api/resources/pair-widget');
    expect(app.get(PairWidgetAdmin).sawManagerOnRead).toBe(false);
  });

  test('a service that ignores ctx.manager still works', async () => {
    app = await createTestApp({ imports: [TxModule] });
    const res = await request(app.getHttpServer()).post('/admin/api/resources/own-repo-widget').send({ name: 'mine' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('mine');
  });

  test('transactions: false turns the wrapper off', async () => {
    app = await createTestApp({ imports: [TxModule], admin: { transactions: false } });
    const http = app.getHttpServer();
    expect((await request(http).post('/admin/api/resources/strict-widget').send({ name: 'explode' })).status).toBe(422);
    expect(await count(http)).toBe(1); // saved before the hook threw, nothing rolled it back
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/options.test.ts packages/core/test/transactions.test.ts`
Expected: FAIL — `transactions` missing from options; `ctx.manager` is undefined in `pair-widget` (TypeError → 500); the `explode` widget stays saved.

- [ ] **Step 3: Implement**

`packages/core/src/options.ts` — add to `AdminModuleOptions`:
```ts
  /** Run every create/update/delete in one database transaction (ctx.manager). Default `true`. */
  transactions?: boolean;
```
to `ResolvedAdminOptions`: `transactions: boolean;` and to the returned object in `resolveAdminOptions`: `transactions: options.transactions ?? true,`.

`packages/core/src/registry/resource-registry.ts` — add `dataSource: DataSource;` to `RegisteredResource` and `dataSource,` to the object stored in `register()`.

`packages/core/src/resource/admin-resource-base.ts`:
1. Add the helper after the `primaryKey` getter:
```ts
  /** The repository for this operation: the admin transaction's when one is running (ctx.manager), else the default. */
  protected repositoryFor(ctx: AdminContext): Repository<T> {
    return ctx.manager ? ctx.manager.getRepository<T>(this.repository.target) : this.repository;
  }
```
2. In `findOne`, `create`, `update` and `delete`, replace every use of `this.repository` with a local `const repo = this.repositoryFor(ctx);` (rename the unused `_ctx` parameters to `ctx`). For example:
```ts
  async findOne(id: RecordId, ctx: AdminContext): Promise<T | null> {
    return this.repositoryFor(ctx).findOne({ where: { [this.primaryKey]: id } as FindOptionsWhere<T> });
  }

  async create(dto: object, ctx: AdminContext): Promise<T> {
    const repo = this.repositoryFor(ctx);
    await this.runHooks('beforeSave', dto, ctx, 'create');
    const saved = await repo.save(repo.create({ ...dto } as DeepPartial<T>));
    await this.runHooks('afterSave', saved, ctx, 'create');
    return saved;
  }
```
and the same pattern in `update` (`repo.merge`, `repo.save`) and `delete` (`repo.remove`). `buildListQuery`/`findMany` keep `this.repository` (reads are not transactional).

`packages/core/src/api/admin-api.service.ts`:
1. Change the context import to `import { AdminContext } from '../resource/admin-context.js';`.
2. Add the wrapper:
```ts
  /** Runs a write in one transaction (unless disabled) with ctx.manager set and AdminContext.current() pointing at it. */
  private async write<T>(entry: RegisteredResource, ctx: AdminContext, work: (ctx: AdminContext) => Promise<T>): Promise<T> {
    if (!this.options.transactions) return work(ctx);
    return entry.dataSource.transaction(async (manager) => {
      const transactional: AdminContext = { ...ctx, manager };
      return AdminContext.run(transactional, () => work(transactional));
    });
  }
```
3. Wrap the database part of `create`, `update` and `remove` (validation of the body stays outside, it touches no database):
```ts
  async create(name: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const dto = await validateWrite(body, { allowed: schema.form.create, dto: resource.form?.create });
    return this.write(entry, ctx, async (tx) => {
      const created: unknown = await resource.create(dto, tx);
      if (typeof created !== 'object' || created === null) {
        throw new Error(`${entry.className}.create() must return the created entity`);
      }
      return serializeRecord(created, schema.fields);
    });
  }

  async update(name: string, rawId: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    const updateDto = resource.form?.update;
    const dto = await validateWrite(body, { allowed: schema.form.update, dto: updateDto ?? resource.form?.create, partial: !updateDto });
    return this.write(entry, ctx, async (tx) => {
      if (!(await resource.findOne(id, tx))) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
      const updated: unknown = await resource.update(id, dto, tx);
      return serializeRecord(await this.reloadIfEmpty(entry, updated, id, tx), schema.fields);
    });
  }

  async remove(name: string, rawId: string, ctx: AdminContext): Promise<void> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    await this.write(entry, ctx, async (tx) => {
      if (!(await resource.findOne(id, tx))) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
      await resource.delete(id, tx);
    });
  }
```
(Note the update body is validated before the existence check now; an invalid body for a missing id answers 422 instead of 404 — acceptable, and cheaper.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @nest-my-admin/core build && bun test packages examples && bun run typecheck`
Expected: all pass, including M0/M1a CRUD, hooks and demo tests. If a crud test asserted 404 for an invalid body on a missing id, it keeps passing only if its body is valid — check `crud.test.ts` "the primary key is not writable and missing records are 404": `PATCH /99999 {name:'x'}` has a valid body, so 404 is unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): run create, update and delete in a transaction exposed as ctx.manager"
```

---

### Task 3: `errorMapper` for host exceptions

**Files:**
- Modify: `packages/core/src/options.ts`, `packages/core/src/http/error-response.ts`, `packages/core/src/http/admin-http.server.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/http/error-response.test.ts` (modify), `packages/core/test/error-mapper.test.ts` (new)

**Interfaces:**
- Produces: `export type ErrorMapper = (error: unknown) => AdminError | undefined;` (exported from the package); `AdminModuleOptions.errorMapper?: ErrorMapper` → `ResolvedAdminOptions.errorMapper?: ErrorMapper`; `toErrorResponse(error, correlationId, logger, columnProperties?, errorMapper?)`. The mapper runs for every error that is not already an `AdminError`; if it returns an `AdminError`, that is answered instead; if it returns anything else or throws, the original error is handled as before (a throwing mapper is logged).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/http/error-response.test.ts` (inside the `describe`), and add `AdminError` to the `../errors.js` import:
```ts
  test('errorMapper translates host exceptions (Review Focus 4)', () => {
    class OutOfStock extends Error {}
    const mapper = (error: unknown) => (error instanceof OutOfStock ? new AdminFieldError({ stock: 'out of stock' }) : undefined);
    expect(toErrorResponse(new OutOfStock(), 'c', logger(), undefined, mapper).body).toEqual({
      code: 'VALIDATION', message: 'Validation failed', fields: { stock: ['out of stock'] }, correlationId: 'c',
    });
    expect(toErrorResponse(new Error('other'), 'c', logger(), undefined, mapper).status).toBe(500);
  });

  test('a mapper that throws or returns a non-AdminError is ignored and logged', () => {
    const log = logger();
    const throwing = () => {
      throw new Error('mapper bug');
    };
    expect(toErrorResponse(new NotFoundException(), 'c', log, undefined, throwing).body.code).toBe('NOT_FOUND');
    expect(log.error).toHaveBeenCalledTimes(1);
    const bogus = () => ({ code: 'NOT_A_REAL_ERROR' }) as unknown as AdminError;
    expect(toErrorResponse(new NotFoundException(), 'c', logger(), undefined, bogus).body.code).toBe('NOT_FOUND');
  });

  test('AdminErrors are never passed to the mapper', () => {
    let called = false;
    toErrorResponse(new AdminNotFoundError(), 'c', logger(), undefined, () => {
      called = true;
      return undefined;
    });
    expect(called).toBe(false);
  });
```

`packages/core/test/error-mapper.test.ts`:
```ts
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminError, AdminResource, AdminResourceBase } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

class InsufficientFunds extends Error {}

@AdminResource(Widget, { name: 'domain-widget' })
class DomainWidgetAdmin extends AdminResourceBase<Widget> {
  async create(): Promise<Widget> {
    throw new InsufficientFunds('balance too low');
  }
}

@Module({ providers: [DomainWidgetAdmin] })
class DomainModule {}

let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({
    imports: [DomainModule],
    admin: {
      errorMapper: (error) =>
        error instanceof InsufficientFunds ? new AdminError('BUSINESS_RULE', 402, `Payment needed: ${error.message}`) : undefined,
    },
  });
});
afterAll(async () => {
  await app.close();
});

test('forRoot({ errorMapper }) answers domain exceptions in the contract', async () => {
  const res = await request(app.getHttpServer()).post('/admin/api/resources/domain-widget').send({ name: 'x' });
  expect(res.status).toBe(402);
  expect(res.body.code).toBe('BUSINESS_RULE');
  expect(res.body.message).toBe('Payment needed: balance too low');
  expect(typeof res.body.correlationId).toBe('string');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/http/error-response.test.ts packages/core/test/error-mapper.test.ts`
Expected: FAIL — the mapper argument is ignored (500 INTERNAL); `errorMapper` is not a known option (type error).

- [ ] **Step 3: Implement**

`packages/core/src/options.ts`:
```ts
import type { AdminError } from './errors.js';

/** Translates your own exceptions into admin errors. Return undefined to leave an error alone. */
export type ErrorMapper = (error: unknown) => AdminError | undefined;
```
add `errorMapper?: ErrorMapper;` to both `AdminModuleOptions` (with a doc comment) and `ResolvedAdminOptions`, and `errorMapper: options.errorMapper,` to the resolved object.

`packages/core/src/http/error-response.ts`:
1. Add `import type { ErrorMapper } from '../options.js';`
2. Change the signature and add the mapping step at the top of `toErrorResponse`:
```ts
export function toErrorResponse(
  error: unknown,
  correlationId: string,
  logger: ErrorLogger,
  columnProperties?: ReadonlyMap<string, string>,
  errorMapper?: ErrorMapper,
): ErrorResponse {
  if (errorMapper && !(error instanceof AdminError)) {
    try {
      const mapped = errorMapper(error);
      if (mapped instanceof AdminError) error = mapped;
    } catch (mapperError) {
      logger.error(`[${correlationId}] errorMapper threw: ${mapperError instanceof Error ? (mapperError.stack ?? mapperError.message) : String(mapperError)}`);
    }
  }
  // …existing body unchanged…
```

`packages/core/src/http/admin-http.server.ts` — pass `this.options.errorMapper` as the fifth argument in both `toErrorResponse` calls (the `handle()` catch block and the error middleware; in the middleware pass `undefined` for `columnProperties`).

`packages/core/src/index.ts` — change the options export to `export type { AdminModuleOptions, ErrorMapper } from './options.js';`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): errorMapper option translates host exceptions into the error contract"
```

---

### Task 4: Warn when overridden writes skip lifecycle hooks

**Files:**
- Create: `packages/core/src/registry/hook-warnings.ts`
- Modify: `packages/core/src/registry/resource-registry.ts`
- Test: `packages/core/src/registry/hook-warnings.test.ts` (new)

**Interfaces:**
- Produces: `hookWarnings(resource: AdminResourceBase<any>, className: string): string[]` — one message per overridden write method whose hooks would be skipped. The registry logs each with `logger.warn` for explicit `@AdminResource` classes.

- [ ] **Step 1: Write the failing test**

`packages/core/src/registry/hook-warnings.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AfterSave, BeforeDelete, BeforeSave } from '../decorators/hooks.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { hookWarnings } from './hook-warnings.js';

describe('hookWarnings', () => {
  test('warns when a write with hooks is overridden', () => {
    class OverridingAdmin extends AdminResourceBase {
      @BeforeSave() normalise() {}
      @BeforeDelete() guard() {}
      async create(dto: object) {
        return dto;
      }
      async delete() {}
    }
    expect(hookWarnings(new OverridingAdmin(), 'OverridingAdmin')).toEqual([
      "OverridingAdmin: @BeforeSave/@AfterSave hooks do not run because create() is overridden; call this.runHooks('beforeSave' | 'afterSave', …) in your override",
      "OverridingAdmin: @BeforeDelete hooks do not run because delete() is overridden; call this.runHooks('beforeDelete', …) in your override",
    ]);
  });

  test('stays quiet when hooks and overrides do not meet', () => {
    class HooksOnly extends AdminResourceBase {
      @AfterSave() log() {}
    }
    class OverrideOnly extends AdminResourceBase {
      async update(_id: string | number, dto: object) {
        return dto;
      }
    }
    expect(hookWarnings(new HooksOnly(), 'HooksOnly')).toEqual([]);
    expect(hookWarnings(new OverrideOnly(), 'OverrideOnly')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/core/src/registry/hook-warnings.test.ts`
Expected: FAIL — `./hook-warnings.js` not found.

- [ ] **Step 3: Implement**

`packages/core/src/registry/hook-warnings.ts`:
```ts
import { getHooks } from '../decorators/hooks.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';

const base = AdminResourceBase.prototype;

/** Hooks only run in the base class's default writes; say so when a class overrides a write that has hooks. */
export function hookWarnings(resource: AdminResourceBase<any>, className: string): string[] {
  const warnings: string[] = [];
  const target = resource.constructor;
  const hasSaveHooks = getHooks(target, 'beforeSave').length + getHooks(target, 'afterSave').length > 0;
  for (const method of ['create', 'update'] as const) {
    if (hasSaveHooks && resource[method] !== base[method]) {
      warnings.push(
        `${className}: @BeforeSave/@AfterSave hooks do not run because ${method}() is overridden; call this.runHooks('beforeSave' | 'afterSave', …) in your override`,
      );
    }
  }
  if (getHooks(target, 'beforeDelete').length > 0 && resource.delete !== base.delete) {
    warnings.push(`${className}: @BeforeDelete hooks do not run because delete() is overridden; call this.runHooks('beforeDelete', …) in your override`);
  }
  return warnings;
}
```

`packages/core/src/registry/resource-registry.ts` — import `hookWarnings` and, in `onModuleInit`, right before `this.register(metatype.name, definition, instance, moduleGroup);`, add:
```ts
      for (const warning of hookWarnings(instance, metatype.name)) this.logger.warn(warning);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): warn at boot when an overridden write would skip lifecycle hooks"
```

---

### Task 5: Compile form constraints from DTOs and columns

**Files:**
- Create: `packages/core/src/schema/dto-constraints.ts`
- Modify: `packages/core/src/contract.ts`, `packages/core/src/schema/column-field.ts` (ColumnLike only), `packages/core/src/schema/dto-fields.ts`, `packages/core/src/schema/build-resource-schema.ts`
- Test: `packages/core/src/schema/dto-constraints.test.ts` (new), `packages/core/src/schema/dto-fields.test.ts` (modify), `packages/core/src/schema/build-resource-schema.test.ts` (modify), `packages/core/test/meta.test.ts` (modify), `examples/demo-api/test/catalog-admin.test.ts` (modify)

**Interfaces:**
- Produces:
  ```ts
  export interface FieldConstraints {
    required?: boolean;
    minLength?: number; maxLength?: number;
    min?: number; max?: number;
    integer?: boolean;
    pattern?: { source: string; flags: string; message?: string };
    format?: 'email' | 'url' | 'uuid';
    oneOf?: string[];
  }
  // ResourceSchema.form gains:
  constraints: { create: Record<string, FieldConstraints>; update: Record<string, FieldConstraints> };
  ```
  `dtoConstraints(dto: DtoClass): Record<string, FieldConstraints>` — from class-validator metadata (verified names in class-validator 0.15.1: `isLength` [min,max], `minLength`, `maxLength`, `min`, `max`, `isInt`, `isEmail`, `isUrl`, `isUuid`, `isIn` [values], `matches` [RegExp|string, modifiers] with `message` when a string; `conditionalValidation` = `@IsOptional`; `isDefined`). Metadata with `each: true` is skipped. Every property gets `required: true|false` (false when `@IsOptional`).
  `ColumnLike.length?: string | number`.
  In `form.constraints`, `required` is either `true` or absent (never `false`); `dtoConstraints` itself reports explicit `required: false` for `@IsOptional` properties.
  Resolution: entity facts first (`required` for create = `form.requiredOnCreate`; `maxLength` from a numeric column length on string columns; `oneOf` from enum values; `integer`; `format: 'uuid'` for uuid columns), then DTO constraints on top. On update, `required` only when a dedicated update DTO declares the field without `@IsOptional`. `form.requiredOnCreate` stays as before.
  DTO-only fields: `@IsIn` makes them `type: 'enum'` with `enumValues`; `@IsInt` sets `integer: true`.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/schema/dto-constraints.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { dtoConstraints } from './dto-constraints.js';

class SampleDto {
  @IsString() @Length(2, 40) name: string;
  @MinLength(3) @MaxLength(9) code: string;
  @IsInt() @Min(0) @Max(99) qty: number;
  @IsEmail() email: string;
  @IsOptional() @IsUrl() site?: string;
  @IsOptional() @IsUUID() ref?: string;
  @Matches(/^[a-z]+$/i, { message: 'letters only' }) slug: string;
  @IsIn(['draft', 'live']) status: string;
  @IsOptional() @IsString({ each: true }) tags?: string[];
}

describe('dtoConstraints', () => {
  test('compiles class-validator metadata', () => {
    expect(dtoConstraints(SampleDto)).toEqual({
      name: { required: true, minLength: 2, maxLength: 40 },
      code: { required: true, minLength: 3, maxLength: 9 },
      qty: { required: true, integer: true, min: 0, max: 99 },
      email: { required: true, format: 'email' },
      site: { required: false, format: 'url' },
      ref: { required: false, format: 'uuid' },
      slug: { required: true, pattern: { source: '^[a-z]+$', flags: 'i', message: 'letters only' } },
      status: { required: true, oneOf: ['draft', 'live'] },
      tags: { required: false },
    });
  });

  test('a string pattern keeps its modifiers', () => {
    class StringPatternDto {
      @Matches('^x+$', 'i') value: string;
    }
    expect(dtoConstraints(StringPatternDto).value).toEqual({ required: true, pattern: { source: '^x+$', flags: 'i' } });
  });
});
```

`packages/core/src/schema/dto-fields.test.ts` — append inside the `describe`:
```ts
  test('DTO-only fields pick up enum values and integers', () => {
    class ChoiceDto {
      @IsIn(['a', 'b']) choice: string;
      @IsInt() count: number;
    }
    expect(dtoOnlyField(ChoiceDto, 'choice')).toMatchObject({ type: 'enum', enumValues: ['a', 'b'] });
    expect(dtoOnlyField(ChoiceDto, 'count')).toMatchObject({ type: 'number', integer: true });
  });
```
(add `IsIn` to its `class-validator` import).

`packages/core/src/schema/build-resource-schema.test.ts`:
1. In the first test, change `expect(schema.form).toEqual({` to `expect(schema.form).toMatchObject({` and add after it:
```ts
    expect(schema.form.constraints.create).toEqual({
      name: { required: true, maxLength: 60 },
      price: { required: true },
      condition: { oneOf: ['new', 'used'] },
      specs: {},
    });
    expect(schema.form.constraints.update.name).toEqual({ maxLength: 60 });
```
2. In the second test ("uses DTO properties for the form…"), change `expect(schema.form).toEqual({` to `expect(schema.form).toMatchObject({` and add:
```ts
    expect(schema.form.constraints.create).toEqual({
      name: { required: true, minLength: 1, maxLength: 60 },
      price: { required: true },
      secret: {},
    });
    expect(schema.form.constraints.update.name).toEqual({ minLength: 1, maxLength: 60 }); // create DTO reused as a partial update
```
3. Add:
```ts
  test('a dedicated update DTO decides what is required on update', () => {
    class RenameGadgetDto {
      @IsString() @MaxLength(10) name: string;
    }
    @AdminResource(Gadget)
    class RenameAdmin extends AdminResourceBase<Gadget> {
      form = { create: CreateGadgetDto, update: RenameGadgetDto };
    }
    expect(schemaFor(new RenameAdmin()).form.constraints.update).toEqual({ name: { required: true, maxLength: 10 } });
  });
```
(add `MaxLength` to its class-validator import).

`packages/core/test/meta.test.ts` and `examples/demo-api/test/catalog-admin.test.ts` — in the tests that do `expect(res.body.form).toEqual({ create…, update…, requiredOnCreate… })`, change `toEqual` to `toMatchObject` (the form now also carries `constraints`). In `catalog-admin.test.ts`, also add to that test:
```ts
    expect(res.body.form.constraints.create.name).toEqual({ required: true, minLength: 1, maxLength: 120 });
    expect(res.body.form.constraints.create.sku).toMatchObject({ required: true, pattern: { source: '^[A-Za-z0-9-]{2,40}$', flags: '', message: 'sku must be 2-40 letters, digits or dashes' } });
    expect(res.body.form.constraints.create.stock).toEqual({ integer: true, min: 0 });
    expect(res.body.form.constraints.create.status).toEqual({ oneOf: ['draft', 'active', 'archived'] });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @nest-my-admin/core build && bun test packages/core examples/demo-api`
Expected: FAIL — `./dto-constraints.js` not found; `form.constraints` undefined.

- [ ] **Step 3: Implement**

`packages/core/src/contract.ts` — add after `FieldSchema`:
```ts
/** Rules the browser checks before submitting (spec §9.4). The server re-validates; these only save a round trip. */
export interface FieldConstraints {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  /** From @Matches: rebuild with `new RegExp(source, flags)`. */
  pattern?: { source: string; flags: string; message?: string };
  format?: 'email' | 'url' | 'uuid';
  oneOf?: string[];
}
```
and extend `ResourceSchema.form`:
```ts
  form: {
    create: string[];
    update: string[];
    requiredOnCreate: string[];
    constraints: { create: Record<string, FieldConstraints>; update: Record<string, FieldConstraints> };
  };
```

`packages/core/src/schema/column-field.ts` — add to `ColumnLike`: `length?: string | number;`

`packages/core/src/schema/dto-constraints.ts`:
```ts
import { ValidationTypes, getMetadataStorage } from 'class-validator';
import type { FieldConstraints } from '../contract.js';
import type { DtoClass } from './dto-fields.js';

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Browser-checkable constraints per DTO property, compiled from class-validator metadata (spec §5.3, §9.4). */
export function dtoConstraints(dto: DtoClass): Record<string, FieldConstraints> {
  const result: Record<string, FieldConstraints> = {};
  const optional = new Set<string>();
  for (const meta of getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false)) {
    const constraints = (result[meta.propertyName] ??= {});
    if (meta.type === ValidationTypes.CONDITIONAL_VALIDATION) {
      optional.add(meta.propertyName);
      continue;
    }
    if (meta.each) continue; // array-element rules do not describe the field itself
    const [first, second] = (meta.constraints ?? []) as unknown[];
    switch (meta.name) {
      case 'isLength': {
        const min = num(first);
        const max = num(second);
        if (min !== undefined && min > 0) constraints.minLength = min;
        if (max !== undefined) constraints.maxLength = max;
        break;
      }
      case 'minLength':
        if (num(first) !== undefined) constraints.minLength = num(first);
        break;
      case 'maxLength':
        if (num(first) !== undefined) constraints.maxLength = num(first);
        break;
      case 'min':
        if (num(first) !== undefined) constraints.min = num(first);
        break;
      case 'max':
        if (num(first) !== undefined) constraints.max = num(first);
        break;
      case 'isInt':
        constraints.integer = true;
        break;
      case 'isEmail':
        constraints.format = 'email';
        break;
      case 'isUrl':
        constraints.format = 'url';
        break;
      case 'isUuid':
        constraints.format = 'uuid';
        break;
      case 'isIn':
        if (Array.isArray(first)) constraints.oneOf = first.map(String);
        break;
      case 'matches': {
        const regex = first instanceof RegExp ? first : new RegExp(String(first), typeof second === 'string' ? second : undefined);
        constraints.pattern = {
          source: regex.source,
          flags: regex.flags,
          ...(typeof meta.message === 'string' ? { message: meta.message } : {}),
        };
        break;
      }
    }
  }
  for (const [name, constraints] of Object.entries(result)) constraints.required = !optional.has(name);
  return result;
}
```
Write the object literal keys in the order the test expects? No — `toEqual` ignores key order.

`packages/core/src/schema/dto-fields.ts` — make DTO-only fields use the compiled constraints:
```ts
import { dtoConstraints } from './dto-constraints.js';
```
and in `dtoOnlyField`, after computing the base field:
```ts
  const constraints = dtoConstraints(dto)[property] ?? {};
  const field: FieldSchema = {
    name: property,
    label: humanize(property),
    type: constraints.oneOf ? 'enum' : (DESIGN_TYPES.get(designType) ?? 'string'),
    nullable: isDtoPropertyOptional(dto, property),
    primary: false,
    readonly: false,
    persisted: false,
  };
  if (constraints.oneOf) field.enumValues = constraints.oneOf;
  if (constraints.integer) field.integer = true;
  return field;
```

`packages/core/src/schema/build-resource-schema.ts`:
1. Imports: add `FieldConstraints` to the contract import; `import { dtoConstraints } from './dto-constraints.js';`; add `type DtoClass` to the `./dto-fields.js` import.
2. Before the `return`, add:
```ts
  const columnByName = new Map(supportedColumns.map((column) => [column.propertyName, column]));
  const entityConstraints = (name: string): FieldConstraints => {
    const field = byName.get(name);
    if (!field) return {};
    const constraints: FieldConstraints = {};
    const length = Number(columnByName.get(name)?.length);
    if ((field.type === 'string' || field.type === 'text') && Number.isInteger(length) && length > 0) constraints.maxLength = length;
    if (field.enumValues) constraints.oneOf = field.enumValues;
    if (field.integer) constraints.integer = true;
    if (field.type === 'uuid') constraints.format = 'uuid';
    return constraints;
  };
  const compile = (names: string[], dto: DtoClass | undefined, isRequired: (name: string, fromDto?: FieldConstraints) => boolean) => {
    const fromDto = dto ? dtoConstraints(dto) : {};
    const out: Record<string, FieldConstraints> = {};
    for (const name of names) {
      const merged: FieldConstraints = { ...entityConstraints(name), ...fromDto[name] };
      delete merged.required;
      if (isRequired(name, fromDto[name])) merged.required = true;
      out[name] = merged;
    }
    return out;
  };
  const dedicatedUpdateDto = resource.form?.update;
  const constraints = {
    create: compile(create, createDto, (name) => requiredOnCreate.includes(name)),
    update: compile(update, updateDto, (_name, fromDto) => dedicatedUpdateDto !== undefined && fromDto?.required === true),
  };
```
3. Change the returned `form` to `form: { create, update, requiredOnCreate, constraints },`.

(`requiredOnCreate` for the no-DTO case already means "not nullable, no default"; with a create DTO it means "no `@IsOptional`" — the create constraints reuse it, so the two can never disagree.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @nest-my-admin/core build && bun test packages examples && bun run typecheck`
Expected: all pass. If the demo's `name` shows `maxLength: 120` from both the column (`length: 120`) and the DTO (`@Length(1, 120)`), that is expected — the DTO wins on overlap and they agree.

- [ ] **Step 5: Commit**

```bash
git add packages/core examples/demo-api/test
git commit -m "feat(core): compile browser-checkable form constraints from DTOs and columns"
```

---

### Task 6: Validate forms in the browser

**Files:**
- Create: `packages/ui/src/lib/validate.ts`
- Modify: `packages/ui/src/app/form-page.tsx`, `packages/ui/src/app/field-input.tsx`
- Test: `packages/ui/src/lib/validate.test.ts` (new)

**Interfaces:**
- Consumes: `ResourceSchema.form.constraints`, `FieldConstraints` (Task 5); `toPayload` (M0).
- Produces: `validatePayload(payload: Record<string, unknown>, constraints: Record<string, FieldConstraints>, mode: 'create' | 'update'): Record<string, string[]>`. Messages: `is required`, `must be at least N characters`, `must be at most N characters`, `must be at least N`, `must be at most N`, `must be an integer`, the pattern's own message or `is not in the expected format`, `must be an email address`, `must be a URL`, `must be a UUID`, `must be one of: a, b`. On create a missing or empty required field is an error; on update only a field that is being sent (cleared) can be.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/lib/validate.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { FieldConstraints } from '@nest-my-admin/core/contract';
import { validatePayload } from './validate';

const constraints: Record<string, FieldConstraints> = {
  name: { required: true, minLength: 2, maxLength: 5 },
  slug: { required: false, pattern: { source: '^[a-z]+$', flags: 'i', message: 'letters only' } },
  stock: { required: false, integer: true, min: 0, max: 10 },
  email: { format: 'email' },
  site: { format: 'url' },
  ref: { format: 'uuid' },
  status: { oneOf: ['draft', 'live'] },
};

describe('validatePayload', () => {
  test('accepts valid values and treats flags like the server (Review Focus 5)', () => {
    expect(validatePayload({ name: 'Lamp', slug: 'ABC', stock: 3, email: 'a@b.co', site: 'https://x.io', status: 'live' }, constraints, 'create')).toEqual({});
  });

  test('reports each broken rule with the server-style message', () => {
    expect(
      validatePayload(
        { name: 'L', slug: 'a-b', stock: 1.5, email: 'nope', site: 'ftp://x', ref: 'x', status: 'gone' },
        constraints,
        'create',
      ),
    ).toEqual({
      name: ['must be at least 2 characters'],
      slug: ['letters only'],
      stock: ['must be an integer'],
      email: ['must be an email address'],
      site: ['must be a URL'],
      ref: ['must be a UUID'],
      status: ['must be one of: draft, live'],
    });
    expect(validatePayload({ name: 'Too long', stock: 11 }, constraints, 'create')).toEqual({
      name: ['must be at most 5 characters'],
      stock: ['must be at most 10'],
    });
  });

  test('required fields: missing on create, only cleared ones on update', () => {
    expect(validatePayload({}, constraints, 'create')).toEqual({ name: ['is required'] });
    expect(validatePayload({ name: '' }, constraints, 'create')).toEqual({ name: ['is required'] });
    expect(validatePayload({}, constraints, 'update')).toEqual({});
    expect(validatePayload({ name: null }, { name: { required: true } }, 'update')).toEqual({ name: ['is required'] });
  });

  test('a pattern without its own message gets a generic one', () => {
    expect(validatePayload({ code: 'x' }, { code: { pattern: { source: '^\\d+$', flags: '' } } }, 'create')).toEqual({
      code: ['is not in the expected format'],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/ui/src/lib/validate.test.ts`
Expected: FAIL — `./validate` not found.

- [ ] **Step 3: Implement**

`packages/ui/src/lib/validate.ts`:
```ts
import type { FieldConstraints } from '@nest-my-admin/core/contract';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function check(value: unknown, c: FieldConstraints): string[] {
  const messages: string[] = [];
  if (typeof value === 'string') {
    if (c.minLength !== undefined && value.length < c.minLength) messages.push(`must be at least ${c.minLength} characters`);
    if (c.maxLength !== undefined && value.length > c.maxLength) messages.push(`must be at most ${c.maxLength} characters`);
    if (c.pattern && !new RegExp(c.pattern.source, c.pattern.flags).test(value)) messages.push(c.pattern.message ?? 'is not in the expected format');
    if (c.format === 'email' && !EMAIL.test(value)) messages.push('must be an email address');
    if (c.format === 'url' && !isHttpUrl(value)) messages.push('must be a URL');
    if (c.format === 'uuid' && !UUID.test(value)) messages.push('must be a UUID');
    if (c.oneOf && !c.oneOf.includes(value)) messages.push(`must be one of: ${c.oneOf.join(', ')}`);
  }
  if (typeof value === 'number') {
    if (c.integer && !Number.isInteger(value)) messages.push('must be an integer');
    if (c.min !== undefined && value < c.min) messages.push(`must be at least ${c.min}`);
    if (c.max !== undefined && value > c.max) messages.push(`must be at most ${c.max}`);
  }
  return messages;
}

/**
 * Checks a payload (the output of toPayload) against the schema's constraints. The server re-validates;
 * this only saves a round trip, so it must never reject a value the server accepts.
 */
export function validatePayload(
  payload: Record<string, unknown>,
  constraints: Record<string, FieldConstraints>,
  mode: 'create' | 'update',
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const [name, c] of Object.entries(constraints)) {
    const sent = Object.hasOwn(payload, name);
    const value = payload[name];
    if (value === undefined || value === null || value === '') {
      if (c.required && (mode === 'create' || sent)) errors[name] = ['is required'];
      continue;
    }
    const messages = check(value, c);
    if (messages.length > 0) errors[name] = messages;
  }
  return errors;
}
```

`packages/ui/src/app/form-page.tsx`:
1. Add `import { validatePayload } from '@/lib/validate';`
2. Replace the body of `submit`:
```tsx
  function submit(event: FormEvent) {
    event.preventDefault();
    const { payload, errors } = toPayload(fields, values, mode === 'edit' ? initial : undefined);
    const formMode = mode === 'create' ? 'create' : 'update';
    const ruleErrors = validatePayload(payload, schema.form.constraints[formMode], formMode);
    const allErrors = { ...ruleErrors, ...errors }; // conversion errors ("must be a number") win for the same field
    setFieldErrors(allErrors);
    setFormError(null);
    if (Object.keys(allErrors).length === 0) save.mutate(payload);
  }
```
3. Pass the field's constraints to the input: `<FieldInput … constraints={schema.form.constraints[mode === 'create' ? 'create' : 'update'][field.name]} />`.

`packages/ui/src/app/field-input.tsx`:
1. Add `import type { FieldConstraints } from '@nest-my-admin/core/contract';` (merge into the existing contract import) and `constraints?: FieldConstraints;` to `FieldInputProps`; destructure it.
2. Change `inputProps(field)` to `inputProps(field, constraints)` and, in its `default:` branch, return `{ type: constraints?.format === 'email' ? 'email' : constraints?.format === 'url' ? 'url' : 'text' }` so phones show the right keyboard.

- [ ] **Step 4: Verify**

Run: `bun test packages/ui && bun run --filter @nest-my-admin/ui typecheck && bun run build`
Expected: tests pass, no type errors, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): check DTO-derived constraints in the browser before saving"
```

---

### Task 7: Demo joins the transaction; end-to-end coverage; documentation

**Files:**
- Modify: `examples/demo-api/src/catalog/products.service.ts`, `examples/demo-api/src/catalog/product.admin.ts`, `examples/demo-api/e2e/products.pw.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/plans/m0-followups.md`

**Interfaces:**
- Consumes: `ctx.manager` (Task 2), client validation (Task 6).
- Produces: `ProductsService.create(dto, manager?)`, `update(id, dto, manager?)`, `remove(id, manager?)` — the demo's pattern for joining the admin transaction.

- [ ] **Step 1: Make the demo service transaction-aware**

`examples/demo-api/src/catalog/products.service.ts` — add `import type { EntityManager } from 'typeorm';` (merge with the existing `Repository` type import) and give each write an optional manager:
```ts
  /** Pass the admin's ctx.manager to write inside its transaction; plain callers omit it. */
  private repo(manager?: EntityManager): Repository<Product> {
    return manager ? manager.getRepository(Product) : this.products;
  }

  async create(dto: CreateProductDto, manager?: EntityManager): Promise<Product> {
    const products = this.repo(manager);
    const product = products.create({ ...dto, sku: dto.sku.toUpperCase() });
    this.assertSellable(product);
    return products.save(product);
  }

  async update(id: number, dto: UpdateProductDto, manager?: EntityManager): Promise<Product> {
    const products = this.repo(manager);
    const product = await products.findOneByOrFail({ id });
    if (product.status === 'archived') throw new ConflictException('Archived products are read-only');
    products.merge(product, dto);
    this.assertSellable(product);
    return products.save(product);
  }

  async remove(id: number, manager?: EntityManager): Promise<void> {
    const products = this.repo(manager);
    const product = await products.findOneByOrFail({ id });
    if (product.status === 'active') throw new ConflictException('Active products cannot be deleted; archive them first');
    await products.remove(product);
  }
```

`examples/demo-api/src/catalog/product.admin.ts` — pass the manager through:
```ts
  create(dto: CreateProductDto, ctx: AdminContext) {
    return this.products.create(dto, ctx.manager);
  }

  update(id: RecordId, dto: UpdateProductDto, ctx: AdminContext) {
    return this.products.update(Number(id), dto, ctx.manager);
  }

  delete(id: RecordId, ctx: AdminContext) {
    return this.products.remove(Number(id), ctx.manager);
  }
```

Run: `bun run --filter @nest-my-admin/core build && bun test examples/demo-api && bun run --filter demo-api typecheck`
Expected: all pass (behaviour unchanged; writes now join the admin transaction).

- [ ] **Step 2: Add the E2E test for client-side validation**

Append to `examples/demo-api/e2e/products.pw.ts`:
```ts
test('client-side validation stops a bad form before it reaches the server', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/admin/api/resources/product')) posts.push(req.url());
  });
  await page.goto('/admin/product/new');
  await page.getByLabel('Sku').fill('bad sku!');
  await page.getByLabel('Price').fill('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#field-name-error')).toContainText('is required');
  await expect(page.locator('#field-sku-error')).toContainText('sku must be 2-40 letters, digits or dashes');
  expect(posts).toHaveLength(0);
});
```

Run: `PW_CHANNEL=chrome bun run e2e`
Expected: `13 passed, 1 skipped` (7 tests × 2 projects; the keyboard test skips on mobile). Leave no server on port 3310.

- [ ] **Step 3: Update the docs**

`README.md` — add a section after "Customising lists":
````markdown
## Transactions, context and errors

Every create, update and delete runs in one database transaction. Pass `ctx.manager` to your services so their writes
join it — a hook or service that throws afterwards rolls everything back:

```ts
create(dto: CreateProductDto, ctx: AdminContext) {
  return this.products.create(dto, ctx.manager); // service: manager ? manager.getRepository(Product) : this.products
}
```

Services that keep using their own injected repository still work, but on Postgres/MySQL they write outside the
transaction. `AdminContext.current()` returns the admin request being handled (or `undefined` in your own controllers),
so deep code can find it without a `ctx` parameter. Turn transactions off with `forRoot({ transactions: false })`.

Translate your own exceptions with `forRoot({ errorMapper: (e) => e instanceof OutOfStock ? new AdminFieldError({ stock: 'out of stock' }) : undefined })`.

Forms check your DTO rules (`@Length`, `@Min`/`@Max`, `@IsInt`, `@Matches`, `@IsEmail`, `@IsUrl`, `@IsUUID`, `@IsIn`) in the
browser before saving; the server still validates everything.
````

`CLAUDE.md` — in Architecture, add after the "Hooks" bullet:
```markdown
- Writes run inside `AdminApiService.write()`: one `dataSource.transaction()`, `ctx.manager` set, and `AdminContext.run()` re-entered so `AdminContext.current()` sees the transactional context. `AdminResourceBase` defaults use `repositoryFor(ctx)`. Reads get no manager.
- Form constraints: `dtoConstraints` compiles class-validator metadata (names like `isLength`, `matches`, `isIn`; `conditionalValidation` = `@IsOptional`) on top of entity facts into `form.constraints.{create,update}`; the UI's `validatePayload` checks them before submit.
```

`docs/superpowers/plans/m0-followups.md` — in "## M1a follow-ups", delete the line about hooks being skipped when create/update/delete is overridden (done: boot warning), and add under it:
```markdown
- (from M1b) Nested DTOs (`@ValidateNested` + `@Type`) → sub-forms and arrays of sub-forms: do with embedded columns in M1c.
- (from M1b) Client constraints do not cover `@IsDecimal` digit limits or `@IsPositive`; the server still enforces them.
```

- [ ] **Step 4: Full verification**

Run: `bun run test && bun run typecheck && bun run pack:smoke && PW_CHANNEL=chrome bun run e2e`
Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add examples/demo-api README.md CLAUDE.md docs/superpowers/plans/m0-followups.md
git commit -m "feat(demo): join the admin transaction; e2e for client validation; document transactions, context and errorMapper"
```

---

## Out of scope for M1b (planned elsewhere)

- **M1c:** nested DTOs as sub-forms (together with embedded columns and relations), the `@VersionColumn` conflict flow, the Postgres/MySQL matrix that exercises transactions on real connection pools.
- **M3:** `ctx.user` / permissions on `AdminContext`.
