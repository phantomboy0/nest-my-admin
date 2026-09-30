import { describe, expect, test } from 'bun:test';
import type { ResourceSchema, SessionResponse } from '@nest-my-admin/core/contract';
import { readOnlySchema, readOnlySession } from './view-as';

describe('view-as', () => {
  test('schemas lose every write', () => {
    const schema = {
      creatable: true,
      permissions: { create: true, update: true, delete: true, purge: false },
      list: { editable: ['price'] },
      form: { create: ['name', 'price'], update: ['price'], requiredOnCreate: ['name'], readonly: ['sku'] },
    } as unknown as ResourceSchema;
    const cut = readOnlySchema(schema);
    expect(cut.creatable).toBe(false);
    expect(cut.permissions).toEqual({ create: false, update: false, delete: false, purge: false });
    expect(cut.list.editable).toEqual([]);
    expect(cut.form).toMatchObject({ create: [], update: [], requiredOnCreate: [], readonly: ['sku', 'price', 'name'] });
  });

  test('sessions: no managing roles while viewing as', () => {
    const session = { rbac: { enabled: true, view: true, manage: true } } as SessionResponse;
    expect(readOnlySession(session).rbac.manage).toBe(true);
    expect(readOnlySession({ ...session, viewAs: { by: { id: '1', displayName: 'Root', isSuperuser: true } } }).rbac).toEqual({ enabled: true, view: true, manage: false });
  });
});
