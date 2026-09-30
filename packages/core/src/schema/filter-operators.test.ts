import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '../contract.js';
import { operatorsFor } from './filter-operators.js';

const field = (type: FieldType, nullable = false): FieldSchema => ({
  name: 'x', label: 'X', type, nullable, primary: false, readonly: false, persisted: true,
});

describe('operatorsFor', () => {
  test('depends on the column type', () => {
    expect(operatorsFor(field('string'))).toEqual(['eq', 'ne', 'in', 'nin', 'contains', 'startsWith']);
    expect(operatorsFor(field('text'))).toEqual(['contains', 'startsWith']);
    expect(operatorsFor(field('number'))).toEqual(['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between']);
    expect(operatorsFor(field('datetime'))).toEqual(['lt', 'lte', 'gt', 'gte', 'between']);
    expect(operatorsFor(field('boolean'))).toEqual(['eq', 'ne']);
    expect(operatorsFor(field('enum'))).toEqual(['eq', 'ne', 'in', 'nin']);
    expect(operatorsFor(field('uuid'))).toEqual(['eq', 'ne', 'in', 'nin']);
  });

  test('nullable columns also get isNull; json columns get nothing', () => {
    expect(operatorsFor(field('text', true))).toEqual(['contains', 'startsWith', 'isNull']);
    expect(operatorsFor(field('json', true))).toEqual([]);
  });
});
