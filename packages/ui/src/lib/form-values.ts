import type { AdminRecord, FieldSchema, RelationRef } from '@nest-my-admin/core/contract';
import { translate as tr } from '@/i18n';

/**
 * What an input edits: text, a checkbox, a picked record (to-one relation), picked records (to-many), or the values
 * of a sub-form (object field) or of a list of sub-forms (`many`).
 */
export type FormValue = string | boolean | RelationRef | null | RelationRef[] | FormValues | FormValues[];
export interface FormValues {
  [name: string]: FormValue;
}

const asGroup = (value: FormValue | undefined): FormValues =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as FormValues) : {};
const asGroups = (value: FormValue | undefined): FormValues[] => (Array.isArray(value) ? (value as FormValues[]) : []);

export function isRef(value: unknown): value is RelationRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'id' in value && 'title' in value;
}

const sameIds = (a: RelationRef[], b: RelationRef[]) => {
  const ids = new Set(a.map((ref) => String(ref.id)));
  return a.length === b.length && b.every((ref) => ids.has(String(ref.id)));
};

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
    if (field.type === 'object') {
      const children = field.fields ?? [];
      values[field.name] = field.many
        ? (Array.isArray(value) ? value : []).map((item) => toFormValues(children, item as AdminRecord))
        : toFormValues(children, (value ?? undefined) as AdminRecord | undefined);
    } else if (field.relation?.kind === 'to-many') values[field.name] = Array.isArray(value) ? value.filter(isRef) : [];
    else if (field.type === 'relation') values[field.name] = isRef(value) ? value : null;
    else if (field.type === 'boolean') values[field.name] = value === true;
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
export function toPayload(fields: FieldSchema[], values: FormValues, initial?: FormValues, prefix = ''): PayloadResult {
  const payload: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (initial && raw === initial[field.name]) continue;
    const path = `${prefix}${field.name}`;
    if (field.type === 'object') {
      const children = field.fields ?? [];
      if (field.many) {
        // A list is sent whole (each item as on create); in edit mode only when it changed.
        const items = asGroups(raw).map((item, index) => toPayload(children, item, undefined, `${path}.${index}.`));
        for (const item of items) Object.assign(errors, item.errors);
        const list = items.map((item) => item.payload);
        const before = initial ? asGroups(initial[field.name]).map((item) => toPayload(children, item).payload) : undefined;
        if (before ? JSON.stringify(before) !== JSON.stringify(list) : list.length > 0) payload[field.name] = list;
        continue;
      }
      // One sub-form: in edit mode only its changed fields (a partial update); on create all of them.
      const group = toPayload(children, asGroup(raw), initial ? asGroup(initial[field.name]) : undefined, `${path}.`);
      Object.assign(errors, group.errors);
      if (Object.keys(group.payload).length > 0 || (!initial && !field.nullable)) payload[field.name] = group.payload;
      continue;
    }
    if (field.relation?.kind === 'to-many') {
      const refs = Array.isArray(raw) ? raw.filter(isRef) : [];
      const before = initial?.[field.name];
      if (initial ? !sameIds(refs, Array.isArray(before) ? before.filter(isRef) : []) : refs.length > 0) payload[field.name] = refs.map((ref) => ref.id);
      continue;
    }
    if (field.type === 'relation') {
      const ref = isRef(raw) ? raw : null;
      const before = initial?.[field.name];
      if (initial && String(ref?.id) === String(isRef(before) ? before.id : undefined)) continue;
      if (ref) payload[field.name] = ref.id;
      else if (field.nullable || initial) payload[field.name] = null;
      continue;
    }
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
        if (numeric === undefined) errors[path] = [tr('validation.number')];
        else payload[field.name] = field.type === 'number' ? Number(numeric) : numeric;
        break;
      }
      case 'json':
        try {
          payload[field.name] = JSON.parse(trimmed);
        } catch {
          errors[path] = [tr('validation.json')];
        }
        break;
      case 'datetime': {
        const date = new Date(trimmed);
        if (Number.isNaN(date.getTime())) errors[path] = [tr('validation.datetime')];
        else payload[field.name] = date.toISOString();
        break;
      }
      default:
        payload[field.name] = text;
    }
  }
  return { payload, errors };
}

/**
 * The form's values as `relationOptions()` sees them (`?values=`): what a save would send, keeping ids, numbers,
 * booleans and short text (long text and groups are left out). Undefined when that is still over 4 KB.
 */
export function dependencyValues(fields: FieldSchema[], values: FormValues): string | undefined {
  const { payload } = toPayload(fields, values);
  const small = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.every((item) => typeof item === 'string' || typeof item === 'number');
    if (typeof value === 'string') return value.length <= 100;
    return value === null || typeof value !== 'object';
  };
  const kept = Object.fromEntries(Object.entries(payload).filter(([, value]) => small(value)));
  const json = JSON.stringify(kept);
  return json.length <= 4000 ? json : undefined;
}
