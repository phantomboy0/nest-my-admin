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
