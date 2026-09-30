import type { FieldSchema, FilterOperator, ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import type { FilterCondition, FilterValue, ListParams } from '../resource/admin-resource-base.js';
import { MAX_PAGE_SIZE } from '../schema/build-resource-schema.js';

type Errors = Record<string, string[]>;
type Parsed<T> = { value: T } | { error: string };

const PAGING_KEYS = new Set(['page', 'pageSize', 'sort', 'search', 'trashed']);
const FILTER_KEY = /^filter\[([^\][]+)\](?:\[([^\][]+)\])?$/;
const MAX_LIST_VALUES = 100;
const MAX_TEXT = 200;
const NUMBER = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;
const MAX_INT32 = 2147483647;
const MAX_INT64 = 9223372036854775807n;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parses `page`, `pageSize`, `sort`, `search` and `filter[field][op]` (spec §11). Field names come only from the schema. */
export function parseListQuery(query: URLSearchParams, schema: ResourceSchema): ListParams {
  const errors: Errors = Object.create(null) as Errors;
  const page = readPositiveInt(query, 'page', 1, errors);
  const pageSize = readPositiveInt(query, 'pageSize', schema.list.pageSize, errors);
  if (!errors.pageSize && pageSize > MAX_PAGE_SIZE) errors.pageSize = [`must be at most ${MAX_PAGE_SIZE}`];

  let sort = schema.list.defaultSort;
  const rawSort = readOne(query, 'sort', errors);
  if (rawSort !== undefined) {
    const field = rawSort.replace(/^-/, '');
    if (schema.list.sortable.includes(field)) sort = { field, direction: rawSort.startsWith('-') ? 'desc' : 'asc' };
    else errors.sort = [`cannot sort by "${field}"`];
  }

  const filters: FilterCondition[] = [];
  for (const key of new Set(query.keys())) {
    if (PAGING_KEYS.has(key)) continue;
    const match = FILTER_KEY.exec(key);
    if (!match) {
      errors[key] = ['is not a supported list parameter'];
      continue;
    }
    const raw = readOne(query, key, errors);
    if (raw === undefined) continue;
    const fieldName = match[1]!;
    const operator = (match[2] ?? 'eq') as FilterOperator;
    const allowed = schema.list.filters.find((filter) => filter.field === fieldName);
    if (!allowed) {
      errors[key] = [`cannot filter by "${fieldName}"`];
      continue;
    }
    if (!allowed.operators.includes(operator)) {
      errors[key] = [`operator "${operator}" is not allowed for "${fieldName}" (allowed: ${allowed.operators.join(', ')})`];
      continue;
    }
    const field = schema.fields.find((candidate) => candidate.name === fieldName)!;
    const parsed = parseFilterValue(field, operator, raw);
    if ('error' in parsed) errors[key] = [parsed.error];
    else filters.push({ field: fieldName, operator, value: parsed.value });
  }

  let search: ListParams['search'];
  const rawSearch = readOne(query, 'search', errors);
  if (rawSearch !== undefined && rawSearch.trim() !== '') {
    const term = rawSearch.trim();
    if (schema.list.search.length === 0) errors.search = ['this resource is not searchable'];
    else if (term.length > MAX_TEXT) errors.search = [`must be at most ${MAX_TEXT} characters`];
    else search = { term, fields: schema.list.search };
  }

  let trashed: ListParams['trashed'];
  const rawTrashed = readOne(query, 'trashed', errors);
  if (rawTrashed !== undefined) {
    if (!schema.softDelete) errors.trashed = ['this resource has no trash'];
    else if (rawTrashed === 'only' || rawTrashed === 'with') trashed = rawTrashed;
    else errors.trashed = ['must be only or with'];
  }

  if (Object.keys(errors).length > 0) throw new AdminValidationError(errors, 'Invalid list query');
  return { page, pageSize, sort, filters, count: schema.list.count, ...(search ? { search } : {}), ...(trashed ? { trashed } : {}) };
}

function parseFilterValue(field: FieldSchema, operator: FilterOperator, raw: string): Parsed<FilterValue> {
  if (operator === 'isNull') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'must be true or false' };
  }
  if (operator === 'contains' || operator === 'startsWith') {
    return raw.length === 0 || raw.length > MAX_TEXT ? { error: `must be 1 to ${MAX_TEXT} characters` } : { value: raw };
  }
  if (operator === 'in' || operator === 'nin' || operator === 'between') {
    const parts = raw.split(',').map((part) => part.trim());
    if (operator === 'between' && parts.length !== 2) return { error: 'must be two comma-separated values' };
    if (parts.length > MAX_LIST_VALUES || parts.some((part) => part === '')) {
      return { error: `must be 1 to ${MAX_LIST_VALUES} comma-separated values` };
    }
    const values: Array<string | number | Date> = [];
    for (const part of parts) {
      const parsed = parseScalar(field, part);
      if ('error' in parsed) return parsed;
      if (typeof parsed.value === 'boolean') return { error: 'is not supported for this field' };
      values.push(parsed.value);
    }
    return { value: values };
  }
  return parseScalar(field, raw);
}

