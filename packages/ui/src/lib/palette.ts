import type { MetaResponse } from '@nest-my-admin/core/contract';
import { toLatinDigits } from '@/lib/digits';

export interface PaletteItem {
  id: string;
  section: 'go' | 'create' | 'records';
  label: string;
  /** A hint shown after the label (the group, or the record's resource). */
  detail?: string;
  to: string;
}

/** Folding for matching: case, Arabic/Persian letter variants, digit sets, ZWNJ. */
export function fold(text: string): string {
  return toLatinDigits(text)
    .toLocaleLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, ' ');
}

/** Every word of the query appears in the text, in any order ("new prod" matches "New Product"). */
export function matches(text: string, query: string): boolean {
  const haystack = fold(text);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/** Resources and groups to go to, and "New …" for creatable resources, that match the query (all of them when empty). */
export function navigationItems(meta: MetaResponse, query: string, newLabel: (name: string) => string): PaletteItem[] {
  const go: PaletteItem[] = [];
  const create: PaletteItem[] = [];
  for (const group of meta.groups) {
    if (meta.groups.length > 1 && matches(group.label, query)) go.push({ id: `group:${group.key}`, section: 'go', label: group.label, to: `/g/${group.key}` });
    for (const resource of group.resources) {
      if (matches(`${resource.label} ${group.label}`, query)) go.push({ id: `go:${resource.name}`, section: 'go', label: resource.label, detail: group.label, to: `/${resource.name}` });
      const label = newLabel(resource.label);
      if (resource.creatable && query.trim() !== '' && matches(label, query)) create.push({ id: `new:${resource.name}`, section: 'create', label, to: `/${resource.name}/new` });
    }
  }
  return [...go, ...create];
}
