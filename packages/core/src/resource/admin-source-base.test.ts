import { describe, expect, test } from 'bun:test';
import type { ListParams } from './admin-resource-base.js';
import { inMemoryList } from './admin-source-base.js';

interface Row {
  name: string;
  size: number;
  kind: string | null;
  at: Date;
  on: boolean;
}

const rows: Row[] = [
  { name: 'file10', size: 10, kind: 'db', at: new Date('2026-10-01T00:00:00Z'), on: true },
  { name: 'file2', size: 2, kind: null, at: new Date('2026-10-03T00:00:00Z'), on: false },
  { name: 'Archive', size: 30, kind: 'files', at: new Date('2026-10-02T00:00:00Z'), on: true },
  { name: 'notes', size: 2, kind: 'db', at: new Date('2026-10-04T00:00:00Z'), on: false },
];
const params = (more: Partial<ListParams> = {}): ListParams => ({ page: 1, pageSize: 25, sort: { field: 'name', direction: 'asc' }, filters: [], ...more });
const names = (more: Partial<ListParams>) => inMemoryList(rows, params(more)).items.map((row) => row.name);

describe('inMemoryList', () => {
  test('sorts naturally and case-insensitively, stable for ties, both ways', () => {
    expect(names({})).toEqual(['Archive', 'file2', 'file10', 'notes']);
    expect(names({ sort: { field: 'size', direction: 'desc' } })).toEqual(['Archive', 'file10', 'file2', 'notes']);
    expect(names({ sort: { field: 'at', direction: 'asc' } })).toEqual(['file10', 'Archive', 'file2', 'notes']);
  });

  test('search matches any of its fields, ignoring case', () => {
    expect(names({ search: { term: 'FILE', fields: ['name'] } })).toEqual(['file2', 'file10']);
    expect(names({ search: { term: 'db', fields: ['name', 'kind'] } })).toEqual(['file10', 'notes']);
    expect(names({ search: { term: '  ', fields: ['name'] } })).toHaveLength(4);
  });

  test('every filter operator', () => {
    const where = (field: string, operator: ListParams['filters'][number]['operator'], value: ListParams['filters'][number]['value']) => names({ filters: [{ field, operator, value }] });
    expect(where('kind', 'eq', 'db')).toEqual(['file10', 'notes']);
    expect(where('kind', 'ne', 'db')).toEqual(['Archive', 'file2']);
    expect(where('kind', 'in', ['files', 'db'])).toEqual(['Archive', 'file10', 'notes']);
    expect(where('kind', 'nin', ['db'])).toEqual(['Archive', 'file2']);
    expect(where('size', 'lt', 10)).toEqual(['file2', 'notes']);
    expect(where('size', 'lte', 10)).toEqual(['file2', 'file10', 'notes']);
    expect(where('size', 'gt', 10)).toEqual(['Archive']);
    expect(where('size', 'gte', 10)).toEqual(['Archive', 'file10']);
    expect(where('size', 'between', [2, 10])).toEqual(['file2', 'file10', 'notes']);
    expect(where('at', 'gte', new Date('2026-10-03T00:00:00Z'))).toEqual(['file2', 'notes']);
    expect(where('name', 'contains', 'ILE')).toEqual(['file2', 'file10']);
    expect(where('name', 'startsWith', 'a')).toEqual(['Archive']);
    expect(where('kind', 'isNull', true)).toEqual(['file2']);
    expect(where('kind', 'isNull', false)).toEqual(['Archive', 'file10', 'notes']);
    expect(where('on', 'eq', true)).toEqual(['Archive', 'file10']);
    expect(where('size', 'eq', '2')).toEqual(['file2', 'notes']);
  });

  test('pages after filtering, with the total of all matches', () => {
    const page = inMemoryList(rows, params({ page: 2, pageSize: 3 }));
    expect(page.items.map((row) => row.name)).toEqual(['notes']);
    expect(page.total).toBe(4);
    expect(inMemoryList(rows, params({ page: 3, pageSize: 3 })).items).toEqual([]);
  });

  test('never changes the rows it was given', () => {
    const copy = [...rows];
    inMemoryList(rows, params({ sort: { field: 'size', direction: 'desc' } }));
    expect(rows).toEqual(copy);
  });
});
