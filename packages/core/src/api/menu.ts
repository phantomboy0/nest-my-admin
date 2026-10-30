import type { MetaMenu, MetaMenuItem, MetaMenuSection, MetaPageSummary, MetaResourceSummary } from '../contract.js';
import { parseListQuery } from '../crud/list-query.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { AdminMenuOptions } from '../options.js';
import type { PageRegistry } from '../pages/page-registry.js';
import type { ResourceRegistry } from '../registry/resource-registry.js';
import { didYouMean } from '../schema/suggest.js';

/** A menu item by name (classes resolved at boot). */
export type ResolvedMenuItem = { resource: string; badge?: Record<string, string> } | { page: string } | { href: string; label: LocalizedText };

/** A menu section with every reference resolved: names for classes, a group's label and icon filled in. */
export interface ResolvedMenuSection {
  key: string;
  label: LocalizedText;
  /** The `translate` key of the label: the section's own (`menu.<key>`), or the group's (`group.<key>`). */
  labelKey: string;
  icon: string;
  /** Without items: the members of this group, as the user sees them (meta's group). */
  group?: string;
  items?: ResolvedMenuItem[];
}

export interface ResolvedMenu {
  sections: ResolvedMenuSection[];
  advanced?: { label?: LocalizedText };
}

/** The menu with classes turned into names and `{ group }` sections filled from their `@AdminGroup`; fails boot on an unknown one. */
export function resolveMenu(menu: AdminMenuOptions, registry: ResourceRegistry, pages: PageRegistry): ResolvedMenu {
  const groups = new Map(registry.groupList().map((group) => [group.key, group]));
  const sections = menu.sections.map((section): ResolvedMenuSection => {
    const fail = (message: string): never => {
      throw new Error(`nest-my-admin: menu: ${message}`);
    };
    const items = section.items?.map((item): ResolvedMenuItem => {
      if ('resource' in item && typeof item.resource === 'function') {
        const entry = registry.list().find((candidate) => candidate.resource.constructor === item.resource);
        if (!entry) fail(`${item.resource.name} is not a registered resource`);
        return { ...item, resource: entry!.schema.name };
      }
      if ('page' in item && typeof item.page === 'function') {
        const page = pages.list().find((candidate) => candidate.source.constructor === item.page);
        if (!page) fail(`${item.page.name} is not a registered settings page`);
        return { page: page!.name };
      }
      return item as ResolvedMenuItem;
    });
    const key = section.key!;
    if (section.group === undefined) return { key, label: section.label, labelKey: `menu.${key}`, icon: section.icon, items: items! };
    const group = groups.get(section.group);
    if (!group) fail(`unknown group "${section.group}"${didYouMean(section.group, [...groups.keys()])}`);
    return {
      key,
      label: section.label ?? group!.label,
      labelKey: section.label !== undefined ? `menu.${key}` : `group.${group!.key}`,
      icon: section.icon ?? group!.icon ?? 'folder',
      group: group!.key,
      ...(items ? { items } : {}),
    };
  });
  return { sections, ...(menu.advanced ? { advanced: menu.advanced } : {}) };
}

/**
 * The menu's references, once every resource and page is registered: they exist, resources have a navigation entry,
 * and each badge is a list query the resource accepts (its `filter[...]` fields are in `list.filters`).
 */
export function checkMenu(menu: ResolvedMenu, registry: ResourceRegistry, pages: PageRegistry): void {
  for (const section of menu.sections) {
    const fail = (message: string): never => {
      throw new Error(`nest-my-admin: menu.sections.${section.key}: ${message}`);
    };
    for (const item of section.items ?? []) {
      if ('resource' in item) {
        const entry = registry.find(item.resource);
        if (!entry) fail(`unknown resource "${item.resource}"`);
        if (!entry!.nav) fail(`${item.resource} has no navigation entry (nav: false); set nav: true on it to place it in the menu`);
        if (item.badge) {
          try {
            parseListQuery(new URLSearchParams({ ...item.badge, pageSize: '1' }), entry!.schema);
          } catch (error) {
            const fields = Object.keys((error as { fields?: Record<string, string[]> }).fields ?? {});
            fail(`badge of ${item.resource}: ${fields.join(', ') || (error as Error).message} is not a filter the list allows (list.filters)`);
          }
        }
      } else if ('page' in item) {
        if (!pages.find(item.page)) fail(`unknown settings page "${item.page}"`);
      }
    }
  }
}

/**
 * The menu as one user gets it: items cut to the resources and pages they see (`resources`, `pages`: what meta
 * lists for them), empty sections dropped, and what no section places in `advanced`, in meta's order.
 */
export function buildMenu(
  menu: ResolvedMenu,
  text: (label: LocalizedText, key?: string) => string,
  groups: Array<{ key: string; resources: MetaResourceSummary[]; pages: MetaPageSummary[] }>,
): MetaMenu {
  const resources = groups.flatMap((group) => group.resources);
  const pages = groups.flatMap((group) => group.pages);
  const resourceByName = new Map(resources.map((resource) => [resource.name, resource]));
  const pageByName = new Map(pages.map((page) => [page.name, page]));
  const placed = new Set<string>();
  const sections: MetaMenuSection[] = [];
  for (const section of menu.sections) {
    const items: MetaMenuItem[] = [];
    // A group section without items lists the group's members as the user sees them.
    const members = groups.find((group) => group.key === section.group);
    const listed: ResolvedMenuItem[] = section.items ?? [...(members?.resources ?? []).map((resource) => ({ resource: resource.name })), ...(members?.pages ?? []).map((page) => ({ page: page.name }))];
    for (const item of listed) {
      if ('resource' in item) {
        placed.add(`r:${item.resource}`);
        const seen = resourceByName.get(item.resource);
        if (seen) items.push(resourceItem(seen, item.badge !== undefined));
      } else if ('page' in item) {
        placed.add(`p:${item.page}`);
        const seen = pageByName.get(item.page);
        if (seen) items.push({ kind: 'page', page: seen.name, label: seen.label, ...(seen.icon ? { icon: seen.icon } : {}) });
      } else {
        items.push({ kind: 'link', href: item.href, label: text(item.label) });
      }
    }
    // A section of links only is the host's choice; one whose resources and pages were all cut is dropped.
    const linksOnly = section.items !== undefined && section.items.every((item) => 'href' in item);
    if (linksOnly || items.some((item) => item.kind !== 'link')) sections.push({ key: section.key, label: text(section.label, section.labelKey), icon: section.icon, items });
  }
  const rest: MetaMenuItem[] = [
    ...resources.filter((resource) => !placed.has(`r:${resource.name}`)).map((resource) => resourceItem(resource, false)),
    ...pages.filter((page) => !placed.has(`p:${page.name}`)).map((page): MetaMenuItem => ({ kind: 'page', page: page.name, label: page.label, ...(page.icon ? { icon: page.icon } : {}) })),
  ];
  return { sections, advanced: { key: 'advanced', label: text(menu.advanced?.label ?? { en: 'Advanced', fa: 'پیشرفته' }, 'menu.advanced'), icon: 'database', items: rest } };
}

function resourceItem(summary: MetaResourceSummary, badge: boolean): MetaMenuItem {
  return {
    kind: 'resource',
    resource: summary.name,
    label: summary.label,
    ...(summary.icon ? { icon: summary.icon } : {}),
    creatable: summary.creatable,
    searchable: summary.searchable,
    ...(badge ? { badge: true as const } : {}),
  };
}
