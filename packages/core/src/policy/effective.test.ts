import { describe, expect, test } from 'bun:test';
import { EffectivePermissions } from './effective.js';
import type { RoleDefinition } from './roles.js';

const role = (name: string, rest: Partial<RoleDefinition>): RoleDefinition => ({ name, permissions: [], ...rest });
const viewer = role('viewer', { permissions: ['product.view'], fields: { product: { cost: 'hidden' } } });
const editor = role('editor', { permissions: ['product.update'], fields: { product: { price: 'readonly' } }, scopes: { product: { update: 'drafts' } } });
const auditor = role('auditor', { permissions: ['product.view', 'product.field.salary.view'], scopes: { product: { view: 'own' } } });

describe('effective permissions', () => {
  test('union of roles; update implies view', () => {
    const perms = new EffectivePermissions([editor], false);
    expect(perms.canOn('product', 'view')).toBe(true);
    expect(perms.canOn('product', 'update')).toBe(true);
    expect(perms.canOn('product', 'delete')).toBe(false);
    expect(perms.canOn('category', 'view')).toBe(false);
    expect(new EffectivePermissions([viewer, role('d', { permissions: ['product.delete'] })], false).canOn('product', 'delete')).toBe(true);
  });

  test('field levels: rules, ceilings, restricted fields, most permissive wins (Review Focus 2)', () => {
    const one = new EffectivePermissions([viewer], false);
    expect(one.fieldLevel('product', 'name')).toBe('view'); // view-only role
    expect(one.fieldLevel('product', 'cost')).toBe('hidden');
    const two = new EffectivePermissions([viewer, editor], false);
    expect(two.fieldLevel('product', 'cost')).toBe('edit'); // hidden in one, editable in the other
    expect(two.fieldLevel('product', 'price')).toBe('view'); // readonly in editor, view in viewer
    expect(two.fieldLevel('product', 'salary', true)).toBe('hidden'); // restricted, nobody granted it
    expect(new EffectivePermissions([auditor], false).fieldLevel('product', 'salary', true)).toBe('view');
    expect(new EffectivePermissions([role('x', { permissions: ['product.view'], fields: { product: { name: 'edit' } } })], false).fieldLevel('product', 'name')).toBe('view'); // never above the role
    expect(new EffectivePermissions([], false).fieldLevel('product', 'name')).toBe('hidden');
  });

  test('scopes per operation are ORed; a role without one means every row', () => {
    expect(new EffectivePermissions([editor], false).scopes('product', 'update')).toEqual(['drafts']);
    expect(new EffectivePermissions([editor], false).scopes('product', 'view')).toBe('all');
    expect(new EffectivePermissions([auditor, role('own2', { permissions: ['product.view'], scopes: { product: { view: ['drafts'] } } })], false).scopes('product', 'view')).toEqual(['own', 'drafts']);
    expect(new EffectivePermissions([auditor, viewer], false).scopes('product', 'view')).toBe('all');
    expect(new EffectivePermissions([], false).scopes('product', 'view')).toEqual([]); // nobody: no rows
  });

  test('superusers can do everything', () => {
    const root = new EffectivePermissions([], true);
    expect(root.can('anything.at.all')).toBe(true);
    expect(root.fieldLevel('product', 'salary', true)).toBe('edit');
    expect(root.scopes('product', 'delete')).toBe('all');
  });

  test('custom codes', () => {
    expect(new EffectivePermissions([role('r', { permissions: ['reports.run', 'product.*'] })], false).can('product.view_all')).toBe(true);
    expect(new EffectivePermissions([viewer], false).can('reports.run')).toBe(false);
  });
});
