import { describe, expect, test } from 'bun:test';
import type { PageResponse, ResourceSchema, SessionResponse } from '@nest-my-admin/core/contract';
import { readOnlyPage, readOnlySchema, readOnlySession } from './view-as';

describe('view-as', () => {
  test('schemas lose every write', () => {
    const schema = {
      creatable: true,
      permissions: { create: true, update: true, delete: true, purge: false },
      list: { editable: ['price'] },
      actions: [{ name: 'ship', label: 'Ship', target: 'record', bulk: true, atomic: false, variant: 'default' }, { name: 'recount', label: 'Recount', target: 'resource', bulk: false, atomic: false, variant: 'default' }],
      form: { create: ['name', 'price'], update: ['price'], requiredOnCreate: ['name'], readonly: ['sku'] },
    } as unknown as ResourceSchema;
    const cut = readOnlySchema(schema);
    expect(cut.creatable).toBe(false);
    expect(cut.permissions).toEqual({ create: false, update: false, delete: false, purge: false });
    expect(cut.list.editable).toEqual([]);
    // The server still lists the actions the user may run, but refuses to run them for a viewer.
    expect(cut.actions).toEqual([]);
    expect(schema.actions).toHaveLength(2);
    expect(cut.form).toMatchObject({ create: [], update: [], requiredOnCreate: [], readonly: ['sku', 'price', 'name'] });
  });

  test('inline children lose every write too', () => {
    const child = { creatable: true, permissions: { create: true, update: true, delete: true, purge: false }, list: { editable: [] }, actions: [], form: { create: ['qty'], update: ['qty'], requiredOnCreate: [], readonly: [] } };
    const schema = { ...child, inlines: { line: child } } as unknown as ResourceSchema;
    const cut = readOnlySchema(schema).inlines!.line!;
    expect(cut.permissions).toEqual({ create: false, update: false, delete: false, purge: false });
    expect(cut.form).toMatchObject({ create: [], update: [], readonly: ['qty'] });
  });

  test('settings pages are read-only, whatever the answer says', () => {
    const page = { schema: { name: 'shop', readonly: false }, values: { shopName: 'Demo' }, secrets: { apiKey: true }, files: {} } as unknown as PageResponse;
    const cut = readOnlyPage(page);
    expect(cut.schema.readonly).toBe(true);
    expect(cut.values).toEqual({ shopName: 'Demo' });
    expect(page.schema.readonly).toBe(false);
    expect(readOnlyPage(cut)).toBe(cut);
  });

  test('sessions: no managing roles while viewing as', () => {
    const session = { rbac: { enabled: true, view: true, manage: true } } as SessionResponse;
    expect(readOnlySession(session).rbac.manage).toBe(true);
    expect(readOnlySession({ ...session, viewAs: { by: { id: '1', displayName: 'Root', isSuperuser: true } } }).rbac).toEqual({ enabled: true, view: true, manage: false });
  });
});
