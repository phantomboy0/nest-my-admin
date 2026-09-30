import { describe, expect, test } from 'bun:test';
import type { FieldSchema, ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import { parseListQuery } from './list-query.js';

const f = (name: string, type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});

const schema: ResourceSchema = {
  name: 'widget',
  label: 'Widget',
  group: 'widgets',
  primaryKey: 'id',
  fields: [
    f('id', 'number', { primary: true, readonly: true }),
    f('name', 'string'),
    f('price', 'decimal', { scale: 2 }),
    f('stock', 'number'),
    f('status', 'enum', { enumValues: ['draft', 'live'] }),
    f('visible', 'boolean'),
    f('notes', 'text', { nullable: true }),
    f('createdAt', 'datetime', { readonly: true }),
  ],
  list: {
    columns: ['id', 'name'],
    sortable: ['id', 'name'],
    defaultSort: { field: 'id', direction: 'desc' },
    pageSize: 25,
    filters: [
      { field: 'name', operators: ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith'] },
      { field: 'price', operators: ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between'] },
      { field: 'stock', operators: ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between'] },
      { field: 'status', operators: ['eq', 'ne', 'in', 'nin'] },
      { field: 'visible', operators: ['eq', 'ne'] },
      { field: 'notes', operators: ['contains', 'startsWith', 'isNull'] },
      { field: 'createdAt', operators: ['lt', 'lte', 'gt', 'gte', 'between'] },
    ],
    search: ['name', 'notes'],
  },
  form: { create: [], update: [], requiredOnCreate: [] },
};

const parse = (query: string, s: ResourceSchema = schema) => parseListQuery(new URLSearchParams(query), s);

function errorsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdminValidationError) return error.fields ?? {};
    throw error;
  }
  throw new Error('expected an AdminValidationError');
}

describe('parseListQuery: paging and sorting', () => {
  test('uses the resource defaults', () => {
    expect(parse('')).toEqual({ page: 1, pageSize: 25, sort: { field: 'id', direction: 'desc' }, filters: [] });
  });

  test('reads page, pageSize and sort', () => {
    const params = parse('page=3&pageSize=10&sort=name');
    expect([params.page, params.pageSize, params.sort]).toEqual([3, 10, { field: 'name', direction: 'asc' }]);
    expect(parse('sort=-name').sort).toEqual({ field: 'name', direction: 'desc' });
  });

  test('rejects invalid paging, sorting and unknown parameters', () => {
    expect(errorsOf(() => parse('page=0'))).toEqual({ page: ['must be a positive integer'] });
    expect(errorsOf(() => parse('pageSize=101'))).toEqual({ pageSize: ['must be at most 100'] });
    expect(errorsOf(() => parse('sort=secret'))).toEqual({ sort: ['cannot sort by "secret"'] });
    expect(errorsOf(() => parse('page=1&page=2'))).toEqual({ page: ['must be given once'] });
    expect(errorsOf(() => parse('foo=1'))).toEqual({ foo: ['is not a supported list parameter'] });
  });
});

describe('parseListQuery: filters', () => {
  test('parses operators into typed values', () => {
    const { filters } = parse(
      'filter[status]=live&filter[stock][gte]=5&filter[price][between]=1,9.5&filter[status][in]=draft,live' +
        '&filter[visible][eq]=false&filter[notes][isNull]=true&filter[name][contains]=50%25',
    );
    expect(filters).toEqual([
      { field: 'status', operator: 'eq', value: 'live' },
      { field: 'stock', operator: 'gte', value: 5 },
      { field: 'price', operator: 'between', value: ['1', '9.5'] },
      { field: 'status', operator: 'in', value: ['draft', 'live'] },
      { field: 'visible', operator: 'eq', value: false },
      { field: 'notes', operator: 'isNull', value: true },
      { field: 'name', operator: 'contains', value: '50%' },
    ]);
  });

  test('datetime values become Date objects', () => {
    const [condition] = parse('filter[createdAt][gte]=2026-01-01T00:00:00Z').filters;
    expect(condition!.value).toBeInstanceOf(Date);
    expect((condition!.value as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('wrong fields, operators and values are 422s keyed by parameter (Review Focus 2)', () => {
    expect(errorsOf(() => parse('filter[secret][eq]=1'))).toEqual({ 'filter[secret][eq]': ['cannot filter by "secret"'] });
    expect(errorsOf(() => parse('filter[status][gt]=a'))).toEqual({
      'filter[status][gt]': ['operator "gt" is not allowed for "status" (allowed: eq, ne, in, nin)'],
    });
    expect(errorsOf(() => parse('filter[price][gte]=abc'))).toEqual({ 'filter[price][gte]': ['must be a number'] });
    expect(errorsOf(() => parse('filter[stock][gte]=1.5x'))).toEqual({ 'filter[stock][gte]': ['must be a number'] });
    expect(errorsOf(() => parse('filter[status][eq]=gone'))).toEqual({ 'filter[status][eq]': ['must be one of: draft, live'] });
    expect(errorsOf(() => parse('filter[price][between]=1'))).toEqual({ 'filter[price][between]': ['must be two comma-separated values'] });
    expect(errorsOf(() => parse('filter[status][in]=draft,'))).toEqual({ 'filter[status][in]': ['must be 1 to 100 comma-separated values'] });
    expect(errorsOf(() => parse('filter[notes][isNull]=maybe'))).toEqual({ 'filter[notes][isNull]': ['must be true or false'] });
    expect(errorsOf(() => parse('filter[createdAt][lt]=never'))).toEqual({ 'filter[createdAt][lt]': ['must be a date and time'] });
    expect(errorsOf(() => parse('filter[status][eq]=draft&filter[status][eq]=live'))).toEqual({ 'filter[status][eq]': ['must be given once'] });
    expect(errorsOf(() => parse('filter[name][contains]='))).toEqual({ 'filter[name][contains]': ['must be 1 to 200 characters'] });
  });
});

describe('parseListQuery: search', () => {
  test('trims the term and carries the searchable fields', () => {
    expect(parse('search=%20lamp%20').search).toEqual({ term: 'lamp', fields: ['name', 'notes'] });
    expect(parse('search=%20%20').search).toBeUndefined();
  });

  test('rejects over-long terms and unsearchable resources', () => {
    expect(errorsOf(() => parse(`search=${'x'.repeat(201)}`))).toEqual({ search: ['must be at most 200 characters'] });
    const unsearchable = { ...schema, list: { ...schema.list, search: [] } };
    expect(errorsOf(() => parse('search=lamp', unsearchable))).toEqual({ search: ['this resource is not searchable'] });
  });
});
