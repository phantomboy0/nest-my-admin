import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './api';

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: api.meta });

export const useSchema = (resource: string) =>
  useQuery({ queryKey: ['schema', resource], queryFn: () => api.schema(resource) });

export const useList = (resource: string, page: number, sort?: string) =>
  useQuery({
    queryKey: ['list', resource, page, sort],
    queryFn: () => api.list(resource, { page, sort }),
    placeholderData: keepPreviousData,
  });

export const useRecord = (resource: string, id: string | undefined) =>
  useQuery({ queryKey: ['record', resource, id], queryFn: () => api.get(resource, id!), enabled: id !== undefined });
