import { EffectivePermissions, type FieldLevel } from '../policy/effective.js';
import { codeMatches, knownCodes, type PolicyCatalog, type RoleDefinition, type ScopedOperation } from '../policy/roles.js';

const RANK: Record<FieldLevel, number> = { hidden: 0, view: 1, edit: 2 };
const SCOPED: readonly ScopedOperation[] = ['view', 'update', 'delete'];

/**
 * What `role` would grant beyond what `manager` holds (spec §6.5 anti-escalation); empty when it grants nothing more.
 * Compares concrete codes (wildcards expanded against the catalog), field levels and row scopes.
 */
export function escalations(role: RoleDefinition, manager: EffectivePermissions, catalog: PolicyCatalog): string[] {
  if (manager.superuser) return [];
  const problems: string[] = [];
  const granted = new EffectivePermissions([role], false);
  for (const code of knownCodes(catalog)) {
    if (role.permissions.some((pattern) => codeMatches(pattern, code)) && !manager.can(code)) problems.push(`grants ${code}, which you do not have`);
  }
  for (const [resource, info] of catalog.resources) {
    if (!granted.canReach(resource)) continue;
    const restricted = new Set(info.restricted ?? []);
    for (const field of info.fields) {
      const theirs = granted.fieldLevel(resource, field, restricted.has(field));
      const yours = manager.fieldLevel(resource, field, restricted.has(field));
      if (RANK[theirs] > RANK[yours]) problems.push(`gives ${theirs} on ${resource}.${field}, above your ${yours}`);
    }
    for (const operation of SCOPED) {
      if (!granted.canOn(resource, operation)) continue;
      const yours = manager.scopes(resource, operation);
      if (yours === 'all') continue;
      const theirs = granted.scopes(resource, operation);
      if (theirs === 'all' || theirs.some((scope) => !yours.includes(scope))) {
        problems.push(`reaches ${theirs === 'all' ? 'every' : theirs.join('/')} row of ${resource} for ${operation}; yours: ${yours.join('/') || 'none'}`);
      }
    }
  }
  return [...new Set(problems)];
}
