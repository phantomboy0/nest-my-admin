import type { AuditEntry, AuditEntryChange, FieldSchema, MetaResponse, ResourceSchema } from '@nest-my-admin/core/contract';
import { translate as tr, type MessageKey } from '@/i18n';
import { formatCell, richTextExcerpt } from '@/lib/format';
import type { ParamChanges } from '@/lib/list-state';

/** Labels the reader's meta and schemas have for what an entry names; each may not know (the raw name is shown then). */
export interface AuditNames {
  resource?: (name: string) => string | undefined;
  action?: (resource: string, name: string) => string | undefined;
  page?: (name: string) => string | undefined;
  /** Whether deleting in this resource moves to the trash. */
  softDelete?: (resource: string) => boolean | undefined;
}

/** The names the reader's meta and loaded schemas give: resource and page labels from meta, action labels and the trash from schemas. */
export function auditNames(meta: MetaResponse | undefined, schemaOf: (resource: string) => ResourceSchema | undefined): AuditNames {
  const groups = meta?.groups ?? [];
  return {
    resource: (name) => schemaOf(name)?.label ?? groups.flatMap((group) => group.resources).find((resource) => resource.name === name)?.label,
    page: (name) => groups.flatMap((group) => group.pages).find((page) => page.name === name)?.label,
    action: (resource, name) => schemaOf(resource)?.actions?.find((action) => action.name === name)?.label,
    softDelete: (resource) => schemaOf(resource)?.softDelete,
  };
}

type Entry = Pick<AuditEntry, 'event' | 'resource' | 'recordId' | 'recordTitle' | 'meta' | 'restricted' | 'changes'>;

const RECORD_EVENTS: Record<string, MessageKey> = {
  created: 'audit.event.created',
  updated: 'audit.event.updated',
  deleted: 'audit.event.deleted',
  restored: 'audit.event.restored',
  purged: 'audit.event.purged',
};

const FIXED_EVENTS: Record<string, MessageKey> = {
  'auth.login': 'audit.event.login',
  'auth.logout': 'audit.event.logout',
  'auth.view_as': 'audit.event.viewAs',
  'auth.password_changed': 'audit.event.passwordChanged',
  'auth.two_factor_enabled': 'audit.event.twoFactorEnabled',
  'auth.two_factor_disabled': 'audit.event.twoFactorDisabled',
  'auth.recovery_codes_regenerated': 'audit.event.recoveryCodes',
  'rbac.role.changed': 'audit.event.roleChanged',
  'rbac.group.changed': 'audit.event.groupChanged',
  'rbac.user_roles.changed': 'audit.event.userRolesChanged',
  'rbac.user.created': 'audit.event.userCreated',
  'rbac.user.changed': 'audit.event.userChanged',
  'rbac.user.password_reset': 'audit.event.passwordReset',
  'rbac.user.two_factor_reset': 'audit.event.twoFactorReset',
};

const FAILED_SIGN_IN: Record<string, MessageKey> = {
  WRONG_CODE: 'audit.event.loginFailedCode',
  RATE_LIMITED: 'audit.event.loginFailedLimited',
};

/**
 * An entry of a resource or settings page the reader cannot reach: the server names nothing (`*.updated`, `*.action`,
 * `page.*.updated`), and the UI says only that something happened.
 */
export function isAnonymous(entry: Pick<AuditEntry, 'event'>): boolean {
  return entry.event.startsWith('*.') || entry.event.startsWith('page.*.');
}

/** What a record or action entry says after its resource's name: `updated`, `action.ship`. */
function recordEvent(entry: Entry): string | undefined {
  return entry.resource !== undefined && entry.event.startsWith(`${entry.resource}.`) ? entry.event.slice(entry.resource.length + 1) : undefined;
}

const PAGE_EVENT = /^page\.(.+)\.updated$/;

