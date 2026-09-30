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

/** Where to go after signing in: a path inside the admin, never another site (`//evil`, `https:`). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.startsWith('/login')) return '/';
  return next;
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
