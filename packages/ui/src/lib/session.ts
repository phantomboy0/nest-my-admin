/**
 * The signed-in session outside React: the CSRF token the API client sends with every write, and what to do when
 * the server says the session is gone (401 on anything but the session endpoints).
 */
let csrfToken: string | undefined;
let onSignedOut: (() => void) | undefined;

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export function currentCsrfToken(): string | undefined {
  return csrfToken;
}

export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler;
}

export function signedOut(): void {
  csrfToken = undefined;
  onSignedOut?.();
}

/**
 * A browser path as the router knows it: without the admin's base path (`/admin/category` → `/category`). The data
 * router's own location keeps the base, and a `next` that kept it would land on `/admin/admin/…` after signing in.
 */
export function routerPath(pathname: string, basePath: string): string {
  const base = basePath.replace(/\/+$/, '');
  if (base === '' || (pathname !== base && !pathname.startsWith(`${base}/`))) return pathname;
  return pathname.slice(base.length) || '/';
}

/** Where to go after signing in: a path inside the admin, never another site (`//evil`, `https:`) nor the login page. */
export function safeNext(next: string | null | undefined, basePath = ''): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  const path = routerPath(next, basePath);
  return path.startsWith('/login') ? '/' : path;
}

const VIEW_AS_KEY = 'nma-view-as';

/** The user a superuser is viewing the admin as (this tab only), sent as `X-View-As`. */
export function viewingAs(): string | undefined {
  try {
    return sessionStorage.getItem(VIEW_AS_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setViewingAs(id: string | undefined): void {
  try {
    if (id === undefined) sessionStorage.removeItem(VIEW_AS_KEY);
    else sessionStorage.setItem(VIEW_AS_KEY, id);
  } catch {
    // storage blocked: view-as cannot start
  }
}
