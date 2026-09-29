import type { ResourceSchema } from '../contract.js';
import { AdminNotFoundError } from '../errors.js';
import type { RecordId } from '../resource/admin-resource-base.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Converts the id from the URL to the primary key's type. Ids that cannot exist are 404s, never database errors. */
export function parseRecordId(raw: string, schema: ResourceSchema): RecordId {
  const notFound = () => new AdminNotFoundError(`${schema.label} "${raw}" not found`);
  const type = schema.fields.find((field) => field.name === schema.primaryKey)?.type;
  if (type === 'number') {
    if (!/^-?\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw notFound();
    return Number(raw);
  }
  if (type === 'uuid' && !UUID.test(raw)) throw notFound();
  return raw;
}
