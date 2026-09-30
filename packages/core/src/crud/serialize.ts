import type { AdminRecord, FieldSchema } from '../contract.js';

/**
 * Entity → JSON-safe record containing only the schema's persisted fields. Relation fields and dotted paths come
 * from `loaded` (the reference loader) and are left out when it has none for them; `title` becomes `_title`.
 */
export function serializeRecord(entity: object, fields: FieldSchema[], loaded?: Record<string, unknown>, title?: string): AdminRecord {
  const source = entity as Record<string, unknown>;
  const out: AdminRecord = {};
  for (const field of fields) {
    if (!field.persisted) continue;
    if (field.type === 'relation' || field.name.includes('.')) {
      if (loaded && Object.hasOwn(loaded, field.name)) out[field.name] = loaded[field.name];
      continue;
    }
    out[field.name] = serializeValue(source[field.name], field);
  }
  if (title !== undefined) out._title = title;
  return out;
}

export function serializeValue(value: unknown, field: FieldSchema): unknown {
  if (value === null || value === undefined) return null;
  switch (field.type) {
    case 'decimal':
      return formatDecimal(value, field.scale);
    case 'bigint':
      return String(value);
    case 'date':
      return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    case 'datetime':
      return value instanceof Date ? value.toISOString() : value;
    default:
      return value;
  }
}

/**
 * Decimals are always strings. Drivers differ (Postgres returns "1.50", SQLite returns 1.5),
 * so values are padded to the column scale with string arithmetic; never rounded.
 */
export function formatDecimal(value: unknown, scale?: number): string {
  if (typeof value === 'number') return scale === undefined ? String(value) : value.toFixed(scale);
  const text = String(value);
  if (scale === undefined || scale === 0 || !/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [integer, fraction = ''] = text.split('.');
  return fraction.length >= scale ? text : `${integer}.${fraction.padEnd(scale, '0')}`;
}
