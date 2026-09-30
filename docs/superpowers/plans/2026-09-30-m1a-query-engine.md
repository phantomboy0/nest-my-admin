# M1a — Query Engine, Delete & Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin lists can be filtered and searched with the spec's query syntax, records can be deleted, resources get `@BeforeSave`/`@AfterSave`/`@BeforeDelete` hooks, entities can be auto-registered, and the M0 follow-ups on the error contract and host isolation are closed.

**Architecture:** The resource schema gains `list.filters` (field + allowed operators, derived from the column type) and `list.search`. `parseListQuery` turns `filter[field][op]=value` / `search=` into typed `FilterCondition`s (field names only ever come from the schema allow-list). `AdminResourceBase.buildListQuery()` applies them to a TypeORM `SelectQueryBuilder`, so host `findMany` overrides can extend the same query. Delete is a new route + base method; hooks are method decorators that the base class's default `create`/`update`/`delete` run. The UI adds a filter bar and search box whose state lives in the page URL and is passed straight through to the API.

**Tech Stack:** unchanged from M0 — Bun 1.4.2, TypeScript 7.0.2, NestJS 12.1.1, TypeORM 1.1.1 (sql.js in tests), class-validator 0.15.1, React 19.3 + Vite 8 + TanStack Query 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md` — §5.2 (list config, hooks), §10.1 (Django parity: list_filter, search_fields), §11 (list query syntax, operators, error codes), §16 (M1). Also `docs/superpowers/plans/m0-followups.md`. This is plan 1 of 3 for M1 (M1a); M1b = write pipeline (DTO→form compiler, transactions, `AdminContext.current()`), M1c = TypeORM coverage (relations, embedded, inheritance, composite keys, version, soft delete, multiple DataSources) + the Nest 11 / TypeORM 0.3 / CommonJS matrix.

## Global Constraints

- All M0 Global Constraints still apply (see `docs/superpowers/plans/2026-09-29-m0-walking-skeleton.md`): Bun 1.4.2; exact dependency pins; ESM with `.js` relative imports in core; decorator metadata flags; core's only runtime dependency is `@nest-my-admin/ui`; the isolated Express mount (D12); `decimal`/`bigint` as JSON strings; `.pw.ts` for Playwright files; never add `Co-Authored-By` or AI attribution to commits.
- Every admin API error body is exactly `{ code, message, fields?, correlationId }`; `code` ∈ `BAD_REQUEST | VALIDATION | UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | CONFLICT | BUSINESS_RULE | INTERNAL`.
- List query syntax (spec §11): `page`, `pageSize`, `sort`, `search`, `filter[<field>][<op>]=<value>` and the shorthand `filter[<field>]=<value>` (= `eq`). Operators: `eq ne in nin lt lte gt gte between contains startsWith isNull`. `in`/`nin`/`between` take comma-separated values (`between` exactly two). Any other query parameter is a 422.
- SQL safety: field names placed into SQL come only from the resource schema's allow-lists (`list.filters`, `list.search`, `list.sortable`); every value is a bound parameter. `LIKE` patterns escape `!`, `%`, `_` with the escape character `!` (`ESCAPE '!'` works unquoted on SQLite, Postgres and MySQL).
- `DELETE` returns `204` with no body. The JSON `Content-Type` requirement applies to `POST`/`PATCH`/`PUT` only (DELETE is never a CORS "simple" request, so it is always preflighted cross-origin).
- The Playwright bundled Chromium cannot be downloaded on the owner's machine: run E2E locally with `PW_CHANNEL=chrome bun run e2e`.

## Review Focus

1. **LIKE wildcards typed by users** — searching `%` or filtering `notes contains _` must match those characters literally, not everything. → Task 5 (`list-filters.test.ts`).
2. **A filter value of the wrong type** (`filter[price][gte]=abc`, `filter[status][eq]=gone`) — must be a 422 naming the parameter, never a database error. → Task 4 (unit) and Task 5 (HTTP).
3. **Ties in the sort column across a page boundary** — paging through records with equal sort values must neither repeat nor skip a record. → Task 5.
4. **Datetime filters on SQLite**, which stores datetimes as text — `filter[createdAt][gte]=<ISO>` must compare correctly. → Task 5.
5. **Host auth middleware in front of the admin** (the README tells hosts to add one) returning 401/403 — the admin must answer in its own contract with `UNAUTHENTICATED`/`FORBIDDEN`, not `BAD_REQUEST`. → Task 1.

## File Structure

```
packages/core/src/
  contract.ts                       (modify: UNAUTHENTICATED, FilterOperator, FilterSchema, list.filters/search)
  constants.ts                      (modify: ADMIN_HOOKS_METADATA)
  options.ts                        (modify: autoRegister)
  index.ts                          (modify: export hooks + filter types)
  http/error-response.ts            (modify: codeForStatus exported, 401, FK violations)
  http/admin-http.server.ts         (modify: error middleware, backstop, DELETE route, CSRF rule)
  schema/suggest.ts                 (new: "did you mean" for config errors)
  schema/filter-operators.ts        (new: operators per field type)
  schema/build-resource-schema.ts   (modify: filters, search, suggestions)
  crud/list-query.ts                (modify: filters + search parsing)
  crud/list-query-builder.ts        (new: applies ListParams to a SelectQueryBuilder)
  decorators/hooks.ts               (new: @BeforeSave/@AfterSave/@BeforeDelete)
  resource/admin-resource-base.ts   (modify: ListParams, buildListQuery, hooks, delete)
  registry/resource-registry.ts     (modify: autoRegister, entity on entries)
  api/admin-api.service.ts          (modify: remove)
packages/core/test/
  fixtures/widgets.ts               (modify: list filters/search)
  list-filters.test.ts · delete-hooks.test.ts (new) · isolation.test.ts · registry.test.ts (modify)
packages/ui/src/
  lib/api-error.ts (new) · lib/api.ts · lib/queries.ts · lib/list-state.ts (new) · lib/form-values.ts (export helper)
  app/filter-bar.tsx (new) · app/list-page.tsx · app/form-page.tsx
examples/demo-api/
  src/catalog/product.admin.ts · src/catalog/products.service.ts · test/catalog-admin.test.ts · e2e/products.pw.ts
README.md · CLAUDE.md · docs/superpowers/plans/m0-followups.md
```

---

### Task 1: Error contract and host-isolation hardening

**Files:**
- Modify: `packages/core/src/contract.ts`, `packages/core/src/http/error-response.ts`, `packages/core/src/http/admin-http.server.ts`, `packages/ui/src/lib/api.ts`
- Create: `packages/ui/src/lib/api-error.ts`
- Test: `packages/core/src/http/error-response.test.ts` (modify), `packages/core/test/isolation.test.ts` (modify), `packages/ui/src/lib/api-error.test.ts` (new)

**Interfaces:**
- Consumes: M0 `toErrorResponse`, `AdminError`, `createAdminContext`, `sendJson`.
- Produces: `AdminErrorCode` includes `'UNAUTHENTICATED'`; exported `codeForStatus(status: number): AdminErrorCode`; UI `ApiError` (now in `lib/api-error.ts`, re-exported from `lib/api.ts`) whose message carries `(reference: <correlationId>)` for `INTERNAL`; UI `describeError(error: Error): string`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/http/error-response.test.ts` (inside the existing `describe('toErrorResponse', ...)` block, after the last test):
```ts
  test('status codes map to contract codes', () => {
    expect(codeForStatus(401)).toBe('UNAUTHENTICATED');
    expect(codeForStatus(403)).toBe('FORBIDDEN');
    expect(codeForStatus(404)).toBe('NOT_FOUND');
    expect(codeForStatus(409)).toBe('CONFLICT');
    expect(codeForStatus(413)).toBe('BAD_REQUEST');
    expect(codeForStatus(415)).toBe('BAD_REQUEST');
    expect(codeForStatus(422)).toBe('VALIDATION');
    expect(codeForStatus(400)).toBe('BUSINESS_RULE');
  });

  test('an UnauthorizedException from host code is UNAUTHENTICATED', () => {
    expect(toErrorResponse(new UnauthorizedException('Log in first'), 'c', logger()).body).toEqual({
      code: 'UNAUTHENTICATED', message: 'Log in first', correlationId: 'c',
    });
  });
```
and change the file's imports to:
```ts
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { codeForStatus, toErrorResponse } from './error-response.js';
```
(keep the existing `QueryFailedError` and `AdminFieldError`/`AdminNotFoundError` imports).

Append to `packages/core/test/isolation.test.ts` — first extend its imports:
```ts
import {
  Catch, Controller, Get, Injectable, Module, ValidationPipe,
  type ArgumentsHost, type CallHandler, type CanActivate, type ExceptionFilter, type ExecutionContext, type NestInterceptor,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { map } from 'rxjs';
```
then add below the existing classes:
```ts
@Injectable()
class WrapInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map((data: unknown) => ({ data })));
  }
}

@Catch()
class TeapotFilter implements ExceptionFilter {
  catch(_error: unknown, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(418).json({ teapot: true });
  }
}
```
and add these tests inside the existing `describe(...)`:
```ts
  test('host global interceptors, exception filters and pipes do not apply to the admin', async () => {
    const app = await createTestApp({
      imports: [HostModule],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: WrapInterceptor },
        { provide: APP_FILTER, useClass: TeapotFilter },
        { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }) },
      ],
    });
    const http = app.getHttpServer();
    expect((await request(http).get('/ping')).body).toEqual({ data: 'pong' }); // the host interceptor is active
    const meta = await request(http).get('/admin/api/meta');
    expect(meta.body.schemaVersion).toBe(1); // …but does not wrap admin responses
    const missing = await request(http).get('/admin/api/resources/nope');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('NOT_FOUND'); // not the host's 418 filter
    expect((await request(http).post('/admin/api/resources/widget').send({ name: 'Piped' })).status).toBe(201);
    await app.close();
  });

  test('host auth middleware errors under the admin path keep their status in the contract (Review Focus 5)', async () => {
    const app = await createTestApp({
      beforeInit: (a) =>
        a.use('/admin/api/resources', (req: { headers: Record<string, unknown> }, _res: unknown, next: (error: unknown) => void) =>
          next(Object.assign(new Error('Login required'), { status: req.headers['x-role'] ? 403 : 401 })),
        ),
    });
    const http = app.getHttpServer();
    const unauthenticated = await request(http).get('/admin/api/resources/widget');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe('UNAUTHENTICATED');
    expect(unauthenticated.body.message).toBe('Login required');
    expect(typeof unauthenticated.body.correlationId).toBe('string');
    const forbidden = await request(http).get('/admin/api/resources/widget').set('x-role', 'viewer');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN');
    await app.close();
  });
```

Create `packages/ui/src/lib/api-error.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { ApiError, describeError } from './api-error';

describe('ApiError', () => {
  test('internal errors carry the correlation id so users can report it', () => {
    expect(new ApiError(500, { code: 'INTERNAL', message: 'Internal error', correlationId: 'abc-123' }).message).toBe(
      'Internal error (reference: abc-123)',
    );
    expect(new ApiError(404, { code: 'NOT_FOUND', message: 'Gone', correlationId: 'x' }).message).toBe('Gone');
  });

  test('describeError lists field messages after the main message', () => {
    const error = new ApiError(422, {
      code: 'VALIDATION', message: 'Invalid list query', fields: { 'filter[price][gte]': ['must be a number'] }, correlationId: 'x',
    });
    expect(describeError(error)).toBe('Invalid list query — filter[price][gte]: must be a number');
    expect(describeError(new Error('offline'))).toBe('offline');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/http/error-response.test.ts packages/core/test/isolation.test.ts packages/ui/src/lib/api-error.test.ts`
