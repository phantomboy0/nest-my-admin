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
bun run e2e                                     # build + Playwright on examples/demo-api (desktop + mobile); needs `bunx playwright install chromium` once (or, if that download is blocked, `PW_CHANNEL=chrome bun run e2e` to use installed Chrome)
bun run pack:smoke                              # pack core+ui, npm-install into a temp app, boot on node and bun
cd examples/demo-api && bun src/main.ts         # demo at http://localhost:3000/admin
cd packages/ui && bun run dev                   # UI dev server :5173, proxies /admin/api to :3000
```

## Architecture

- `packages/core` (ESM Nest library). `ResourceRegistry` discovers `@AdminResource` providers via `DiscoveryService` in `onModuleInit`, attaches the TypeORM repository, and builds a `ResourceSchema` with `buildResourceSchema` (TypeORM column metadata + class-validator DTO metadata). The sidebar group of a resource is the Nest module that provides it (`@AdminGroup` customises it).
- The admin HTTP surface is **not** Nest controllers: `AdminHttpServer` mounts one handler on the Express adapter at `path` (spec D12), so host guards, interceptors, pipes, filters and `setGlobalPrefix` never affect it. `/api/*` goes through the package's own `Router` → `AdminApiService` → resource methods; everything else is served by `UiAssets` (SPA fallback, `<base href>` + JSON config (`<script type="application/json" id="nma-config">`) injected into `index.html`).
- Writes: `validateWrite` (DTO whitelist + class-validator) → the resource's `create`/`update`, which host apps override to call their services (spec D2). Errors always leave through `toErrorResponse` as `{ code, message, fields?, correlationId }`; TypeORM unique/not-null violations are mapped to field errors.
- `packages/core/src/contract.ts` is the JSON contract with the UI. It is types only; the UI imports it from source through a tsconfig path.
- `packages/ui` is a Vite + React + shadcn SPA published as static `dist/` only (all its deps are devDependencies). The shadcn primitives and theme tokens were copied from crm-next (`radix-nova`, neutral).
- `examples/demo-api` is the reference host app used by integration and E2E tests. It imports `@nest-my-admin/core` through the package `exports` (the built `dist/`), so run `bun run build` (or `bun run --filter @nest-my-admin/core build`) after changing core; the root `test`, `typecheck` and `e2e` scripts do this for you.

## Conventions

- Relative imports in `packages/core` use `.js` extensions (NodeNext ESM).
- `decimal` and `bigint` values are always strings in API responses (`serializeValue`); drivers disagree, so never rely on the driver.
- Playwright files end in `.pw.ts`; Bun's test runner would otherwise pick up `*.spec.ts`.
- New UI inputs for numbers use `type="text"` with `inputMode`, not `type="number"`.
- In Bun 1.4.2, `expect(obj).toMatchObject({ x: expect.any(...) })` overwrites `obj.x` with the matcher — read values you need before such assertions.
