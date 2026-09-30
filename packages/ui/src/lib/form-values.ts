import type { AdminRecord, FieldSchema } from '@nest-my-admin/core/contract';

export type FormValues = Record<string, string | boolean>;

export interface PayloadResult {
  payload: Record<string, unknown>;
  errors: Record<string, string[]>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string → value for <input type="datetime-local"> in the browser's timezone. */
export function toDatetimeLocal(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Record → the string/boolean values the inputs edit. */
export function toFormValues(fields: FieldSchema[], record?: AdminRecord): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const value = record?.[field.name];
    if (field.type === 'boolean') values[field.name] = value === true;
    else if (value === null || value === undefined) values[field.name] = '';
    else if (field.type === 'json') values[field.name] = JSON.stringify(value, null, 2);
    else if (field.type === 'datetime') values[field.name] = toDatetimeLocal(String(value));
    else values[field.name] = String(value);
  }
  return values;
}

/**
 * Plain digits with an optional fraction; thousands commas are dropped only when grouped correctly
 * ("1,234.50"), so a decimal comma ("1,50") is an error instead of becoming 150.
 */
function normalizeNumeric(text: string, integerOnly: boolean): string | undefined {
  const value = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) ? text.replace(/,/g, '') : text;
  if (!(integerOnly ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/).test(value)) return undefined;
  return value;
}

/**
 * Input values → JSON payload for `fields`. With `initial` (edit mode) only changed values are sent and a
 * cleared input is sent as null. On create, an empty input is null for nullable fields and omitted otherwise,
 * so the server reports "required" (or applies the column default) instead of receiving "" or 0.
 */
export function toPayload(fields: FieldSchema[], values: FormValues, initial?: FormValues): PayloadResult {
  const payload: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (initial && raw === initial[field.name]) continue;
    if (field.type === 'boolean') {
      payload[field.name] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw : '';
    const trimmed = text.trim();
    if (trimmed === '') {
      if (field.nullable || initial) payload[field.name] = null;
      continue;
    }
    switch (field.type) {
      case 'number':
      case 'decimal':
      case 'bigint': {
        const numeric = normalizeNumeric(trimmed, field.type === 'bigint');
        if (numeric === undefined) errors[field.name] = ['must be a number'];
        else payload[field.name] = field.type === 'number' ? Number(numeric) : numeric;
        break;
      }
      case 'json':
        try {
          payload[field.name] = JSON.parse(trimmed);
        } catch {
          errors[field.name] = ['must be valid JSON'];
        }
        break;
      case 'datetime': {
        const date = new Date(trimmed);
        if (Number.isNaN(date.getTime())) errors[field.name] = ['must be a valid date and time'];
        else payload[field.name] = date.toISOString();
        break;
      }
      default:
        payload[field.name] = text;
    }
  }
  return { payload, errors };
}
