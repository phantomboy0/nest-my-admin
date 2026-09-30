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
  | 'relation'
  /** A group of fields (an embedded entity or a nested DTO), or a list of such groups when `many`; see `FieldSchema.fields`. */
  | 'object';

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
  /** Set when `type` is `object`: the group's fields, named relative to it (`city` in `address`). */
  fields?: FieldSchema[];
  /** An `object` field holding a list of groups (an array of nested DTOs). */
  many?: boolean;
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

export interface RelatedList {
  label: string;
  resource: string;
  field: string;
  operator: 'eq' | 'in';
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

/**
 * Rules the browser checks before submitting (spec §9.4). The server re-validates; these only save a round trip.
 * Keyed by field name; fields inside objects by dotted path (`address.city`, `lines.*.qty` for every list item).
 */
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
  /** Primary key columns in order; records carry `_id`, their encoded id (see `AdminRecord`). */
  primaryKeys: string[];
  fields: FieldSchema[];
  list: {
    columns: string[];
    sortable: string[];
    defaultSort: { field: string; direction: SortDirection };
    pageSize: number;
    count: 'exact' | 'estimate' | 'none';
    /** `keyset`: pages follow `nextCursor` (`?after=`), not page numbers. */
    pagination: 'offset' | 'keyset';
    filters: FilterSchema[];
    /** Fields matched case-insensitively by `?search=`. Empty = not searchable. */
    search: string[];
  };
  /** False for the root of a single-table inheritance: records are created through its child resources. */
  creatable: boolean;
  /**
   * Other resources whose relation fields point at this one (spec §9.4 Related): a record's related records are
   * `/<resource>?filter[<field>][<operator>]=<id>`.
   */
  related: RelatedList[];
  /**
   * The `@VersionColumn` field. Send its value as `If-Match: "<version>"` with PATCH and DELETE: a record changed
   * since then answers 409 CONFLICT with `current`.
   */
  version?: string;
  /**
   * The entity has a `@DeleteDateColumn`: DELETE moves records to the trash, lists take `trashed=only|with`,
   * `POST …/:id/restore` brings one back and `DELETE …/:id?purge=true` removes it for good.
   */
  softDelete: boolean;
  form: {
    create: string[];
    update: string[];
    requiredOnCreate: string[];
    constraints: { create: Record<string, FieldConstraints>; update: Record<string, FieldConstraints> };
  };
}

/**
 * A record: field name → value, dotted list paths (`'customer.name'`) as flat keys, `_id` (the encoded record id used
 * in URLs: key values in primary-key order, `~` as `~0` and `,` as `~1`, joined by `,`; `new` is `~new`) and `_title`,
 * the record's display name (spec §5.2 `title`).
 */
export type AdminRecord = Record<string, unknown>;

export interface ListResponse {
  items: AdminRecord[];
  /** `null` when the resource does not count (`list.count: 'none'`). */
  total: number | null;
  /** `total` is an estimate (`list.count: 'estimate'` on a large result). */
  estimated?: boolean;
  /** Set when `total` is null: whether there is a next page. */
  hasMore?: boolean;
  /** Keyset lists: pass as `after` for the next page; `null` on the last page. */
  nextCursor?: string | null;
  page: number;
  pageSize: number;
}

export type AdminErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'BUSINESS_RULE' | 'INTERNAL';

export interface AdminErrorBody {
  code: AdminErrorCode;
  message: string;
  fields?: Record<string, string[]>;
  /** On a 409 for a stale `If-Match` version: the record as it is now (for the diff dialog). */
  current?: AdminRecord;
  correlationId: string;
}

/** Injected into index.html as `<script type="application/json" id="nma-config">`. */
export interface AdminRuntimeConfig {
  basePath: string;
  apiBase: string;
  title: string;
}
