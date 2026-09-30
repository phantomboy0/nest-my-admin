import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: api.meta });

export const useSchema = (resource: string) =>
  useQuery({ queryKey: ['schema', resource], queryFn: () => api.schema(resource) });

export const useList = (resource: string, query: string) =>
  useQuery({
    queryKey: ['list', resource, query],
    queryFn: () => api.list(resource, new URLSearchParams(query)),
    placeholderData: keepPreviousData,
  });

export const useRecord = (resource: string, id: string | undefined) =>
  useQuery({ queryKey: ['record', resource, id], queryFn: () => api.get(resource, id!), enabled: id !== undefined });

/** Picker options for `search` (runs only while `enabled`, i.e. while the picker is open). */
export const useOptions = (resource: string, field: string, search: string, enabled: boolean) =>
  useQuery({
    queryKey: ['options', resource, field, search],
    queryFn: () => api.options(resource, field, { search }),
    enabled,
    placeholderData: keepPreviousData,
  });

/** Titles of related records known only by id (relation filters restored from the URL). */
export const useRelationRefs = (resource: string, field: string, ids: string[]) =>
  useQuery({
    queryKey: ['options', resource, field, 'ids', ids],
    queryFn: () => api.options(resource, field, { ids }),
    enabled: ids.length > 0,
  });
