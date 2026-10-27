import { describe, expect, test } from 'bun:test';
import type { ListTabSchema } from '@nest-my-admin/core/contract';
import { activeFilterCount, activeTab, restoreFilters, tabChanges, clearFilters, filterKey, hasActiveFilters, listQueryFromUrl, pageSizeOptions, paging, rangeText, withChanges } from './list-state';

describe('list state', () => {
  test('listQueryFromUrl keeps list params only, drops empties and sorts keys', () => {
    const url = new URLSearchParams('sort=-id&foo=1&search=&filter%5Bstatus%5D%5Beq%5D=live&after=c1');
    expect(listQueryFromUrl(url)).toBe('after=c1&filter%5Bstatus%5D%5Beq%5D=live&sort=-id');
  });

  test('filterKey builds the bracket syntax', () => {
    expect(filterKey('price', 'gte')).toBe('filter[price][gte]');
  });

  test('withChanges resets the page unless the page itself changes', () => {
    const params = new URLSearchParams('page=3&sort=name');
    expect(withChanges(params, { search: 'lamp' }).toString()).toBe('sort=name&search=lamp');
    expect(withChanges(params, { page: '4' }).toString()).toBe('page=4&sort=name');
    expect(withChanges(new URLSearchParams('search=x&sort=name'), { search: null }).toString()).toBe('sort=name');
    expect(withChanges(new URLSearchParams('after=c1&sort=name'), { sort: 'id' }).toString()).toBe('sort=id');
    expect(withChanges(new URLSearchParams('after=c1&sort=name'), { after: 'c2' }).toString()).toBe('after=c2&sort=name');
  });

  test('active filters and clearing them', () => {
    const params = new URLSearchParams('sort=name&search=x&filter%5Bstatus%5D%5Beq%5D=live');
    expect(hasActiveFilters(params)).toBe(true);
    expect(hasActiveFilters(new URLSearchParams('sort=name&page=2'))).toBe(false);
    expect(clearFilters(params)).toEqual({ search: null, 'filter[status][eq]': null });
  });
});

describe('paging', () => {
  test('exact, estimated and uncounted totals', () => {
    expect(paging({ total: 1234, pageSize: 25 }, 2)).toEqual({ summary: '1,234 total', label: 'Page 2 of 50', hasNext: true });
    expect(paging({ total: 50, pageSize: 25 }, 2)).toMatchObject({ hasNext: false });
    expect(paging({ total: 12000, estimated: true, pageSize: 25 }, 1)).toEqual({ summary: 'about 12,000', label: 'Page 1', hasNext: true });
    expect(paging({ total: null, hasMore: true, pageSize: 25 }, 3)).toEqual({ summary: '', label: 'Page 3', hasNext: true });
    expect(paging({ total: null, hasMore: false, pageSize: 25 }, 3).hasNext).toBe(false);
  });
});

describe('footer', () => {
  test('rangeText names the rows on screen when the total is exact', () => {
    expect(rangeText({ total: 1234, pageSize: 25 }, 2, 25)).toBe('Showing 26 to 50 of 1,234');
    expect(rangeText({ total: 30, pageSize: 25 }, 2, 5)).toBe('Showing 26 to 30 of 30');
    expect(rangeText({ total: 0, pageSize: 25 }, 1, 0)).toBe('');
    expect(rangeText({ total: 12000, estimated: true, pageSize: 25 }, 1, 25)).toBe('about 12,000');
    expect(rangeText({ total: null, pageSize: 25 }, 1, 25)).toBe('');
    expect(rangeText(undefined, 1, 0)).toBe('');
  });

  test('pageSizeOptions adds the default to the usual sizes, up to the server maximum', () => {
    expect(pageSizeOptions(25)).toEqual([10, 20, 25, 50, 100]);
    expect(pageSizeOptions(20)).toEqual([10, 20, 50, 100]);
    expect(pageSizeOptions(8)).toEqual([8, 10, 20, 50, 100]);
  });
});

test('activeFilterCount counts filtered fields, not conditions or the search', () => {
  const params = new URLSearchParams('search=x&filter[price][gte]=1&filter[price][lte]=9&filter[status][in]=a,b&filter[tag][eq]=&page=2');
  expect(activeFilterCount(params)).toBe(2);
  expect(activeFilterCount(new URLSearchParams('search=x'))).toBe(0);
});

test('restoreFilters undoes filter, search and sort changes back to a snapshot', () => {
  const before = new URLSearchParams('sort=-price&filter[status][in]=draft&pageSize=50');
  const now = new URLSearchParams('sort=name&filter[status][in]=draft,active&filter[price][gte]=3&search=x&pageSize=50');
  expect(restoreFilters(now, before)).toEqual({ 'filter[price][gte]': null, 'filter[status][in]': 'draft', search: null, sort: '-price' });
  expect(restoreFilters(before, before)).toEqual({});
});

describe('list tabs', () => {
  const tabs: ListTabSchema[] = [
    { key: 'all', label: 'All', filter: {}, where: false, count: 'exact' as const },
    { key: 'active', label: 'Active', filter: { 'filter[status][eq]': 'active' }, where: false, count: 'exact' as const },
    { key: 'out', label: 'Out of stock', filter: {}, where: true, count: 'exact' as const },
  ];
  test('the active tab is the one whose filters the URL holds exactly; «all» has none', () => {
    expect(activeTab(tabs, new URLSearchParams(''))?.key).toBe('all');
    expect(activeTab(tabs, new URLSearchParams('filter[status][eq]=active&sort=-id'))?.key).toBe('active');
    expect(activeTab(tabs, new URLSearchParams('tab=out'))?.key).toBe('out');
    expect(activeTab(tabs, new URLSearchParams('filter[status][eq]=draft'))).toBeUndefined();
    expect(activeTab(tabs, new URLSearchParams('filter[status][eq]=active&search=x'))?.key).toBe('active'); // the search is not a filter
  });
  test('selecting a tab replaces the filters with its own (and tab= for a where tab)', () => {
    expect(tabChanges(tabs[1]!, new URLSearchParams('filter[price][gte]=5&tab=out&sort=name'))).toEqual({ 'filter[price][gte]': null, tab: null, 'filter[status][eq]': 'active' });
    expect(tabChanges(tabs[2]!, new URLSearchParams('filter[status][eq]=active'))).toEqual({ 'filter[status][eq]': null, tab: 'out' });
    expect(tabChanges(tabs[0]!, new URLSearchParams('filter[status][eq]=active'))).toEqual({ 'filter[status][eq]': null });
  });
});
