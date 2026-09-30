import { useState } from 'react';
import { NavLink } from 'react-router';
import { ChevronDown, KeyRound, Pin, PinOff, UserRound, UsersRound } from 'lucide-react';
import type { MetaGroup, MetaResourceSummary } from '@nest-my-admin/core/contract';
import { Input } from '@/components/ui/input';
import { useLocale } from '@/i18n';
import { iconFor } from '@/lib/icons';
import { known, navStore, useNavState } from '@/lib/nav-state';
import { useSession } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface SidebarProps {
  title: string;
  logo?: string;
  groups: MetaGroup[];
  /** Icon-only rail (desktop). */
  rail?: boolean;
}

const linkClass = (rail: boolean) => ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent',
    rail && 'justify-center px-0',
    isActive && 'bg-sidebar-accent font-medium',
  );

/**
 * Groups (collapsible, one per Nest module) with their resources, a filter box, and the resources pinned or opened
 * recently in this browser. As a rail it shows icons only, each link keeping its name for assistive technology.
 */
export function Sidebar({ title, logo, groups, rail = false }: SidebarProps) {
  const { t } = useLocale();
  const nav = useNavState();
  const [filter, setFilter] = useState('');
  const resources = new Map(groups.flatMap((group) => group.resources.map((resource) => [resource.name, resource] as const)));
  const pinned = known(nav.pinned, new Set(resources.keys())).map((name) => resources.get(name)!);
  const recent = known(nav.recent, new Set(resources.keys()))
    .filter((name) => !nav.pinned.includes(name))
    .map((name) => resources.get(name)!);

  const term = filter.trim().toLocaleLowerCase();
  const visible = groups
    .map((group) => ({
      group,
      resources: term && !group.label.toLocaleLowerCase().includes(term)
        ? group.resources.filter((resource) => resource.label.toLocaleLowerCase().includes(term))
        : group.resources,
    }))
    .filter((entry) => entry.resources.length > 0);

  const item = (resource: MetaResourceSummary, section: string) => {
    const Icon = iconFor(resource.icon, 'resource');
    const isPinned = nav.pinned.includes(resource.name);
    return (
      <li key={`${section}:${resource.name}`} className="group/item flex items-center">
        <NavLink to={`/${resource.name}`} className={linkClass(rail)} aria-label={rail ? resource.label : undefined} title={rail ? resource.label : undefined}>
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {!rail && <span className="truncate">{resource.label}</span>}
        </NavLink>
        {!rail && (
          <button
            type="button"
            className={cn(
              'rounded-md p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100',
              isPinned && 'opacity-100',
            )}
            aria-label={t(isPinned ? 'shell.unpin' : 'shell.pin', { name: resource.label })}
            aria-pressed={isPinned}
            onClick={() => navStore.togglePin(resource.name)}
          >
            {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
        )}
      </li>
    );
  };

  return (
    <nav aria-label={t('shell.resources')} className={cn('flex h-full flex-col gap-4 overflow-y-auto p-3', rail && 'items-stretch px-2')}>
      <div className={cn('flex items-center gap-2 px-2 py-1', rail && 'justify-center px-0')}>
        {logo && <img src={logo} alt="" className="size-7 shrink-0 rounded-md object-contain" />}
        {!rail && <span className="truncate text-lg font-semibold">{title}</span>}
      </div>

      {!rail && (
        <Input
          type="search"
          aria-label={t('shell.filterResources')}
          placeholder={t('shell.filterResources')}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}

      {!rail && !term && pinned.length > 0 && (
        <Section label={t('shell.pinned')}>
          <ul className="flex flex-col gap-0.5">{pinned.map((resource) => item(resource, 'pinned'))}</ul>
        </Section>
      )}
      {!rail && !term && recent.length > 0 && (
        <Section label={t('shell.recent')}>
          <ul className="flex flex-col gap-0.5">{recent.map((resource) => item(resource, 'recent'))}</ul>
        </Section>
      )}

      {visible.map(({ group, resources: items }) => {
        const collapsed = !term && !rail && nav.collapsedGroups.includes(group.key);
        const GroupIcon = iconFor(group.icon, 'group');
        const listId = `nav-group-${group.key}`;
        return (
          <div key={group.key}>
            {!rail && (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 pb-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-expanded={!collapsed}
                aria-controls={listId}
                aria-label={t(collapsed ? 'shell.expandGroup' : 'shell.collapseGroup', { name: group.label })}
                onClick={() => navStore.toggleGroup(group.key)}
              >
                <GroupIcon className="size-3.5" aria-hidden />
                <span className="flex-1 truncate text-start">{group.label}</span>
                <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90 rtl:rotate-90')} aria-hidden />
              </button>
            )}
            {rail && <div className="mx-2 mb-1 border-t" aria-hidden />}
            {!collapsed && (
              <ul id={listId} className="flex flex-col gap-0.5" aria-label={group.label}>
                {items.map((resource) => item(resource, group.key))}
              </ul>
            )}
          </div>
        );
      })}
      {term && visible.length === 0 && <p className="px-2 text-sm text-muted-foreground">{t('shell.noMatches')}</p>}
      {!term && <AdministrationLinks rail={rail} />}
    </nav>
  );
}

/** Users, groups and roles (with `rbac`, for users who may see them). */
function AdministrationLinks({ rail }: { rail: boolean }) {
  const { t } = useLocale();
  const session = useSession();
  if (!session.data?.rbac.view) return null;
  const links: Array<[string, string, typeof UserRound]> = [
    ['/-/users', t('rbac.users'), UserRound],
    ['/-/groups', t('rbac.groups'), UsersRound],
    ['/-/roles', t('rbac.roles'), KeyRound],
  ];
  return (
    <div className="mt-auto border-t pt-3">
      {!rail && <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t('rbac.administration')}</div>}
      <ul className="flex flex-col gap-0.5" aria-label={t('rbac.administration')}>
        {links.map(([to, label, Icon]) => (
          <li key={to}>
            <NavLink to={to} className={linkClass(rail)} aria-label={rail ? label : undefined} title={rail ? label : undefined}>
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {!rail && <span className="truncate">{label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label}>
      <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </section>
  );
}
