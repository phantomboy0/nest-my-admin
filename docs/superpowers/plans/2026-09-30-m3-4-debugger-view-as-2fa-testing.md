# M3-4 — Permission Debugger, View-as, 2FA and Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M3 is finished and v0.1 can be adopted (D11):
- a **permission debugger** that explains why a user may or may not do something (spec §6.7);
- **view-as** for superusers, read-only (spec §6.5);
- **TOTP two-factor sign-in** with recovery codes in `@nest-my-admin/auth` (spec §7);
- **`@nest-my-admin/testing`** for host apps (spec §13.3): `admin.as(user).list(...)`, and `expectNoLeaks` crawling everything a user can reach.

**Architecture:**
- **Debugger.**
  - `GET /api/rbac/explain?user=&resource=&record=` (needs `rbac.view`) answers, for every operation and field at once, with:
    - the user's roles and where each comes from (direct, a group, `resolveRoles`);
    - for the operation, which role grants it through which pattern;
    - per field, each role's level and the result (with `restricted`);
    - per scoped operation, each role's scopes and the result;
    - for a record: in scope or not, `@AdminCan` answers, and the final `_perm`.
  - `AdminPolicy.explain()` builds it from the same `EffectivePermissions` code paths, with no second implementation.
  - The UI page `/-/debugger` picks a user, a resource, an operation and optionally a field or record id.
- **View-as.**
  - A superuser sends `X-View-As: <userId>`. The request then runs with that user's identity and permissions (`ctx.user`, `ctx.permissions`), and `ctx.viewAs = { by }` is set.
  - Every POST/PATCH/DELETE (except `DELETE /api/session`) is refused with 403 while viewing as.
  - Each start is logged with both ids; the audit log arrives in M4.
  - The UI has "View as" on the user page, a banner ("Viewing as Ada — read-only · Stop") that is kept per tab (sessionStorage), and all write controls hidden.
- **2FA** (built-in adapter):
  - TOTP per RFC 6238: SHA-1, 30 s, 6 digits, ±1 step. A code is never accepted twice (last used step stored).
  - The secret is stored encrypted with AES-256-GCM when `builtinAuth({ secretKey })` is given (32+ bytes, base64); otherwise it is stored plain and a warning is logged when someone sets 2FA up.
  - 10 recovery codes, stored as SHA-256 hashes, each usable once.
  - Sign-in with 2FA on: the password step answers 401 `TWO_FACTOR_REQUIRED` (no session) until the same request carries `otp` (a code or a recovery code). A wrong code counts toward the lockout.
  - Account page: setup (a QR code of the `otpauth://` URL through the `qrcode-generator` dev dependency bundled in the UI, plus the secret for manual entry), then confirm with a code (recovery codes shown once), then disable with the password.
  - Adapter capability `twoFactor`.
- **Testing** (`packages/testing`, `@nest-my-admin/testing`):

  ```ts
  const admin = await createAdminTestingModule({ imports: [AppModule] });
  const operator = admin.as({ id: 'u7', roles: ['operator'] });
  await operator.list('order', { search: 'x' });  // also get, create, update, delete, meta, schema, search, options
  await admin.expectNoLeaks('employee', { as: { id: 'u7', roles: ['operator'] } });
  ```

  - It runs through `AdminApiService` with a context built like a request (`@nest-my-admin/core/internal`, documented as for the testing package only), so it exercises the same enforcement without HTTP or a sign-in.
  - `expectNoLeaks`:
    - reads, as a superuser, the hidden field values and out-of-scope rows for this user;
    - then crawls, as the user, meta, schema, every list page (up to a limit), each visible record, each out-of-scope id (it must be 404), search with hidden values, and relation options;
    - fails with a report of every hidden value or out-of-scope record found.

**Deferred:** a configurable `nma_` table prefix (entity names are decorator-time constants; a runtime-generated entity factory is a larger change than v0.1 needs), and the audit log of view-as (M4).

