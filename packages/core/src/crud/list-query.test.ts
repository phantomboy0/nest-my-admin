import { describe, expect, test } from 'bun:test';
import type { ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import { parseListQuery } from './list-query.js';

const schema: ResourceSchema = {
  name: 'widget',
  label: 'Widget',
  group: 'widgets',
  primaryKey: 'id',
  fields: [],
  list: { columns: ['id', 'name'], sortable: ['id', 'name'], defaultSort: { field: 'id', direction: 'desc' }, pageSize: 25, filters: [], search: [] },
  form: { create: [], update: [], requiredOnCreate: [] },
};

const parse = (query: string) => parseListQuery(new URLSearchParams(query), schema);

function errorsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn();
  } catch (error) {
    if (error instanceof AdminValidationError) return error.fields ?? {};
    throw error;
  }
  throw new Error('expected an AdminValidationError');
}

describe('parseListQuery', () => {
  test('uses the resource defaults', () => {
    expect(parse('')).toEqual({ page: 1, pageSize: 25, sort: { field: 'id', direction: 'desc' } });
  });

  test('reads page, pageSize and sort', () => {
    expect(parse('page=3&pageSize=10&sort=name')).toEqual({ page: 3, pageSize: 10, sort: { field: 'name', direction: 'asc' } });
    expect(parse('sort=-name').sort).toEqual({ field: 'name', direction: 'desc' });
  });

  test('rejects invalid values with per-parameter messages', () => {
    expect(errorsOf(() => parse('page=0'))).toEqual({ page: ['must be a positive integer'] });
    expect(errorsOf(() => parse('page=abc&pageSize=2.5'))).toEqual({
      page: ['must be a positive integer'],
      pageSize: ['must be a positive integer'],
    });
    expect(errorsOf(() => parse('page=99999999999999999999'))).toEqual({ page: ['must be a positive integer'] });
    expect(errorsOf(() => parse('pageSize=101'))).toEqual({ pageSize: ['must be at most 100'] });
    expect(errorsOf(() => parse('sort=secret'))).toEqual({ sort: ['cannot sort by "secret"'] });
    expect(errorsOf(() => parse('page=1&page=2'))).toEqual({ page: ['must be given once'] });
  });
});
