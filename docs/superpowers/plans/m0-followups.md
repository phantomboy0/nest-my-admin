# M0 follow-ups for the M1 plan

Deferred findings from the M0 per-task and final reviews (see git history for context).

## Promoted by the final review (do early in M1)
- Error contract for body-parser/host errors is in place; keep it covered as M1 adds routes.
- Desktop list rows are not keyboard-reachable (list-page.tsx): render the first cell as a Link.
- Add UNAUTHENTICATED to AdminErrorCode before auth lands (401 currently maps to FORBIDDEN).
- Backstop 500 in admin-http.server.ts has no body/correlationId; form doesn't show correlationId for INTERNAL.
- Record with string primary key "new" is shadowed by the :resource/new route.
- pack-smoke only proves an ESM consumer: add a CJS consumer with the Nest 11 / TypeORM 0.3 matrix.
- isolation.test.ts covers guard + prefix only; add global interceptor/filter/pipe cases (D12).

## Deferred minors
- Task 3: minor (deferred): @ValidateIf treated as optional → dtoOnlyField nullable; no tests for isDeleteDate/Array/simple-array mapping
- Task 4: minor (deferred): no tests for list.sort failure / pageSize bounds / '-name' / separate update DTO; empty list.columns accepted; #private vs Proxy
- Tasks 5+6: minor (deferred): toFixed rounds/exponent for over-scale numbers (comment says never rounded); huge page → unsafe int; bigint id not format-checked ('abc' may 500); '-0' id; partial ignores nested DTOs
- Task 7: minor (deferred): path regex allows '..'/'//' segments; group key collisions first-wins silently; test asserts message not class; failed-init apps not closed in helper
- Tasks 8+9: minor (deferred): case-insensitive FS /INDEX.HTML served raw; symlinks followed out of dist; traversal test file doesn't exist; router params on plain {}; 401→FORBIDDEN, 413/429→BUSINESS_RULE; duplicate statSync
- Tasks 8+9: minor (deferred): "vanishing file" test hits pre-existing /assets 404 branch, not sendFile's statSync catch (untested); test servers not closed in finally; uncaughtError check may be early
- Task 10: minor (deferred): this.ui! assertion; no test for headersSent branch
- Task 10: minor (deferred): /admin// test accepts 200|404 (loose); backstop 500 has no body
- Task 11: minor (deferred): globals.css packs several declarations per line; Number('0x10')/'1e3' accepted in toPayload
- Task 12: minor (deferred): ProductAdmin Number(id) NaN path untested (update of garbage id); releasedOn untested
- Task 13: minor (deferred): desktop table rows not keyboard-reachable (tr onClick, brief-mandated); removeQueries while record observer mounted; PageMessage error + form alert both role=alert (not simultaneous today)
- Task 14: minor (deferred → carried to Task 16): document PW_CHANNEL in README/CLAUDE.md
- Task 15: minor (deferred): tarball lookup uses `!` not assert; hardcoded ports 4311/4312; asset regex tied to Vite output
- Task 16: minor (deferred): docs phrase e2e as `PW_CHANNEL=chrome bun run e2e` — reads as required, is optional
- Final: minor (deferred to M1): e2e no longer covers server-side field errors (use price 1.234); host 401/403 under /admin mapped to BAD_REQUEST by new error middleware
