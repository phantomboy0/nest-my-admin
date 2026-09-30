import type { ResourceSchema, SessionResponse } from '@nest-my-admin/core/contract';

/** While viewing as someone the admin is read-only (the server refuses writes): no write controls at all. */
export function readOnlySchema(schema: ResourceSchema): ResourceSchema {
  return {
    ...schema,
    creatable: false,
    permissions: { create: false, update: false, delete: false, purge: false },
    list: { ...schema.list, editable: [] },
    form: { ...schema.form, create: [], update: [], requiredOnCreate: [], readonly: [...new Set([...schema.form.readonly, ...schema.form.update, ...schema.form.create])] },
  };
}

export function readOnlySession(session: SessionResponse): SessionResponse {
  return session.viewAs ? { ...session, rbac: { ...session.rbac, manage: false } } : session;
}
