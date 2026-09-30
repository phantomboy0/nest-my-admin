/**
 * The JSON contract between @nest-my-admin/core and @nest-my-admin/ui.
 * Types only: the UI imports this file from source with `import type`,
 * so it must never contain runtime code or import anything.
 */

export type FieldType =
  | 'string' | 'text' | 'number' | 'bigint' | 'decimal' | 'boolean'
  | 'date' | 'datetime' | 'enum' | 'json' | 'uuid'
  /** A column type the admin can display and edit as text but not filter or search (time, inet, bytea, ...). */
  | 'other'
  /** A related record (many-to-one, owning one-to-one) or records (owning many-to-many); see `FieldSchema.relation`. */
  | 'relation';

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
  /** Backed by a known integer column type (int, smallint, ...); `number` fields without it may be floats. */
  integer?: boolean;
  /** Set when `type` is `relation`. */
  relation?: RelationSchema;
}

/**
 * A relation field. Reads return `RelationRef | null` (to-one) or `RelationRef[]` (to-many);
 * writes send the id or `null` (to-one) or an array of ids (to-many).
 */
export interface RelationSchema {
  /** `to-one`: many-to-one or owning one-to-one. `to-many`: owning many-to-many. */
  kind: 'to-one' | 'to-many';
  /** The registered resource of the target entity (for links and pickers); absent when it has none. */
  resource?: string;
  /** Type of the target's primary key: ids are sent, filtered and returned with it (bigint ids as strings). */
  idType: 'number' | 'bigint' | 'string' | 'uuid';
}

/** A related record as the admin shows it. */
export interface RelationRef {
  id: string | number;
  title: string;
}

/** `GET /resources/:resource/fields/:field/options` */
export interface OptionsResponse {
  items: RelationRef[];
}

/** Rules the browser checks before submitting (spec §9.4). The server re-validates; these only save a round trip. */
export interface FieldConstraints {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  integer?: boolean;
  /** From @Matches: rebuild with `new RegExp(source, flags)`. */
  pattern?: { source: string; flags: string; message?: string };
  format?: 'email' | 'url' | 'uuid';
  oneOf?: string[];
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
    constraints: { create: Record<string, FieldConstraints>; update: Record<string, FieldConstraints> };
  };
}

/**
 * A record: field name → value, dotted list paths (`'customer.name'`) as flat keys,
 * and `_title`, the record's display name (spec §5.2 `title`).
 */
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
