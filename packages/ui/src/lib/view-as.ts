import type { PageResponse, ResourceSchema, SessionResponse } from '@nest-my-admin/core/contract';

/**
 * While viewing as someone the admin is read-only (the server refuses writes): no write controls at all. The schema
 * still lists the actions that user may run, but running one as them is refused, so none is offered.
 */
export function readOnlySchema(schema: ResourceSchema): ResourceSchema {
  return {
    ...schema,
    creatable: false,
    actions: [],
    // A print page opens in its own tab, which cannot view as someone: it would print as the superuser.
    prints: [],
    permissions: { create: false, update: false, delete: false, purge: false },
    list: { ...schema.list, editable: [] },
    form: { ...schema.form, create: [], update: [], requiredOnCreate: [], readonly: [...new Set([...schema.form.readonly, ...schema.form.update, ...schema.form.create])] },
    ...(schema.inlines ? { inlines: Object.fromEntries(Object.entries(schema.inlines).map(([name, child]) => [name, readOnlySchema(child)])) } : {}),
  };
}

/** A settings page while viewing as someone: no save and no upload controls (the server says so too; this makes sure). */
export function readOnlyPage(page: PageResponse): PageResponse {
  return page.schema.readonly ? page : { ...page, schema: { ...page.schema, readonly: true } };
}

export function readOnlySession(session: SessionResponse): SessionResponse {
  return session.viewAs ? { ...session, rbac: { ...session.rbac, manage: false } } : session;
}
