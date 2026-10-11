import type { DataSource } from 'typeorm';
import { parseRecordId, recordIdOf } from '../crud/record-id.js';
import { AdminBadRequestError, AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { FieldConfig } from '../schema/field-config.js';

/**
 * What files belong to: a resource (its records hold the keys), or anything else with file fields and one or more
 * "records". `FilesService` asks the owner who may upload, change and see, and what a record holds; the rows of
 * `nma_file`, the uploads and the cleanup are the same for every owner.
 */
export interface FileOwner {
  /** What `nma_file.resource` holds, and the `resource` of `POST /api/uploads`: a resource's name, or `page:<name>`. */
  readonly name: string;
  /** Where the owner's writes run: `nma_file` rows share their transaction when it is the files' DataSource too. */
  readonly dataSource: DataSource;
  /** The options of every configured field (`widget`, `file`). */
  readonly fieldConfig: ReadonlyMap<string, FieldConfig>;
  /** Whether `name` is a field an upload can be for (a top-level field of the owner). */
  hasField(name: string): boolean;
  /** `nma_file.recordId` of a saved record. */
  recordId(record: object): string;
  /** An upload: 404 when the user cannot reach the owner at all, 403 when they may not write to it. */
  requireWrite(ctx: AdminContext): void;
  /** Whether the user may write to the owner (an unsaved upload is shown only to its uploader while they may). */
  mayWrite(ctx: AdminContext): boolean;
  /** Whether the user may change this field. */
  mayEdit(field: string, ctx: AdminContext): boolean;
  /**
   * For a download: what the record `recordId` holds in `field` now, when this user may see that record and field;
   * `undefined` when they may not, or when there is no such record (the caller answers the same 404 for all of it).
   */
  held(recordId: string, field: string, ctx: AdminContext): Promise<unknown>;
}

/** A resource as the owner of its records' files: permissions, field levels and row scopes decide. */
export function resourceFileOwner(entry: RegisteredResource, policy: AdminPolicy): FileOwner {
  const { name } = entry.schema;
  const mayWrite = (ctx: AdminContext): boolean => {
    const permissions = policy.permissionsOf(ctx);
    return permissions.canOn(name, 'create') || permissions.canOn(name, 'update');
  };
  return {
    name,
    dataSource: entry.dataSource,
    fieldConfig: entry.fieldConfig,
    hasField: (field) => !field.includes('.') && entry.schema.fields.some((candidate) => candidate.name === field),
    recordId: (record) => recordIdOf(record, entry.schema.primaryKeys),
    requireWrite(ctx) {
      policy.requireReach(entry, ctx);
      if (!mayWrite(ctx)) throw new AdminForbiddenError(`You may not create or change ${entry.schema.label} records`);
    },
    mayWrite,
    mayEdit: (field, ctx) => policy.levels(entry, ctx).get(field) === 'edit',
    async held(recordId, field, ctx) {
      if (!policy.permissionsOf(ctx).canOn(name, 'view')) return undefined;
      const level = policy.levels(entry, ctx).get(field);
      if (level === undefined || level === 'hidden') return undefined;
      try {
        const id = parseRecordId(recordId, entry.schema);
        const entity = await entry.resource.findOne(id, ctx);
        if (!entity) return undefined;
        await policy.requireInScope(entry, id, recordId, 'view', ctx); // a findOne override may ignore scopes
        return (entity as Record<string, unknown>)[field];
      } catch (error) {
        if (error instanceof AdminNotFoundError || error instanceof AdminBadRequestError || error instanceof AdminValidationError) return undefined;
        throw error;
      }
    },
  };
}
