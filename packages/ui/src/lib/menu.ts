import type { MenuBadges, MetaGroup, MetaPageSummary, MetaResourceSummary, MetaResponse } from '@nest-my-admin/core/contract';

/** One sidebar entry, in the order the menu (or the module group) gives. */
export type NavItem =
  | { kind: 'resource'; name: string; label: string; icon?: string; /** Key in `MenuBadges`. */ badge?: string }
  | { kind: 'page'; name: string; label: string; icon?: string }
  | { kind: 'link'; href: string; label: string };

/**
 * A navigation section: a module group, or a section of the host's menu. `resources` and `pages` are read the same way
 * either way (cards, group pages, breadcrumbs, palette); the sidebar renders `items`, which keeps links and order.
 */
export interface NavGroup extends MetaGroup {
  items: NavItem[];
  /** The menu's last section (unplaced resources and pages). */
  advanced?: boolean;
}

/** The sections people navigate by: the menu's when the host declared one (spec §5.3), else the module groups. */
export function navGroups(meta: MetaResponse): NavGroup[] {
  if (!meta.menu) {
    return meta.groups.map((group) => ({
      ...group,
      items: [
        ...group.resources.map((resource): NavItem => ({ kind: 'resource', name: resource.name, label: resource.label, ...(resource.icon ? { icon: resource.icon } : {}) })),
        ...group.pages.map((page): NavItem => ({ kind: 'page', name: page.name, label: page.label, ...(page.icon ? { icon: page.icon } : {}) })),
      ],
    }));
  }
  const { sections, advanced } = meta.menu;
  return [...sections, ...(advanced.items.length > 0 ? [advanced] : [])].map((section) => {
    const resources: MetaResourceSummary[] = [];
    const pages: MetaPageSummary[] = [];
    const items: NavItem[] = section.items.map((item) => {
      if (item.kind === 'resource') {
        resources.push({ name: item.resource, label: item.label, ...(item.icon ? { icon: item.icon } : {}), creatable: item.creatable, searchable: item.searchable });
        return { kind: 'resource', name: item.resource, label: item.label, ...(item.icon ? { icon: item.icon } : {}), ...(item.badge ? { badge: `${section.key}.${item.resource}` } : {}) };
      }
      if (item.kind === 'page') {
        pages.push({ name: item.page, label: item.label, ...(item.icon ? { icon: item.icon } : {}) });
        return { kind: 'page', name: item.page, label: item.label, ...(item.icon ? { icon: item.icon } : {}) };
      }
      return item;
    });
    return { key: section.key, label: section.label, ...(section.icon ? { icon: section.icon } : {}), resources, pages, items, ...(section === advanced ? { advanced: true } : {}) };
  });
}

/** A section's count: the sum of its items' badges (the design's «فروش ۱۸»), or nothing when none has a count. */
export function sectionCount(items: NavItem[], badges: MenuBadges | undefined): { count: number; estimate: boolean } | undefined {
  const counted = items.flatMap((item) => (item.kind === 'resource' && item.badge && badges?.[item.badge] ? [badges[item.badge]!] : []));
  if (counted.length === 0) return undefined;
  return { count: counted.reduce((sum, badge) => sum + badge.count, 0), estimate: counted.some((badge) => badge.estimate) };
}

/** A curated menu opens only the section you are in; module groups all start open (as before menus existed). */
export function collapsedByDefault({ menu, current }: { menu: boolean; current: boolean }): boolean {
  return menu && !current;
}
