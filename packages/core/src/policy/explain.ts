import type { ExplainRoleSource, PermissionExplanation, ResourceSchema } from '../contract.js';
import { parseRecordId, recordIdOf } from '../crud/record-id.js';
import type { AdminUser } from '../auth/auth-adapter.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import { runInAdminContext, type AdminContext } from '../resource/admin-context.js';
import { EffectivePermissions, type FieldLevel } from './effective.js';
import { RESOURCE_OPERATIONS, codeMatches, type RoleDefinition, type ScopedOperation } from './roles.js';
import type { AdminPolicy } from './admin-policy.service.js';

const SCOPED: ScopedOperation[] = ['view', 'update', 'delete'];

export interface ExplainInput {
  user: AdminUser;
  entry: RegisteredResource;
  /** The resource's full schema in the viewer's language (labels only). */
  labels: ResourceSchema;
  /** The target user's context: their permissions, as a request of theirs would have. */
  ctx: AdminContext & { permissions: EffectivePermissions };
  /** Role names and where they come from. */
  sources: Map<string, ExplainRoleSource[]>;
  record?: string;
}

/**
 * Why a user may or may not do things with a resource (spec §6.7). Every answer comes from the code the API
 * enforces with: the final values from `EffectivePermissions` and `AdminPolicy`, and the per-role breakdowns from
 * the same code run on one role at a time.
 */
export async function explainPermissions(policy: AdminPolicy, input: ExplainInput): Promise<Omit<PermissionExplanation, 'user'>> {
  const { entry, labels, ctx, sources } = input;
  const perms = ctx.permissions;
  const r = entry.schema.name;
  const roles = perms.roles;
  const single = new Map<RoleDefinition, EffectivePermissions>(roles.map((role) => [role, new EffectivePermissions([role], false)]));
  const known = new Set(roles.map((role) => role.name));

  const operations = RESOURCE_OPERATIONS.map((operation) => {
    const grantedBy: PermissionExplanation['operations'][number]['grantedBy'] = [];
    if (!perms.superuser) {
      for (const role of roles) {
        for (const pattern of role.permissions) {
          if (codeMatches(pattern, `${r}.${operation}`)) grantedBy.push({ role: role.name, pattern });
          else if (operation === 'view' && codeMatches(pattern, `${r}.update`)) grantedBy.push({ role: role.name, pattern, via: 'update' });
        }
      }
    }
    const allowed = perms.canOn(r, operation) && (operation !== 'create' || entry.schema.creatable);
    return { operation, allowed, grantedBy };
  });

  const levels = policy.levels(entry, ctx);
  const fields = entry.schema.fields
    .filter((field) => !field.name.includes('.'))
    .map((field) => {
      const restricted = entry.fieldConfig.get(field.name)?.restricted === true;
      const level = levels.get(field.name) ?? 'hidden';
      const byRole: Array<{ role: string; level: FieldLevel; rule?: string; code?: string }> = [];
      if (!perms.superuser) {
        for (const role of roles) {
          const one = single.get(role)!;
          if (!one.canReach(r)) continue;
          const rule = role.fields?.[r]?.[field.name];
          const code = role.permissions.find((pattern) => codeMatches(pattern, `${r}.field.${field.name}.edit`) || codeMatches(pattern, `${r}.field.${field.name}.view`));
          byRole.push({ role: role.name, level: one.fieldLevel(r, field.name, restricted), ...(rule ? { rule } : {}), ...(code ? { code } : {}) });
        }
      }
      const forced = level !== perms.fieldLevel(r, field.name, restricted);
      return { name: field.name, label: labels.fields.find((candidate) => candidate.name === field.name)?.label ?? field.name, restricted, level, ...(forced ? { forced } : {}), byRole };
    });

  const scopes = SCOPED.map((operation) => ({
    operation,
    result: perms.scopes(r, operation),
    byRole: perms.superuser ? [] : roles.filter((role) => single.get(role)!.canOn(r, operation)).map((role) => ({ role: role.name, scopes: single.get(role)!.scopes(r, operation) })),
    global: policy.globalScopeNames(entry, perms),
  }));

  const result: Omit<PermissionExplanation, 'user'> = {
    superuser: perms.superuser,
    roles: [...sources.entries()].map(([name, from]) => {
      const role = roles.find((candidate) => candidate.name === name);
      return { name, ...(role?.label !== undefined ? { label: role.label as PermissionExplanation['roles'][number]['label'] } : {}), known: known.has(name), sources: from };
    }),
    resource: { name: r, label: labels.label },
    operations,
    fields,
    scopes,
  };
  if (input.record !== undefined) result.record = await runInAdminContext(ctx, () => explainRecord(policy, entry, input.record!, ctx));
  return result;
}

async function explainRecord(policy: AdminPolicy, entry: RegisteredResource, raw: string, ctx: AdminContext & { permissions: EffectivePermissions }): Promise<NonNullable<PermissionExplanation['record']>> {
  const perms = ctx.permissions;
  const r = entry.schema.name;
  const reasons: NonNullable<PermissionExplanation['record']>['reasons'] = {};
  let id;
  try {
    id = parseRecordId(raw, entry.schema);
  } catch {
    return { id: raw, exists: false, view: false, update: false, delete: false, reasons: { view: 'missing', update: 'missing', delete: 'missing' } };
  }
  const keys = entry.schema.primaryKeys;
  const stored = await entry.dataSource.manager.getRepository(entry.metadata.target).createQueryBuilder('nma_explain').whereInIds([id]).getOne();
  const exists = stored !== null;
  const key = recordIdOf(typeof id === 'object' ? id : { [keys[0]!]: id }, keys);
  const inScope = async (operation: ScopedOperation) => (await policy.allowedIds(entry, [id], operation, ctx)).has(key);

  let found: object | null = null;
  let view = false;
  if (!exists) reasons.view = 'missing';
  else if (!perms.canOn(r, 'view')) reasons.view = 'permission';
  else {
    found = await entry.resource.findOne(id, ctx);
    view = found !== null && (await inScope('view'));
    if (!view) reasons.view = 'scope';
  }
  const write = async (operation: 'update' | 'delete'): Promise<boolean> => {
    if (!exists) reasons[operation] = 'missing';
    else if (!perms.canOn(r, operation)) reasons[operation] = 'permission';
    else if (!view) reasons[operation] = reasons.view ?? 'scope';
    else if (!(await inScope(operation))) reasons[operation] = 'scope';
    else if (!policy.recordRule(entry, operation, found!, ctx)) reasons[operation] = 'rule';
    else return true;
    return false;
  };
  const update = await write('update');
  const del = await write('delete');
  return { id: key, exists, view, update, delete: del, reasons };
}
