import { describe, expect, test } from 'bun:test';
import type { MetaResponse } from '@nest-my-admin/core/contract';
import { collapsedByDefault, navGroups, sectionCount } from './menu';

const base: MetaResponse = {
  schemaVersion: 1,
  title: 'Shop',
  locale: 'en',
  locales: ['en'],
  groups: [
    { key: 'catalog', label: 'Catalog', icon: 'boxes', resources: [{ name: 'product', label: 'Product', creatable: true, searchable: true }], pages: [{ name: 'shop', label: 'Shop settings' }] },
  ],
};

describe('navigation groups', () => {
  test('without a menu, the module groups, resources then pages', () => {
    const [catalog] = navGroups(base);
    expect(catalog).toMatchObject({ key: 'catalog', label: 'Catalog', icon: 'boxes' });
    expect(catalog!.items).toEqual([
      { kind: 'resource', name: 'product', label: 'Product' },
      { kind: 'page', name: 'shop', label: 'Shop settings' },
    ]);
  });

  test('with a menu, its sections in order, items as placed, then «advanced» when it holds anything', () => {
    const meta: MetaResponse = {
      ...base,
      menu: {
        sections: [
          {
            key: 'sales',
            label: 'Sales',
            icon: 'shopping-cart',
            items: [
              { kind: 'link', href: 'https://shop.example/', label: 'Storefront' },
              { kind: 'resource', resource: 'order', label: 'Orders', creatable: true, searchable: true, badge: true },
            ],
          },
        ],
        advanced: { key: 'advanced', label: 'Advanced', icon: 'database', items: [{ kind: 'resource', resource: 'product', label: 'Product', creatable: true, searchable: true }] },
      },
    };
    const groups = navGroups(meta);
    expect(groups.map((group) => group.key)).toEqual(['sales', 'advanced']);
    expect(groups[0]!.items).toEqual([
      { kind: 'link', href: 'https://shop.example/', label: 'Storefront' },
      { kind: 'resource', name: 'order', label: 'Orders', badge: 'sales.order' },
    ]);
    // Cards, group pages, breadcrumbs and the palette read resources and pages as for module groups.
    expect(groups[0]!.resources).toEqual([{ name: 'order', label: 'Orders', creatable: true, searchable: true }]);
    expect(groups[1]).toMatchObject({ advanced: true });
    expect(navGroups({ ...meta, menu: { ...meta.menu!, advanced: { ...meta.menu!.advanced, items: [] } } }).map((group) => group.key)).toEqual(['sales']);
  });

  test('a section counts the sum of its badges, or nothing without any', () => {
    const items = [
      { kind: 'resource' as const, name: 'order', label: 'Orders', badge: 'sales.order' },
      { kind: 'resource' as const, name: 'payment', label: 'Payments', badge: 'sales.payment' },
      { kind: 'resource' as const, name: 'coupon', label: 'Coupons' },
    ];
    expect(sectionCount(items, { 'sales.order': { count: 18, estimate: false }, 'sales.payment': { count: 2, estimate: true } })).toEqual({ count: 20, estimate: true });
    expect(sectionCount(items, {})).toBeUndefined();
    expect(sectionCount(items, undefined)).toBeUndefined();
  });

  test('with a menu, sections start collapsed unless they hold the current page; without one, open', () => {
    expect(collapsedByDefault({ menu: true, current: false })).toBe(true);
    expect(collapsedByDefault({ menu: true, current: true })).toBe(false);
    expect(collapsedByDefault({ menu: false, current: false })).toBe(false);
  });
});
