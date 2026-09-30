import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType, ResourceSchema } from '@nest-my-admin/core/contract';
import { filterChips } from './filter-chips';

const f = (name: string, label: string, type: FieldType, extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label, type, nullable: true, primary: false, readonly: false, persisted: true, ...extra,
});
const schema = {
  fields: [
    f('status', 'Status', 'enum', { enumValues: ['draft', 'active'] }),
    f('price', 'Price', 'decimal'),
    f('notes', 'Notes', 'text'),
    f('visible', 'Visible', 'boolean'),
    f('categoryId', 'Category', 'relation', { relation: { kind: 'to-one', idType: 'number' } }),
  ],
} as ResourceSchema;
const chips = (query: string) => filterChips(schema, new URLSearchParams(query));

describe('filter chips (Review Focus 3)', () => {
  test('one chip per field, readable values', () => {
    expect(chips('filter[status][in]=draft,active').map(({ label, value }) => `${label}: ${value}`)).toEqual(['Status: draft, active']);
    expect(chips('filter[price][gte]=5&filter[price][lte]=10').map(({ value }) => value)).toEqual(['5 – 10']);
    expect(chips('filter[price][gte]=5').map(({ value }) => value)).toEqual(['≥ 5']);
    expect(chips('filter[notes][isNull]=true').map(({ value }) => value)).toEqual(['empty']);
    expect(chips('filter[visible][eq]=false').map(({ value }) => value)).toEqual(['No']);
    expect(chips('search=lamp')).toEqual([{ key: 'search', label: 'Search', value: '“lamp”', remove: ['search'] }]);
  });

  test('relation chips carry ids to title', () => {
    expect(chips('filter[categoryId][eq]=3')[0]).toMatchObject({ label: 'Category', value: '#3', ref: { field: 'categoryId', ids: ['3'] } });
  });

  test('removing a chip removes exactly its parameters', () => {
    const all = chips('filter[price][gte]=5&filter[price][lte]=10&filter[status][in]=draft&sort=name');
    expect(all.map(({ remove }) => remove)).toEqual([['filter[price][gte]', 'filter[price][lte]'], ['filter[status][in]']]);
  });

  test('unknown fields and empty values are ignored', () => {
    expect(chips('filter[nope][eq]=1&filter[status][in]=')).toEqual([]);
  });
});
