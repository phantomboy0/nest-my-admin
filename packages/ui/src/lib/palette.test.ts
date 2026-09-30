import { describe, expect, test } from 'bun:test';
import type { MetaResponse } from '@nest-my-admin/core/contract';
import { matches, navigationItems } from './palette';

const meta: MetaResponse = {
  schemaVersion: 1,
  title: 'Shop',
  locale: 'en',
  locales: ['en'],
  groups: [
    { key: 'catalog', label: 'Catalog', resources: [{ name: 'product', label: 'Product', creatable: true, searchable: true }, { name: 'stock-move', label: 'Stock move', creatable: false, searchable: false }] },
    { key: 'sales', label: 'Sales', resources: [{ name: 'order', label: 'سفارش', creatable: true, searchable: true }] },
  ],
};
const newLabel = (name: string) => `New ${name}`;

describe('palette', () => {
  test('matching folds case, letter variants and digits', () => {
    expect(matches('New Product', 'new prod')).toBe(true);
    expect(matches('New Product', 'prod new')).toBe(true);
    expect(matches('کتاب ۱۲', 'كتاب 12')).toBe(true);
    expect(matches('Product', 'order')).toBe(false);
  });
  test('an empty query lists every place to go, and nothing to create', () => {
    expect(navigationItems(meta, '', newLabel).map((item) => item.id)).toEqual(['group:catalog', 'go:product', 'go:stock-move', 'group:sales', 'go:order']);
  });
  test('"new prod" offers the create form; resources that cannot be created are left out', () => {
    expect(navigationItems(meta, 'new prod', newLabel)).toEqual([{ id: 'new:product', section: 'create', label: 'New Product', to: '/product/new' }]);
    expect(navigationItems(meta, 'new stock', newLabel)).toEqual([]);
    expect(navigationItems(meta, 'stock', newLabel).map((item) => item.to)).toEqual(['/stock-move']);
    expect(navigationItems(meta, 'catalog', newLabel).map((item) => item.to)).toEqual(['/g/catalog', '/product', '/stock-move']);
  });
});
