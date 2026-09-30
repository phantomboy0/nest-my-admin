import { describe, expect, test } from 'bun:test';
import type { RbacCatalog } from '@nest-my-admin/core/contract';
import { catalogCodes, grants, togglePermission } from './role-draft';

const catalog: RbacCatalog = {
  operations: ['view', 'create', 'update', 'delete', 'purge'],
  resources: [
    { name: 'product', label: 'Product', group: 'catalog', fields: [], scopes: [], custom: ['approve'] },
    { name: 'tag', label: 'Tag', group: 'catalog', fields: [], scopes: [], custom: [] },
  ],
  global: ['rbac.view'],
};
const known = catalogCodes(catalog);

describe('role drafts', () => {
  test('ticking adds a code once', () => {
    expect(togglePermission(['product.view'], 'product.update', true, known)).toEqual(['product.view', 'product.update']);
    expect(togglePermission(['product.*'], 'product.update', true, known)).toEqual(['product.*']);
  });
  test('unticking a code a wildcard grants expands the wildcard', () => {
    const next = togglePermission(['product.*', 'tag.view'], 'product.delete', false, known);
    expect(next.sort()).toEqual(['product.approve', 'product.create', 'product.purge', 'product.update', 'product.view', 'tag.view'].sort());
    expect(grants(next, 'product.delete')).toBe(false);
    const fromStar = togglePermission(['*'], 'tag.view', false, known);
    expect(grants(fromStar, 'tag.view')).toBe(false);
    expect(grants(fromStar, 'rbac.view')).toBe(true);
    expect(grants(fromStar, 'product.approve')).toBe(true);
  });
  test('unticking a plain code removes it', () => {
    expect(togglePermission(['product.view', 'tag.view'], 'tag.view', false, known)).toEqual(['product.view']);
  });
});
