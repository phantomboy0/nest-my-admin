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
  widget?: 'text' | 'textarea' | 'number' | 'money' | 'switch' | 'checkbox' | 'select' | 'radio' | 'date' | 'datetime' | 'json' | 'color' | 'badge' | 'slug' | 'password' | 'email' | 'url' | 'file' | 'image' | 'richtext';
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
  /** Set for `file` and `image` widgets: what may be uploaded to the field. */
  file?: { accept: string[]; maxBytes: number; many: boolean };
  /** Set for the `richtext` widget: whether the editor can upload images (`files` is configured) and their largest size. */
  richtext?: { images: boolean; maxBytes: number };
  /**
   * A write-only field of a settings page: its value is never served. `PageResponse.secrets` says whether one is
   * stored; a save replaces it with a non-empty string, clears it with `null`, and leaves it alone when the key is absent.
   */
  secret?: true;
}

/**
 * What a write sends for a `file` or `image` field: the `token` of a new upload, the `key` of a file the record
 * already has (to keep it), or null to clear the field. Fields with `file.many` send a list of the first two.
 */
export type FileFieldValue = { token: string } | { key: string } | null;

/** A stored file of a record, in `_files`. */
export interface AdminFileRef {
  /** The storage key: the field's value. */
  key: string;
  /** The original file name, cleaned. */
  name: string;
  contentType: string;
  size: number;
  /** The storage's public URL for public files, else `<admin path>/api/files/<key>` (answers only to people who may view the record and the field). */
  url: string;
}

/** The answer of `POST /api/uploads`: `token` goes into the record's field to attach the file. */
export interface UploadResponse {
  token: string;
  name: string;
  contentType: string;
  size: number;
  /**
   * Where a browser can fetch the file right away. Always set for rich-text images (the storage's public URL, else
   * `<admin path>/api/files/<key>`, which answers to the uploader until the record is saved); for file and image
   * fields only for public files of storages with public URLs.
   */
  url?: string;
}

export interface FormLayoutSection {
  title?: string;
  fields: string[];
  columns: 1 | 2 | 3;
}

/**
 * A child resource edited inside the parent's form (`{ inline: ChildAdmin }` in the layout). The child's schema, cut
 * for this user, is `ResourceSchema.inlines[inline]`; a record's rows are `_inlines[inline]` (`InlineRows`).
 */
export interface FormLayoutInline {
  /** The child resource's name: the key in `inlines` and `_inlines`. */
  inline: string;
  /** The section's title, else the child resource's label. */
  label: string;
  /** `cards`: one card per row with the child's fields; `table`: one row per child, one cell per field. */
  display: 'cards' | 'table';
  /** The child's fields the inline shows, in order (never the link field; only fields this user may see). */
  fields: string[];
  /** A number field of the child that orders the rows (written 0, 1, 2… on reorder); without it rows go by key. */
  order?: string;
  /** Fewest rows a save may leave. */
  min?: number;
  /** Most rows a save may leave, and most rows read (`truncated` beyond). At most 500. */
  max: number;
  /** The child's field that points at the parent (set by the server). */
  link: string;
}

export interface FormLayoutTab {
  tab: string;
  sections: Array<FormLayoutSection | FormLayoutInline>;
}

export type FormLayoutNode = FormLayoutSection | FormLayoutTab | FormLayoutInline;

/** One inline of a record (`_inlines[child]` on `GET /resources/:parent/:id`). */
export interface InlineRows {
  /** The children of this record, as the child's own endpoints answer them (`_id`, `_perm`, `_readonly`, `_files`…), by `order` then key. */
  rows: AdminRecord[];
  /** How many children of this record the user may see. */
  total: number;
  /** More than `max` exist: `rows` holds the first `max`, and the inline is not edited in the form. */
  truncated: boolean;
}

/**
 * `_inlines` in the body of `POST /resources/:parent` and `PATCH /resources/:parent/:id`: child resource name → the
 * changes to that inline, saved with the parent in one transaction. Deletes run first, then updates, then creates,
 * inline by inline in layout order; any failure saves nothing. At most 500 entries per inline (`create`, `update` and
 * `delete` together, and `order` on its own).
 *
 * Errors use the usual `{ code, message, fields }` with these paths: `_inlines.<child>.create.<index>.<field>`,
 * `_inlines.<child>.update.<_id>.<field>` (the `_id` as sent), `_inlines.<child>.delete.<_id>`, and
 * `_inlines.<child>` for the count (`min`/`max`), the order list and whole-inline problems.
 */
