import type { RbacCatalog } from '@nest-my-admin/core/contract';

/** Whether `pattern` grants `code` (the server's rule: `*` last matches the rest, elsewhere one segment). */
export function codeMatches(pattern: string, code: string): boolean {
  const wanted = pattern.split('.');
  const actual = code.split('.');
  for (let i = 0; i < wanted.length; i++) {
    const part = wanted[i]!;
    if (part === '*' && i === wanted.length - 1) return actual.length > i;
    if (i >= actual.length) return false;
    if (part !== '*' && part !== actual[i]) return false;
  }
  return wanted.length === actual.length;
}

/** Every code the catalog knows (what the matrix can tick). */
export function catalogCodes(catalog: RbacCatalog): string[] {
  const codes = [...catalog.global];
  for (const resource of catalog.resources) {
    for (const operation of catalog.operations) codes.push(`${resource.name}.${operation}`);
    for (const custom of resource.custom) codes.push(`${resource.name}.${custom}`);
  }
  return codes;
}

export function grants(permissions: string[], code: string): boolean {
  return permissions.some((pattern) => codeMatches(pattern, code));
}

/**
 * Ticks or unticks one code. Unticking a code a wildcard grants (`product.*`) replaces that wildcard with the other
 * codes it granted, so nothing else changes.
 */
export function togglePermission(permissions: string[], code: string, on: boolean, known: string[]): string[] {
  if (on) return grants(permissions, code) ? permissions : [...permissions, code];
  const next: string[] = [];
  for (const pattern of permissions) {
    if (pattern === code) continue;
    if (pattern.includes('*') && codeMatches(pattern, code)) {
      for (const other of known) if (other !== code && codeMatches(pattern, other) && !next.includes(other)) next.push(other);
      continue;
    }
    next.push(pattern);
  }
  return next.filter((pattern) => pattern === code || !codeMatches(pattern, code));
}
