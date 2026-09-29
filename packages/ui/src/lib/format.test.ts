import { describe, expect, test } from 'bun:test';
import type { FieldSchema, FieldType } from '@nest-my-admin/core/contract';
import { formatCell } from './format';

const field = (type: FieldType): FieldSchema => ({
  name: 'x', label: 'X', type, nullable: true, primary: false, readonly: false, persisted: true,
});

describe('formatCell', () => {
  test('renders values for display', () => {
    expect(formatCell(null, field('string'))).toBe('—');
    expect(formatCell(true, field('boolean'))).toBe('Yes');
    expect(formatCell(false, field('boolean'))).toBe('No');
    expect(formatCell({ a: 1 }, field('json'))).toBe('{"a":1}');
    expect(formatCell('19.90', field('decimal'))).toBe('19.90');
    expect(formatCell(7, field('number'))).toBe('7');
  });
});
