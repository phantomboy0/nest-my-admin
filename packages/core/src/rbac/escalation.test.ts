import { describe, expect, test } from 'bun:test';
import { EffectivePermissions } from '../policy/effective.js';
import type { PolicyCatalog, RoleDefinition } from '../policy/roles.js';
import { escalations } from './escalation.js';

const catalog: PolicyCatalog = {
  resources: new Map([
    ['product', { fields: ['name', 'price', 'cost'], scopes: ['drafts', 'own'], custom: [], restricted: ['cost'] }],
    ['category', { fields: ['name'], scopes: [], custom: [] }],
  ]),
  global: ['rbac.manage', 'rbac.view'],
};
const role = (rest: Partial<RoleDefinition>): RoleDefinition => ({ name: 'r', permissions: [], ...rest });
const manager = (...roles: RoleDefinition[]) => new EffectivePermissions(roles, false);
const editor = role({ permissions: ['product.view', 'product.update', 'rbac.manage'], fields: { product: { price: 'readonly' } }, scopes: { product: { update: 'drafts' } } });

describe('anti-escalation (Review Focus 1)', () => {
  test('a subset of what you hold is fine', () => {
    expect(escalations(role({ permissions: ['product.view'] }), manager(editor), catalog)).toEqual([]);
    expect(escalations(role({ permissions: ['product.update'], fields: { product: { price: 'readonly' } }, scopes: { product: { update: 'drafts' } } }), manager(editor), catalog)).toEqual([]);
  });
  test('codes you do not hold, wildcards included', () => {
    expect(escalations(role({ permissions: ['product.delete'] }), manager(editor), catalog)).toEqual(['grants product.delete, which you do not have']);
    const star = escalations(role({ permissions: ['*'] }), manager(editor), catalog);
    expect(star).toContain('grants category.view, which you do not have');
    expect(star).toContain('grants rbac.view, which you do not have');
  });
  test('actions you may not run yourself', () => {
    const shop: PolicyCatalog = { resources: new Map([['product', { fields: ['name'], scopes: [], custom: [], actions: ['publish', 'recount'] }]]), global: [] };
    const publisher = role({ permissions: ['product.view', 'product.update', 'product.action.publish'] });
    expect(escalations(role({ permissions: ['product.view', 'product.action.publish'] }), manager(publisher), shop)).toEqual([]);
    expect(escalations(role({ permissions: ['product.view', 'product.action.recount'] }), manager(publisher), shop)).toEqual(['grants product.action.recount, which you do not have']);
    expect(escalations(role({ permissions: ['product.view', 'product.action.*'] }), manager(publisher), shop)).toEqual(['grants product.action.recount, which you do not have']);
    expect(escalations(role({ permissions: ['product.*'] }), manager(role({ permissions: ['product.*'] })), shop)).toEqual([]);
  });
  test('settings pages you may not open or save yourself', () => {
    const shop: PolicyCatalog = { resources: new Map(), pages: ['payments', 'sms'], global: [] };
    const holder = role({ permissions: ['page.payments', 'page.payments.update', 'page.sms'] });
    expect(escalations(role({ permissions: ['page.payments', 'page.payments.update'] }), manager(holder), shop)).toEqual([]);
    expect(escalations(role({ permissions: ['page.sms.update'] }), manager(holder), shop)).toEqual(['grants page.sms.update, which you do not have']);
    expect(escalations(role({ permissions: ['page.*'] }), manager(holder), shop)).toEqual(['grants page.sms.update, which you do not have']);
    expect(escalations(role({ permissions: ['*'] }), manager(role({ permissions: ['page.*'] })), shop)).toEqual([]);
  });
  test('a wildcard over a custom permission does not let you grant the page of the same name', () => {
    const shop: PolicyCatalog = { resources: new Map([['order', { fields: [], scopes: [], custom: ['export'] }]]), pages: ['export'], global: [] };
    const exporter = role({ permissions: ['*.export'] });
    expect(escalations(role({ permissions: ['*.export'] }), manager(exporter), shop)).toEqual([]);
    expect(escalations(role({ permissions: ['page.export'] }), manager(exporter), shop)).toEqual(['grants page.export, which you do not have']);
    expect(escalations(role({ permissions: ['page.*'] }), manager(exporter), shop)).toEqual(['grants page.export, which you do not have', 'grants page.export.update, which you do not have']);
  });
  test('field levels above yours', () => {
    expect(escalations(role({ permissions: ['product.update'], scopes: { product: { update: 'drafts' } } }), manager(editor), catalog)).toEqual(['gives edit on product.price, above your view']);
    expect(escalations(role({ permissions: ['product.view', 'product.field.cost.view'] }), manager(editor), catalog)).toEqual([
      'grants product.field.cost.view, which you do not have',
      'gives view on product.cost, above your hidden',
    ]);
  });
  test('scopes wider than yours', () => {
    const wide = escalations(role({ permissions: ['product.update'], fields: { product: { price: 'readonly' } } }), manager(editor), catalog);
    expect(wide).toEqual(['reaches every row of product for update; yours: drafts']);
    expect(escalations(role({ permissions: ['product.update'], fields: { product: { price: 'readonly' } }, scopes: { product: { update: 'own' } } }), manager(editor), catalog)).toEqual([
      'reaches own row of product for update; yours: drafts',
    ]);
  });
  test('superusers may grant anything', () => {
    expect(escalations(role({ permissions: ['*'] }), new EffectivePermissions([], true), catalog)).toEqual([]);
  });
});
