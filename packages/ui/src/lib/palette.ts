import type { MetaResponse } from '@nest-my-admin/core/contract';
import { toLatinDigits } from '@/lib/digits';
import { navGroups } from '@/lib/menu';

/** The design's three groups: records (search), actions (create, toggle theme…) and places to go. */
export interface PaletteItem {
  id: string;
  section: 'go' | 'actions' | 'records';
  label: string;
  /** A hint shown after the label (the group, or the record's resource). */
  detail?: string;
  /** Where it goes; an action without one is run by the palette (`id`). */
  to?: string;
  /** An icon name (`lib/icons.ts`): the resource's, else its section's. */
  icon?: string;
}

/** Create actions offered before anything is typed (the design shows a few, not one per resource). */
export const IDLE_CREATES = 3;

/** An action the palette runs itself (the theme toggle): offered always, matched by its label. */
export interface PaletteAction {
  id: string;
  label: string;
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

/**
 * Places to go (sections, resources, settings pages) and actions: "New …" for creatable resources, and `actions`.
 * An empty query lists every place, the menu's own create actions (with a menu; none without) and `actions`;
 * typing narrows all of them, and any creatable resource can then be offered.
 */
export function navigationItems(meta: MetaResponse, query: string, newLabel: (name: string) => string, actions: PaletteAction[] = []): PaletteItem[] {
  const go: PaletteItem[] = [];
  const create: PaletteItem[] = [];
  const groups = navGroups(meta);
  const typed = query.trim() !== '';
  for (const group of groups) {
    if (groups.length > 1 && matches(group.label, query)) go.push({ id: `group:${group.key}`, section: 'go', label: group.label, to: `/g/${group.key}`, ...(group.icon ? { icon: group.icon } : {}) });
    for (const resource of group.resources) {
      const icon = resource.icon ?? group.icon;
      if (matches(`${resource.label} ${group.label}`, query)) go.push({ id: `go:${resource.name}`, section: 'go', label: resource.label, detail: group.label, to: `/${resource.name}`, ...(icon ? { icon } : {}) });
      const label = newLabel(resource.label);
      const offered = typed || (meta.menu !== undefined && !group.advanced && create.length < IDLE_CREATES);
      if (resource.creatable && offered && matches(label, query)) create.push({ id: `new:${resource.name}`, section: 'actions', label, to: `/${resource.name}/new` });
    }
    for (const page of group.pages) {
      const icon = page.icon ?? group.icon;
      if (matches(`${page.label} ${group.label}`, query)) go.push({ id: `page:${page.name}`, section: 'go', label: page.label, detail: group.label, to: `/p/${page.name}`, ...(icon ? { icon } : {}) });
    }
  }
  const run = actions.filter((action) => matches(action.label, query)).map((action): PaletteItem => ({ id: action.id, section: 'actions', label: action.label }));
  return [...go, ...create, ...run];
}
