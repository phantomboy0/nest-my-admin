import type { FieldSchema, ResourceSchema } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { RecordId } from '../resource/admin-resource-base.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyText(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The record id the UI puts in URLs (`_id`): key values in primary-column order, `~` written `~0` and `,` written
 * `~1`, joined by `,`. An id that would read `new` is `~new`, so it never collides with the create page.
 */
export function encodeRecordId(values: unknown[]): string {
  const encoded = values.map((value) => keyText(value).replace(/~/g, '~0').replace(/,/g, '~1')).join(',');
  return encoded === 'new' ? '~new' : encoded;
}

/** `_id` of an entity. */
export function recordIdOf(entity: object, primaryKeys: string[]): string {
  return encodeRecordId(primaryKeys.map((key) => (entity as Record<string, unknown>)[key]));
}

/** The key parts of an encoded id, or undefined when it is not a valid encoding. */
function decodeParts(raw: string): string[] | undefined {
  if (raw === '~new') return ['new'];
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (char === ',') {
      parts.push(current);
      current = '';
    } else if (char === '~') {
      const next = raw[++i];
      if (next === '0') current += '~';
      else if (next === '1') current += ',';
      else return undefined;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

function parseKeyPart(raw: string, field: FieldSchema | undefined): string | number | undefined {
  switch (field?.type) {
    case 'number':
      return /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : undefined;
    case 'bigint':
      return /^-?\d+$/.test(raw) ? raw : undefined;
    case 'uuid':
      return UUID.test(raw) ? raw : undefined;
    default:
      return raw;
  }
}

/**
 * Turns an encoded id from the URL into what `findOne` gets: the key's value for single-key resources, an object of
 * key values for composite keys. Ids that cannot exist are 404s, never database errors.
 */
export function parseRecordId(raw: string, schema: ResourceSchema): RecordId {
  const notFound = () => new AdminNotFoundError(`${schema.label} "${raw}" not found`);
  const parts = decodeParts(raw);
  if (!parts || parts.length !== schema.primaryKeys.length) throw notFound();
  const values = parts.map((part, index) => {
    const key = schema.primaryKeys[index]!;
    const value = parseKeyPart(part, schema.fields.find((field) => field.name === key));
    if (value === undefined) throw notFound();
    return value;
  });
  if (values.length === 1) return values[0]!;
  return Object.fromEntries(schema.primaryKeys.map((key, index) => [key, values[index]!]));
}