Expected: FAIL — `codeForStatus` is not exported; the auth-middleware test gets `code: 'BAD_REQUEST'`; `./api-error` not found.

- [ ] **Step 3: Implement**

`packages/core/src/contract.ts` — replace the `AdminErrorCode` type:
```ts
export type AdminErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'BUSINESS_RULE' | 'INTERNAL';
```

`packages/core/src/http/error-response.ts` — replace `function codeForStatus` with an exported version:
```ts
export function codeForStatus(status: number): AdminErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 413 || status === 415) return 'BAD_REQUEST';
  if (status === 422) return 'VALIDATION';
  return 'BUSINESS_RULE';
}
```

`packages/core/src/http/admin-http.server.ts`:
1. Change imports:
```ts
import { HttpException, Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AdminErrorCode } from '../contract.js';
import { AdminError, AdminNotFoundError, AdminUnsupportedMediaTypeError } from '../errors.js';
import { codeForStatus, toErrorResponse } from './error-response.js';
```
2. Replace `bodyParserError` with:
```ts
/** Maps an error passed to next() before this handler ran (body parser, host middleware) to the admin contract. */
function earlyError(error: unknown): { status: number; code: AdminErrorCode; message: string } | undefined {
  const { type, status } = (error ?? {}) as { type?: unknown; status?: unknown };
  if (type === 'entity.parse.failed') return { status: 400, code: 'BAD_REQUEST', message: 'Request body is not valid JSON' };
  if (type === 'entity.too.large') return { status: 413, code: 'BAD_REQUEST', message: 'Request body is too large' };
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, code: codeForStatus(status), message: error instanceof Error ? error.message : 'Bad request' };
  }
  return undefined;
}
```
3. Replace the backstop `.catch(...)` body so it answers in the contract:
```ts
      this.handle(req, res, next).catch((error: unknown) => {
        const correlationId = randomUUID();
        this.logger.error(`[${correlationId}] unhandled admin error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
        if (res.headersSent) {
          res.end();
          return;
        }
        sendJson(res, 500, { code: 'INTERNAL', message: 'Internal error', correlationId });
      });
```
(This path is unreachable by construction — `handle()` catches everything — so it has no test; it exists so a future bug still yields a contract response.)
4. Replace the error middleware body:
```ts
    adapter.use(this.options.path, (error: unknown, req: AdminRequest, res: ServerResponse, next: (error?: unknown) => void) => {
      if (res.headersSent) {
        next(error);
        return;
      }
      const correlationId = createAdminContext(req).correlationId;
      if (error instanceof AdminError || error instanceof HttpException) {
        const { status, body } = toErrorResponse(error, correlationId, this.logger);
        sendJson(res, status, body);
        return;
      }
      const early = earlyError(error);
      if (early) {
        sendJson(res, early.status, { code: early.code, message: early.message, correlationId });
        return;
      }
      const { status, body } = toErrorResponse(error, correlationId, this.logger);
      sendJson(res, status, body);
    });
```

Create `packages/ui/src/lib/api-error.ts`:
```ts
import type { AdminErrorBody } from '@nest-my-admin/core/contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: AdminErrorBody,
  ) {
    super(body.code === 'INTERNAL' && body.correlationId ? `${body.message} (reference: ${body.correlationId})` : body.message);
    this.name = 'ApiError';
  }

  get fields(): Record<string, string[]> {
    return this.body.fields ?? {};
  }
}

/** One line for places that show a whole error at once (list page, banners). */
export function describeError(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  const details = Object.entries(error.fields).map(([name, messages]) => `${name}: ${messages.join(', ')}`);
  return [error.message, ...details].join(' — ');
}
```

`packages/ui/src/lib/api.ts` — delete the `ApiError` class and add at the top:
```ts
import { ApiError } from './api-error';

export { ApiError, describeError } from './api-error';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @nest-my-admin/core build && bun test packages && bun run typecheck`
Expected: all pass (the UI still imports `ApiError` from `@/lib/api`, which re-exports it).

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/ui
git commit -m "fix(core): UNAUTHENTICATED code, host middleware errors keep their status, contract body from the backstop"
```

---

### Task 2: "Did you mean" suggestions in configuration errors

**Files:**
- Create: `packages/core/src/schema/suggest.ts`
- Modify: `packages/core/src/schema/build-resource-schema.ts`
- Test: `packages/core/src/schema/suggest.test.ts` (new), `packages/core/src/schema/build-resource-schema.test.ts` (modify)

**Interfaces:**
- Produces: `suggest(name: string, candidates: readonly string[]): string | undefined`, `didYouMean(name: string, candidates: readonly string[]): string` (returns `' (did you mean "x"?)'` or `''`).

- [ ] **Step 1: Write the failing tests**

`packages/core/src/schema/suggest.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { didYouMean, suggest } from './suggest.js';

describe('suggest', () => {
  test('finds the closest candidate within a small edit distance', () => {
    expect(suggest('nmae', ['name', 'price'])).toBe('name');
    expect(suggest('NAME', ['name'])).toBe('name');
    expect(suggest('createdat', ['createdAt', 'updatedAt'])).toBe('createdAt');
  });

  test('returns nothing when nothing is close', () => {
    expect(suggest('zzz', ['name'])).toBeUndefined();
    expect(suggest('name', [])).toBeUndefined();
  });

  test('didYouMean formats the hint', () => {
    expect(didYouMean('nmae', ['name'])).toBe(' (did you mean "name"?)');
    expect(didYouMean('zzz', ['name'])).toBe('');
  });
});
```

Append to `packages/core/src/schema/build-resource-schema.test.ts` inside `describe('buildResourceSchema', ...)`:
```ts
  test('configuration errors suggest the closest column', () => {
    @AdminResource(Gadget)
    class TypoAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: ['nmae' as 'name'] };
    }
    expect(() => schemaFor(new TypoAdmin())).toThrow('TypoAdmin: list.columns: unknown column "nmae" on Gadget (did you mean "name"?)');

    @AdminResource(Gadget)
    class SortTypoAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { sort: '-prcie' as '-price' };
    }
    expect(() => schemaFor(new SortTypoAdmin())).toThrow('list.sort: cannot sort by "prcie" (did you mean "price"?)');
  });

  test('rejects an empty column list', () => {
    @AdminResource(Gadget)
    class EmptyAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: [] };
    }
    expect(() => schemaFor(new EmptyAdmin())).toThrow('EmptyAdmin: list.columns must name at least one column');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/schema`
Expected: FAIL — `./suggest.js` not found; the new builder tests get messages without hints / no error for `[]`.

- [ ] **Step 3: Implement**

`packages/core/src/schema/suggest.ts`:
```ts
/** Closest candidate within a small edit distance, for "did you mean" hints in configuration errors. */
export function suggest(name: string, candidates: readonly string[]): string | undefined {
  const target = name.toLowerCase();
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(target, candidate.toLowerCase());
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  if (!best) return undefined;
  return best.distance <= Math.max(2, Math.floor(name.length / 3)) ? best.candidate : undefined;
}

export function didYouMean(name: string, candidates: readonly string[]): string {
  const match = suggest(name, candidates);
  return match ? ` (did you mean "${match}"?)` : '';
}

/** Levenshtein distance with a single rolling row. */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}
```

`packages/core/src/schema/build-resource-schema.ts`:
1. Add the import: `import { didYouMean } from './suggest.js';`
2. Replace the column check loop:
```ts
  if (columns.length === 0) fail('list.columns must name at least one column');
  for (const column of columns) {
    if (!byName.has(column)) fail(`list.columns: unknown column "${column}" on ${entityName}${didYouMean(column, [...byName.keys()])}`);
  }
```
3. Replace the sort check:
```ts
  if (!sortable.includes(sortField)) fail(`list.sort: cannot sort by "${sortField}"${didYouMean(sortField, sortable)}`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core/src/schema`
Expected: PASS (the existing "unknown column \"nope\"" test still passes — `nope` has no close match, and `toThrow` matches a substring).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema
git commit -m "feat(core): suggest the closest column in resource configuration errors"
```

---

### Task 3: Filter and search configuration in the resource schema

**Files:**
- Create: `packages/core/src/schema/filter-operators.ts`
- Modify: `packages/core/src/contract.ts`, `packages/core/src/resource/admin-resource-base.ts` (ListConfig only), `packages/core/src/schema/build-resource-schema.ts`, `packages/core/test/fixtures/widgets.ts`
- Test: `packages/core/src/schema/filter-operators.test.ts` (new), `packages/core/src/schema/build-resource-schema.test.ts` (modify)

**Interfaces:**
- Consumes: `didYouMean` (Task 2).
- Produces:
  - contract: `type FilterOperator = 'eq'|'ne'|'in'|'nin'|'lt'|'lte'|'gt'|'gte'|'between'|'contains'|'startsWith'|'isNull'`; `interface FilterSchema { field: string; operators: FilterOperator[] }`; `ResourceSchema.list.filters: FilterSchema[]`, `ResourceSchema.list.search: string[]`.
  - `operatorsFor(field: FieldSchema): FilterOperator[]`, `SEARCHABLE_TYPES: readonly FieldType[]` (`['string', 'text']`).
  - `ListConfig<T>.filters?: EntityKey<T>[]`, `ListConfig<T>.search?: EntityKey<T>[]`. Defaults: filters = every `enum` and `boolean` field; search = every `string` field.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/schema/filter-operators.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '../contract.js';
import { operatorsFor } from './filter-operators.js';

const field = (type: FieldType, nullable = false): FieldSchema => ({
  name: 'x', label: 'X', type, nullable, primary: false, readonly: false, persisted: true,
});

describe('operatorsFor', () => {
  test('depends on the column type', () => {
    expect(operatorsFor(field('string'))).toEqual(['eq', 'ne', 'in', 'nin', 'contains', 'startsWith']);
    expect(operatorsFor(field('text'))).toEqual(['contains', 'startsWith']);
    expect(operatorsFor(field('number'))).toEqual(['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between']);
    expect(operatorsFor(field('datetime'))).toEqual(['lt', 'lte', 'gt', 'gte', 'between']);
    expect(operatorsFor(field('boolean'))).toEqual(['eq', 'ne']);
    expect(operatorsFor(field('enum'))).toEqual(['eq', 'ne', 'in', 'nin']);
    expect(operatorsFor(field('uuid'))).toEqual(['eq', 'ne', 'in', 'nin']);
  });

  test('nullable columns also get isNull; json columns get nothing', () => {
    expect(operatorsFor(field('text', true))).toEqual(['contains', 'startsWith', 'isNull']);
    expect(operatorsFor(field('json', true))).toEqual([]);
  });
});
```

