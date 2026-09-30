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
