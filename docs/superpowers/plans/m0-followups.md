# M0 follow-ups for the M1 plan

Deferred findings from the M0 per-task and final reviews (see git history for context).

## Promoted by the final review (do early in M1)
- Error contract for body-parser/host errors is in place; keep it covered as M1 adds routes.
- Record with string primary key "new" is shadowed by the :resource/new route.
- pack-smoke only proves an ESM consumer: add a CJS consumer with the Nest 11 / TypeORM 0.3 matrix.
- (from M1a) Count modes (`exact | estimate | none`) and keyset pagination (spec §11) are driver-specific: do them in M1c with the database matrix.
- (from M1a) Persian/Arabic search normalization (spec §12) belongs with i18n in M2.

## Deferred minors
- Task 3: minor (deferred): @ValidateIf treated as optional → dtoOnlyField nullable; no tests for isDeleteDate/Array/simple-array mapping
- Task 4: minor (deferred): no tests for list.sort failure / pageSize bounds / '-name' / separate update DTO; empty list.columns accepted; #private vs Proxy
- Tasks 5+6: minor (deferred): toFixed rounds/exponent for over-scale numbers (comment says never rounded); huge page → unsafe int; bigint id not format-checked ('abc' may 500); '-0' id; partial ignores nested DTOs
- Task 7: minor (deferred): path regex allows '..'/'//' segments; group key collisions first-wins silently; test asserts message not class; failed-init apps not closed in helper
- Tasks 8+9: minor (deferred): case-insensitive FS /INDEX.HTML served raw; symlinks followed out of dist; traversal test file doesn't exist; router params on plain {}; 429→BUSINESS_RULE; duplicate statSync
- Tasks 8+9: minor (deferred): "vanishing file" test hits pre-existing /assets 404 branch, not sendFile's statSync catch (untested); test servers not closed in finally; uncaughtError check may be early
- Task 10: minor (deferred): this.ui! assertion; no test for headersSent branch
- Task 10: minor (deferred): /admin// test accepts 200|404 (loose)
- Task 11: minor (deferred): globals.css packs several declarations per line; Number('0x10')/'1e3' accepted in toPayload
- Task 12: minor (deferred): ProductAdmin Number(id) NaN path untested (update of garbage id); releasedOn untested
- Task 13: minor (deferred): removeQueries while record observer mounted; PageMessage error + form alert both role=alert (not simultaneous today)
- Task 14: minor (deferred → carried to Task 16): document PW_CHANNEL in README/CLAUDE.md
- Task 15: minor (deferred): tarball lookup uses `!` not assert; hardcoded ports 4311/4312; asset regex tied to Vite output
- Task 16: minor (deferred): docs phrase e2e as `PW_CHANNEL=chrome bun run e2e` — reads as required, is optional

## M1a follow-ups
- -> M3 (blocker there): method-override middleware can turn a CORS-simple form POST into DELETE and bypass the JSON content-type CSRF check; use req.originalMethod when auth lands.
- -> M1c: run the suite on Postgres/MySQL; non-_2 MySQL FK codes; FK-on-delete e2e.
- -> M1c: FK violation on insert/update should be a VALIDATION field error on the FK field.
- -> M1c: CONFLICT needs a way to distinguish @VersionColumn conflicts (spec §11 diff dialog).
- -> M1c/M3: spec §5.2 names a `query(qb, ctx)` hook called by the default findMany; M1a shipped `buildListQuery` (override findMany) instead. Decide in M1c/M3 (row scopes) and make restrictions apply to findOne too.
- -> M2: Unicode case folding on SQLite with §12 normalization.
- -> M2: Save and Confirm delete are not mutually disabled.
- -> M2: datetime "To" filter uses lte at minute precision.
- -> M2: free-text numeric filter inputs.
- -> M2: duplicate list.filters entries (reject at boot).
- Hooks are skipped when create/update/delete is overridden (by design): consider a boot warning.