export type InlineChanges = Record<string, InlineChangeSet>;

export interface InlineChangeSet {
  /** New rows: the child's create fields plus `_key` (1–64 characters, unique in the list), which `order` refers to. Never the link field. */
  create?: Array<Record<string, unknown> & { _key: string }>;
  /** Changed rows: `_id`, the changed fields only, and `_version` for a child with a version column (a stale one is 409). Never the link field. */
  update?: Array<Record<string, unknown> & { _id: string; _version?: number }>;
  /** `_id`s of rows to delete. */
  delete?: string[];
  /**
   * Only for an inline with `order`, and only for a user who may update the child's order field: every row that
   * exists after the save that this user sees, by `_id` (existing rows) or `_key` (new rows), in their new order.
   * The server writes 0, 1, 2… into the order field; entries then may not set that field themselves.
   */
  order?: string[];
}

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

/** A form described by a DTO alone: an action's input, a settings page. */
export interface DtoFormSchema {
  fields: FieldSchema[];
  /** Keyed like `ResourceSchema.form.constraints`. */
  constraints: Record<string, FieldConstraints>;
  /** Top-level fields that must be sent. */
  required: string[];
}

/**
 * A custom action of a resource (`@AdminAction`), run with `POST /resources/:resource/actions/:name` and the body
 * `ActionRequest`. Its permission code is `<resource>.action.<name>`; record actions also need `<resource>.update`.
 */
export interface ActionSchema {
  name: string;
  label: string;
  /** `record`: runs on records (`ids`); `resource`: runs once, without ids (a list toolbar button). */
  target: 'record' | 'resource';
  /** A record action that also takes a selection of several records. */
  bulk: boolean;
  /** Bulk: all records in one transaction (one failure undoes everything and is the answer) instead of one each. */
  atomic: boolean;
  /** Ask before running: `true` for the default question, or the question itself. */
  confirm?: string | true;
  variant: 'default' | 'destructive';
  icon?: string;
  /** The form to fill in before running; its values are sent as `input`. */
  input?: DtoFormSchema;
}

/** Body of `POST /resources/:resource/actions/:name`. Record actions need `ids` (encoded record ids); resource actions refuse them. */
export interface ActionRequest {
  ids?: string[];
  /** Values of the action's input form; leave out (or `{}`) for an action without one. */
  input?: Record<string, unknown>;
}

/**
 * The answer for one record (one distinct id): the record after the action, or `null` when the user can no longer
 * see it (the action deleted it or moved it out of their scopes).
 */
export interface ActionRecordResult {
  message?: string;
  record: AdminRecord | null;
}

/**
 * The answer for several records. Not atomic: each id succeeds or fails on its own. Atomic: either every id is in
 * `ok`, or the request fails as a whole with the first error. `message` is set when every record that ran gave the
 * same one.
 */
export interface ActionBulkResult extends BulkResult {
  message?: string;
}

/** The answer of a resource action. */
export interface ActionResourceResult {
  message?: string;
}

export type ActionResult = ActionRecordResult | ActionBulkResult | ActionResourceResult;

export interface MetaResourceSummary {
  name: string;
  label: string;
  icon?: string;
  /** Records can be created (the command palette offers "New …"). */
  creatable: boolean;
  /** Has `list.search`: global search (`/api/search`) covers it. */
  searchable: boolean;
}

/** A settings page (`@AdminSettingsPage`) in the sidebar. */
export interface MetaPageSummary {
  name: string;
  label: string;
  icon?: string;
}

export interface MetaGroup {
  key: string;
  label: string;
  icon?: string;
  /** May be empty: a group can hold only pages. */
  resources: MetaResourceSummary[];
  /** The settings pages of the group this user may view. */
  pages: MetaPageSummary[];
}