In `packages/core/src/schema/build-resource-schema.test.ts`:
1. Add an entity after `Pair`:
```ts
@Entity()
class Tool {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column({ type: 'int', nullable: true }) weight: number | null;
  @Column({ default: false }) active: boolean;
  @Column({ type: 'simple-json', nullable: true }) extra: Record<string, unknown> | null;
}
```
2. Change the DataSource setup to `entities: [Gadget, Pair, Tool]`.
3. In the first test, replace the `expect(schema.list).toEqual({...})` block with:
```ts
    expect(schema.list).toEqual({
      columns: ['id', 'name', 'price', 'condition', 'createdAt'],
      sortable: ['id', 'name', 'price', 'condition', 'createdAt'],
      defaultSort: { field: 'id', direction: 'desc' },
      pageSize: 25,
      filters: [{ field: 'condition', operators: ['eq', 'ne', 'in', 'nin'] }],
      search: ['name'],
    });
```
4. Add tests:
```ts
  test('uses configured filters and search fields', () => {
    @AdminResource(Tool)
    class ToolAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { filters: ['weight', 'active', 'title'], search: ['title'] };
    }
    const schema = schemaFor(new ToolAdmin(), Tool);
    expect(schema.list.filters).toEqual([
      { field: 'weight', operators: ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between', 'isNull'] },
      { field: 'active', operators: ['eq', 'ne'] },
      { field: 'title', operators: ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith'] },
    ]);
    expect(schema.list.search).toEqual(['title']);
  });

  test('defaults: enum and boolean columns are filters, string columns are searched', () => {
    @AdminResource(Tool)
    class PlainToolAdmin extends AdminResourceBase<Tool> {}
    const schema = schemaFor(new PlainToolAdmin(), Tool);
    expect(schema.list.filters.map((f) => f.field)).toEqual(['active']);
    expect(schema.list.search).toEqual(['title']);
  });

  test('rejects filters and search fields that cannot work', () => {
    @AdminResource(Tool)
    class JsonFilterAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { filters: ['extra'] };
    }
    expect(() => schemaFor(new JsonFilterAdmin(), Tool)).toThrow('list.filters: column "extra" (json) cannot be filtered');

    @AdminResource(Tool)
    class NumberSearchAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { search: ['weight'] };
    }
    expect(() => schemaFor(new NumberSearchAdmin(), Tool)).toThrow('list.search: column "weight" (number) is not a text column');

    @AdminResource(Tool)
    class TypoFilterAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { filters: ['wieght' as 'weight'] };
    }
    expect(() => schemaFor(new TypoFilterAdmin(), Tool)).toThrow('list.filters: unknown column "wieght" on Tool (did you mean "weight"?)');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/schema`
Expected: FAIL — `./filter-operators.js` not found; `schema.list` has no `filters`/`search`.

- [ ] **Step 3: Implement**

`packages/core/src/contract.ts` — add after `SortDirection`:
```ts
export type FilterOperator =
  | 'eq' | 'ne' | 'in' | 'nin' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'contains' | 'startsWith' | 'isNull';

/** A filterable field and the operators its column type supports (spec §11). */
export interface FilterSchema {
  field: string;
  operators: FilterOperator[];
}
```
and in `ResourceSchema.list` add after `pageSize: number;`:
```ts
    filters: FilterSchema[];
    /** Fields matched case-insensitively by `?search=`. Empty = not searchable. */
    search: string[];
```

`packages/core/src/schema/filter-operators.ts`:
```ts
import type { FieldSchema, FieldType, FilterOperator } from '../contract.js';

const EQUALITY: FilterOperator[] = ['eq', 'ne', 'in', 'nin'];
const RANGE: FilterOperator[] = ['lt', 'lte', 'gt', 'gte', 'between'];

const OPERATORS_BY_TYPE: Record<FieldType, FilterOperator[]> = {
  string: [...EQUALITY, 'contains', 'startsWith'],
  text: ['contains', 'startsWith'],
  uuid: EQUALITY,
  enum: EQUALITY,
  number: [...EQUALITY, ...RANGE],
  bigint: [...EQUALITY, ...RANGE],
  decimal: [...EQUALITY, ...RANGE],
  date: [...EQUALITY, ...RANGE],
  datetime: RANGE, // exact equality on timestamps is never what a person means
  boolean: ['eq', 'ne'],
  json: [],
};

/** Column types that `?search=` can match with a case-insensitive LIKE. */
export const SEARCHABLE_TYPES: readonly FieldType[] = ['string', 'text'];

export function operatorsFor(field: FieldSchema): FilterOperator[] {
  const operators = OPERATORS_BY_TYPE[field.type];
  if (operators.length === 0) return [];
  return field.nullable ? [...operators, 'isNull'] : [...operators];
}
```

`packages/core/src/resource/admin-resource-base.ts` — extend `ListConfig<T>`:
```ts
export interface ListConfig<T> {
  columns?: EntityKey<T>[];
  /** `'name'` for ascending, `'-createdAt'` for descending. Defaults to `-<primary key>`. */
  sort?: EntityKey<T> | `-${EntityKey<T>}`;
  pageSize?: number;
  /** Filterable fields. Default: every enum and boolean column. */
  filters?: EntityKey<T>[];
  /** Fields matched by `?search=`. Default: every string column. */
  search?: EntityKey<T>[];
}
```

`packages/core/src/schema/build-resource-schema.ts`:
1. Imports: `import type { FieldSchema, FilterSchema, ResourceSchema, SortDirection } from '../contract.js';` and `import { SEARCHABLE_TYPES, operatorsFor } from './filter-operators.js';`
2. Before the `return`, add:
```ts
  const allNames = [...byName.keys()];
  const filterNames: string[] =
    resource.list?.filters ?? entityFields.filter((field) => field.type === 'enum' || field.type === 'boolean').map((field) => field.name);
  const filters: FilterSchema[] = [];
  for (const name of filterNames) {
    const field = byName.get(name);
    if (!field) return fail(`list.filters: unknown column "${name}" on ${entityName}${didYouMean(name, allNames)}`);
    const operators = operatorsFor(field);
    if (operators.length === 0) return fail(`list.filters: column "${name}" (${field.type}) cannot be filtered`);
    filters.push({ field: name, operators });
  }

  const search: string[] = resource.list?.search ?? entityFields.filter((field) => field.type === 'string').map((field) => field.name);
  for (const name of search) {
    const field = byName.get(name);
    if (!field) return fail(`list.search: unknown column "${name}" on ${entityName}${didYouMean(name, allNames)}`);
    if (!SEARCHABLE_TYPES.includes(field.type)) return fail(`list.search: column "${name}" (${field.type}) is not a text column`);
  }
```
3. Change the returned `list` to:
```ts
    list: { columns, sortable, defaultSort: { field: sortField, direction }, pageSize, filters, search },
```

