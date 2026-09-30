/**
 * For `@nest-my-admin/testing` only: the services behind the admin's HTTP API, and building a request context
 * in-process. Not a stable API, and never mounted on HTTP.
 * @packageDocumentation
 */
export { AdminApiService } from './api/admin-api.service.js';
export { AdminAuthService } from './auth/auth.service.js';
export { AdminPolicy } from './policy/admin-policy.service.js';
export { EffectivePermissions } from './policy/effective.js';
export { AdminRbac } from './rbac/rbac.service.js';
export { ResourceRegistry, type RegisteredResource } from './registry/resource-registry.js';
export { createAdminContext, runInAdminContext } from './resource/admin-context.js';
