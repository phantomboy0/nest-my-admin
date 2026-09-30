import { describe, expect, test } from 'bun:test';
import { clearFilters, filterKey, hasActiveFilters, listQueryFromUrl, paging, withChanges } from './list-state';

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