`packages/core/test/fixtures/widgets.ts` — give `WidgetAdmin` explicit filters and search (Task 5's integration tests use them):
```ts
@AdminResource(Widget)
export class WidgetAdmin extends AdminResourceBase<Widget> {
  list: ListConfig<Widget> = {
    columns: ['id', 'name', 'price', 'status', 'visible'],
    filters: ['status', 'visible', 'price', 'notes', 'name', 'createdAt'],
    search: ['name', 'notes'],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): derive filter operators and search fields into the resource schema"
```

---

### Task 4: Parse filters and search from the list query

**Files:**
- Modify: `packages/core/src/crud/list-query.ts`, `packages/core/src/resource/admin-resource-base.ts` (ListParams only), `packages/core/src/index.ts`
- Test: `packages/core/src/crud/list-query.test.ts` (rewrite)

**Interfaces:**
- Consumes: `ResourceSchema.list.filters/search`, `FilterOperator` (Task 3).
- Produces (in `admin-resource-base.ts`, exported from the package index):
  ```ts
  export type FilterValue = string | number | boolean | Date | Array<string | number>;
  export interface FilterCondition { field: string; operator: FilterOperator; value: FilterValue; }
  export interface ListParams {
    page: number; pageSize: number; sort: { field: string; direction: SortDirection };
    filters: FilterCondition[];
    search?: { term: string; fields: string[] };
  }
  ```
  `parseListQuery(query, schema): ListParams` — value types: `number` → number; `decimal`/`bigint`/`date`/`enum`/`uuid`/`string` → string; `boolean` → boolean; `datetime` → `Date`; `isNull` → boolean; `in`/`nin`/`between` → array (`between` length 2). Errors are keyed by the raw parameter name (e.g. `filter[price][gte]`).

- [ ] **Step 1: Rewrite the test file**

`packages/core/src/crud/list-query.test.ts` (replace the whole file):
```ts
import { describe, expect, test } from 'bun:test';
import type { FieldSchema, ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import { parseListQuery } from './list-query.js';

const f = (name: string, type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});

const schema: ResourceSchema = {
  name: 'widget',
  label: 'Widget',
  group: 'widgets',
  primaryKey: 'id',
  fields: [
    f('id', 'number', { primary: true, readonly: true }),
    f('name', 'string'),
    f('price', 'decimal', { scale: 2 }),
    f('stock', 'number'),
    f('status', 'enum', { enumValues: ['draft', 'live'] }),
    f('visible', 'boolean'),
    f('notes', 'text', { nullable: true }),
    f('createdAt', 'datetime', { readonly: true }),
  ],
  list: {
    columns: ['id', 'name'],
    sortable: ['id', 'name'],
    defaultSort: { field: 'id', direction: 'desc' },
    pageSize: 25,
    filters: [
      { field: 'name', operators: ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith'] },
      { field: 'price', operators: ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between'] },
      { field: 'stock', operators: ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between'] },
      { field: 'status', operators: ['eq', 'ne', 'in', 'nin'] },
      { field: 'visible', operators: ['eq', 'ne'] },
      { field: 'notes', operators: ['contains', 'startsWith', 'isNull'] },
      { field: 'createdAt', operators: ['lt', 'lte', 'gt', 'gte', 'between'] },
    ],
    search: ['name', 'notes'],
  },
  form: { create: [], update: [], requiredOnCreate: [] },
};

const parse = (query: string, s: ResourceSchema = schema) => parseListQuery(new URLSearchParams(query), s);

function errorsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdminValidationError) return error.fields ?? {};
    throw error;
  }
  throw new Error('expected an AdminValidationError');
}

describe('parseListQuery: paging and sorting', () => {
  test('uses the resource defaults', () => {
    expect(parse('')).toEqual({ page: 1, pageSize: 25, sort: { field: 'id', direction: 'desc' }, filters: [] });
  });

  test('reads page, pageSize and sort', () => {
    const params = parse('page=3&pageSize=10&sort=name');
    expect([params.page, params.pageSize, params.sort]).toEqual([3, 10, { field: 'name', direction: 'asc' }]);
    expect(parse('sort=-name').sort).toEqual({ field: 'name', direction: 'desc' });
  });

  test('rejects invalid paging, sorting and unknown parameters', () => {
    expect(errorsOf(() => parse('page=0'))).toEqual({ page: ['must be a positive integer'] });
    expect(errorsOf(() => parse('pageSize=101'))).toEqual({ pageSize: ['must be at most 100'] });
    expect(errorsOf(() => parse('sort=secret'))).toEqual({ sort: ['cannot sort by "secret"'] });
    expect(errorsOf(() => parse('page=1&page=2'))).toEqual({ page: ['must be given once'] });
    expect(errorsOf(() => parse('foo=1'))).toEqual({ foo: ['is not a supported list parameter'] });
  });
});

describe('parseListQuery: filters', () => {
  test('parses operators into typed values', () => {
    const { filters } = parse(
      'filter[status]=live&filter[stock][gte]=5&filter[price][between]=1,9.5&filter[status][in]=draft,live' +
        '&filter[visible][eq]=false&filter[notes][isNull]=true&filter[name][contains]=50%25',
    );
    expect(filters).toEqual([
      { field: 'status', operator: 'eq', value: 'live' },
      { field: 'stock', operator: 'gte', value: 5 },
      { field: 'price', operator: 'between', value: ['1', '9.5'] },
      { field: 'status', operator: 'in', value: ['draft', 'live'] },
      { field: 'visible', operator: 'eq', value: false },
      { field: 'notes', operator: 'isNull', value: true },
      { field: 'name', operator: 'contains', value: '50%' },
    ]);
  });

  test('datetime values become Date objects', () => {
    const [condition] = parse('filter[createdAt][gte]=2026-01-01T00:00:00Z').filters;
    expect(condition!.value).toBeInstanceOf(Date);
    expect((condition!.value as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('wrong fields, operators and values are 422s keyed by parameter (Review Focus 2)', () => {
    expect(errorsOf(() => parse('filter[secret][eq]=1'))).toEqual({ 'filter[secret][eq]': ['cannot filter by "secret"'] });
    expect(errorsOf(() => parse('filter[status][gt]=a'))).toEqual({
      'filter[status][gt]': ['operator "gt" is not allowed for "status" (allowed: eq, ne, in, nin)'],
    });
    expect(errorsOf(() => parse('filter[price][gte]=abc'))).toEqual({ 'filter[price][gte]': ['must be a number'] });
    expect(errorsOf(() => parse('filter[stock][gte]=1.5x'))).toEqual({ 'filter[stock][gte]': ['must be a number'] });
    expect(errorsOf(() => parse('filter[status][eq]=gone'))).toEqual({ 'filter[status][eq]': ['must be one of: draft, live'] });
    expect(errorsOf(() => parse('filter[price][between]=1'))).toEqual({ 'filter[price][between]': ['must be two comma-separated values'] });
    expect(errorsOf(() => parse('filter[status][in]=draft,'))).toEqual({ 'filter[status][in]': ['must be 1 to 100 comma-separated values'] });
    expect(errorsOf(() => parse('filter[notes][isNull]=maybe'))).toEqual({ 'filter[notes][isNull]': ['must be true or false'] });
    expect(errorsOf(() => parse('filter[createdAt][lt]=never'))).toEqual({ 'filter[createdAt][lt]': ['must be a date and time'] });
    expect(errorsOf(() => parse('filter[status][eq]=draft&filter[status][eq]=live'))).toEqual({ 'filter[status][eq]': ['must be given once'] });
    expect(errorsOf(() => parse('filter[name][contains]='))).toEqual({ 'filter[name][contains]': ['must be 1 to 200 characters'] });
  });
});

describe('parseListQuery: search', () => {
  test('trims the term and carries the searchable fields', () => {
    expect(parse('search=%20lamp%20').search).toEqual({ term: 'lamp', fields: ['name', 'notes'] });
    expect(parse('search=%20%20').search).toBeUndefined();
  });

  test('rejects over-long terms and unsearchable resources', () => {
    expect(errorsOf(() => parse(`search=${'x'.repeat(201)}`))).toEqual({ search: ['must be at most 200 characters'] });
    const unsearchable = { ...schema, list: { ...schema.list, search: [] } };
    expect(errorsOf(() => parse('search=lamp', unsearchable))).toEqual({ search: ['this resource is not searchable'] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/crud/list-query.test.ts`
Expected: FAIL — results have no `filters`; unknown parameters are ignored.

- [ ] **Step 3: Implement**

`packages/core/src/resource/admin-resource-base.ts` — change the imports and `ListParams`:
```ts
import type { FilterOperator, SortDirection } from '../contract.js';

export type FilterValue = string | number | boolean | Date | Array<string | number>;

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: FilterValue;
}

export interface ListParams {
  page: number;
  pageSize: number;
  sort: { field: string; direction: SortDirection };
  filters: FilterCondition[];
  search?: { term: string; fields: string[] };
}
```

`packages/core/src/crud/list-query.ts` (replace the whole file):
```ts
import type { FieldSchema, FilterOperator, ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import type { FilterCondition, FilterValue, ListParams } from '../resource/admin-resource-base.js';
import { MAX_PAGE_SIZE } from '../schema/build-resource-schema.js';

type Errors = Record<string, string[]>;
type Parsed<T> = { value: T } | { error: string };

const PAGING_KEYS = new Set(['page', 'pageSize', 'sort', 'search']);
const FILTER_KEY = /^filter\[([^\][]+)\](?:\[([^\][]+)\])?$/;
const MAX_LIST_VALUES = 100;
const MAX_TEXT = 200;
const NUMBER = /^-?\d+(\.\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses `page`, `pageSize`, `sort`, `search` and `filter[field][op]` (spec §11). Field names come only from the schema. */
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

  const filters: FilterCondition[] = [];
  for (const key of new Set(query.keys())) {
    if (PAGING_KEYS.has(key)) continue;
    const match = FILTER_KEY.exec(key);
    if (!match) {
      errors[key] = ['is not a supported list parameter'];
      continue;
    }
    const raw = readOne(query, key, errors);
    if (raw === undefined) continue;
    const fieldName = match[1]!;
    const operator = (match[2] ?? 'eq') as FilterOperator;
    const allowed = schema.list.filters.find((filter) => filter.field === fieldName);
    if (!allowed) {
      errors[key] = [`cannot filter by "${fieldName}"`];
      continue;
    }
    if (!allowed.operators.includes(operator)) {
      errors[key] = [`operator "${operator}" is not allowed for "${fieldName}" (allowed: ${allowed.operators.join(', ')})`];
      continue;
    }
    const field = schema.fields.find((candidate) => candidate.name === fieldName)!;
    const parsed = parseFilterValue(field, operator, raw);
    if ('error' in parsed) errors[key] = [parsed.error];
    else filters.push({ field: fieldName, operator, value: parsed.value });
  }

  let search: ListParams['search'];
  const rawSearch = readOne(query, 'search', errors);
  if (rawSearch !== undefined && rawSearch.trim() !== '') {
    if (schema.list.search.length === 0) errors.search = ['this resource is not searchable'];
    else if (rawSearch.length > MAX_TEXT) errors.search = [`must be at most ${MAX_TEXT} characters`];
    else search = { term: rawSearch.trim(), fields: schema.list.search };
  }

  if (Object.keys(errors).length > 0) throw new AdminValidationError(errors, 'Invalid list query');
  return { page, pageSize, sort, filters, ...(search ? { search } : {}) };
}

function parseFilterValue(field: FieldSchema, operator: FilterOperator, raw: string): Parsed<FilterValue> {
  if (operator === 'isNull') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'must be true or false' };
  }
  if (operator === 'contains' || operator === 'startsWith') {
    return raw.length === 0 || raw.length > MAX_TEXT ? { error: `must be 1 to ${MAX_TEXT} characters` } : { value: raw };
  }
  if (operator === 'in' || operator === 'nin' || operator === 'between') {
    const parts = raw.split(',').map((part) => part.trim());
    if (operator === 'between' && parts.length !== 2) return { error: 'must be two comma-separated values' };
    if (parts.length > MAX_LIST_VALUES || parts.some((part) => part === '')) {
      return { error: `must be 1 to ${MAX_LIST_VALUES} comma-separated values` };
    }
    const values: Array<string | number> = [];
    for (const part of parts) {
      const parsed = parseScalar(field, part);
      if ('error' in parsed) return parsed;
      if (typeof parsed.value === 'boolean' || parsed.value instanceof Date) return { error: 'is not supported for this field' };
      values.push(parsed.value);
    }
    return { value: values };
  }
  return parseScalar(field, raw);
}

function parseScalar(field: FieldSchema, raw: string): Parsed<string | number | boolean | Date> {
  switch (field.type) {
    case 'number':
      return NUMBER.test(raw) ? { value: Number(raw) } : { error: 'must be a number' };
    case 'decimal':
      return NUMBER.test(raw) ? { value: raw } : { error: 'must be a number' };
    case 'bigint':
      return /^-?\d+$/.test(raw) ? { value: raw } : { error: 'must be an integer' };
    case 'boolean':
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'must be true or false' };
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? { value: raw } : { error: 'must be a date (YYYY-MM-DD)' };
    case 'datetime': {
      const time = Date.parse(raw);
      return Number.isNaN(time) ? { error: 'must be a date and time' } : { value: new Date(time) };
    }
    case 'enum':
      return field.enumValues?.includes(raw) ? { value: raw } : { error: `must be one of: ${(field.enumValues ?? []).join(', ')}` };
    case 'uuid':
      return UUID.test(raw) ? { value: raw } : { error: 'must be a UUID' };
    default:
      return raw.length <= MAX_TEXT ? { value: raw } : { error: `must be at most ${MAX_TEXT} characters` };
  }
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
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    errors[key] = ['must be a positive integer'];
    return fallback;
  }
  return Number(raw);
}
```

`packages/core/src/index.ts` — extend the `admin-resource-base.js` export:
```ts
export {
  AdminResourceBase,
  type FilterCondition,
  type FilterValue,
  type FindManyResult,
  type FormConfig,
  type ListConfig,
  type ListParams,
  type RecordId,
} from './resource/admin-resource-base.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass. (The default `findMany` ignores `filters` until Task 5; no existing test sends filters.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src
git commit -m "feat(core): parse filter[field][op] and search list parameters"
```

---

### Task 5: Apply filters, search and stable sorting in the default list query

**Files:**
- Create: `packages/core/src/crud/list-query-builder.ts`
- Modify: `packages/core/src/resource/admin-resource-base.ts`
- Test: `packages/core/test/list-filters.test.ts` (new)

**Interfaces:**
- Consumes: `ListParams`, `FilterCondition` (Task 4); the Widget fixture's filters/search (Task 3).
- Produces: `applyListParams<T>(qb: SelectQueryBuilder<T>, params: ListParams, primaryKey: string): SelectQueryBuilder<T>`; `AdminResourceBase.buildListQuery(params: ListParams, alias = 'entity'): SelectQueryBuilder<T>` (protected) — host `findMany` overrides can extend it, e.g. `this.buildListQuery(params).andWhere('entity.ownerId = :id', { id })`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/list-filters.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';

const base = '/admin/api/resources/widget';
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp();
  const seed = [
    { name: 'Alpha lamp', price: '5', status: 'live', visible: true, notes: 'bright' },
    { name: 'beta Lamp', price: '15.5', status: 'draft', visible: false, notes: null },
    { name: 'Gamma', price: '50', status: 'live', visible: false, notes: '50% off' },
    { name: 'Delta_x', price: '99.99', status: 'draft', visible: true, notes: 'n_a' },
  ];
  for (const widget of seed) {
    const res = await request(app.getHttpServer()).post(base).send(widget);
    if (res.status !== 201) throw new Error(`seed failed: ${JSON.stringify(res.body)}`);
  }
});
afterAll(async () => {
  await app.close();
});

async function names(query: string): Promise<string[]> {
  const res = await request(app.getHttpServer()).get(`${base}?${query}`);
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return (res.body.items as Array<{ name: string }>).map((w) => w.name).sort();
}