/**
 * A settings page: one form backed by host code (`@AdminSettingsPage`). Its permission codes are `page.<name>` (view)
 * and `page.<name>.update` (save; whoever may save may view).
 */
export interface PageSchema {
  name: string;
  label: string;
  icon?: string;
  fields: FieldSchema[];
  layout?: FormLayoutNode[];
  /** Keyed like `ResourceSchema.form.constraints`; every rule applies to what is sent (a save is partial). */
  constraints: Record<string, FieldConstraints>;
  /** Top-level fields the DTO requires. A save is partial, so this is for marking inputs, not for refusing a submit. */
  required: string[];
  /** The user may not save: no `page.<name>.update`, or viewing as another user. */
  readonly: boolean;
}

/** `GET /api/pages/:name`, and the answer of `PATCH /api/pages/:name`. */
export interface PageResponse {
  schema: PageSchema;
  /** Every field that is not a secret; `null` when nothing is stored. File fields hold keys. */
  values: Record<string, unknown>;
  /** Per secret field: whether a value is stored. The value itself is never sent. */
  secrets: Record<string, boolean>;
  /** A ref for every file the file fields hold (as `_files` of a record). */
  files: Record<string, AdminFileRef | AdminFileRef[]>;
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
  /** `@AdminResource({ readonly: true })`: nothing is created, changed or deleted through the admin (actions still run). */
  readonly?: boolean;
  permissions?: { create: boolean; update: boolean; delete: boolean; purge: boolean };
  /**
   * The custom actions (`@AdminAction`) the signed-in user may run, in declaration order. Record actions are narrowed
   * per record by `_perm.actions`.
   */
  actions: ActionSchema[];
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
    /** Sections, inlines and tabs (`form.layout`); absent = one section in form order. */
    layout?: FormLayoutNode[];
    constraints: { create: Record<string, FieldConstraints>; update: Record<string, FieldConstraints> };
  };
  /**
   * The schema of each child resource the layout places inline (`FormLayoutInline.inline`), cut for this user like
   * its own schema. Absent when the layout has no inline the user may see.
   */
  inlines?: Record<string, ResourceSchema>;
}

/**
 * A record: field name → value, dotted list paths (`'customer.name'`) as flat keys, `_id` (the encoded record id used
 * in URLs: key values in primary-key order, `~` as `~0` and `,` as `~1`, joined by `,`; `new` is `~new`), `_title`,
 * the record's display name (spec §5.2 `title`), `_perm` (`RecordPermissions`, absent when nothing narrows what the
 * schema allows), and when configured `_readonly` (fields `readonlyIf` locks on this
 * record) and `_links` (`RecordLink[]`). File and image fields hold their key (a list of keys with `file.many`), and
 * resources with such fields add `_files`: field name → `AdminFileRef` (`AdminFileRef[]` with `file.many`) for every
 * field that holds a file. `GET /resources/:resource/:id` of a resource with inlines adds `_inlines`: child resource
 * name → `InlineRows`, for each inline the user may see; so do the answers of its POST and PATCH, read after the save.
 */
export type AdminRecord = Record<string, unknown>;

/**
 * `_perm` of a record: what the user may do with this one (permission, row scopes and `@AdminCan` rules together).
 * `actions` is there on resources with record actions: the names of those the user may run on this record. A record
 * without `_perm` allows everything its schema does.
 */
export interface RecordPermissions {
  update: boolean;
  delete: boolean;
  actions?: string[];
}

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
  /** Two-factor sign-in can be set up on the account page. */
  twoFactor: boolean;
}

/** `GET /api/account/2fa`. */
export interface TwoFactorStatusResponse {
  enabled: boolean;
  recoveryCodesLeft: number;
}

/** `POST /api/account/2fa/setup`: shown once, to scan or type into the authenticator app. */
export interface TwoFactorSetupResponse {
  secret: string;
  otpauthUrl: string;
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
  /** The audit log (with `audit`): is it on (records have a history), and may this user read the audit page (`audit.view`). */
  audit: { enabled: boolean; view: boolean };
  /** Changes when roles or memberships change: refetch meta and schemas. */
  permissionsVersion: number;
  /** A superuser looking through another user's eyes (`X-View-As`): `user` is the target, `by` the superuser. Read-only. */
  viewAs?: { by: SessionUser };
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
  twoFactor?: boolean;
  roles: string[];
  groups: number[];
}

