export { AdminModule } from './admin.module.js';
export type { AdminAuditOptions, AdminBranding, AdminCurrency, AdminFilesOptions, AdminMenuItem, AdminMenuOptions, AdminMenuSection, AdminModuleOptions, ErrorMapper, GlobalScope } from './options.js';
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
  type ComputedColumn,
  type ComputedSource,
  type ListConfig,
  type ListTab,
  type ListParams,
  type RecordId,
  type RecordLinkConfig,
} from './resource/admin-resource-base.js';
export { AdminField, BADGE_COLORS, WIDGETS, type AdminFieldOptions, type FileFieldOptions, type BadgeColor, type WidgetName } from './decorators/admin-field.js';
export type { FieldConfig, FieldsConfig, LayoutConfig, LayoutInlineConfig, LayoutSectionConfig, LayoutTabConfig } from './schema/field-config.js';
export type { RegisteredInline } from './inlines/inline-config.js';
export { AdminContext } from './resource/admin-context.js';
export { AdminCan, AdminScope, type RecordOperation, type ScopeCondition } from './decorators/admin-scope.js';
export { AdminAction, type ActionOutcome, type AdminActionOptions } from './decorators/admin-action.js';
export { AdminSettingsPage, type AdminSettingsPageOptions, type AdminSettingsSource } from './decorators/admin-settings-page.js';
export type { FieldRule, ResourceOperation, RoleDefinition, ScopedOperation } from './policy/roles.js';
export { ADMIN_RBAC_ENTITIES, NmaGroup, NmaGroupMember, NmaGroupRole, NmaRole, NmaUserRole } from './rbac/entities.js';
export { ADMIN_FILE_ENTITIES, NmaFile } from './files/entities.js';
export { ADMIN_AUDIT_ENTITIES, NmaAuditEntry, type AuditMeta } from './audit/entities.js';
export type { AuditChange } from './audit/diff.js';
export type { AdminFile } from './files/admin-file.js';
export { AdminFiles, type AdminPublicFile, type AdminPublicFileBody } from './files/admin-files.service.js';
export type { RegisterFileInput, ReleaseFileInput } from './files/files.service.js';
export { localStorage, type AdminStorage, type LocalStorageOptions } from './files/storage.js';
export { s3Storage, type S3StorageOptions } from './files/s3-storage.js';
export { accepts, sniff } from './files/sniff.js';
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
  AdminTwoFactorRequiredError,
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
  type AdminUserChanges,
  type AdminUserRecord,
  type NewAdminUser,
  type AuthIO,
  type LoginInput,
  type TwoFactorStatus,
} from './auth/auth-adapter.js';
export { appendSetCookie, isSecureRequest, parseCookies, serializeCookie, type CookieOptions } from './http/cookies.js';
export { AfterSave, BeforeDelete, BeforeSave, type DeleteMode, type HookKind, type SaveMode } from './decorators/hooks.js';
export type * from './contract.js';
