export { AdminGroup, type AdminGroupOptions } from './decorators/admin-group.js';
export { AdminResource, type AdminResourceOptions } from './decorators/admin-resource.js';
export {
  AdminResourceBase,
  type FindManyResult,
  type FormConfig,
  type ListConfig,
  type ListParams,
  type RecordId,
} from './resource/admin-resource-base.js';
export type { AdminContext } from './resource/admin-context.js';
export { AdminBadRequestError, AdminError, AdminFieldError, AdminNotFoundError, AdminValidationError } from './errors.js';
export type * from './contract.js';
