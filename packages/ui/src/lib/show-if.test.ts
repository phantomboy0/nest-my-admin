import { describe, expect, test } from 'bun:test';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { isShown } from './show-if';

const field = (showIf?: FieldSchema['showIf']): FieldSchema => ({
  name: 'x', label: 'X', type: 'string', nullable: true, primary: false, readonly: false, persisted: true, ...(showIf ? { showIf } : {}),
});

describe('isShown', () => {
  test('no condition: always shown', () => {
    expect(isShown(field(), {})).toBe(true);
  });
  test('one value', () => {
    expect(isShown(field({ status: 'draft' }), { status: 'draft' })).toBe(true);
    expect(isShown(field({ status: 'draft' }), { status: 'active' })).toBe(false);
  });
  test('one of several values', () => {
    const f = field({ status: ['draft', 'active'] });
    expect(isShown(f, { status: 'active' })).toBe(true);
    expect(isShown(f, { status: 'archived' })).toBe(false);
  });
  test('numbers compare with what was typed', () => {
    expect(isShown(field({ stock: 0 }), { stock: '0' })).toBe(true);
    expect(isShown(field({ stock: 1000 }), { stock: '1,000' })).toBe(true);
    expect(isShown(field({ stock: 0 }), { stock: '' })).toBe(false);
  });
  test('booleans and empty values', () => {
    expect(isShown(field({ active: true }), { active: true })).toBe(true);
    expect(isShown(field({ active: true }), { active: false })).toBe(false);
    expect(isShown(field({ note: null }), { note: '' })).toBe(true);
    expect(isShown(field({ customer: '3' }), { customer: { id: 3, title: 'Ada' } })).toBe(true);
  });
  test('several keys: all must match', () => {
    const f = field({ status: 'active', active: true });
    expect(isShown(f, { status: 'active', active: true })).toBe(true);
    expect(isShown(f, { status: 'active', active: false })).toBe(false);
  });
});