function parseScalar(field: FieldSchema, raw: string): Parsed<string | number | boolean | Date> {
  switch (field.type) {
    case 'number': {
      if (field.integer) {
        if (!INTEGER.test(raw)) return { error: 'must be an integer' };
        return Math.abs(Number(raw)) > MAX_INT32 ? { error: 'is out of range' } : { value: Number(raw) };
      }
      return NUMBER.test(raw) && Number.isFinite(Number(raw)) ? { value: Number(raw) } : { error: 'must be a number' };
    }
    case 'decimal':
      return NUMBER.test(raw) ? { value: raw } : { error: 'must be a number' };
    case 'bigint': {
      if (!INTEGER.test(raw)) return { error: 'must be an integer' };
      const big = BigInt(raw);
      return big > MAX_INT64 || big < -MAX_INT64 ? { error: 'is out of range' } : { value: raw };
    }
    case 'boolean':
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'must be true or false' };
    case 'date':
      return isRealDate(raw) ? { value: raw } : { error: 'must be a date (YYYY-MM-DD)' };
    case 'datetime': {
      const time = ISO_DATETIME.test(raw) ? Date.parse(raw) : Number.NaN;
      return Number.isNaN(time) || !isRealDate(raw.slice(0, 10))
        ? { error: 'must be an ISO date-time with a time zone' }
        : { value: new Date(time) };
    }
    case 'enum':
      return field.enumValues?.includes(raw) ? { value: raw } : { error: `must be one of: ${(field.enumValues ?? []).join(', ')}` };
    case 'uuid':
      return UUID.test(raw) ? { value: raw } : { error: 'must be a UUID' };
    case 'relation':
      return parseId(field, raw);
    default:
      return raw.length <= MAX_TEXT ? { value: raw } : { error: `must be at most ${MAX_TEXT} characters` };
  }
}

/** An id of a relation's target, typed like its primary key. */
export function parseId(field: FieldSchema, raw: string): Parsed<string | number> {
  switch (field.relation?.idType) {
    case 'number':
      if (field.integer) return INTEGER.test(raw) && Number.isSafeInteger(Number(raw)) ? { value: Number(raw) } : { error: 'must be an id (an integer)' };
      return NUMBER.test(raw) && Number.isFinite(Number(raw)) ? { value: Number(raw) } : { error: 'must be an id (a number)' };
    case 'bigint':
      return INTEGER.test(raw) && BigInt(raw) <= MAX_INT64 && BigInt(raw) >= -MAX_INT64 ? { value: raw } : { error: 'must be an id (an integer)' };
    case 'uuid':
      return UUID.test(raw) ? { value: raw } : { error: 'must be an id (a UUID)' };
    default:
      return raw.length > 0 && raw.length <= MAX_TEXT ? { value: raw } : { error: `must be an id of 1 to ${MAX_TEXT} characters` };
  }
}

function readOne(query: URLSearchParams, key: string, errors: Errors): string | undefined {
  const values = query.getAll(key);
  if (values.length > 1) {
    errors[key] = ['must be given once'];
    return undefined;
  }
  return values[0];
}

function readPositiveInt(query: URLSearchParams, key: string, fallback: number, errors: Errors): number {
  const raw = readOne(query, key, errors);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    errors[key] = ['must be a positive integer'];
    return fallback;
  }
  return Number(raw);
}

function isRealDate(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const time = Date.parse(`${raw}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === raw;
}
