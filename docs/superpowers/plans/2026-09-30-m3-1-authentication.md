# M3-1 — Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The admin knows who is using it:
- a pluggable `AdminAuthAdapter`;
- the built-in `@nest-my-admin/auth`: admin users in `nma_user`, scrypt password hashes, opaque hashed sessions in `nma_session`, CSRF tokens, lockout and rate limiting, session list and "log out everywhere", password change, and a bootstrap superuser;
- a login page, a user menu and an account page in the UI;
- `ctx.user` in every resource method.

**Architecture:**
- **Core owns the contract, the adapter owns the users.** `AdminModuleOptions.auth` takes one of:
  - `AdminAuth.custom(MyAdapter)`: a provider of the host app, looked up through `ModuleRef`;
  - `builtinAuth({ … })` from `@nest-my-admin/auth`: a factory that receives the `ModuleRef`;
  - `AdminAuth.none()`: explicitly open, for local tools.
- **Without `auth`:**
  - the admin stays open and logs a warning at boot, as today;
  - with `NODE_ENV=production` that is a boot error, so an unauthenticated admin never ships by accident.
- **Adapter contract:**

  ```ts
  interface AdminAuthAdapter {
    authenticate(req): Promise<AdminPrincipal | null>;                  // { user, csrfToken?, sessionId? }
    login?(input: { username; password }, io: { req; res }): Promise<AdminPrincipal>;  // sets its own cookie
    logout?(principal, io): Promise<void>;
    listSessions?(principal); revokeSession?(principal, id); revokeOtherSessions?(principal);
    changePassword?(principal, { current, next }, io);
  }
  ```

  `AdminUser` is `{ id, displayName, username?, email?, isSuperuser }`.
- **Request flow.**
  - Every `/api/*` request except `GET`/`POST /api/session` is authenticated first. No principal → 401 `UNAUTHENTICATED`.
  - A principal with a `csrfToken` must send it back as `X-CSRF-Token` on POST, PATCH and DELETE (403 `FORBIDDEN` otherwise). Session auth needs it; token-header adapters leave it out.
  - `ctx.user` is set before the route runs, so `AdminContext.current().user` works in host services.
- **Session API.**
  - `GET /api/session`: `{ user, csrfToken }`, or 401 with `{ loginAvailable }`.
  - `POST /api/session`: log in.
  - `DELETE /api/session`: log out.
  - `/api/account/*`: sessions list and revoke, "log out everywhere", password change. A route whose adapter method is missing answers 404, and the capabilities are listed in `GET /api/session`.
- **Built-in adapter** (`packages/auth`), on the host's DataSource:
  - Entities are exported as `ADMIN_AUTH_ENTITIES`; a DataSource without them is a boot error.
  - Passwords:
    - `scrypt` from `node:crypto` (no native dependency), stored as `scrypt$N$r$p$salt$hash`;
    - policy: at least 10 characters and not the username;
    - compared in constant time, and against a dummy hash for unknown users so timing does not tell which usernames exist.
  - Sessions: 32 random bytes, of which only the SHA-256 is stored.
    - Sliding idle expiry (12 h) and an absolute limit (30 days).
    - The cookie `nma_session` is HttpOnly and SameSite=Lax, with Path set to the admin path and Secure on https (or when `cookie.secure` is `true`).
    - Each session has its own CSRF token.
  - Lockout: 5 failed passwords lock the account for 15 minutes.
  - Rate limiting: 20 login attempts per minute per IP (in memory).
  - The login error message is the same for unknown users, bad passwords and locked accounts; the lockout is visible only to the user through the retry wait.
  - Password change revokes the user's other sessions.
  - `bootstrapSuperuser: { username, password }` creates the first superuser when `nma_user` is empty.
- **UI.**
  - `/login` sits outside the shell. Any 401 goes to `/login?next=…`.
  - The API client sends `X-CSRF-Token`.
  - A user menu in the header (name, Account, Log out).
  - `/account`: change password, sessions with "this device", revoke, and log out everywhere.

**Deferred:**
- TOTP 2FA and recovery codes, with the Users page: M3-3.
- Permissions: M3-2.
- The configurable table prefix: M3-3, with the RBAC tables.
- The `nma createsuperuser` CLI (M5); `bootstrapSuperuser` and `createAdminUser(dataSource, …)` cover it until then.

**Spec:** D3, D7, §4 (request pipeline: auth guard first), §5.5 (`ctx.user`), §7 (adapter interface; opaque hashed sessions; HttpOnly/Secure/SameSite; CSRF header; rate limiting and lockout; session list and log out everywhere). Plan 1 of 4 for M3.

## Global Constraints

- All earlier constraints apply (exact pins, logical utilities, every string in `en` and `fa`, the error contract, per-app test databases, no AI attribution).
- **No native dependencies.** Hashing is `node:crypto` `scrypt` on Node and Bun.
- **Secrets never leave the server.** No password hash, session token hash or other user's CSRF token in any response or log. Tokens are compared with `timingSafeEqual`.
- **Existing hosts keep working.** Without `auth` (outside production) every existing test and example runs unchanged.

## Review Focus

1. **No way in without a session.** Every API route except the session endpoints answers 401 when not signed in, including resources, meta, search and options. UI assets stay public (the login page needs them).
2. **CSRF.** A cookie-authenticated POST, PATCH or DELETE without the right `X-CSRF-Token` is refused before it touches anything, including logout and the account routes.
3. **Session hygiene.**
   - Tokens are stored hashed. Logout, revoke, idle expiry and absolute expiry each end a session for good.
   - A password change ends the other sessions.
   - The cookie flags are right on http and https.
