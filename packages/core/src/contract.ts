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
  /** Unique on its own (a unique column, constraint or index); Duplicate leaves it empty. */
  unique?: boolean;
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
  /** A sentence under the input. */
  help?: string;
  placeholder?: string;
  /** The widget chosen in the field config; the UI infers one from the type when absent. */
  widget?: 'text' | 'textarea' | 'number' | 'money' | 'switch' | 'checkbox' | 'select' | 'radio' | 'date' | 'datetime' | 'json' | 'color' | 'badge' | 'slug' | 'password' | 'email' | 'url';
  /** Display labels of enum values (values sent stay the raw ones). */
  enumLabels?: Record<string, string>;
  /** Badge colour per value. */
  colors?: Record<string, 'gray' | 'red' | 'amber' | 'green' | 'blue' | 'purple' | 'pink'>;
  /** Shown only while every named field has the value (or one of the values) given. */
  showIf?: Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;
  /** The slug widget fills itself from this field until edited. */
  slugFrom?: string;
  /** Currency code for the money widget (display only). */
  currency?: string;
}

export interface FormLayoutSection {
  title?: string;
  fields: string[];
  columns: 1 | 2 | 3;
}

export interface FormLayoutTab {
  tab: string;
  sections: FormLayoutSection[];
}

export type FormLayoutNode = FormLayoutSection | FormLayoutTab;

/** An external link of a record (`links()` on the resource), shown in the detail header. */
export interface RecordLink {
  label: string;
  href: string;
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
  /** Records can be created (the command palette offers "New …"). */
  creatable: boolean;
  /** Has `list.search`: global search (`/api/search`) covers it. */
  searchable: boolean;
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
  /** The language of this response's labels (from `Accept-Language`). */
  locale: string;
  /** Languages people can switch between. */
  locales: string[];
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
    /** Fields edited in place in the list (saved with PATCH). */
    editable: string[];
    /** Phone cards: fields (or paths) for the title, subtitle, badge and meta line. Without it, the title and the columns. */
    mobile?: { title?: string; subtitle?: string; badge?: string; meta: string[] };
  };
  /** False for the root of a single-table inheritance, or when the user may not create. */
  creatable: boolean;
  /** What the signed-in user may do (spec §6.1); records may narrow update/delete in `_perm`. */
  permissions?: { create: boolean; update: boolean; delete: boolean; purge: boolean };
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
    /** Shown on the update form but not writable (`readonly: true`); records add their own in `_readonly`. */
    readonly: string[];
    /** Sections and tabs (`form.layout`); absent = one section in form order. */
    layout?: FormLayoutNode[];
    constraints: { create: Record<string, FieldConstraints>; update: Record<string, FieldConstraints> };
  };
}

/**
 * A record: field name → value, dotted list paths (`'customer.name'`) as flat keys, `_id` (the encoded record id used
 * in URLs: key values in primary-key order, `~` as `~0` and `,` as `~1`, joined by `,`; `new` is `~new`), `_title`,
 * the record's display name (spec §5.2 `title`), and when configured `_readonly` (fields `readonlyIf` locks on this
 * record) and `_links` (`RecordLink[]`).
 */
export type AdminRecord = Record<string, unknown>;

/** `POST /resources/:resource/bulk-delete` with `{ ids }` (encoded record ids): each id succeeds or fails on its own. */
export interface BulkResult {
  ok: string[];
  failed: Array<{ id: string; code: AdminErrorCode; message: string }>;
}

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

/** `GET /api/search?q=`: records matching `q` in each searchable resource (command palette). */
export interface SearchResponse {
  groups: Array<{
    resource: string;
    label: string;
    items: Array<{ _id: string; _title: string }>;
    /** More records match than were returned. */
    hasMore: boolean;
  }>;
}

/** What the auth adapter supports (the UI shows only what works). */
export interface AuthCapabilities {
  login: boolean;
  logout: boolean;
  /** List and revoke sessions on the account page. */
  sessions: boolean;
  /** "Log out everywhere else". */
  revokeOthers: boolean;
  password: boolean;
}

export interface SessionUser {
  id: string;
  displayName: string;
  username?: string;
  email?: string;
  isSuperuser: boolean;
}

/** `GET /api/session` and `POST /api/session` (log in). Not signed in: 401. */
export interface SessionResponse {
  user: SessionUser;
  /** Send as `X-CSRF-Token` on POST, PATCH and DELETE. Absent when the adapter does not use cookies. */
  csrfToken?: string;
  /** No sign-in configured: everyone is a superuser. */
  open: boolean;
  auth: AuthCapabilities;
  /** Roles/groups/users pages (with `rbac`): may this user see them, change them. */
  rbac: { enabled: boolean; view: boolean; manage: boolean };
  /** Changes when roles or memberships change: refetch meta and schemas. */
  permissionsVersion: number;
}

/** Text in one language, or per language (`{ en, fa }`). */
export type LocalizedTextJson = string | Record<string, string>;

export interface RbacRole {
  name: string;
  label?: LocalizedTextJson;
  description?: LocalizedTextJson;
  /** Defined in code: read-only here. */
  system: boolean;
  permissions: string[];
  fields?: Record<string, Record<string, 'hidden' | 'readonly' | 'view' | 'edit'>>;
  scopes?: Record<string, Partial<Record<'view' | 'update' | 'delete', string | string[]>>>;
}

export interface RbacGroup {
  id: number;
  name: string;
  label: LocalizedTextJson | null;
  roles: string[];
  members: string[];
}

export interface RbacUser {
  id: string;
  displayName: string;
  username?: string;
  email?: string;
  isSuperuser: boolean;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  roles: string[];
  groups: number[];
}

export interface RbacUsersResponse {
  items: RbacUser[];
  total: number;
  page: number;
  pageSize: number;
  /** What the auth adapter supports on this page. */
  capabilities: { list: boolean; create: boolean; update: boolean; password: boolean };
}

/** What roles can name, for the matrix editor. */
export interface RbacCatalog {
  operations: Array<'view' | 'create' | 'update' | 'delete' | 'purge'>;
  resources: Array<{
    name: string;
    label: string;
    group: string;
    fields: Array<{ name: string; label: string; restricted: boolean }>;
    scopes: string[];
    custom: string[];
  }>;
  global: string[];
}

/** `GET /api/account/sessions`: the user's signed-in devices. */
export interface AccountSession {
  id: string;
  /** The session of this request. */
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent?: string;
  ip?: string;
}

export type AdminErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'FORBIDDEN_FIELDS' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'BUSINESS_RULE' | 'INTERNAL';

export interface AdminErrorBody {
  code: AdminErrorCode;
  message: string;
  fields?: Record<string, string[]>;
  /** On a 409 for a stale `If-Match` version: the record as it is now (for the diff dialog). */
  current?: AdminRecord;
  correlationId: string;
}

/** A label in one language, or per language (`{ en: 'Orders', fa: 'سفارش‌ها' }`). */
export type LocalizedLabel = string | Record<string, string>;

/** Host branding (spec §9.5). Colours and lengths are validated by core before they reach the page. */
export interface BrandingConfig {
  name?: LocalizedLabel;
  logo?: string;
  primaryColor?: string;
  primaryForeground?: string;
  radius?: string;
}

/** Injected into index.html as `<script type="application/json" id="nma-config">`. */
export interface AdminRuntimeConfig {
  basePath: string;
  apiBase: string;
  /** The title in the default locale (the tab title before meta loads). */
  title: string;
  /** Default language. */
  locale: string;
  locales: string[];
  branding: BrandingConfig;
}
