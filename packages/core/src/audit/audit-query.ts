import { AdminValidationError } from '../errors.js';

/** What `GET /api/audit` may be asked for; a record's history takes `before` alone. */
export const AUDIT_FILTERS = ['actor', 'event', 'resource', 'record', 'from', 'to', 'before'] as const;
export type AuditFilterName = (typeof AUDIT_FILTERS)[number];

export interface AuditQuery {
  actor?: string;
  /** An event's whole name, or a prefix when it ends with `.*` (`product.*`). */
  event?: string;
  resource?: string;
  record?: string;
  /** Entries at or after this instant. */
  from?: Date;
  /** Entries before this instant, or up to and including it. */
  to?: { at: Date; inclusive: boolean };
  /** Entries with a smaller id (the previous page's `next`). */
  before?: number;
}

const DAY_MS = 86_400_000;
// Years every supported database stores (MySQL's DATETIME starts at 1000), with room for the day added to `to`.
const EARLIEST = Date.UTC(1900, 0, 1);
const LATEST = Date.UTC(9000, 0, 1);
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/;

/**
 * `2026-10-12` (the whole day, in UTC) or `2026-10-12T08:30[:15[.250]][Z|+03:30]` (that instant; UTC without a
 * zone). Computed here rather than by `Date.parse`, which engines disagree on. Undefined for anything else.
 */
export function parseInstant(raw: string): { at: Date; day: boolean } | undefined {
  const match = INSTANT.exec(raw);
  if (!match) return undefined;
  const [, year, month, date, hour, minute, second, fraction, zone] = match;
  const day = hour === undefined;
  const midnight = Date.UTC(Number(year), Number(month) - 1, Number(date));
  // 02-31 would roll over into March: not a date.
  if (new Date(midnight).toISOString().slice(0, 10) !== `${year}-${month}-${date}`) return undefined;
  let time = midnight;
  if (!day) {
    time += Number(hour) * 3_600_000 + Number(minute) * 60_000 + Number(second ?? 0) * 1000 + Number((fraction ?? '').padEnd(3, '0'));
    if (zone && zone !== 'Z') {
      const offset = (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * 60_000;
      time += zone.startsWith('-') ? offset : -offset;
    }
  }
  if (time < EARLIEST || time > LATEST) return undefined;
  return { at: new Date(time), day };
}

/**
 * Reads the query of an audit listing. A parameter that is not `allowed`, is given twice or cannot be read is a 422
 * on that parameter; an empty one is as if it were not sent. A value that merely matches nothing is not an error.
 */
export function parseAuditQuery(query: URLSearchParams, allowed: readonly AuditFilterName[]): AuditQuery {
  const errors: Record<string, string[]> = {};
  for (const key of new Set(query.keys())) {
    if (!(allowed as readonly string[]).includes(key)) errors[key] = ['is not a supported parameter'];
    else if (query.getAll(key).length > 1) errors[key] = ['must be given once'];
  }
  const read = (key: AuditFilterName): string | undefined => {
    const value = query.get(key);
    return value === null || value === '' || errors[key] || !allowed.includes(key) ? undefined : value;
  };
  const out: AuditQuery = {};
  for (const key of ['actor', 'event', 'resource', 'record'] as const) {
    const value = read(key);
    if (value === undefined) continue;
    // Longer than any column it is compared with, or a control character (Postgres refuses a NUL in a text).
    if (value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) errors[key] = ['must be at most 255 characters of text'];
    else out[key] = value;
  }
  for (const key of ['from', 'to'] as const) {
    const value = read(key);
    if (value === undefined) continue;
    const instant = parseInstant(value);
    if (!instant) errors[key] = ['must be a date (2026-10-12) or a time (2026-10-12T08:30:00Z)'];
    else if (key === 'from') out.from = instant.at;
    // A day includes all of itself: up to the next midnight.
    else out.to = instant.day ? { at: new Date(instant.at.getTime() + DAY_MS), inclusive: false } : { at: instant.at, inclusive: true };
  }
  const before = read('before');
  if (before !== undefined) {
    if (!/^\d{1,15}$/.test(before)) errors.before = ['must be the `next` of the page before'];
    else out.before = Number(before);
  }
  if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
  return out;
}
