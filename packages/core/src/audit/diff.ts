import type { FieldSchema } from '../contract.js';

/**
 * One changed field of an audit entry. `before` is absent on a create, `after` on a delete. A sensitive or secret
 * field is `{ field, changed: true }`: its values are never stored. `truncated`: a value was cut (a long text) or
 * left out (anything else) to keep the entry small.
 */
export type AuditChange = { field: string; before?: unknown; after?: unknown; truncated?: true } | { field: string; changed: true };

const isRef = (value: unknown): value is { id: unknown } => typeof value === 'object' && value !== null && !Array.isArray(value) && 'id' in value;

/** JSON with object keys sorted, so two objects with the same content are the same text. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item) && !(item instanceof Date)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : typeof item === 'bigint'
        ? item.toString()
        : item,
  );
}

const byId = (a: unknown, b: unknown): number => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/**
 * A value as the entry stores it: a related record as its id (never its title), a many-to-many as its ids in order,
 * dates as ISO text, bigints as strings.
 */
function stored(value: unknown, field: Pick<FieldSchema, 'type' | 'relation'>): unknown {
  if (value === null || value === undefined) return null;
  if (field.type === 'relation') {
    const id = (item: unknown) => (isRef(item) ? item.id : item);
    return Array.isArray(value) ? value.map(id).sort(byId) : id(value);
  }
  if (value instanceof Date) return field.type === 'date' ? value.toISOString().slice(0, 10) : value.toISOString();
  if (field.type === 'bigint' || typeof value === 'bigint') return String(value);
  return value;
}

/** What two stored values are compared by. */
function comparable(value: unknown, field: Pick<FieldSchema, 'type'>): string {
  if (value === null) return 'null';
  if (field.type === 'decimal' && /^-?\d+(\.\d+)?$/.test(String(value))) {
    // The same amount whatever the padding: "10.50", "10.5" and 10.5.
    const [integer, fraction = ''] = String(value).split('.');
    const trimmed = fraction.replace(/0+$/, '');
    return trimmed ? `${integer}.${trimmed}` : integer!;
  }
  if (field.type === 'datetime' && typeof value === 'string') {
    const time = Date.parse(value);
    return Number.isNaN(time) ? value : String(time);
  }
  return canonical(value);
}

const isEmpty = (value: unknown): boolean => value === null || (Array.isArray(value) && value.length === 0);

/**
 * The changed fields between two serialized records (`serializeFull`, or a settings page's values): `before` alone
 * is a delete (what it held), `after` alone a create (what it holds), both an update (what differs). Only `fields`
 * are looked at, dotted paths excluded. Objects and JSON are compared as JSON whatever their key order, related
 * records by id, many-to-many fields as id sets, decimals by amount, dates by moment, files by key (the column's
 * value). A field in `masked` is reported as `{ field, changed: true }`, without its values.
 */
export function diffRecords(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  fields: readonly FieldSchema[],
  masked: ReadonlySet<string>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const field of fields) {
    if (field.name.includes('.')) continue;
    const was = before ? stored(before[field.name], field) : null;
    const is = after ? stored(after[field.name], field) : null;
    if (before && after ? comparable(was, field) === comparable(is, field) : isEmpty(before ? was : is)) continue;
    if (masked.has(field.name)) changes.push({ field: field.name, changed: true });
    else changes.push({ field: field.name, ...(before ? { before: was } : {}), ...(after ? { after: is } : {}) });
  }
  return changes;
}

/** `diffRecords` for plain objects without a schema (a role, a group, a user's roles): the named keys, compared as JSON. */
export function diffPlain(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, keys: readonly string[]): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const key of keys) {
    const was = before?.[key] ?? null;
    const is = after?.[key] ?? null;
    if (before && after ? canonical(was) === canonical(is) : (before ? was : is) === null) continue;
    changes.push({ field: key, ...(before ? { before: was } : {}), ...(after ? { after: is } : {}) });
  }
  return changes;
}

/** Characters of a text value that are kept, and the JSON size above which any other value is left out. */
const VALUE_LIMIT = 4_000;
/** The whole `changes` column, in bytes: under the 65,535 a MySQL TEXT holds (where `simple-json` lives). */
export const CHANGES_LIMIT = 48_000;

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? '');

/**
 * The changes as they fit a row: a text longer than 4,000 characters is cut, any other value whose JSON is longer
 * is left out, and if the entry is still over 48 kB the largest changes lose their values until it fits. Each
 * change touched says `truncated: true`; every field stays listed.
 */
export function fitChanges(changes: AuditChange[]): AuditChange[] {
  const fitted = changes.map((change): AuditChange => {
    if ('changed' in change) return change;
    const out: { field: string; before?: unknown; after?: unknown; truncated?: true } = { field: change.field };
    for (const side of ['before', 'after'] as const) {
      if (!(side in change)) continue;
      const value = change[side];
      if (typeof value === 'string' && value.length > VALUE_LIMIT) {
        out[side] = `${value.slice(0, VALUE_LIMIT)}…`;
        out.truncated = true;
      } else if (typeof value !== 'string' && (JSON.stringify(value) ?? '').length > VALUE_LIMIT) out.truncated = true;
      else out[side] = value;
    }
    return out;
  });
  let total = bytes(fitted);
  if (total <= CHANGES_LIMIT) return fitted;
  const largestFirst = fitted.map((change, index) => ({ index, size: bytes(change) })).sort((a, b) => b.size - a.size);
  for (const { index, size } of largestFirst) {
    if (total <= CHANGES_LIMIT) break;
    const bare: AuditChange = { field: fitted[index]!.field, truncated: true };
    fitted[index] = bare;
    total -= size - bytes(bare);
  }
  return fitted;
}
