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

/** "Showing 26 to 50 of 1,234" for an exact total; an estimate keeps "about 12,000"; '' when the list is not counted or empty. */
export function rangeText(data: Pick<ListResponse, 'total' | 'estimated' | 'pageSize'> | undefined, page: number, shown: number): string {
  if (!data || data.total === null || data.total === 0) return '';
  if (data.estimated) return tr('list.about', { count: formatNumber(data.total) });
  const from = (page - 1) * data.pageSize + 1;
  return tr('list.range', { from: formatNumber(from), to: formatNumber(from + Math.max(shown, 1) - 1), total: formatNumber(data.total) });
}

/** The page sizes the footer offers: the usual ones plus the resource's default (the server allows up to 100). */
export function pageSizeOptions(defaultSize: number): number[] {
  return [...new Set([10, 20, 50, 100, defaultSize])].filter((size) => size <= 100).sort((a, b) => a - b);
}

/** How many fields have a filter set (a range is one); the search is not counted. */
export function activeFilterCount(params: URLSearchParams): number {
  const fields = new Set<string>();
  for (const [key, value] of params) {
    const match = /^filter\[([^\][]+)\]/.exec(key);
    if (match && value !== '') fields.add(match[1]!);
  }
  return fields.size;
}

/** The changes that put the filters, search and sort of `now` back to `snapshot` (a drawer's Cancel). */
export function restoreFilters(now: URLSearchParams, snapshot: URLSearchParams): ParamChanges {
  const tracked = (key: string) => key === 'search' || key === 'sort' || key.startsWith('filter[');
  const changes: ParamChanges = {};
  for (const key of new Set([...now.keys(), ...snapshot.keys()])) {
    if (!tracked(key) || now.get(key) === snapshot.get(key)) continue;
    changes[key] = snapshot.get(key);
  }
  return Object.fromEntries(Object.entries(changes).sort(([a], [b]) => a.localeCompare(b)));
}
