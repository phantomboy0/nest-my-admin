import type { AdminErrorBody, AdminRecord, ListResponse, MetaResponse, OptionsResponse, ResourceSchema } from '@nest-my-admin/core/contract';
import { runtimeConfig } from './config';
import { ApiError } from './api-error';

export { ApiError, describeError } from './api-error';

function isErrorBody(value: unknown): value is AdminErrorBody {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${runtimeConfig.apiBase}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
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
      isErrorBody(data) ? data : { code: 'INTERNAL', message: `Request failed (${res.status})`, correlationId: '' },
    );
  }
  return data as T;
}

const enc = encodeURIComponent;

const ifMatch = (version: unknown): Record<string, string> =>
  typeof version === 'number' || typeof version === 'string' ? { 'If-Match': `"${version}"` } : {};

export const api = {
  meta: () => request<MetaResponse>('/meta'),
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
  restore: (resource: string, id: string) => request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}/restore`, { method: 'POST', body: '{}' }),
  get: (resource: string, id: string) => request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`),
  create: (resource: string, body: Record<string, unknown>) =>
    request<AdminRecord>(`/resources/${enc(resource)}`, { method: 'POST', body: JSON.stringify(body) }),
  update: (resource: string, id: string, body: Record<string, unknown>, version?: unknown) =>
    request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(body), headers: ifMatch(version) }),
};
