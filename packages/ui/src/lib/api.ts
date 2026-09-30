import type { AdminErrorBody, AdminRecord, ListResponse, MetaResponse, ResourceSchema } from '@nest-my-admin/core/contract';
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

export const api = {
  meta: () => request<MetaResponse>('/meta'),
  schema: (resource: string) => request<ResourceSchema>(`/meta/resources/${enc(resource)}`),
  list: (resource: string, params: { page: number; pageSize?: number; sort?: string }) => {
    const query = new URLSearchParams({ page: String(params.page) });
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.sort) query.set('sort', params.sort);
    return request<ListResponse>(`/resources/${enc(resource)}?${query}`);
  },
  get: (resource: string, id: string) => request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`),
  create: (resource: string, body: Record<string, unknown>) =>
    request<AdminRecord>(`/resources/${enc(resource)}`, { method: 'POST', body: JSON.stringify(body) }),
  update: (resource: string, id: string, body: Record<string, unknown>) =>
    request<AdminRecord>(`/resources/${enc(resource)}/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
};
