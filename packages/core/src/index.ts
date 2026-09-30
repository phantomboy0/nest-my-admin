export { AdminModule } from './admin.module.js';
export type { AdminBranding, AdminModuleOptions, ErrorMapper, GlobalScope } from './options.js';
export type { LocalizedText } from './i18n/localized-text.js';
export { ResourceRegistry, type RegisteredGroup, type RegisteredResource } from './registry/resource-registry.js';
export type { DbNames } from './registry/db-names.js';
export { AdminGroup, type AdminGroupOptions } from './decorators/admin-group.js';
export { AdminResource, type AdminResourceOptions } from './decorators/admin-resource.js';
export {
  AdminResourceBase,
  type FilterCondition,
  type FilterValue,
  type FindManyResult,
  type CountMode,
  type FormConfig,
  type ListConfig,
  type ListParams,
  type RecordId,
  type RecordLinkConfig,
} from './resource/admin-resource-base.js';
export { AdminField, BADGE_COLORS, WIDGETS, type AdminFieldOptions, type BadgeColor, type WidgetName } from './decorators/admin-field.js';
export type { FieldConfig, FieldsConfig, LayoutConfig, LayoutSectionConfig, LayoutTabConfig } from './schema/field-config.js';
export { AdminContext } from './resource/admin-context.js';
export { AdminCan, AdminScope, type RecordOperation, type ScopeCondition } from './decorators/admin-scope.js';
export type { FieldRule, ResourceOperation, RoleDefinition, ScopedOperation } from './policy/roles.js';
export { ADMIN_RBAC_ENTITIES, NmaGroup, NmaGroupMember, NmaGroupRole, NmaRole, NmaUserRole } from './rbac/entities.js';
export type { FieldPath } from './schema/field-paths.js';
export type { TitleDefinition } from './schema/titles.js';
export {
  AdminBadRequestError,
  AdminConflictError,
  AdminError,
  AdminFieldError,
  AdminForbiddenError,
  AdminForbiddenFieldsError,
  AdminNotFoundError,
  AdminRateLimitError,
  AdminUnauthenticatedError,
  AdminValidationError,
} from './errors.js';
export {
  AdminAuth,
  type AdminAuthAdapter,
  type AdminAuthConfig,
  type AdminPrincipal,
  type AdminSessionInfo,
  type AdminUser,
  type AuthIO,
  type LoginInput,
} from './auth/auth-adapter.js';
export { appendSetCookie, isSecureRequest, parseCookies, serializeCookie, type CookieOptions } from './http/cookies.js';
export { AfterSave, BeforeDelete, BeforeSave, type DeleteMode, type HookKind, type SaveMode } from './decorators/hooks.js';
export type * from './contract.js';
