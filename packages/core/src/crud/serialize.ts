import type { AdminRecord, FieldSchema } from '../contract.js';

/**
 * Entity → JSON-safe record containing only the schema's persisted fields. Values in `loaded` win (the reference
 * loader's relations and paths, the discriminator); relation fields and dotted paths without one are left out.
 * `meta` adds `_id` and `_title`.
 */
export function serializeRecord(
  entity: object,
  fields: FieldSchema[],
  loaded?: Record<string, unknown>,
  meta: { id?: string; title?: string } = {},
): AdminRecord {
  const source = entity as Record<string, unknown>;
  const out: AdminRecord = {};
  for (const field of fields) {
    if (!field.persisted) continue;
    if (loaded && Object.hasOwn(loaded, field.name)) {
      out[field.name] = loaded[field.name];
      continue;
    }
    if (field.type === 'relation' || field.name.includes('.')) {
      if (loaded && Object.hasOwn(loaded, field.name)) out[field.name] = loaded[field.name];
      continue;
    }
    out[field.name] = field.type === 'object' ? serializeObject(source[field.name], field) : serializeValue(source[field.name], field);
  }
  if (meta.id !== undefined) out._id = meta.id;
  if (meta.title !== undefined) out._title = meta.title;
  return out;
}

/**
 * An embedded object (or list of them) with each child serialized by its type. An object backed by a json column
 * (children not persisted) is returned as stored, so keys the DTO does not describe survive a round trip.
 */
export function serializeObject(value: unknown, field: FieldSchema): unknown {
  if (value === null || value === undefined) return null;
  const children = field.fields ?? [];
  if (!children.some((child) => child.persisted)) return value;
  const group = (item: unknown): unknown => {
    if (typeof item !== 'object' || item === null) return null;
    const source = item as Record<string, unknown>;
    return Object.fromEntries(
      children.map((child) => [child.name, child.type === 'object' ? serializeObject(source[child.name], child) : serializeValue(source[child.name], child)]),
    );
  };
  if (field.many) return Array.isArray(value) ? value.map(group) : null;
  return group(value);
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