describe('list filters', () => {
  test('equality, membership and booleans', async () => {
    expect(await names('filter[status][eq]=live')).toEqual(['Alpha lamp', 'Gamma']);
    expect(await names('filter[status]=draft')).toEqual(['Delta_x', 'beta Lamp']);
    expect(await names('filter[status][in]=draft,live')).toHaveLength(4);
    expect(await names('filter[status][ne]=live')).toEqual(['Delta_x', 'beta Lamp']);
    expect(await names('filter[visible][eq]=false')).toEqual(['Gamma', 'beta Lamp']);
  });

  test('ranges on decimals', async () => {
    expect(await names('filter[price][gte]=15.5')).toEqual(['Delta_x', 'Gamma', 'beta Lamp']);
    expect(await names('filter[price][between]=5,15.5')).toEqual(['Alpha lamp', 'beta Lamp']);
    expect(await names('filter[price][lt]=5')).toEqual([]);
  });

  test('null checks', async () => {
    expect(await names('filter[notes][isNull]=true')).toEqual(['beta Lamp']);
    expect(await names('filter[notes][isNull]=false')).toEqual(['Alpha lamp', 'Delta_x', 'Gamma']);
  });

  test('contains and startsWith are case-insensitive', async () => {
    expect(await names('filter[name][contains]=LAMP')).toEqual(['Alpha lamp', 'beta Lamp']);
    expect(await names('filter[name][startsWith]=BE')).toEqual(['beta Lamp']);
  });

  test('LIKE wildcards typed by users match literally (Review Focus 1)', async () => {
    expect(await names('filter[notes][contains]=_')).toEqual(['Delta_x']);
    expect(await names(`search=${encodeURIComponent('%')}`)).toEqual(['Gamma']);
    expect(await names(`filter[notes][contains]=${encodeURIComponent('50%')}`)).toEqual(['Gamma']);
  });

  test('datetime ranges work against SQLite text storage (Review Focus 4)', async () => {
    expect(await names('filter[createdAt][gte]=2000-01-01T00:00:00Z')).toHaveLength(4);
    expect(await names('filter[createdAt][lt]=2000-01-01T00:00:00Z')).toEqual([]);
  });

  test('bad values are 422 before reaching the database (Review Focus 2)', async () => {
    const res = await request(app.getHttpServer()).get(`${base}?filter[price][gte]=abc`);
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ 'filter[price][gte]': ['must be a number'] });
  });
});

