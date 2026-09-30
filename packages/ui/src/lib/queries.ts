import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale } from '@/i18n';
import { api } from './api';

// Labels depend on the language, so meta and schemas are cached per locale.
export const useMeta = () => {
  const { locale } = useLocale();
  return useQuery({ queryKey: ['meta', locale], queryFn: api.meta });
};

export const useSchema = (resource: string) => {
  const { locale } = useLocale();
  return useQuery({ queryKey: ['schema', resource, locale], queryFn: () => api.schema(resource) });
};

export const useList = (resource: string, query: string, enabled = true) =>
  useQuery({
    queryKey: ['list', resource, query],
    queryFn: () => api.list(resource, new URLSearchParams(query)),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useRecord = (resource: string, id: string | undefined) =>
  useQuery({ queryKey: ['record', resource, id], queryFn: () => api.get(resource, id!), enabled: id !== undefined });

/** Picker options for `search` (runs only while `enabled`, i.e. while the picker is open). */
/** `values`: the form's current values as JSON, for options that depend on other fields. */
export const useOptions = (resource: string, field: string, search: string, enabled: boolean, values?: string) =>
  useQuery({
    queryKey: ['options', resource, field, search, values ?? ''],
    queryFn: () => api.options(resource, field, { search, values }),
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
