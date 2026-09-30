import type {
  AccountSession,
  AdminErrorBody,
  AdminRecord,
  BulkResult,
  ListResponse,
  MetaResponse,
  OptionsResponse,
  ResourceSchema,
  RbacCatalog,
  RbacGroup,
  RbacRole,
  RbacUser,
  RbacUsersResponse,
  SearchResponse,
  SessionResponse,
} from '@nest-my-admin/core/contract';
import { activeLocale, translate as tr } from '@/i18n';
import { runtimeConfig } from './config';
import { ApiError } from './api-error';
import { currentCsrfToken, signedOut } from './session';

export { ApiError, describeError } from './api-error';

function isErrorBody(value: unknown): value is AdminErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const csrf = currentCsrfToken();
  const res = await fetch(`${runtimeConfig.apiBase}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Accept-Language': activeLocale(), // labels in meta and schemas follow it
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      // Every write carries the session's CSRF token (spec §7).
      ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...init.headers,
    },
  });
  // The session ended (expired, revoked, logged out elsewhere): back to the login page. The session endpoints
  // answer 401 for "not signed in" and "wrong password", which their callers handle.
  if (res.status === 401 && !path.startsWith('/session')) signedOut();
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    throw new ApiError(
      res.status,
      isErrorBody(data) ? data : { code: 'INTERNAL', message: tr('common.requestFailed', { status: res.status }), correlationId: '' },
    );
  }
  return data as T;
}

const enc = encodeURIComponent;

const ifMatch = (version: unknown): Record<string, string> =>
  typeof version === 'number' || typeof version === 'string' ? { 'If-Match': `"${version}"` } : {};

export const api = {
  session: () => request<SessionResponse>('/session'),
  login: (username: string, password: string) => request<SessionResponse>('/session', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<void>('/session', { method: 'DELETE' }),
  sessions: () => request<{ items: AccountSession[] }>('/account/sessions'),
  revokeSession: (id: string) => request<void>(`/account/sessions/${enc(id)}`, { method: 'DELETE' }),
  revokeOtherSessions: () => request<void>('/account/sessions', { method: 'DELETE' }),
  changePassword: (current: string, next: string) => request<void>('/account/password', { method: 'POST', body: JSON.stringify({ current, next }) }),
  meta: () => request<MetaResponse>('/meta'),
  rbac: {
    catalog: () => request<RbacCatalog>('/rbac/catalog'),
    roles: () => request<{ items: RbacRole[] }>('/rbac/roles'),
    role: (name: string) => request<RbacRole>(`/rbac/roles/${enc(name)}`),
    createRole: (role: Omit<RbacRole, 'system'>) => request<RbacRole>('/rbac/roles', { method: 'POST', body: JSON.stringify(role) }),
    updateRole: (name: string, role: Omit<RbacRole, 'system' | 'name'>) => request<RbacRole>(`/rbac/roles/${enc(name)}`, { method: 'PATCH', body: JSON.stringify(role) }),
    deleteRole: (name: string) => request<void>(`/rbac/roles/${enc(name)}`, { method: 'DELETE' }),
    exportRoles: () => request<{ version: 1; roles: RbacRole[] }>('/rbac/roles/export'),
    importRoles: (data: unknown) => request<{ imported: string[] }>('/rbac/roles/import', { method: 'POST', body: JSON.stringify(data) }),
    groups: () => request<{ items: RbacGroup[] }>('/rbac/groups'),
    group: (id: number) => request<RbacGroup>(`/rbac/groups/${id}`),
    saveGroup: (group: Partial<Omit<RbacGroup, 'id'>>, id?: number) =>
      request<RbacGroup>(id === undefined ? '/rbac/groups' : `/rbac/groups/${id}`, { method: id === undefined ? 'POST' : 'PATCH', body: JSON.stringify(group) }),
    deleteGroup: (id: number) => request<void>(`/rbac/groups/${id}`, { method: 'DELETE' }),
    users: (query: { search?: string; page?: number }) =>
      request<RbacUsersResponse>(`/rbac/users?${new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]))}`),
    user: (id: string) => request<RbacUser>(`/rbac/users/${enc(id)}`),
    createUser: (user: Record<string, unknown>) => request<RbacUser>('/rbac/users', { method: 'POST', body: JSON.stringify(user) }),
    updateUser: (id: string, changes: Record<string, unknown>) => request<RbacUser>(`/rbac/users/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(changes) }),
    setPassword: (id: string, password: string) => request<void>(`/rbac/users/${enc(id)}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
  },
  search: (q: string) => request<SearchResponse>(`/search?${new URLSearchParams({ q })}`),
  schema: (resource: string) => request<ResourceSchema>(`/meta/resources/${enc(resource)}`),
  list: (resource: string, query: URLSearchParams) => request<ListResponse>(`/resources/${enc(resource)}?${query}`),
  /** `version` (the record's @VersionColumn value) makes the server refuse with 409 if the record changed since. */
  remove: (resource: string, id: string, version?: unknown) =>
    request<void>(`/resources/${enc(resource)}/${enc(id)}`, { method: 'DELETE', headers: ifMatch(version) }),
  /** Picker options of a relation field: matching `search`, or the records with these `ids`. */
  options: (resource: string, field: string, query: { search?: string; ids?: Array<string | number>; values?: string }) => {
    const params = new URLSearchParams();
    if (query.ids) params.set('ids', query.ids.join(','));
    else if (query.search) params.set('search', query.search);
    if (query.values) params.set('values', query.values);
    return request<OptionsResponse>(`/resources/${enc(resource)}/fields/${enc(field)}/options${params.size ? `?${params}` : ''}`);
  },
  /** Deletes each record on its own; `failed` says which could not be deleted and why. */
  bulkDelete: (resource: string, ids: string[]) =>
    request<BulkResult>(`/resources/${enc(resource)}/bulk-delete`, { method: 'POST', body: JSON.stringify({ ids }) }),
  restore: (resource: string, id: string) => request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}/restore`, { method: 'POST', body: '{}' }),
  get: (resource: string, id: string) => request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`),
  create: (resource: string, body: Record<string, unknown>) =>
    request<AdminRecord>(`/resources/${enc(resource)}`, { method: 'POST', body: JSON.stringify(body) }),
  update: (resource: string, id: string, body: Record<string, unknown>, version?: unknown) =>
    request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(body), headers: ifMatch(version) }),
};
