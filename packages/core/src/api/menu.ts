import type { MetaMenu, MetaMenuItem, MetaMenuSection, MetaPageSummary, MetaResourceSummary } from '../contract.js';
import { parseListQuery } from '../crud/list-query.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { AdminMenuOptions } from '../options.js';
import type { PageRegistry } from '../pages/page-registry.js';
import type { ResourceRegistry } from '../registry/resource-registry.js';

/**
 * The menu's references, once every resource and page is registered: they exist, resources have a navigation entry,
 * and each badge is a list query the resource accepts (its `filter[...]` fields are in `list.filters`).
 */
export function checkMenu(menu: AdminMenuOptions, registry: ResourceRegistry, pages: PageRegistry): void {
  for (const section of menu.sections) {
    const fail = (message: string): never => {
      throw new Error(`nest-my-admin: menu.sections.${section.key}: ${message}`);
    };
    for (const item of section.items) {
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
  menu: AdminMenuOptions,
  text: (label: LocalizedText, key?: string) => string,
  resources: MetaResourceSummary[],
  pages: MetaPageSummary[],
): MetaMenu {
  const resourceByName = new Map(resources.map((resource) => [resource.name, resource]));
  const pageByName = new Map(pages.map((page) => [page.name, page]));
  const placed = new Set<string>();
  const sections: MetaMenuSection[] = [];
  for (const section of menu.sections) {
    const items: MetaMenuItem[] = [];
    for (const item of section.items) {
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
    const linksOnly = section.items.every((item) => 'href' in item);
    if (linksOnly || items.some((item) => item.kind !== 'link')) sections.push({ key: section.key, label: text(section.label, `menu.${section.key}`), icon: section.icon, items });
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
