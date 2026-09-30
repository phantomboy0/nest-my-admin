import type { FilterOperator } from '@nest-my-admin/core/contract';

export type ParamChanges = Record<string, string | null>;

const isListKey = (key: string) => key === 'page' || key === 'sort' || key === 'search' || key.startsWith('filter[');

/** The API list query is the page URL's list parameters, passed through unchanged (spec §11 syntax). */
export function listQueryFromUrl(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of params) if (value !== '' && isListKey(key)) query.append(key, value);
  if (!query.has('page')) query.set('page', '1');
  query.sort();
  return query.toString();
}

export function filterKey(field: string, operator: FilterOperator): string {
  return `filter[${field}][${operator}]`;
}

export function hasActiveFilters(params: URLSearchParams): boolean {
  return [...params.keys()].some((key) => key === 'search' || key.startsWith('filter['));
}

export function clearFilters(params: URLSearchParams): ParamChanges {
  const changes: ParamChanges = {};
  for (const key of params.keys()) if (key === 'search' || key.startsWith('filter[')) changes[key] = null;
  return changes;
}

/** Applies changes; any change other than to `page` sends the user back to page 1. */
export function withChanges(params: URLSearchParams, changes: ParamChanges): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  if (Object.keys(changes).some((key) => key !== 'page')) next.delete('page');
  return next;
}
