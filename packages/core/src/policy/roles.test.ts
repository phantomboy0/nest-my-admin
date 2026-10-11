import { describe, expect, test } from 'bun:test';
import { actionCode, checkRoles, codeMatches, knownCodes, type PolicyCatalog, type RoleDefinition } from './roles.js';
import { EffectivePermissions } from './effective.js';

const catalog: PolicyCatalog = {
  resources: new Map([
    ['product', { fields: ['name', 'price', 'cost'], scopes: ['drafts', 'own'], custom: ['view_all'], actions: ['publish', 'recount'] }],
    ['category', { fields: ['name'], scopes: [], custom: [] }],
  ]),
  global: ['reports.run'],
};
const fail = (message: string): never => {
  throw new Error(message);
};
const check = (role: Partial<RoleDefinition>) => () => checkRoles([{ name: 'r', permissions: [], ...role }], catalog, fail);

describe('permission codes', () => {
  test('wildcards', () => {
    expect(codeMatches('product.view', 'product.view')).toBe(true);
    expect(codeMatches('product.*', 'product.view')).toBe(true);
    expect(codeMatches('product.*', 'product.field.cost.view')).toBe(true);
    expect(codeMatches('product.*', 'category.view')).toBe(false);
    expect(codeMatches('*.view', 'category.view')).toBe(true);
    expect(codeMatches('*.view', 'product.field.cost.view')).toBe(false);
    expect(codeMatches('*', 'reports.run')).toBe(true);
    expect(codeMatches('product.view', 'product.view_all')).toBe(false);
    expect(codeMatches('product', 'product.view')).toBe(false);
  });
  test('known codes', () => {
    const codes = knownCodes(catalog);
    expect(codes).toContain('product.purge');
    expect(codes).toContain('product.view_all');
    expect(codes).toContain('product.field.cost.edit');
    expect(codes).toContain('reports.run');
  });
  test('action codes: `{resource}.action.{name}`, covered by the resource wildcard', () => {
    expect(actionCode('product', 'publish')).toBe('product.action.publish');
    expect(knownCodes(catalog)).toEqual(expect.arrayContaining(['product.action.publish', 'product.action.recount']));
    expect(knownCodes(catalog).some((code) => code.startsWith('category.action.'))).toBe(false);
    const can = (pattern: string) => new EffectivePermissions([{ name: 'r', permissions: [pattern] }], false).can('product.action.publish');
    expect(can('product.action.publish')).toBe(true);
    expect(can('product.action.*')).toBe(true);
    expect(can('product.*')).toBe(true); // everything on product, as for field and custom codes
    expect(can('*')).toBe(true);
    expect(can('*.action.publish')).toBe(true);
    expect(can('product.action.recount')).toBe(false);
    expect(can('product.update')).toBe(false);
    expect(can('*.update')).toBe(false);
    expect(can('product.action')).toBe(false);
    expect(check({ permissions: ['product.action.publish', 'product.action.*'] })).not.toThrow();
    expect(check({ permissions: ['product.action.publsh'] })).toThrow('unknown permission "product.action.publsh" (did you mean "product.action.publish"?)');
    expect(check({ permissions: ['category.action.*'] })).toThrow('unknown permission "category.action.*"');
  });
});

describe('role validation', () => {
  test('accepts real codes, fields and scopes', () => {
    expect(check({ permissions: ['product.*', '*.view', 'reports.run', 'product.field.cost.view'], fields: { product: { price: 'readonly' } }, scopes: { product: { update: 'drafts', view: ['own', 'drafts'] } } })).not.toThrow();
  });
  test('unknown things are boot errors with suggestions', () => {
    expect(check({ permissions: ['product.veiw'] })).toThrow('roles.r.permissions: unknown permission "product.veiw" (did you mean "product.view"?)');
    expect(check({ fields: { prodct: {} } })).toThrow('roles.r.fields: unknown resource "prodct" (did you mean "product"?)');
    expect(check({ fields: { product: { prise: 'hidden' } } })).toThrow('unknown field "prise" (did you mean "price"?)');
    expect(check({ fields: { product: { price: 'secret' as 'hidden' } } })).toThrow('"secret" is not hidden, readonly, view or edit');
    expect(check({ scopes: { product: { update: 'draft' } } })).toThrow('no @AdminScope("draft") on the product resource (did you mean "drafts"?)');
    expect(check({ scopes: { product: { create: 'drafts' } as never } })).toThrow('"create" is not view, update or delete');
    expect(() => checkRoles([{ name: 'a', permissions: [] }, { name: 'a', permissions: [] }], catalog, fail)).toThrow('"a" is defined twice');
    expect(() => checkRoles([{ name: 'bad name', permissions: [] }], catalog, fail)).toThrow('not a valid role name');
  });
});
