import { codeMatches, type ResourceOperation, type RoleDefinition, type ScopedOperation } from './roles.js';

/** How much of a field a user gets: not at all, shown read-only, or editable. */
export type FieldLevel = 'hidden' | 'view' | 'edit';
const RANK: Record<FieldLevel, number> = { hidden: 0, view: 1, edit: 2 };
const max = (a: FieldLevel, b: FieldLevel): FieldLevel => (RANK[a] >= RANK[b] ? a : b);
const min = (a: FieldLevel, b: FieldLevel): FieldLevel => (RANK[a] <= RANK[b] ? a : b);

/** Rows an operation may touch: all of them, or those matching any of these scopes. */
export type ScopeSet = 'all' | string[];

/**
 * A user's effective permissions (spec §6.1): the union of their roles, grant-only. Superusers can do everything.
 * Pure: built once per request from the role definitions.
 */
export class EffectivePermissions {
  constructor(
    readonly roles: readonly RoleDefinition[],
    readonly superuser: boolean,
  ) {}

  private grants(role: RoleDefinition, code: string): boolean {
    return role.permissions.some((pattern) => codeMatches(pattern, code));
  }

  /** Any code: `product.view`, `order.view_all`, `reports.run`. */
  can(code: string): boolean {
    return this.superuser || this.roles.some((role) => this.grants(role, code));
  }

  private roleCan(role: RoleDefinition, resource: string, operation: ResourceOperation): boolean {
    if (this.grants(role, `${resource}.${operation}`)) return true;
    // Django parity: whoever may change a record may see it.
    return operation === 'view' && this.grants(role, `${resource}.update`);
  }

  canOn(resource: string, operation: ResourceOperation): boolean {
    return this.superuser || this.roles.some((role) => this.roleCan(role, resource, operation));
  }

  /** The user can reach the resource at all (view or create). */
  canReach(resource: string): boolean {
    return this.canOn(resource, 'view') || this.canOn(resource, 'create');
  }

  /**
   * The field's level: over the roles that can reach the resource, the most permissive (spec §6.2). Within a role,
   * a field without a rule is `edit` when the role may create or update, else `view`; `restricted` fields start
   * `hidden`; rules and field codes (`{r}.field.{f}.view|edit`) set it, never above what the role may do.
   */
  fieldLevel(resource: string, field: string, restricted = false): FieldLevel {
    if (this.superuser) return 'edit';
    let level: FieldLevel = 'hidden';
    for (const role of this.roles) {
      const reach = this.roleCan(role, resource, 'view') || this.roleCan(role, resource, 'create');
      if (!reach) continue;
      const writes = this.roleCan(role, resource, 'update') || this.roleCan(role, resource, 'create');
      const ceiling: FieldLevel = writes ? 'edit' : 'view';
      let own: FieldLevel = restricted ? 'hidden' : ceiling;
      const rule = role.fields?.[resource]?.[field];
      if (rule === 'hidden') own = 'hidden';
      else if (rule === 'readonly' || rule === 'view') own = 'view';
      else if (rule === 'edit') own = ceiling;
      if (this.grants(role, `${resource}.field.${field}.edit`)) own = max(own, ceiling);
      else if (this.grants(role, `${resource}.field.${field}.view`)) own = max(own, 'view');
      level = max(level, min(own, ceiling));
    }
    return level;
  }

  /** The rows `operation` may touch (spec §6.4): ORed over the roles that allow it; a role without a scope = all. */
  scopes(resource: string, operation: ScopedOperation): ScopeSet {
    if (this.superuser) return 'all';
    const names = new Set<string>();
    for (const role of this.roles) {
      if (!this.roleCan(role, resource, operation)) continue;
      const assigned = role.scopes?.[resource]?.[operation];
      if (assigned === undefined || (Array.isArray(assigned) && assigned.length === 0)) return 'all';
      for (const name of Array.isArray(assigned) ? assigned : [assigned]) names.add(name);
    }
    return [...names];
  }
}
