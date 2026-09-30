export { AdminModule } from './admin.module.js';
export type { AdminModuleOptions } from './options.js';
export { ResourceRegistry, type RegisteredGroup, type RegisteredResource } from './registry/resource-registry.js';
export { AdminGroup, type AdminGroupOptions } from './decorators/admin-group.js';
export { AdminResource, type AdminResourceOptions } from './decorators/admin-resource.js';
export {
  AdminResourceBase,
  type FilterCondition,
  type FilterValue,
  type FindManyResult,
  type FormConfig,
  type ListConfig,
  type ListParams,
  type RecordId,
} from './resource/admin-resource-base.js';
export { AdminContext } from './resource/admin-context.js';
export { AdminBadRequestError, AdminError, AdminFieldError, AdminNotFoundError, AdminValidationError } from './errors.js';
export { AfterSave, BeforeDelete, BeforeSave, type HookKind, type SaveMode } from './decorators/hooks.js';
export type * from './contract.js';