describe('search', () => {
  test('matches any search field, case-insensitively, and combines with filters', async () => {
    expect(await names('search=lamp')).toEqual(['Alpha lamp', 'beta Lamp']);
    expect(await names('search=BRIGHT')).toEqual(['Alpha lamp']);
    expect(await names('search=lamp&filter[status][eq]=draft')).toEqual(['beta Lamp']);
  });

  test('the total reflects the filters', async () => {
    const res = await request(app.getHttpServer()).get(`${base}?filter[status][eq]=live&pageSize=1`);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('stable pagination (Review Focus 3)', () => {
  test('ties in the sort column never repeat or skip records across pages', async () => {
    const tied = await createTestApp();
    const http = tied.getHttpServer();
    for (let i = 0; i < 5; i++) await request(http).post(base).send({ name: 'Same' });
    const seen: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await request(http).get(`${base}?sort=name&pageSize=2&page=${page}`);
      seen.push(...(res.body.items as Array<{ id: number }>).map((w) => w.id));
    }
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    await tied.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/core/test/list-filters.test.ts`
Expected: FAIL — filters are ignored, so every query returns all four widgets.

- [ ] **Step 3: Implement**

`packages/core/src/crud/list-query-builder.ts`:
```ts
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type { FilterCondition, ListParams } from '../resource/admin-resource-base.js';

const COMPARISONS = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;

/** Lower-cased LIKE pattern with `!`, `%` and `_` escaped by `!` (valid unquoted on SQLite, Postgres and MySQL). */
function likePattern(text: string, position: 'anywhere' | 'start'): string {
  const escaped = text.toLowerCase().replace(/[!%_]/g, (char) => `!${char}`);
  return position === 'start' ? `${escaped}%` : `%${escaped}%`;
}

function applyFilter<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, column: string, filter: FilterCondition, name: string): void {
  const { operator, value } = filter;
  switch (operator) {
    case 'eq':
    case 'ne':
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      qb.andWhere(`${column} ${COMPARISONS[operator]} :${name}`, { [name]: value });
      return;
    case 'in':
      qb.andWhere(`${column} IN (:...${name})`, { [name]: value });
      return;
    case 'nin':
      qb.andWhere(`${column} NOT IN (:...${name})`, { [name]: value });
      return;
    case 'between': {
      const [from, to] = value as Array<string | number>;
      qb.andWhere(`${column} BETWEEN :${name}From AND :${name}To`, { [`${name}From`]: from, [`${name}To`]: to });
      return;
    }
    case 'contains':
      qb.andWhere(`LOWER(${column}) LIKE :${name} ESCAPE '!'`, { [name]: likePattern(String(value), 'anywhere') });
      return;
    case 'startsWith':
      qb.andWhere(`LOWER(${column}) LIKE :${name} ESCAPE '!'`, { [name]: likePattern(String(value), 'start') });
      return;
    case 'isNull':
      qb.andWhere(`${column} IS ${value ? '' : 'NOT '}NULL`);
      return;
  }
}

/**
 * Applies filters, search, sort (with the primary key as tie-breaker, so pages never overlap) and paging.
 * Field names come from the resource schema's allow-lists (parseListQuery); values are always bound parameters.
 */
export function applyListParams<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, params: ListParams, primaryKey: string): SelectQueryBuilder<T> {
  const alias = qb.alias;
  params.filters.forEach((filter, index) => applyFilter(qb, `${alias}.${filter.field}`, filter, `filter${index}`));
  if (params.search) {
    const clauses = params.search.fields.map((field) => `LOWER(${alias}.${field}) LIKE :search ESCAPE '!'`);
    qb.andWhere(`(${clauses.join(' OR ')})`, { search: likePattern(params.search.term, 'anywhere') });
  }
  qb.orderBy(`${alias}.${params.sort.field}`, params.sort.direction === 'asc' ? 'ASC' : 'DESC');
  if (params.sort.field !== primaryKey) qb.addOrderBy(`${alias}.${primaryKey}`, 'ASC');
  return qb.skip((params.page - 1) * params.pageSize).take(params.pageSize);
}
```

`packages/core/src/resource/admin-resource-base.ts`:
1. Change the typeorm import to `import type { DeepPartial, FindOptionsWhere, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';` and add `import { applyListParams } from '../crud/list-query-builder.js';`
2. Replace `findMany` with:
```ts
  /**
   * The list query with filters, search, sort and paging applied. Override findMany and extend this to add
   * joins or restrictions: `this.buildListQuery(params).andWhere('entity.ownerId = :id', { id })`.
   */
  protected buildListQuery(params: ListParams, alias = 'entity'): SelectQueryBuilder<T> {
    return applyListParams(this.repository.createQueryBuilder(alias), params, this.primaryKey);
  }

  async findMany(params: ListParams, _ctx: AdminContext): Promise<FindManyResult<T>> {
    const [items, total] = await this.buildListQuery(params).getManyAndCount();
    return { items, total };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass, including the M0 list/pagination tests in `crud.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): apply filters, search and tie-broken sorting in the default list query"
```

---

### Task 6: Delete and lifecycle hooks

**Files:**
- Create: `packages/core/src/decorators/hooks.ts`
- Modify: `packages/core/src/constants.ts`, `packages/core/src/resource/admin-resource-base.ts`, `packages/core/src/api/admin-api.service.ts`, `packages/core/src/http/admin-http.server.ts`, `packages/core/src/http/error-response.ts`, `packages/core/src/index.ts`
- Test: `packages/core/src/decorators/hooks.test.ts` (new), `packages/core/test/delete-hooks.test.ts` (new), `packages/core/src/http/error-response.test.ts` (modify)

**Interfaces:**
- Produces:
  - `@BeforeSave()` — method `(dto: object, ctx: AdminContext, mode: 'create' | 'update')`, may mutate `dto`; `@AfterSave()` — `(entity, ctx, mode)`; `@BeforeDelete()` — `(entity, ctx)`, throw to veto. They run only in the base class's default `create`/`update`/`delete`, in declaration order, parent-class hooks first. `getHooks(target: Function, kind: HookKind): Array<string | symbol>`; `type HookKind = 'beforeSave' | 'afterSave' | 'beforeDelete'`; `type SaveMode = 'create' | 'update'`.
  - `AdminResourceBase.delete(id: RecordId, ctx: AdminContext): Promise<void>`.
  - `AdminApiService.remove(name, rawId, ctx): Promise<void>`; route `DELETE <path>/api/resources/:resource/:id` → 204.
  - Foreign-key violations map to `409 CONFLICT` "The change conflicts with related records".

- [ ] **Step 1: Write the failing tests**

`packages/core/src/decorators/hooks.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import { AfterSave, BeforeDelete, BeforeSave, getHooks } from './hooks.js';

class Parent {
  @BeforeSave() parentBefore() {}
  @BeforeDelete() guard() {}
}

class Child extends Parent {
  @BeforeSave() childBefore() {}
  @AfterSave() childAfter() {}
}

describe('hook decorators', () => {
  test('collect hooks in order, parent first, without leaking into the parent', () => {
    expect(getHooks(Child, 'beforeSave')).toEqual(['parentBefore', 'childBefore']);
    expect(getHooks(Child, 'afterSave')).toEqual(['childAfter']);
    expect(getHooks(Child, 'beforeDelete')).toEqual(['guard']);
    expect(getHooks(Parent, 'beforeSave')).toEqual(['parentBefore']);
    expect(getHooks(class Plain {}, 'beforeSave')).toEqual([]);
  });
});
```

`packages/core/test/delete-hooks.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminFieldError, AdminResource, AdminResourceBase, AfterSave, BeforeDelete, BeforeSave, type AdminContext } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

@AdminResource(Widget, { name: 'hooked-widget' })
class HookedWidgetAdmin extends AdminResourceBase<Widget> {
  readonly calls: string[] = [];

  @BeforeSave()
  trimName(dto: { name?: string }, _ctx: AdminContext, mode: string) {
    this.calls.push(`before:${mode}`);
    if (typeof dto.name === 'string') dto.name = dto.name.trim();
  }

  @AfterSave()
  record(entity: Widget, _ctx: AdminContext, mode: string) {
    this.calls.push(`after:${mode}:${entity.id}`);
  }

  @BeforeDelete()
  keepLiveWidgets(entity: Widget) {
    if (entity.status === 'live') throw new AdminFieldError({ status: 'live widgets cannot be deleted' });
  }
}

@Module({ providers: [HookedWidgetAdmin] })
class HookedModule {}

const plain = '/admin/api/resources/widget';
const hooked = '/admin/api/resources/hooked-widget';
let app: INestApplication;

beforeAll(async () => {
  app = await createTestApp({ imports: [HookedModule] });
});
afterAll(async () => {
  await app.close();
});

describe('delete', () => {
  test('removes the record and answers 204 with no body; no JSON content type needed', async () => {
    const { id } = (await request(app.getHttpServer()).post(plain).send({ name: 'Temp' })).body;
    const res = await request(app.getHttpServer()).delete(`${plain}/${id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await request(app.getHttpServer()).get(`${plain}/${id}`)).status).toBe(404);
  });

  test('missing and impossible ids are 404', async () => {
    expect((await request(app.getHttpServer()).delete(`${plain}/99999`)).status).toBe(404);
    expect((await request(app.getHttpServer()).delete(`${plain}/abc`)).status).toBe(404);
  });
});

describe('hooks', () => {
  test('beforeSave can normalise the dto; afterSave sees the saved entity', async () => {
    const admin = app.get(HookedWidgetAdmin);
    const created = await request(app.getHttpServer()).post(hooked).send({ name: '  Spaced  ' });
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Spaced');
    await request(app.getHttpServer()).patch(`${hooked}/${created.body.id}`).send({ name: ' Renamed ' });
    expect(admin.calls).toEqual(['before:create', `after:create:${created.body.id}`, 'before:update', `after:update:${created.body.id}`]);
    expect((await request(app.getHttpServer()).get(`${hooked}/${created.body.id}`)).body.name).toBe('Renamed');
  });

  test('beforeDelete can veto with a field error', async () => {
    const live = (await request(app.getHttpServer()).post(hooked).send({ name: 'Live', status: 'live' })).body;
    const refused = await request(app.getHttpServer()).delete(`${hooked}/${live.id}`);
    expect(refused.status).toBe(422);
    expect(refused.body.fields).toEqual({ status: ['live widgets cannot be deleted'] });
    const draft = (await request(app.getHttpServer()).post(hooked).send({ name: 'Draft' })).body;
    expect((await request(app.getHttpServer()).delete(`${hooked}/${draft.id}`)).status).toBe(204);
  });
});
```

Append to `packages/core/src/http/error-response.test.ts` inside the `describe`:
```ts
  test('foreign-key violations become 409 CONFLICT', () => {
    expect(toErrorResponse(dbError({ message: 'FOREIGN KEY constraint failed' }), 'c', logger())).toEqual({
      status: 409,
      body: { code: 'CONFLICT', message: 'The change conflicts with related records', correlationId: 'c' },
    });
    expect(toErrorResponse(dbError({ code: '23503', message: 'violates foreign key constraint' }), 'c', logger()).status).toBe(409);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/decorators/hooks.test.ts packages/core/test/delete-hooks.test.ts packages/core/src/http/error-response.test.ts`
Expected: FAIL — `./hooks.js` not found / hook decorators not exported; FK error is 500.

- [ ] **Step 3: Implement**

`packages/core/src/constants.ts` — add:
```ts
/** Reflect-metadata key holding the lifecycle hook method names of a resource class. */
export const ADMIN_HOOKS_METADATA = 'nest-my-admin:hooks';
```

`packages/core/src/decorators/hooks.ts`:
```ts
import 'reflect-metadata';
import { ADMIN_HOOKS_METADATA } from '../constants.js';

export type HookKind = 'beforeSave' | 'afterSave' | 'beforeDelete';
export type SaveMode = 'create' | 'update';

type HookTable = Record<HookKind, Array<string | symbol>>;

function hook(kind: HookKind): MethodDecorator {
  return (target, propertyKey) => {
    const owner = target.constructor;
    const inherited = Reflect.getMetadata(ADMIN_HOOKS_METADATA, owner) as HookTable | undefined;
    // Copy so a subclass never mutates its parent's list.
    const table: HookTable = {
      beforeSave: [...(inherited?.beforeSave ?? [])],
      afterSave: [...(inherited?.afterSave ?? [])],
      beforeDelete: [...(inherited?.beforeDelete ?? [])],
    };
    if (!table[kind].includes(propertyKey)) table[kind].push(propertyKey);
    Reflect.defineMetadata(ADMIN_HOOKS_METADATA, table, owner);
  };
}

/** `(dto, ctx, mode)` — runs before the default create/update saves; may mutate `dto`. */
export const BeforeSave = (): MethodDecorator => hook('beforeSave');
/** `(entity, ctx, mode)` — runs after the default create/update saved. */
export const AfterSave = (): MethodDecorator => hook('afterSave');
/** `(entity, ctx)` — runs before the default delete; throw to refuse. */
export const BeforeDelete = (): MethodDecorator => hook('beforeDelete');

export function getHooks(target: Function, kind: HookKind): Array<string | symbol> {
  return (Reflect.getMetadata(ADMIN_HOOKS_METADATA, target) as HookTable | undefined)?.[kind] ?? [];
}
```

`packages/core/src/resource/admin-resource-base.ts`:
1. Add `import { getHooks, type HookKind } from '../decorators/hooks.js';`
2. Replace `create` and `update`, and add `runHooks` and `delete`:
```ts
  async create(dto: object, ctx: AdminContext): Promise<T> {
    await this.runHooks('beforeSave', dto, ctx, 'create');
    const saved = await this.repository.save(this.repository.create({ ...dto } as DeepPartial<T>));
    await this.runHooks('afterSave', saved, ctx, 'create');
    return saved;
  }

  async update(id: RecordId, dto: object, ctx: AdminContext): Promise<T> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    await this.runHooks('beforeSave', dto, ctx, 'update');
    this.repository.merge(existing, { ...dto } as DeepPartial<T>);
    const saved = await this.repository.save(existing);
    await this.runHooks('afterSave', saved, ctx, 'update');
    return saved;
  }

  async delete(id: RecordId, ctx: AdminContext): Promise<void> {
    const existing = await this.findOne(id, ctx);
    if (!existing) throw new AdminNotFoundError();
    await this.runHooks('beforeDelete', existing, ctx);
    await this.repository.remove(existing);
  }

  /** Runs @BeforeSave/@AfterSave/@BeforeDelete methods in declaration order (parent class first). */
  protected async runHooks(kind: HookKind, ...args: unknown[]): Promise<void> {
    const methods = this as unknown as Record<string | symbol, (...hookArgs: unknown[]) => unknown>;
    for (const key of getHooks(this.constructor, kind)) await methods[key]!.apply(this, args);
  }
```

`packages/core/src/api/admin-api.service.ts` — add after `update`:
```ts
  async remove(name: string, rawId: string, ctx: AdminContext): Promise<void> {
    const { schema, resource } = this.registry.get(name);
    const id = parseRecordId(rawId, schema);
    if (!(await resource.findOne(id, ctx))) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    await resource.delete(id, ctx);
  }
```

`packages/core/src/http/admin-http.server.ts`:
1. Replace `const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);` with:
```ts
// Methods that carry a JSON body. DELETE is never a CORS "simple" request, so a foreign page cannot send one without a preflight.
const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT']);
```
and change the check in `handle()` to `if (BODY_METHODS.has(req.method ?? '') && !isJsonContentType(req.headers['content-type'])) {`.
2. Add the route after the PATCH route in the constructor:
```ts
      .add('DELETE', '/api/resources/:resource/:id', async ({ res, ctx }, p) => {
        await this.api.remove(p.resource, p.id, ctx);
        res.statusCode = 204;
        res.end();
      });
```

`packages/core/src/http/error-response.ts` — in `constraintError`, before the unique-violation check, add:
```ts
  if (code === '23503' || code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_NO_REFERENCED_ROW_2' || /FOREIGN KEY constraint failed/i.test(text)) {
    return { status: 409, body: { code: 'CONFLICT', message: 'The change conflicts with related records' } };
  }
```

`packages/core/src/index.ts` — add:
```ts
export { AfterSave, BeforeDelete, BeforeSave, type HookKind, type SaveMode } from './decorators/hooks.js';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass. (The M0 routing test `DELETE ${base}/1 → 404` still passes: no widget exists in that app.)

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): delete endpoint and @BeforeSave/@AfterSave/@BeforeDelete hooks"
```

---

### Task 7: Auto-register entities without a resource

**Files:**
- Modify: `packages/core/src/options.ts`, `packages/core/src/registry/resource-registry.ts`
- Test: `packages/core/src/options.test.ts` (modify), `packages/core/test/registry.test.ts` (modify)

**Interfaces:**
- Produces: `AdminModuleOptions.autoRegister?: boolean` (default `false`), `ResolvedAdminOptions.autoRegister: boolean`; `RegisteredResource.entity: Function`. With `autoRegister`, every `regular` entity of the default DataSource that has no `@AdminResource` gets a default resource named `kebab(EntityName)` in the group `{ key: 'entities', label: 'Entities', order: 1000 }`. Entities with composite primary keys, or whose name collides with an existing resource, are skipped with a warning log.

- [ ] **Step 1: Write the failing tests**

`packages/core/src/options.test.ts` — change the defaults test to:
```ts
  test('defaults', () => {
    expect(resolveAdminOptions()).toEqual({ path: '/admin', title: 'Admin', uiDistPath: undefined, autoRegister: false });
  });
```

`packages/core/test/registry.test.ts` — add `PrimaryColumn` to the typeorm import, `import request from 'supertest';`, and these declarations/tests:
```ts
@Entity()
class Gizmo {
  @PrimaryGeneratedColumn() id: number;
  @Column() label: string;
}

@Entity()
class Pairing {
  @PrimaryColumn() left: string;
  @PrimaryColumn() right: string;
}

describe('autoRegister', () => {
  test('is off by default', async () => {
    app = await createTestApp({ entities: [Gizmo] });
    expect(app.get(ResourceRegistry).list().map((entry) => entry.schema.name)).toEqual(['widget']);
  });

  test('exposes entities without a resource under "Entities" and skips composite keys', async () => {
    app = await createTestApp({ admin: { autoRegister: true }, entities: [Gizmo, Pairing] });
    const registry = app.get(ResourceRegistry);
    expect(registry.list().map((entry) => entry.schema.name).sort()).toEqual(['gizmo', 'widget']);
    expect(registry.get('gizmo').schema.group).toBe('entities');
    expect(registry.get('widget').schema.group).toBe('widgets');
    expect(registry.groupList().find((group) => group.key === 'entities')).toEqual({ key: 'entities', label: 'Entities', order: 1000 });
    const created = await request(app.getHttpServer()).post('/admin/api/resources/gizmo').send({ label: 'Auto' });
    expect(created.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/core/src/options.test.ts packages/core/test/registry.test.ts`
Expected: FAIL — `autoRegister` missing from resolved options; `gizmo` not registered.

- [ ] **Step 3: Implement**

`packages/core/src/options.ts`:
```ts
export interface AdminModuleOptions {
  /** Mount path of the admin UI and API. Default `/admin`. */
  path?: string;
  /** Title shown in the UI. Default `Admin`. */
  title?: string;
  /** Give every entity of the default DataSource without an @AdminResource a default resource. Default `false`. */
  autoRegister?: boolean;
  /** Advanced: serve the UI from this directory instead of @nest-my-admin/ui (tests, UI development). */
  uiDistPath?: string;
}

export interface ResolvedAdminOptions {
  path: string;
  title: string;
  autoRegister: boolean;
  uiDistPath?: string;
}
```
and change the `return` of `resolveAdminOptions` to:
```ts
  return { path, title: options.title ?? 'Admin', uiDistPath: options.uiDistPath, autoRegister: options.autoRegister ?? false };
```

`packages/core/src/registry/resource-registry.ts`:
1. Imports: `import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';`, `import { ADMIN_OPTIONS } from '../constants.js';`, `import type { ResolvedAdminOptions } from '../options.js';`
2. Add `entity: Function;` to `RegisteredResource`, and `entity: definition.entity,` to the object stored in `register()`.
3. Add below `DEFAULT_GROUP_ORDER`:
```ts
const AUTO_GROUP = { key: 'entities', label: 'Entities', order: 1000 } as const;

/** Default resource used by autoRegister. */
class AutoRegisteredResource extends AdminResourceBase {}
```
4. Change the constructor and the end of `onModuleInit`:
```ts
  private readonly logger = new Logger('NestMyAdmin');

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly moduleRef: ModuleRef,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}
```
and after the discovery loop inside `onModuleInit()`:
```ts
    if (this.options.autoRegister) this.registerAutoResources();
```
5. Add the method:
```ts
  private registerAutoResources(): void {
    let dataSource: DataSource;
    try {
      dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(), { strict: false });
    } catch {
      throw new Error('nest-my-admin: autoRegister needs the default TypeORM DataSource (TypeOrmModule.forRoot())');
    }
    const covered = new Set(this.list().map((entry) => entry.entity));
    for (const metadata of dataSource.entityMetadatas) {
      const entity = metadata.target;
      if (typeof entity !== 'function' || covered.has(entity) || metadata.tableType !== 'regular') continue;
      if (metadata.primaryColumns.length !== 1) {
        this.logger.warn(`autoRegister skipped ${entity.name}: composite primary keys are not supported yet`);
        continue;
      }
      if (this.resources.has(kebabCase(entity.name))) {
        this.logger.warn(`autoRegister skipped ${entity.name}: a resource named "${kebabCase(entity.name)}" already exists`);
        continue;
      }
      if (!this.groups.has(AUTO_GROUP.key)) this.groups.set(AUTO_GROUP.key, { ...AUTO_GROUP });
      this.register(`${entity.name}Admin (auto)`, { entity, group: AUTO_GROUP.key }, new AutoRegisteredResource(), AUTO_GROUP.key);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core && bun run --filter @nest-my-admin/core typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): autoRegister option exposes entities without a resource"
```

---

### Task 8: Demo — filters, search and delete through the service

**Files:**
- Modify: `examples/demo-api/src/catalog/product.admin.ts`, `examples/demo-api/src/catalog/products.service.ts`
- Test: `examples/demo-api/test/catalog-admin.test.ts` (modify)

**Interfaces:**
- Consumes: `ListConfig.filters/search` (Task 3), `delete` override (Task 6).
- Produces: demo list filters `status`, `price`, `stock`, `releasedOn`; search `name`, `sku`; `ProductsService.remove(id)` refusing active products with `ConflictException('Active products cannot be deleted; archive them first')`.

- [ ] **Step 1: Write the failing tests**

Append to `examples/demo-api/test/catalog-admin.test.ts` (inside the existing `describe`):
```ts
  test('filters and search narrow the list', async () => {
    await post({ name: 'Filter lamp', sku: 'flt-1', price: '12', stock: 3, status: 'active' });
    await post({ name: 'Filter mug', sku: 'flt-2', price: '30', status: 'draft' });
    const byStatus = await request(app.getHttpServer()).get(`${base}?filter[status][eq]=draft&search=filter`);
    expect(byStatus.body.items.map((p: { sku: string }) => p.sku)).toEqual(['FLT-2']);
    const byPrice = await request(app.getHttpServer()).get(`${base}?filter[price][between]=10,20&search=flt`);
    expect(byPrice.body.items.map((p: { sku: string }) => p.sku)).toEqual(['FLT-1']);
    const bad = await request(app.getHttpServer()).get(`${base}?filter[sku][eq]=x`);
    expect(bad.status).toBe(422);
    expect(bad.body.fields).toEqual({ 'filter[sku][eq]': ['cannot filter by "sku"'] });
  });

  test('delete goes through the service, which refuses active products', async () => {
    const draft = (await post({ name: 'Doomed', sku: 'del-1', price: '1' })).body;
    expect((await request(app.getHttpServer()).delete(`${base}/${draft.id}`)).status).toBe(204);
    const active = (await post({ name: 'Keeper', sku: 'del-2', price: '1', stock: 1, status: 'active' })).body;
    const refused = await request(app.getHttpServer()).delete(`${base}/${active.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'CONFLICT', message: 'Active products cannot be deleted; archive them first' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run --filter @nest-my-admin/core build && bun test examples/demo-api`
Expected: FAIL — `status` default filter exists but `price`/`search=flt` on `sku` don't; deleting the active product returns 204.

- [ ] **Step 3: Implement**

`examples/demo-api/src/catalog/products.service.ts` — add after `update`:
```ts
  async remove(id: number): Promise<void> {
    const product = await this.products.findOneByOrFail({ id });
    if (product.status === 'active') throw new ConflictException('Active products cannot be deleted; archive them first');
    await this.products.remove(product);
  }
```

`examples/demo-api/src/catalog/product.admin.ts` (replace the whole file):
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

  list: ListConfig<Product> = {
    columns: ['id', 'name', 'sku', 'price', 'stock', 'status'],
    sort: '-id',
    pageSize: 20,
    filters: ['status', 'price', 'stock', 'releasedOn'],
    search: ['name', 'sku'],
  };
  form: FormConfig = { create: CreateProductDto, update: UpdateProductDto };

  create(dto: CreateProductDto, _ctx: AdminContext) {
    return this.products.create(dto);
  }

  update(id: RecordId, dto: UpdateProductDto, _ctx: AdminContext) {
    return this.products.update(Number(id), dto);
  }

  delete(id: RecordId, _ctx: AdminContext) {
    return this.products.remove(Number(id));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter @nest-my-admin/core build && bun test examples/demo-api && bun run --filter demo-api typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add examples/demo-api
git commit -m "feat(demo): filters, search and service-checked delete for products"
```

---

### Task 9: UI — filter bar, search, delete and keyboard-reachable rows

**Files:**
- Create: `packages/ui/src/lib/list-state.ts`, `packages/ui/src/app/filter-bar.tsx`
- Modify: `packages/ui/src/lib/api.ts`, `packages/ui/src/lib/queries.ts`, `packages/ui/src/lib/form-values.ts` (export one helper), `packages/ui/src/app/list-page.tsx`, `packages/ui/src/app/form-page.tsx`
- Test: `packages/ui/src/lib/list-state.test.ts` (new)

**Interfaces:**
- Consumes: `ResourceSchema.list.filters/search`, `FilterOperator` (Task 3); `DELETE` route (Task 6); `ApiError`, `describeError` (Task 1).
- Produces:
  - `listQueryFromUrl(params: URLSearchParams): string` — only `page`, `sort`, `search`, `filter[...]`, non-empty, `page` defaulted to 1, keys sorted (stable cache key).
  - `filterKey(field: string, operator: FilterOperator): string`, `hasActiveFilters(params): boolean`, `clearFilters(params): ParamChanges`, `withChanges(params, changes: ParamChanges): URLSearchParams` (drops `page` unless the change is to `page`); `type ParamChanges = Record<string, string | null>`.
  - `api.list(resource, query: URLSearchParams)`, `api.remove(resource, id)`; `useList(resource, query: string)`.
  - Accessibility hooks for E2E: a `Search` input (aria-label) + `Search` button; filter selects labelled by the field label (e.g. `Status`); a `Filters` toggle button on small screens; `Clear filters` button; on the edit page a `Delete` button that becomes `Confirm delete` + `Keep`; in the desktop table the first cell of each row is a link to the record.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/lib/list-state.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { clearFilters, filterKey, hasActiveFilters, listQueryFromUrl, withChanges } from './list-state';

describe('list state', () => {
  test('listQueryFromUrl keeps list params only, drops empties, defaults page and sorts keys', () => {
    const url = new URLSearchParams('sort=-id&foo=1&search=&filter%5Bstatus%5D%5Beq%5D=live');
    expect(listQueryFromUrl(url)).toBe('filter%5Bstatus%5D%5Beq%5D=live&page=1&sort=-id');
  });

  test('filterKey builds the bracket syntax', () => {
    expect(filterKey('price', 'gte')).toBe('filter[price][gte]');
  });

  test('withChanges resets the page unless the page itself changes', () => {
    const params = new URLSearchParams('page=3&sort=name');
    expect(withChanges(params, { search: 'lamp' }).toString()).toBe('sort=name&search=lamp');
    expect(withChanges(params, { page: '4' }).toString()).toBe('page=4&sort=name');
    expect(withChanges(new URLSearchParams('search=x&sort=name'), { search: null }).toString()).toBe('sort=name');
  });

  test('active filters and clearing them', () => {
    const params = new URLSearchParams('sort=name&search=x&filter%5Bstatus%5D%5Beq%5D=live');
    expect(hasActiveFilters(params)).toBe(true);
    expect(hasActiveFilters(new URLSearchParams('sort=name&page=2'))).toBe(false);
    expect(clearFilters(params)).toEqual({ search: null, 'filter[status][eq]': null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/ui/src/lib/list-state.test.ts`
Expected: FAIL — `./list-state` not found.

- [ ] **Step 3: Implement the pure helpers and API changes**

`packages/ui/src/lib/list-state.ts`:
```ts
import type { FilterOperator } from '@nest-my-admin/core/contract';

export type ParamChanges = Record<string, string | null>;

const isListKey = (key: string) => key === 'page' || key === 'sort' || key === 'search' || key.startsWith('filter[');

/** The API list query is the page URL's list parameters, passed through unchanged (spec §11 syntax). */
export function listQueryFromUrl(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of params) if (value !== '' && isListKey(key)) query.append(key, value);
  if (!query.has('page')) query.set('page', '1');
  query.sort();
  return query.toString();
}

export function filterKey(field: string, operator: FilterOperator): string {
  return `filter[${field}][${operator}]`;
}

export function hasActiveFilters(params: URLSearchParams): boolean {
  return [...params.keys()].some((key) => key === 'search' || key.startsWith('filter['));
}

export function clearFilters(params: URLSearchParams): ParamChanges {
  const changes: ParamChanges = {};
  for (const key of params.keys()) if (key === 'search' || key.startsWith('filter[')) changes[key] = null;
  return changes;
}

/** Applies changes; any change other than to `page` sends the user back to page 1. */
export function withChanges(params: URLSearchParams, changes: ParamChanges): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  if (Object.keys(changes).some((key) => key !== 'page')) next.delete('page');
  return next;
}
```

`packages/ui/src/lib/api.ts` — replace the `list` entry and add `remove`:
```ts
  list: (resource: string, query: URLSearchParams) => request<ListResponse>(`/resources/${enc(resource)}?${query}`),
  remove: (resource: string, id: string) => request<void>(`/resources/${enc(resource)}/${enc(id)}`, { method: 'DELETE' }),
```

`packages/ui/src/lib/queries.ts` — replace `useList`:
```ts
export const useList = (resource: string, query: string) =>
  useQuery({
    queryKey: ['list', resource, query],
    queryFn: () => api.list(resource, new URLSearchParams(query)),
    placeholderData: keepPreviousData,
  });
```

`packages/ui/src/lib/form-values.ts` — export the existing datetime helper (change `function toDatetimeLocal` to `export function toDatetimeLocal`).

Run: `bun test packages/ui/src/lib/list-state.test.ts` — Expected: PASS.

- [ ] **Step 4: Write the filter bar**

`packages/ui/src/app/filter-bar.tsx`:
```tsx
import { useEffect, useState, type KeyboardEvent } from 'react';
import type { FieldSchema, FilterOperator, ResourceSchema } from '@nest-my-admin/core/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toDatetimeLocal } from '@/lib/form-values';
import { clearFilters, filterKey, hasActiveFilters, type ParamChanges } from '@/lib/list-state';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  schema: ResourceSchema;
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
}

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';
const RANGE_TYPES = new Set(['number', 'decimal', 'bigint', 'date', 'datetime']);

export function FilterBar({ schema, params, onChange }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const urlSearch = params.get('search') ?? '';
  const [search, setSearch] = useState(urlSearch);
  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  const filters = schema.list.filters
    .map((filter) => ({ operators: filter.operators, field: schema.fields.find((field) => field.name === filter.field) }))
    .filter((entry): entry is { operators: FilterOperator[]; field: FieldSchema } => entry.field !== undefined);
  const searchable = schema.list.search.length > 0;
  if (filters.length === 0 && !searchable) return null;
  const searchLabels = schema.list.search.map((name) => schema.fields.find((field) => field.name === name)?.label ?? name);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex gap-2">
        {searchable && (
          <form
            role="search"
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              onChange({ search: search.trim() || null });
            }}
          >
            <Input aria-label="Search" placeholder={`Search ${searchLabels.join(', ').toLowerCase()}`} value={search} onChange={(event) => setSearch(event.target.value)} />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        )}
        {filters.length > 0 && (
          <Button type="button" variant="outline" className="md:hidden" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            Filters
          </Button>
        )}
      </div>
      {filters.length > 0 && (
        <div className={cn('gap-3 sm:grid-cols-2 lg:grid-cols-4', open ? 'grid' : 'hidden md:grid')}>
          {filters.map(({ field, operators }) => (
            <FilterControl key={field.name} field={field} operators={operators} params={params} onChange={onChange} />
          ))}
        </div>
      )}
      {hasActiveFilters(params) && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(clearFilters(params))}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}

interface FilterControlProps {
  field: FieldSchema;
  operators: FilterOperator[];
  params: URLSearchParams;
  onChange: (changes: ParamChanges) => void;
}

function FilterControl({ field, operators, params, onChange }: FilterControlProps) {
  const id = `filter-${field.name}`;

  if ((field.type === 'enum' || field.type === 'boolean') && operators.includes('eq')) {
    const key = filterKey(field.name, 'eq');
    const options: Array<[string, string]> =
      field.type === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : (field.enumValues ?? []).map((value) => [value, value]);
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>{field.label}</Label>
        <select id={id} className={selectClass} value={params.get(key) ?? ''} onChange={(event) => onChange({ [key]: event.target.value || null })}>
          <option value="">All</option>
          {options.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (RANGE_TYPES.has(field.type) && operators.includes('gte') && operators.includes('lte')) {
    const inputType = field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
    const toUrl = (value: string) => (field.type === 'datetime' && value ? new Date(value).toISOString() : value.trim());
    const fromUrl = (value: string | null) => (value && field.type === 'datetime' ? toDatetimeLocal(value) : (value ?? ''));
    return (
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{field.label}</legend>
        <div className="flex gap-2">
          {(['gte', 'lte'] as const).map((operator) => {
            const key = filterKey(field.name, operator);
            const inputId = `${id}-${operator}`;
            return (
              <div key={operator} className="flex flex-1 flex-col gap-1">
                <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                  {operator === 'gte' ? 'From' : 'To'}
                </Label>
                <CommitInput
                  id={inputId}
                  type={inputType}
                  inputMode={inputType === 'text' ? 'decimal' : undefined}
                  value={fromUrl(params.get(key))}
                  onCommit={(value) => onChange({ [key]: toUrl(value) || null })}
                />
              </div>
            );
          })}
        </div>
      </fieldset>
    );
  }

  const operator: FilterOperator | undefined = operators.includes('contains') ? 'contains' : operators.includes('eq') ? 'eq' : undefined;
  if (!operator) return null;
  const key = filterKey(field.name, operator);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{operator === 'contains' ? `${field.label} contains` : field.label}</Label>
      <CommitInput id={id} value={params.get(key) ?? ''} onCommit={(value) => onChange({ [key]: value.trim() || null })} />
    </div>
  );
}

interface CommitInputProps {
  id: string;
  value: string;
  type?: string;
  inputMode?: 'decimal';
  onCommit: (value: string) => void;
}

/** A text input that applies its value on Enter or blur, not on every keystroke. */
function CommitInput({ id, value, type = 'text', inputMode, onCommit }: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      id={id}
      type={type}
      inputMode={inputMode}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
```

- [ ] **Step 5: Update the list page**

`packages/ui/src/app/list-page.tsx` — make these changes:
1. Imports: add `import { FilterBar } from '@/app/filter-bar';`, `import { describeError } from '@/lib/api';`, `import { listQueryFromUrl, withChanges, type ParamChanges } from '@/lib/list-state';`.
2. Replace
```tsx
  const list = useList(resource, page, sortParam);
```
with
```tsx
  const list = useList(resource, listQueryFromUrl(searchParams));
```
3. Replace the `updateParams` function with:
```tsx
  function updateParams(changes: ParamChanges) {
    setSearchParams((previous) => withChanges(previous, changes));
  }
```
and change `toggleSort` to `updateParams({ sort: ascending ? `-${field}` : field });` (withChanges resets the page).
4. Render the filter bar right after the heading row, and describe list errors fully:
```tsx
      <FilterBar schema={s} params={searchParams} onChange={updateParams} />

      {list.isError && <PageMessage tone="error">{describeError(list.error)}</PageMessage>}
```
5. Make the first cell of each desktop row a real link (keyboard and screen-reader reachable); the row stays clickable for mouse users:
```tsx
            {items.map((item) => (
              <TableRow key={String(item[s.primaryKey])} className="cursor-pointer" onClick={() => navigate(recordPath(item))}>
                {columns.map((column, index) => (
                  <TableCell key={column.name}>
                    {index === 0 ? (
                      <Link to={recordPath(item)} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                        {formatCell(item[column.name], column)}
                      </Link>
                    ) : (
                      formatCell(item[column.name], column)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
```
6. Update the empty-state text for filtered lists: in both the table and the mobile list, replace `No records yet.` with `{hasActiveFilters(searchParams) ? 'No records match.' : 'No records yet.'}` (import `hasActiveFilters` from `@/lib/list-state`).

- [ ] **Step 6: Add delete to the edit form**

`packages/ui/src/app/form-page.tsx`:
1. Import `describeError` alongside `ApiError`: `import { ApiError, api, describeError } from '@/lib/api';`
2. Inside `RecordForm`, after the `save` mutation, add:
```tsx
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.remove(schema.name, id!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['list', schema.name] });
      navigate(`/${schema.name}`);
      queryClient.removeQueries({ queryKey: ['record', schema.name, id] });
    },
    onError: (error) => {
      setConfirmingDelete(false);
      setFormError(describeError(error));
    },
  });
```
3. In the button row, after the `Cancel` button, add:
```tsx
        {mode === 'edit' &&
          (confirmingDelete ? (
            <div className="ms-auto flex gap-2">
              <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {remove.isPending ? 'Deleting…' : 'Confirm delete'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" className="ms-auto" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          ))}
```
4. In the `save` mutation's `onSuccess`, move `queryClient.removeQueries(...)` after `navigate(...)` (removing a query while its observer is still mounted refetches it for nothing).

- [ ] **Step 7: Verify**

Run: `bun test packages/ui && bun run --filter @nest-my-admin/ui typecheck && bun run build`
Expected: tests pass, no type errors, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): filter bar, search, delete with confirmation and keyboard-reachable rows"
```

---

### Task 10: End-to-end coverage and documentation

**Files:**
- Modify: `examples/demo-api/e2e/products.pw.ts`, `README.md`, `CLAUDE.md`, `docs/superpowers/plans/m0-followups.md`

**Interfaces:**
- Consumes: the UI hooks from Task 9, the demo from Task 8.

- [ ] **Step 1: Add the E2E tests**

In `examples/demo-api/e2e/products.pw.ts`:
1. In the test `deep link refresh works and errors are shown where they belong`, after the `must be a number` assertion, add a server-side validation check (restores M0 coverage of server field errors):
```ts
  await page.getByLabel('Price').fill('1.234'); // valid number, but the DTO allows 2 decimals
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#field-price-error')).toContainText('decimal');
```
2. Append:
```ts
test('filters and search narrow the list', async ({ page, isMobile }) => {
  await page.goto('/admin/product');
  if (isMobile) await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByLabel('Status').selectOption('draft');
  await expect(page).toHaveURL(/filter%5Bstatus%5D%5Beq%5D=draft/);
  await expect(page.getByText('DEMO-3', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Search').fill('notebook');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('DEMO-2', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('DEMO-1', { exact: true }).filter({ visible: true })).toHaveCount(0);
});

test('deletes a draft product and refuses to delete an active one', async ({ page }, testInfo) => {
  const sku = `DEL-${testInfo.project.name.toUpperCase()}`;
  await page.goto('/admin/product/new');
  await page.getByLabel('Name').fill('Short-lived');
  await page.getByLabel('Sku').fill(sku);
  await page.getByLabel('Price').fill('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);

  await page.getByText(sku, { exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page).toHaveURL(/\/admin\/product$/);
  await expect(page.getByText(sku, { exact: true }).filter({ visible: true })).toHaveCount(0);

  await page.getByText('DEMO-1', { exact: true }).filter({ visible: true }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Confirm delete' }).click();
  await expect(page.getByRole('alert')).toContainText('Active products cannot be deleted');
});

test('table rows can be opened with the keyboard', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop table is hidden on small screens (cards are links already)');
  await page.goto('/admin/product');
  const firstLink = page.getByRole('row').nth(1).getByRole('link');
  await firstLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/product\/\d+$/);
});
```

- [ ] **Step 2: Run the suite**

Run: `PW_CHANNEL=chrome bun run e2e`
Expected: `11 passed, 1 skipped` (6 tests × 2 projects; the keyboard test skips on mobile). Leave no server running on port 3310.

- [ ] **Step 3: Update the docs**

`README.md` — after the code example, add:
````markdown
Lists support filters and search with a URL syntax you can bookmark:

```
/admin/api/resources/product?search=lamp&filter[status][eq]=active&filter[price][between]=10,20&sort=-price
```

Operators: `eq ne in nin lt lte gt gte between contains startsWith isNull`. Choose filterable and searchable
fields with `list: { filters: [...], search: [...] }`; hooks (`@BeforeSave`, `@AfterSave`, `@BeforeDelete`) run
in the default create/update/delete, and `AdminModule.forRoot({ autoRegister: true })` exposes every entity
without a resource.
````

`CLAUDE.md` — in the Architecture section, after the "Writes:" bullet, add:
```markdown
- Lists: `parseListQuery` turns `filter[field][op]=value` / `search=` into `FilterCondition`s using only the schema's allow-lists (`list.filters`, `list.search`, `list.sortable`); `applyListParams` puts them on a TypeORM `SelectQueryBuilder` (LIKE escaped with `!`, primary key as sort tie-breaker). Resources override `findMany` and extend `this.buildListQuery(params)` to add restrictions.
- Hooks (`@BeforeSave/@AfterSave/@BeforeDelete`) run only in `AdminResourceBase`'s default create/update/delete; resources that override those methods call their own services instead.
```

`docs/superpowers/plans/m0-followups.md` — delete these lines (done in M1a):
- `- Desktop list rows are not keyboard-reachable (list-page.tsx): render the first cell as a Link.`
- `- Add UNAUTHENTICATED to AdminErrorCode before auth lands (401 currently maps to FORBIDDEN).`
- `- Backstop 500 in admin-http.server.ts has no body/correlationId; form doesn't show correlationId for INTERNAL.`
- `- isolation.test.ts covers guard + prefix only; add global interceptor/filter/pipe cases (D12).`
- the `- Final: minor (deferred to M1): ...` line.
and add under "Promoted by the final review":
```markdown
- (from M1a) Count modes (`exact | estimate | none`) and keyset pagination (spec §11) are driver-specific: do them in M1c with the database matrix.
- (from M1a) Persian/Arabic search normalization (spec §12) belongs with i18n in M2.
```

- [ ] **Step 4: Full verification**

Run: `bun run test && bun run typecheck && bun run pack:smoke && PW_CHANNEL=chrome bun run e2e`
Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add examples/demo-api/e2e README.md CLAUDE.md docs/superpowers/plans/m0-followups.md
git commit -m "test(e2e): filters, search, delete and keyboard access; document the list query syntax"
```

---

## Out of scope for M1a (planned elsewhere)

- **M1b:** DTO → form compiler (min/max/pattern/nested from class-validator), transactions with `ctx.manager`, `AdminContext.current()` via AsyncLocalStorage, `errorMapper`.
- **M1c:** relations (FK columns, relation pickers, `relationOptions`, `customer.name` paths in columns/filters/search), embedded columns, inheritance, composite keys, `@VersionColumn` 409, soft delete, multiple DataSources, count modes and keyset pagination, Nest 11 / TypeORM 0.3 / CommonJS consumer matrix.
- **M2:** i18n/RTL, Persian search normalization, full shadcn sidebar, theming, record route for a string key literally named `new`.
