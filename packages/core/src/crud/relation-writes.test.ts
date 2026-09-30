import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DataSource } from 'typeorm';
import type { FieldSchema, ResourceSchema } from '../contract.js';
import { AdminValidationError } from '../errors.js';
import { ORDER_ENTITIES, Order } from '../../test/fixtures/orders.js';
import { MAX_RELATION_IDS, relationIdsOf, toRelationReferences } from './relation-writes.js';

const relation = (name: string, kind: 'to-one' | 'to-many', idType: 'number' | 'bigint' | 'string' | 'uuid', nullable = true): FieldSchema => ({
  name, label: name, type: 'relation', nullable, primary: false, readonly: false, persisted: true, relation: { kind, idType }, ...(idType === 'number' ? { integer: true } : {}),
});

const schema = {
  fields: [relation('customer', 'to-one', 'number', false), relation('seller', 'to-one', 'bigint'), relation('tags', 'to-many', 'uuid'), relation('codes', 'to-many', 'string')],
} as ResourceSchema;

const UUID_A = '0F8FAD5B-D9CB-469F-A165-70867728950E';
const UUID_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function errorsOf(body: object): Record<string, string[]> {
  try {
    relationIdsOf(body, schema);
  } catch (error) {
    if (error instanceof AdminValidationError) return error.fields!;
    throw error;
  }
  return {};
}

describe('relationIdsOf', () => {
  test('returns the ids sent per field, typed and without duplicates', () => {
    const ids = relationIdsOf({ customer: 3, seller: '9007199254740993', tags: [UUID_A, UUID_B, UUID_A.toLowerCase()], codes: [], other: 'x' }, schema);
    expect([...ids]).toEqual([
      ['customer', [3]],
      ['seller', ['9007199254740993']],
      ['tags', [UUID_A.toLowerCase(), UUID_B]],
      ['codes', []],
    ]);
  });

  test('null clears a nullable relation and is required for the others', () => {
    expect([...relationIdsOf({ seller: null }, schema)]).toEqual([]);
    expect(errorsOf({ customer: null })).toEqual({ customer: ['is required'] });
  });

  test('values of the wrong shape name the field', () => {
    expect(errorsOf({ customer: '3', seller: 1.5, tags: 'a', codes: [1] })).toEqual({
      customer: ['must be an id (an integer)'],
      seller: ['must be an id (an integer)'],
      tags: ['must be a list of ids'],
      codes: ['must contain only ids (a string)'],
    });
    expect(errorsOf({ tags: ['nope'] })).toEqual({ tags: ['must contain only ids (a UUID)'] });
    expect(errorsOf({ customer: { id: 3 } })).toEqual({ customer: ['must be an id (an integer)'] });
    expect(errorsOf({ codes: Array.from({ length: MAX_RELATION_IDS + 1 }, (_, i) => `c${i}`) })).toEqual({ codes: [`must hold at most ${MAX_RELATION_IDS} ids`] });
  });
});

describe('toRelationReferences', () => {
  let dataSource: DataSource;
  beforeAll(async () => {
    dataSource = await new DataSource({ type: 'sqljs', entities: ORDER_ENTITIES }).initialize();
  });
  afterAll(async () => {
    await dataSource.destroy();
  });

  test('wraps ids of relations without their own column; keeps explicit id columns', () => {
    const metadata = dataSource.getMetadata(Order);
    expect(toRelationReferences({ number: 'N1', customer: 3, sellerId: 4, tags: ['a', 'b'] }, metadata)).toEqual({
      number: 'N1',
      customer: { id: 3 },
      sellerId: 4,
      tags: [{ id: 'a' }, { id: 'b' }],
    });
    expect(toRelationReferences({ tags: [] }, metadata)).toEqual({ tags: [] });
  });
});