/** What happened, in words. An event of no known family is shown as it is stored. */
export function eventLabel(entry: Entry, names: AuditNames = {}): string {
  if (isAnonymous(entry)) return tr('audit.event.unseen');
  const rest = recordEvent(entry);
  if (rest !== undefined) {
    if (rest.startsWith('action.') && rest.length > 'action.'.length) {
      const name = rest.slice('action.'.length);
      return tr('audit.event.action', { action: names.action?.(entry.resource!, name) ?? name });
    }
    if (rest === 'deleted' && names.softDelete?.(entry.resource!)) return tr('audit.event.trashed');
    const key = RECORD_EVENTS[rest];
    return key ? tr(key) : entry.event;
  }
  const page = PAGE_EVENT.exec(entry.event)?.[1];
  if (page !== undefined) return tr('audit.event.page', { page: names.page?.(page) ?? page });
  if (entry.event === 'auth.login_failed') {
    const reason = entry.meta?.reason;
    if (reason === 'SUPPRESSED') return tr('audit.event.loginFailedMore', { count: entry.meta?.suppressed ?? 0 });
    return tr((reason && FAILED_SIGN_IN[reason]) || 'audit.event.loginFailed');
  }
  if (entry.event === 'auth.sessions_revoked') {
    const which = entry.meta?.sessions;
    return tr(which === 'others' ? 'audit.event.sessionsOthers' : which === 'one' ? 'audit.event.sessionsOne' : 'audit.event.sessions');
  }
  const key = FIXED_EVENTS[entry.event];
  return key ? tr(key) : entry.event;
}

/** A second sentence some entries need: the cap on failed sign-ins, an action that deleted its record. */
export function eventDetail(entry: Entry): string | undefined {
  if (entry.event === 'auth.login_failed') {
    if (entry.meta?.reason === 'SUPPRESSED') return tr('audit.suppressedNote');
    if (entry.meta?.limited) return tr('audit.limitedNote');
  }
  if (entry.meta?.deleted) return tr('audit.actionDeleted');
  return undefined;
}

/**
 * What the entry is about: "Order: SO-1004" (or "Order #4"), a user's or role's name, the username of a failed
 * sign-in. Nothing for anonymised entries, sign-ins of the actor themselves, and settings pages (the label names those).
 */
export function entrySubject(entry: Entry, names: AuditNames = {}): string | undefined {
  if (isAnonymous(entry)) return undefined;
  if (entry.resource !== undefined) {
    const label = names.resource?.(entry.resource) ?? entry.resource;
    if (entry.recordId === undefined) return label;
    return entry.recordTitle !== undefined && entry.recordTitle !== '' ? `${label}: ${entry.recordTitle}` : `${label} #${entry.recordId}`;
  }
  if (entry.recordTitle !== undefined && entry.recordTitle !== '') return entry.recordTitle;
  if (entry.recordId !== undefined) return entry.recordId;
  if (entry.event === 'auth.login_failed' && entry.meta?.username) return entry.meta.username;
  return undefined;
}

/** For an entry whose details are withheld from this reader (and whose label does not already say so). */
export function restrictedNote(entry: Entry): string | undefined {
  if (!entry.restricted || isAnonymous(entry)) return undefined;
  return tr(entry.resource !== undefined ? 'audit.restrictedRecord' : 'audit.restrictedChanges');
}

export interface ChangeRow {
  field: string;
  /** The field's label in the reader's schema, else its name. */
  label: string;
  /** `changed`: a sensitive field, no values exist. `hidden`: not this reader's to see. `dropped`: too large to keep. */
  state: 'values' | 'changed' | 'hidden' | 'dropped';
  /** Absent: the entry has no such side (a create has no before, a delete no after). */
  before?: string;
  after?: string;
  /** A value was cut (or left out) for its size. */
  truncated: boolean;
}

/** A title for a related record's id, when the page already knows one. */
export type TitleOf = (id: string) => string | undefined;

