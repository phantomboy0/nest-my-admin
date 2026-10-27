import { describe, expect, test } from 'bun:test';
import type { MetaResponse } from '@nest-my-admin/core/contract';
import { matches, navigationItems } from './palette';

const meta: MetaResponse = {
  schemaVersion: 1,
  title: 'Shop',
  locale: 'en',
  locales: ['en'],
  groups: [
    { key: 'catalog', label: 'Catalog', resources: [{ name: 'product', label: 'Product', creatable: true, searchable: true }, { name: 'stock-move', label: 'Stock move', creatable: false, searchable: false }], pages: [] },
    { key: 'sales', label: 'Sales', resources: [{ name: 'order', label: 'سفارش', creatable: true, searchable: true }], pages: [] },
    // A group may hold only pages.
    { key: 'settings', label: 'Settings', resources: [], pages: [{ name: 'shop', label: 'Shop settings' }] },
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
    expect(navigationItems(meta, '', newLabel).map((item) => item.id)).toEqual(['group:catalog', 'go:product', 'go:stock-move', 'group:sales', 'go:order', 'group:settings', 'page:shop']);
  });
  test('"new prod" offers the create form; resources that cannot be created are left out', () => {
    expect(navigationItems(meta, 'new prod', newLabel)).toEqual([{ id: 'new:product', section: 'actions', label: 'New Product', to: '/product/new' }]);
    expect(navigationItems(meta, 'new stock', newLabel)).toEqual([]);
    expect(navigationItems(meta, 'stock', newLabel).map((item) => item.to)).toEqual(['/stock-move']);
    expect(navigationItems(meta, 'catalog', newLabel).map((item) => item.to)).toEqual(['/g/catalog', '/product', '/stock-move']);
  });
  test('settings pages are places to go, found by their own name or their group', () => {
    expect(navigationItems(meta, 'shop set', newLabel)).toEqual([{ id: 'page:shop', section: 'go', label: 'Shop settings', detail: 'Settings', to: '/p/shop' }]);
    expect(navigationItems(meta, 'settings', newLabel).map((item) => item.to)).toEqual(['/g/settings', '/p/shop']);
    expect(navigationItems(meta, 'new shop', newLabel)).toEqual([]);
  });
});

describe('palette with a menu', () => {
  const withMenu: MetaResponse = {
    ...meta,
    menu: {
      sections: [
        {
          key: 'shop',
          label: 'Shop',
          icon: 'box',
          items: [
            { kind: 'resource', resource: 'order', label: 'Orders', creatable: true, searchable: true, badge: true },
            { kind: 'page', page: 'shop', label: 'Shop settings' },
            { kind: 'link', href: 'https://shop.example/', label: 'Storefront' },
          ],
        },
      ],
      advanced: { key: 'advanced', label: 'Advanced', items: [{ kind: 'resource', resource: 'product', label: 'Product', creatable: true, searchable: true }] },
    },
  };
  const theme = { id: 'theme', label: 'Toggle theme' };

  test('an empty query offers the menu’s create actions and the theme toggle, then the places to go by section', () => {
    expect(navigationItems(withMenu, '', newLabel, [theme]).map((item) => `${item.section}:${item.id}`)).toEqual([
      'go:group:shop',
      'go:go:order',
      'go:page:shop',
      'go:group:advanced',
      'go:go:product',
      'actions:new:order',
      'actions:theme',
    ]);
  });

  test('typing narrows all three; create actions for advanced resources appear only when typed for', () => {
    expect(navigationItems(withMenu, 'new prod', newLabel, [theme]).map((item) => item.id)).toEqual(['new:product']);
    expect(navigationItems(withMenu, 'theme', newLabel, [theme])).toEqual([{ id: 'theme', section: 'actions', label: 'Toggle theme' }]);
    expect(navigationItems(withMenu, 'orders', newLabel, [theme]).map((item) => item.detail)).toEqual(['Shop']);
  });
});
