import { describe, expect, test } from 'bun:test';
import type { RbacCatalog } from '@nest-my-admin/core/contract';
import { catalogCodes, codeMatches, grants, togglePermission } from './role-draft';

const catalog: RbacCatalog = {
  operations: ['view', 'create', 'update', 'delete', 'purge'],
  resources: [
    { name: 'product', label: 'Product', group: 'catalog', fields: [], scopes: [], custom: ['approve'], actions: [{ name: 'ship', label: 'Ship', target: 'record' }] },
    { name: 'tag', label: 'Tag', group: 'catalog', fields: [], scopes: [], custom: [], actions: [] },
  ],
  pages: [{ name: 'payments', label: 'Payments', group: 'settings' }],
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
    expect(next.sort()).toEqual(['product.action.ship', 'product.approve', 'product.create', 'product.purge', 'product.update', 'product.view', 'tag.view'].sort());
    expect(grants(next, 'product.delete')).toBe(false);
    const fromStar = togglePermission(['*'], 'tag.view', false, known);
    expect(grants(fromStar, 'tag.view')).toBe(false);
    expect(grants(fromStar, 'rbac.view')).toBe(true);
    expect(grants(fromStar, 'product.approve')).toBe(true);
    // Settings pages are codes of the catalog too: `*` and `page.*` keep them when another box is unticked.
    expect(grants(fromStar, 'page.payments')).toBe(true);
    expect(grants(fromStar, 'page.payments.update')).toBe(true);
    expect(togglePermission(['page.*'], 'page.payments.update', false, known)).toEqual(['page.payments']);
    // The server's rule: a pattern that starts with `*` (other than `*` itself) never grants a page.
    expect(grants(['*.payments', '*.*', '*.*.update'], 'page.payments')).toBe(false);
    expect(grants(['*.*.update'], 'page.payments.update')).toBe(false);
    expect(grants(['*.*'], 'tag.view')).toBe(true);
  });
  test('actions and pages are boxes like any other', () => {
    // One action off under the resource wildcard: everything else of the resource stays, the action goes.
    const withoutShip = togglePermission(['product.*'], 'product.action.ship', false, known);
    expect(withoutShip.sort()).toEqual(['product.approve', 'product.create', 'product.delete', 'product.purge', 'product.update', 'product.view']);
    // `product.action.*` covers every action of the resource and nothing else.
    expect(grants(['product.action.*'], 'product.action.ship')).toBe(true);
    expect(grants(['product.action.*'], 'product.update')).toBe(false);
    expect(togglePermission(['product.action.*'], 'product.action.ship', false, known)).toEqual([]);
    // `*.view` is about resources: unticking one of them never adds a page.
    const views = togglePermission(['*.view'], 'tag.view', false, known);
    expect(views).toEqual(['rbac.view', 'product.view']); // `rbac.view` is a general permission the pattern also matched
    expect(views.some((code) => code.startsWith('page.'))).toBe(false);
    // A page's save box off under `*`: its view box and everything else stay.
    const fromStar = togglePermission(['*'], 'page.payments.update', false, known);
    expect(grants(fromStar, 'page.payments.update')).toBe(false);
    expect(known.filter((code) => code !== 'page.payments.update').every((code) => grants(fromStar, code))).toBe(true);
    // `page.payments.*` is the save code only.
    expect(togglePermission(['page.payments.*'], 'page.payments.update', false, known)).toEqual([]);
    expect(togglePermission([], 'page.payments', true, known)).toEqual(['page.payments']);
  });
  test('unticking a plain code removes it', () => {
    expect(togglePermission(['product.view', 'tag.view'], 'tag.view', false, known)).toEqual(['product.view']);
  });
});

describe('dashboard codes', () => {
  test('dashboard.* and * grant every widget, as on the server; a widget code grants only itself', () => {
    expect(codeMatches('dashboard.*', 'dashboard.sales')).toBe(true);
    expect(codeMatches('*', 'dashboard.sales')).toBe(true);
    expect(codeMatches('dashboard.sales', 'dashboard.orders')).toBe(false);
    expect(codeMatches('*.sales', 'dashboard.sales')).toBe(true);
  });
});
