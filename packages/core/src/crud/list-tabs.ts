import type { ResourceSchema } from '../contract.js';
import type { ListTab } from '../resource/admin-resource-base.js';
import { parseListQuery } from './list-query.js';

export const MAX_TABS = 6;

/** `list.tabs` at boot (spec §5.5): at most six, unique keys, filters the list accepts (`list.filters`), a function `where`. */
export function checkTabs(schema: ResourceSchema, tabs: ListTab[] | undefined, fail: (message: string) => never): void {
  if (tabs === undefined) return;
  if (!Array.isArray(tabs) || tabs.length > MAX_TABS) fail(`list.tabs: at most ${MAX_TABS} tabs`);
  const keys = new Set<string>();
  for (const tab of tabs) {
    if (typeof tab.key !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(tab.key)) fail(`list.tabs: the key "${String(tab.key)}" must be letters, digits, - and _`);
    if (keys.has(tab.key)) fail(`list.tabs: the key "${tab.key}" is used twice`);
    keys.add(tab.key);
    if (tab.where !== undefined && typeof tab.where !== 'function') fail(`list.tabs.${tab.key}: where must be a function (qb, ctx)`);
    if (tab.count !== undefined && !['exact', 'estimate', 'none'].includes(tab.count)) fail(`list.tabs.${tab.key}: count is exact, estimate or none`);
    for (const key of Object.keys(tab.filter ?? {})) if (!key.startsWith('filter[')) fail(`list.tabs.${tab.key}: filter holds filter[...] parameters, not "${key}"`);
    try {
      parseListQuery(new URLSearchParams(tab.filter ?? {}), schema);
    } catch (error) {
      const fields = Object.keys((error as { fields?: Record<string, string[]> }).fields ?? {});
      fail(`list.tabs.${tab.key}: ${fields.join(', ') || (error as Error).message} is not a filter the list allows (list.filters)`);
    }
  }
}

/** The tabs a viewer may use: those whose filters name only fields of the schema they see (anti-oracle, spec §6.5). */
export function visibleTabs(schema: ResourceSchema): ResourceSchema['list']['tabs'] {
  return schema.list.tabs?.filter((tab) => {
    try {
      parseListQuery(new URLSearchParams(tab.filter), schema);
      return true;
    } catch {
      return false;
    }
  });
}
