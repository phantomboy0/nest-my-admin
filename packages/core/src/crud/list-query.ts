import type { ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import type { ListParams } from '../resource/admin-resource-base.js';
import { MAX_PAGE_SIZE } from '../schema/build-resource-schema.js';

type Errors = Record<string, string[]>;

export function parseListQuery(query: URLSearchParams, schema: ResourceSchema): ListParams {
  const errors: Errors = {};
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

  if (Object.keys(errors).length > 0) throw new AdminValidationError(errors, 'Invalid list query');
  return { page, pageSize, sort };
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
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    errors[key] = ['must be a positive integer'];
    return fallback;
  }
  return Number(raw);
}
