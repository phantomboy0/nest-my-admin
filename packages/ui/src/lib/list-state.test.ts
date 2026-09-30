import { describe, expect, test } from 'bun:test';
import { clearFilters, filterKey, hasActiveFilters, listQueryFromUrl, withChanges } from './list-state';

describe('list state', () => {
  test('listQueryFromUrl keeps list params only, drops empties, defaults page and sorts keys', () => {
    const url = new URLSearchParams('sort=-id&foo=1&search=&filter%5Bstatus%5D%5Beq%5D=live');
    expect(listQueryFromUrl(url)).toBe('filter%5Bstatus%5D%5Beq%5D=live&page=1&sort=-id');
  });

  test('filterKey builds the bracket syntax', () => {
    expect(filterKey('price', 'gte')).toBe('filter[price][gte]');
  });

  test('withChanges resets the page unless the page itself changes', () => {
    const params = new URLSearchParams('page=3&sort=name');
    expect(withChanges(params, { search: 'lamp' }).toString()).toBe('sort=name&search=lamp');
    expect(withChanges(params, { page: '4' }).toString()).toBe('page=4&sort=name');
    expect(withChanges(new URLSearchParams('search=x&sort=name'), { search: null }).toString()).toBe('sort=name');
  });

  test('active filters and clearing them', () => {
    const params = new URLSearchParams('sort=name&search=x&filter%5Bstatus%5D%5Beq%5D=live');
    expect(hasActiveFilters(params)).toBe(true);
    expect(hasActiveFilters(new URLSearchParams('sort=name&page=2'))).toBe(false);
    expect(clearFilters(params)).toEqual({ search: null, 'filter[status][eq]': null });
  });
});