/** One changed field, ready to show. `field` is the reader's schema of it, when they have one. */
export function changeRow(change: AuditEntryChange, field: FieldSchema | undefined, titleOf?: TitleOf): ChangeRow {
  const base = { field: change.field, label: field?.label ?? change.field };
  // Hidden and sensitive first: whatever else such a change carried would not be shown.
  if ('hidden' in change && change.hidden) return { ...base, state: 'hidden', truncated: false };
  if ('changed' in change && change.changed) return { ...base, state: 'changed', truncated: false };
  const values = change as { before?: unknown; after?: unknown; truncated?: true };
  const truncated = values.truncated === true;
  if (truncated && !('before' in values) && !('after' in values)) return { ...base, state: 'dropped', truncated };
  return {
    ...base,
    state: 'values',
    before: 'before' in values && values.before !== undefined ? formatAuditValue(values.before, field, titleOf) : undefined,
    after: 'after' in values && values.after !== undefined ? formatAuditValue(values.after, field, titleOf) : undefined,
    truncated,
  };
}

const EMPTY = '—';
/** Rich text and long text are shown whole (the server already cut them at 4,000 characters); the page collapses them. */
const WHOLE = 100_000;

function raw(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return tr(value ? 'common.yes' : 'common.no');
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.length === 0 ? EMPTY : value.every((item) => typeof item !== 'object' || item === null) ? value.map(String).join(', ') : JSON.stringify(value);
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * A stored value as text, through the formatter the record view uses when the reader's schema has the field
 * (dates in the chosen calendar, digits, enum labels, money). Relations are ids, files are names, rich text is its
 * text: nothing here is ever HTML or a link.
 */
export function formatAuditValue(value: unknown, field: FieldSchema | undefined, titleOf?: TitleOf): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (!field) return raw(value);
  if (field.type === 'relation') {
    const ids = (Array.isArray(value) ? value : [value]).map((item) => String(typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : item));
    if (ids.length === 0) return EMPTY;
    return ids
      .map((id) => {
        const title = titleOf?.(id);
        return title !== undefined && title !== '' && title !== `#${id}` ? `${title} (#${id})` : `#${id}`;
      })
      .join(', ');
  }
  if (field.file) return typeof value === 'string' || Array.isArray(value) ? formatCell(value, field) : raw(value);
  if (field.type === 'json' || field.type === 'object') return typeof value === 'string' ? value : JSON.stringify(value);
  // Past here every formatter expects a scalar.
  if (typeof value === 'object') return raw(value);
  if (field.widget === 'richtext') return richTextExcerpt(String(value), WHOLE) || EMPTY;
  return formatCell(value, field);
}

export const AUDIT_FILTERS = ['actor', 'event', 'resource', 'record', 'from', 'to'] as const;
export type AuditFilter = (typeof AUDIT_FILTERS)[number];

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day of the reader's own calendar day (their time zone) as the instant it starts or ends; anything else as typed. */
function dayInstant(value: string, end: boolean): string {
  const match = DAY.exec(value);
  if (!match) return value;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = end ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
  // `2026-02-31` would roll over into March: leave it to the server to refuse.
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.toISOString() : value;
}

/**
 * The `/api/audit` query for the page's URL: the audit filters only, a `record` only with its `resource`, and
 * `from`/`to` days as instants (the times on the page are the reader's local times, so the days are too).
 */
export function auditQueryFromUrl(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const key of AUDIT_FILTERS) {
    const value = params.get(key);
    if (value === null || value === '') continue;
    if (key === 'record' && !params.get('resource')) continue;
    query.set(key, key === 'from' ? dayInstant(value, false) : key === 'to' ? dayInstant(value, true) : value);
  }
  query.sort();
  return query.toString();
}

export function hasAuditFilters(params: URLSearchParams): boolean {
  return auditQueryFromUrl(params) !== '';
}

/** URL changes for one filter. A record id means something only inside its resource, so another resource drops it. */
export function auditFilterChanges(key: AuditFilter, value: string): ParamChanges {
  const text = value.trim();
  return key === 'resource' ? { resource: text || null, record: null } : { [key]: text || null };
}

export function clearAuditFilters(): ParamChanges {
  return Object.fromEntries(AUDIT_FILTERS.map((key) => [key, null]));
}