export interface RbacUsersResponse {
  items: RbacUser[];
  total: number;
  page: number;
  pageSize: number;
  /** What the auth adapter supports on this page. */
  capabilities: { list: boolean; create: boolean; update: boolean; password: boolean; resetTwoFactor: boolean };
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
    /** `@AdminAction`s: the permission code of each is `<resource>.action.<name>`. */
    actions: Array<{ name: string; label: string; target: 'record' | 'resource' }>;
  }>;
  /** Settings pages: the codes of each are `page.<name>` and `page.<name>.update`. */
  pages: Array<{ name: string; label: string; group: string }>;
  global: string[];
}

/** Where a user's role comes from. `group` names the group. */
export interface ExplainRoleSource {
  kind: 'direct' | 'group' | 'resolveRoles' | 'adapter';
  group?: string;
}

/** `GET /api/rbac/explain?user=&resource=[&record=]`: why a user may or may not do things (spec §6.7). */
export interface PermissionExplanation {
  user: SessionUser;
  superuser: boolean;
  /** Every role the user has; `known: false` names a role that does not exist (it grants nothing). */
  roles: Array<{ name: string; label?: LocalizedTextJson; known: boolean; sources: ExplainRoleSource[] }>;
  resource: { name: string; label: string };
  operations: Array<{
    operation: 'view' | 'create' | 'update' | 'delete' | 'purge';
    allowed: boolean;
    /** The patterns that grant it; `via: 'update'` when view comes from holding update. */
    grantedBy: Array<{ role: string; pattern: string; via?: 'update' }>;
  }>;
  /** The resource's `@AdminAction`s. `allowed` is what the schema offers the user; records narrow it (`record.actions`). */
  actions: Array<{
    name: string;
    label: string;
    target: 'record' | 'resource';
    allowed: boolean;
    /** Granted, but not allowed: a record action also needs `update` on the resource. */
    needsUpdate?: true;
    /** The patterns that grant `<resource>.action.<name>`. */
    grantedBy: Array<{ role: string; pattern: string }>;
  }>;
  fields: Array<{
    name: string;
    label: string;
    restricted: boolean;
    level: 'hidden' | 'view' | 'edit';
    /** Keys and the version stay visible whatever the roles say. */
    forced?: boolean;
    byRole: Array<{ role: string; level: 'hidden' | 'view' | 'edit'; rule?: string; code?: string }>;
  }>;
  scopes: Array<{
    operation: 'view' | 'update' | 'delete';
    /** `all` rows, or those of any of these scopes (none = no rows). */
    result: 'all' | string[];
    byRole: Array<{ role: string; scopes: 'all' | string[] }>;
    /** Global scopes that also apply (ANDed). */
    global: string[];
  }>;
  /** Every settings page (they belong to no resource): what the user may do, and the patterns that grant it. */
  pages: Array<{
    name: string;
    label: string;
    view: boolean;
    update: boolean;
    /** `code` is the page code the pattern matches: `page.<name>` or `page.<name>.update` (which also gives view). */
    grantedBy: Array<{ role: string; pattern: string; code: string }>;
  }>;
  record?: {
    id: string;
    exists: boolean;
    view: boolean;
    update: boolean;
    delete: boolean;
    /** The record actions the user may run on it (as in the record's `_perm.actions`); absent without record actions. */
    actions?: string[];
    /** Why each answer is no: `permission`, `scope`, `rule` (an `@AdminCan` method), `missing`. */
    reasons: Partial<Record<'view' | 'update' | 'delete', 'permission' | 'scope' | 'rule' | 'missing'>>;
  };
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
  | 'BAD_REQUEST' | 'VALIDATION' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'FORBIDDEN_FIELDS' | 'NOT_FOUND' | 'CONFLICT' | 'RATE_LIMITED' | 'TWO_FACTOR_REQUIRED' | 'BUSINESS_RULE' | 'INTERNAL';

export interface AdminErrorBody {
  code: AdminErrorCode;
  message: string;
  fields?: Record<string, string[]>;
  /** On a 409 for a stale `If-Match` version: the record as it is now (for the diff dialog). */
  current?: AdminRecord;
  correlationId: string;
}

/**
 * One changed field of an audit entry, as its reader may see it:
 * - `before` and `after`: the values (`before` is absent for a create, `after` for a delete). A related record is its
 *   id, a many-to-many its ids; decimals and bigints are strings, dates ISO text, files their keys. `truncated`: a
 *   long text was cut, or a large value left out.
 * - `changed: true`: a sensitive or secret field. Its values are not stored, so nobody is shown any.
 * - `hidden: true`: the field changed, and this reader may not see it (a field rule, a restricted field, or a field
 *   the resource no longer has).
 */
export type AuditEntryChange = { field: string; before?: unknown; after?: unknown; truncated?: true } | { field: string; changed: true } | { field: string; hidden: true };

/** What an audit entry says besides its changes. */
export interface AuditEntryMeta {
  /** `{resource}.action.{name}`: the action's name. */
  action?: string;
  /** The action's input without its sensitive keys; only for readers who hold the action. */
  input?: Record<string, unknown>;
  /** The input was too large to keep. */
  inputTruncated?: true;
  /**
   * The record was gone for good once this change was made (no row left, trash included): a delete where there is no
   * trash or by a host `delete()` that bypasses it, a purge, or an action that deleted the record it ran on. A
   * delete's entry may get it right after commit. It ends the record: a record with the same key afterwards is
   * another one.
   */
  deleted?: true;
  /** `page.{name}.updated`: the page's name. */
  page?: string;
  /** A child saved inline with its parent: the parent's resource and `_id` (for readers who may view that resource). */
  parent?: { resource: string; recordId: string };
  /** Where the request came from (`auth.*` entries); only for readers with `audit.view`. */
  ip?: string;
  userAgent?: string;
  /** `auth.login_failed`: what was typed as the username, and why it failed (`UNAUTHENTICATED`, `RATE_LIMITED`, `WRONG_CODE`, `SUPPRESSED`). */
  username?: string;
  reason?: string;
  /** `auth.login_failed`: the last failure recorded for its address in that minute; `suppressed` counts the ones left out. */
  limited?: true;
  suppressed?: number;
  /** `auth.sessions_revoked`: which sessions ended. */
  sessions?: 'others' | 'one';
}

/**
 * One entry of the audit log, cut to its reader (`GET /api/resources/:resource/:id/history` and `GET /api/audit`).
 * A key the reader may not see is absent, never null.
 */
export interface AuditEntry {
  /** A numeric string that grows with every entry; page with it (`before`). */
  id: string;
  /** ISO time (UTC). */
  at: string;
  /**
   * `product.updated`, `order.action.ship`, `page.shop.updated`, `rbac.role.changed`, `auth.login`… For an entry of
   * a resource the reader cannot reach, the resource's name is `*` and an action's name is left out: `*.updated`,
   * `*.action`; for a settings page they cannot view, `page.*.updated`.
   */
  event: string;
  /** Who did it, with their display name at the time; null when nobody was signed in (a failed sign-in). */
  actor: { id: string; name: string | null } | null;
  /** The superuser who was viewing the admin as `actor`. */
  viewAsBy?: string;
  /** The resource of a record or action entry. */
  resource?: string;
  /** The record's `_id`; for `rbac.*` a role's name or a group's or user's id; for `auth.*` the user concerned. */
  recordId?: string;
  /** The record's title when the entry was written. */
  recordTitle?: string;
  /** The changed fields. Absent when the entry describes no record change (a sign-in, a resource action) or when `restricted`; `[]` for a restore. */
  changes?: AuditEntryChange[];
  meta?: AuditEntryMeta;
  /**
   * The reader may not see what this entry is about: its changes are withheld, and, for a record they cannot view
   * (the resource, a record outside their scopes, or a record that is gone for good), the record's id and title too.
   */
  restricted?: true;
  /** The request's correlation id, as in its error responses and log lines. */
  correlationId: string;
}

/** A page of audit entries, newest first. `next` is the `before` of the following page; absent on the last one. */
export interface AuditResponse {
  entries: AuditEntry[];
  next?: string;
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