**Spec:** §6.5 (view-as read-only and audited), §6.7 (debugger), §7 (TOTP 2FA, recovery codes), §13.3 (`@nest-my-admin/testing`), D11 (v0.1 adopted in a real project). Plan 4 of 4 for M3.

## Global Constraints

- All earlier constraints apply.
- **View-as cannot write**, whatever the route.
- **2FA secrets and codes never leave the server** after setup: no secret in any later response or log, and recovery codes only once.
- **The testing package never ships an auth bypass.** It builds contexts in-process, and `@nest-my-admin/core/internal` is not mounted on HTTP.

## Review Focus

1. **The debugger tells the truth.** For random role combinations, its final answers equal what the API enforces (a property test over the policy fixtures).
2. **View-as** is superuser-only, read-only, and exactly the target's view (the crawl as target equals the crawl through view-as).
3. **2FA:**
   - no session without the second factor;
   - replayed codes and used recovery codes are refused;
   - wrong codes count toward the lockout;
   - disabling needs the password.
4. **`expectNoLeaks` finds leaks.** It passes on the policy fixtures and fails on a deliberately leaky resource.

## File Structure

```
packages/core/src/policy/explain.ts (+ test)       (AdminPolicy.explain)
packages/core/src/rbac/rbac-routes.ts              (+ /api/rbac/explain)
packages/core/src/http/admin-http.server.ts        (X-View-As; read-only guard)
packages/core/src/internal.ts                      (exports for @nest-my-admin/testing; package.json "./internal")
packages/auth/src/totp.ts (+ test) · src/secret-box.ts (+ test) · builtin-auth.ts (2FA)
packages/testing/                                  (@nest-my-admin/testing: createAdminTestingModule, as(), expectNoLeaks; tests)
packages/ui/src/app/admin/debugger-page.tsx · view-as banner · login OTP step · account 2FA section
examples/demo-api                                  (secretKey from env; E2E: debugger, view-as, 2FA)
README.md · CLAUDE.md · m0-followups.md · versions 0.1.0
```

---

### Task 1: Debugger and view-as (core)

- [x] **Tests first:**
  - `explain.test.ts` (Review Focus 1: random roles vs `EffectivePermissions`, and against the API on the policy fixture);
  - `view-as.test.ts`: superuser only, reads as the target, 403 on writes, the logout exception.
- [x] **Implement.**
- [x] **Verify**, then commit `feat: permission debugger and read-only view-as`.

### Task 2: TOTP 2FA in `@nest-my-admin/auth`

- [x] **Tests first:**
  - `totp.test.ts`: RFC 6238 vectors, window, base32;
  - `secret-box.test.ts`;
  - `builtin-auth.test.ts` 2FA flow (Review Focus 3), on every database.
- [x] **Implement:** adapter methods and the core routes `/api/account/2fa/*`.
- [x] **Verify**, then commit `feat(auth): TOTP two-factor sign-in with recovery codes`.

### Task 3: `@nest-my-admin/testing`

- [x] **Tests first:** `as()` round trips; `expectNoLeaks` passes on a clean fixture and fails (with a readable report) on a leaky one.
- [x] **Implement:** the package (build, typecheck, test in root scripts; packed in pack:smoke).
- [x] **Verify**, then commit `feat(testing): admin testing module with a leak crawler`.

### Task 4: UI, demo, E2E, docs, v0.1

- [x] **UI:**
  - the debugger page;
  - "View as" on user pages, the banner, and write controls hidden;
  - the login OTP step;
  - the account 2FA section (QR, confirm, recovery codes, disable).
- [x] **E2E:**
  - the debugger explains the editor's price;
  - view-as the editor, then stop;
  - enable 2FA for a user, sign in with a code, sign in with a recovery code, disable.
- [x] **Docs:** README (debugger, view-as, 2FA, testing), CLAUDE.md, m0-followups. Package versions 0.1.0.
- [x] **Verify everything**, then commit `feat: v0.1 — debugger, view-as and 2FA in the UI; E2E; docs`.

## After this plan

v0.1 is adopted in a real project (D11). M4: actions (incl. async), inlines, jobs, storage/uploads, audit log, events.
