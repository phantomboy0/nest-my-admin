import type { FilterOperator, ListResponse } from '@nest-my-admin/core/contract';
import { formatNumber, translate as tr } from '@/i18n';

export type ParamChanges = Record<string, string | null>;

const LIST_KEYS = new Set(['page', 'pageSize', 'sort', 'search', 'trashed', 'after']);
const isListKey = (key: string) => LIST_KEYS.has(key) || key.startsWith('filter[');

/** The API list query is the page URL's list parameters, passed through unchanged (spec §11 syntax). */
export function listQueryFromUrl(params: URLSearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of params) if (value !== '' && isListKey(key)) query.append(key, value);
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

/** Applies changes; any change other than to the position (`page`, `after`) sends the user back to the first page. */
export function withChanges(params: URLSearchParams, changes: ParamChanges): URLSearchParams {
  const next = new URLSearchParams(params);
  if (Object.keys(changes).some((key) => key !== 'page' && key !== 'after')) {
    next.delete('page');
    next.delete('after');
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return next;
}

export interface Paging {
  /** "1,234 total", "about 12,000", or '' when the list is not counted. */
  summary: string;
  /** "Page 2 of 5", or "Page 2" without a total. */
  label: string;
  hasNext: boolean;
}

/** What the pager shows for a list response (exact, estimated or uncounted totals). */
export function paging(data: Pick<ListResponse, 'total' | 'estimated' | 'hasMore' | 'pageSize'> | undefined, page: number): Paging {
  if (!data) return { summary: '', label: tr('list.page', { page }), hasNext: false };
  if (data.total === null) return { summary: '', label: tr('list.page', { page }), hasNext: data.hasMore === true };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const count = formatNumber(data.total);
  return {
    summary: tr(data.estimated ? 'list.about' : 'list.total', { count }),
    label: data.estimated ? tr('list.page', { page }) : tr('list.pageOf', { page, pages }),
    hasNext: page < pages,
  };
}