4. **Enumeration and brute force.** Unknown user, wrong password and locked account look the same (message and timing); lockout and IP rate limiting hold.

## File Structure

```
packages/core/src/
  auth/auth-adapter.ts                     (AdminAuthAdapter, AdminUser, AdminPrincipal, AdminAuth.custom/none)
  auth/auth.service.ts (+ test)            (resolves the adapter at boot; authenticate + CSRF per request)
  http/admin-http.server.ts                (auth before routes; /api/session, /api/account/*)
  http/cookies.ts (+ test)                 (parse / serialize cookies)
  resource/admin-context.ts                (ctx.user)
  options.ts                               (auth option; production guard)
  contract.ts                              (SessionResponse, AccountSession, MetaResponse.user)
packages/core/test/auth.test.ts            (fake adapter: 401s, CSRF, ctx.user, capabilities)
packages/auth/                             (@nest-my-admin/auth)
  src/entities.ts · src/password.ts (+ test) · src/sessions.ts · src/builtin-auth.ts · src/rate-limit.ts (+ test) · src/index.ts
  test/builtin-auth.test.ts                (every database: login, cookie, expiry, lockout, revoke, password change)
packages/ui/src/
  lib/api.ts (CSRF header, 401 → login) · app/login-page.tsx · app/account-page.tsx · app/user-menu.tsx · main.tsx routes
examples/demo-api                          (builtinAuth with a bootstrap superuser; tests log in)
examples/demo-api/e2e                      (login once per project via storageState; login/logout/account E2E)
scripts/pack-smoke.ts                      (packs auth too; a login round trip on node and bun)
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Core — adapter contract, request authentication, CSRF, session routes

- [ ] **Tests first** (`auth.test.ts`, with a fake adapter, every database):
  - Review Focus 1 over every route family;
  - Review Focus 2 for resource writes, logout and account routes;
  - `ctx.user` and `AdminContext.current().user` inside a resource method;
  - `GET /api/session` gives the user, CSRF token and capabilities;
  - account routes 404 when the adapter lacks the method;
  - `AdminAuth.none()` is open;
  - no `auth` under `NODE_ENV=production` is a boot error;
  - an adapter that throws is a 500 with a correlation id, never a 200.
  - `cookies.test.ts`: parse and serialize, attribute escaping.
- [ ] **Implement** as in Architecture.
- [ ] **Verify** on all three databases, then commit `feat: authentication adapter contract, sessions API and CSRF`.

### Task 2: `@nest-my-admin/auth`

- [ ] **Tests first:**
  - `password.test.ts`: hash and verify round trip, format, wrong password, tampered hash, policy.
  - `rate-limit.test.ts`: window and reset.
  - `builtin-auth.test.ts` (every database):
    - login sets a cookie with the right flags (Secure only on https) and stores only the token hash;
    - wrong password, unknown user and locked account all give the same 401 message;
    - the 6th attempt is locked out even with the right password, and unlocks after the window (clock injected);
    - the IP limit gives 429;
    - idle and absolute expiry;
    - logout, revoke and log out everywhere;
    - password change revokes the other sessions and checks the policy;
    - bootstrap superuser only on an empty table;
    - a missing entity is a boot error.
- [ ] **Implement** as in Architecture. Workspace package with `exports` of `dist/`, built by `tsc`, in `typecheck`, `test` and `build`.
- [ ] **Verify** on all three databases, then commit `feat(auth): built-in admin users, sessions, lockout and rate limiting`.

### Task 3: UI — login, 401 handling, user menu, account page

- [ ] **Implement:**
  - the login page (username, password, errors, `next` kept, both languages);
  - the API client: CSRF header, and 401 → `/login?next=`;
  - the user menu;
  - the account page: password change with the policy's errors, the sessions table (this device, last seen, revoke), log out everywhere.
- [ ] **Verify**, then commit `feat(ui): login page, user menu and account page`.

### Task 4: Demo, E2E, packaging, docs

- [ ] **Demo:**
  - `builtinAuth({ bootstrapSuperuser: { username: 'admin', password: env or 'admin-demo-pass' } })`;
  - the integration tests log in through a supertest agent with CSRF.
- [ ] **E2E:**
  - a setup project logs in and saves `storageState`, which every project reuses;
  - API helpers send the CSRF token;
  - new tests: a wrong password shows the error; after login you land on `next`; logout sends you to login and the API answers 401; the account page changes the password and revokes another session (a second browser context is logged out).
- [ ] **Packaging:** pack:smoke packs `@nest-my-admin/auth` too and logs in on node and bun. `compat` runs the auth tests too.
- [ ] **Docs:** README (authentication: built-in, custom adapter, none; production guard; cookies and CSRF), CLAUDE.md, m0-followups.
- [ ] **Verify everything** (typecheck, three databases, compat, pack:smoke, e2e, e2e:screens with updated baselines), then commit `feat(demo): sign-in; E2E and packaging for @nest-my-admin/auth; docs`.

## After this plan

M3-2: the policy engine: permission codes, roles/groups/memberships tables, entity, field, row and record rules, meta filtering, anti-oracle, and 404 for out-of-scope records.
