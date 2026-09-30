/**
 * The JSON contract between @nest-my-admin/core and @nest-my-admin/ui.
 * Types only: the UI imports this file from source with `import type`,
 * so it must never contain runtime code or import anything.
 */

export type FieldType =
  | 'string' | 'text' | 'number' | 'bigint' | 'decimal' | 'boolean'
  | 'date' | 'datetime' | 'enum' | 'json' | 'uuid';

export interface FieldSchema {
  name: string;
  label: string;
  type: FieldType;
  nullable: boolean;
  /** Part of the primary key. */
  primary: boolean;
  /** Set by the database or TypeORM (generated ids, create/update/delete dates, version). */
  readonly: boolean;
  /** Backed by an entity column (false for DTO-only fields such as `password`). */
  persisted: boolean;
  enumValues?: string[];
  /** Digits after the decimal point, for `decimal` fields. */
  scale?: number;
}

export interface MetaResourceSummary {
  name: string;
  label: string;
  icon?: string;
}

export interface MetaGroup {
  key: string;
  label: string;
  icon?: string;
  resources: MetaResourceSummary[];
}

export interface MetaResponse {
  schemaVersion: 1;
  title: string;
  groups: MetaGroup[];
}

export type SortDirection = 'asc' | 'desc';

export type FilterOperator =
  | 'eq' | 'ne' | 'in' | 'nin' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'contains' | 'startsWith' | 'isNull';

/** A filterable field and the operators its column type supports (spec §11). */
export interface FilterSchema {
  field: string;
  operators: FilterOperator[];
}

export interface ResourceSchema {
  name: string;
  label: string;
  group: string;
  icon?: string;
  primaryKey: string;
  fields: FieldSchema[];
  list: {
    columns: string[];
    sortable: string[];
    defaultSort: { field: string; direction: SortDirection };
    pageSize: number;
    filters: FilterSchema[];
    /** Fields matched case-insensitively by `?search=`. Empty = not searchable. */
    search: string[];
  };
  form: {
    create: string[];
    update: string[];
    requiredOnCreate: string[];
  };
}

export type AdminRecord = Record<string, unknown>;

export interface ListResponse {
  items: AdminRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export type AdminErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'BUSINESS_RULE' | 'INTERNAL';

export interface AdminErrorBody {
  code: AdminErrorCode;
  message: string;
  fields?: Record<string, string[]>;
  correlationId: string;
}

/** Injected into index.html as `<script type="application/json" id="nma-config">`. */
export interface AdminRuntimeConfig {
  basePath: string;
  apiBase: string;
  title: string;
}
