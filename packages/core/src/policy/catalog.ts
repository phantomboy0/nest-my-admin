import { getScopes } from '../decorators/admin-scope.js';
import { ADMIN_RESOURCE_METADATA } from '../constants.js';
import type { AdminResourceDefinition } from '../decorators/admin-resource.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { RegisteredResource, ResourceRegistry } from '../registry/resource-registry.js';
import type { PolicyCatalog } from './roles.js';

/** Codes the admin itself defines: reading and managing roles, groups and users. */
export const RBAC_CODES = ['rbac.view', 'rbac.manage'];

export function customCodes(entry: RegisteredResource): string[] {
  const definition = Reflect.getMetadata(ADMIN_RESOURCE_METADATA, entry.resource.constructor) as AdminResourceDefinition | undefined;
  return definition?.permissions ?? [];
}

/** Everything roles may name: resources with their fields, scopes, restricted fields and custom codes; global codes. */
export function buildCatalog(registry: ResourceRegistry, options: ResolvedAdminOptions): PolicyCatalog {
  const resources: PolicyCatalog['resources'] = new Map();
  for (const entry of registry.list()) {
    const fields = entry.schema.fields.filter((field) => !field.name.includes('.')).map((field) => field.name);
    resources.set(entry.schema.name, {
      fields,
      scopes: Object.keys(getScopes(entry.resource.constructor)),
      custom: customCodes(entry),
      restricted: fields.filter((name) => entry.fieldConfig.get(name)?.restricted === true),
    });
  }
  return { resources, global: [...new Set([...options.permissions, ...(options.rbac ? RBAC_CODES : [])])] };
}
