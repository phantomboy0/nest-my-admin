import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { ChevronDown, ChevronsUpDown, LayoutDashboard, Pin, PinOff, ShieldCheck, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { MenuBadges } from '@nest-my-admin/core/contract';
import { UserBlock } from '@/app/user-menu';
import { Button } from '@/components/ui/button';
import { formatNumber, useLocale } from '@/i18n';
import { iconFor } from '@/lib/icons';
import { collapsedByDefault, sectionCount, type NavGroup, type NavItem } from '@/lib/menu';
import { known, navStore, sectionCollapsed, useNavState } from '@/lib/nav-state';
import { useMenuBadges, useSession } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface SidebarProps {
  title: string;
  logo?: string;
  /** `navGroups(meta)`: the menu's sections, or the module groups. */
  groups: NavGroup[];
  /** The host declared a menu: sections start collapsed (but the current one), badges are loaded. */
  menu: boolean;
  /** Icon-only rail (desktop). */
  rail?: boolean;
  /** The phone drawer: a close button in the brand row and larger touch targets. */
  onClose?: () => void;
}

/** One entry under a section: a resource list, a settings page, or a link out. */
interface NavEntry {
  key: string;
  to: string;
  label: string;
  /** A link out of the admin (a menu `href` that is absolute). */
  external?: boolean;
  /** A resource list, which may be pinned (pins and recents are for lists). */
  pin?: string;
  /** Key in `MenuBadges`. */
  badge?: string;
}

interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  entries: NavEntry[];
  /** Starts collapsed (a menu section you are not in, «advanced»). */
  collapsedByDefault?: boolean;
  /** A menu section of one item: shown as that item's link, named after the section. */
  asLink?: boolean;
}

const itemClass = 'flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-start text-[13.5px] text-sidebar-foreground hover:bg-muted';
const subClass = ({ isActive }: { isActive: boolean }) =>
  cn('flex h-8 items-center rounded-[7px] px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground', isActive && 'bg-primary-soft font-semibold text-primary-text hover:bg-primary-soft hover:text-primary-text');

function entryOf(item: NavItem): NavEntry {
  if (item.kind === 'resource') return { key: item.name, to: `/${item.name}`, label: item.label, pin: item.name, ...(item.badge ? { badge: item.badge } : {}) };
  if (item.kind === 'page') return { key: `page:${item.name}`, to: `/p/${item.name}`, label: item.label };
  return { key: `link:${item.href}`, to: item.href, label: item.label, external: /^https?:\/\//i.test(item.href) };
}

const isCurrent = (pathname: string, entry: NavEntry) => !entry.external && (pathname === entry.to || pathname.startsWith(`${entry.to}/`));

function sectionsOf(groups: NavGroup[], menu: boolean, pathname: string, pinned: NavEntry[], pinnedLabel: string): NavSection[] {
  const sections = groups.map((group): NavSection => {
    const entries = group.items.map(entryOf);
    return {
      key: group.key,
      label: group.label,
      icon: iconFor(group.icon, 'group'),
      entries,
      collapsedByDefault: collapsedByDefault({ menu, current: entries.some((entry) => isCurrent(pathname, entry)) }),
      asLink: menu && !group.advanced && entries.length === 1,
    };
  });
  return pinned.length > 0 ? [{ key: '~pinned', label: pinnedLabel, icon: Pin, entries: pinned }, ...sections] : sections;
}

/**
 * The design's sidebar: the brand block, collapsible sections (one per group) with their lists and settings pages
 * indented under a line, administration and the signed-in user at the bottom. As a rail it shows one icon per section,
 * whose items open in a flyout.
 */
export function Sidebar({ title, logo, groups, menu, rail = false, onClose }: SidebarProps) {
  const { t } = useLocale();
  const nav = useNavState();
  const { pathname } = useLocation();
  const badges = useMenuBadges(menu).data;
  const resources = new Map(groups.flatMap((group) => group.items.flatMap((item) => (item.kind === 'resource' ? [[item.name, entryOf(item)] as const] : []))));
  const pinned = known(nav.pinned, new Set(resources.keys())).map((name) => resources.get(name)!);
  const all = sectionsOf(groups, menu, pathname, pinned, t('shell.pinned'));
  // «Advanced» sits at the bottom with administration, as in the design.
  const advanced = all.find((section) => groups.some((group) => group.advanced && group.key === section.key));
  const sections = all.filter((section) => section !== advanced);
  const admin = useAdministration();
  const render = (section: NavSection, muted = false) =>
    rail ? (
      <RailSection key={section.key} section={section} muted={muted} />
    ) : (
      <OpenSection key={section.key} section={section} collapsed={sectionCollapsed(nav, section.key, section.collapsedByDefault ?? false)} badges={badges} muted={muted} large={!!onClose} />
    );

  return (
    <nav aria-label={t('shell.resources')} className="flex h-full flex-col">
      <Brand title={title} logo={logo} rail={rail} onClose={onClose} />
      <div className={cn('flex flex-1 flex-col gap-0.5 overflow-y-auto', rail ? 'items-center px-0 py-2.5' : 'p-2.5')}>
        {/* A curated menu starts with the dashboard (home), as the design does. */}
        {menu && <TopLink to="/" label={t('shell.dashboard')} icon={LayoutDashboard} rail={rail} large={!!onClose} end />}
        {sections.map((section) => render(section))}
      </div>
      <div className={cn('flex flex-col gap-1 border-t border-sidebar-border', rail ? 'items-center px-0 py-2.5' : 'p-2.5')}>
        {advanced && render(advanced, true)}
        {admin && render(admin, true)}
        <UserBlock rail={rail} />
      </div>
    </nav>
  );
}

/** A row that is a link itself: the dashboard, and a menu section holding one item (the design's «تنظیمات»). */
function TopLink({ to, label, icon: Icon, rail, large, end, external, count }: { to: string; label: string; icon: NavSection['icon']; rail: boolean; large?: boolean; end?: boolean; external?: boolean; count?: { count: number; estimate: boolean } }) {
  const className = ({ isActive }: { isActive: boolean }) =>
    rail
      ? cn('flex size-10 items-center justify-center rounded-control hover:bg-muted', isActive && 'bg-primary-soft text-primary-text hover:bg-primary-soft')
      : cn(itemClass, large && 'h-11 text-[15px]', isActive && 'bg-primary-soft font-semibold text-primary-text hover:bg-primary-soft');
  const body = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      {!rail && <span className="flex-1 truncate">{label}</span>}
      {!rail && count && <CountPill count={count} />}
    </>
  );
  if (external) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" aria-label={rail ? label : undefined} title={rail ? label : undefined} className={className({ isActive: false })}>
        {body}
      </a>
    );
  }
  return (
    <NavLink to={to} end={end} aria-label={rail ? label : undefined} title={rail ? label : undefined} className={className}>
      {body}
    </NavLink>
  );
}

/** A count in the sidebar (the design's «۱۸»); an estimate reads «~». */
function CountPill({ count, strong }: { count: { count: number; estimate: boolean }; strong?: boolean }) {
  return (
    <span className={cn('inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px]', strong ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
      {count.estimate ? '~' : ''}
      {formatNumber(count.count)}
    </span>
  );
}

function Brand({ title, logo, rail, onClose }: { title: string; logo?: string; rail: boolean; onClose?: () => void }) {
  const { t } = useLocale();
  const mark = logo ? (
    <img src={logo} alt="" className="size-[30px] shrink-0 rounded-control object-contain" />
  ) : (
    <span aria-hidden className="flex size-[30px] shrink-0 items-center justify-center rounded-control bg-primary font-bold text-primary-foreground">
      {[...title.trim()][0] ?? ''}
    </span>
  );
  return (
    <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b border-sidebar-border', rail ? 'justify-center' : 'px-4')}>
      {mark}
      {!rail && (
        <>
          <div className="min-w-0 flex-1 leading-[1.3]">
            <div className={cn('truncate font-semibold', onClose ? 'text-[15px]' : 'text-sm')}>{title}</div>
            {!onClose && <div className="text-[11.5px] text-muted-foreground">{t('shell.adminPanel')}</div>}
          </div>
          {onClose ? (
            <Button variant="ghost" size="icon" aria-label={t('shell.closeMenu')} onClick={onClose}>
              <X />
            </Button>
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
        </>
      )}
    </div>
  );
}

function OpenSection({ section, collapsed, badges, muted, large }: { section: NavSection; collapsed: boolean; badges?: MenuBadges; muted?: boolean; large?: boolean }) {
  const { t } = useLocale();
  const Icon = section.icon;
  const listId = `nav-group-${section.key}`;
  const total = sectionCount(
    section.entries.flatMap((entry): NavItem[] => (entry.badge ? [{ kind: 'resource', name: entry.key, label: entry.label, badge: entry.badge }] : [])),
    badges,
  );
  // A menu section of one item is that item (the design's «تنظیمات»), named after the section.
  if (section.asLink) {
    const [only] = section.entries;
    return <TopLink to={only!.to} label={section.label} icon={Icon} rail={false} large={large} external={only!.external} count={only!.badge ? badges?.[only!.badge] : undefined} />;
  }
  return (
    <div>
      <button
        type="button"
        className={cn(itemClass, large && 'h-11 text-[15px]', muted && 'text-muted-foreground')}
        aria-expanded={!collapsed}
        aria-controls={listId}
        aria-label={t(collapsed ? 'shell.expandGroup' : 'shell.collapseGroup', { name: section.label })}
        onClick={() => navStore.toggleGroup(section.key, section.collapsedByDefault ?? false)}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{section.label}</span>
        {collapsed && total && <CountPill count={total} />}
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', collapsed && 'rotate-90 rtl:rotate-90 ltr:-rotate-90')} aria-hidden />
      </button>
      {!collapsed && (
        <ul id={listId} aria-label={section.label} className="ms-[18px] mt-0.5 mb-1 flex flex-col gap-px border-s border-sidebar-border ps-2.5">
          {section.entries.map((entry) => (
            <li key={entry.key} className="group/item flex items-center">
              {entry.external ? (
                <a href={entry.to} target="_blank" rel="noopener noreferrer" className={cn(subClass({ isActive: false }), 'min-w-0 flex-1')}>
                  <span className="truncate">{entry.label}</span>
                </a>
              ) : (
                <NavLink to={entry.to} className={(state) => cn(subClass(state), 'min-w-0 flex-1 gap-2')}>
                  <span className="flex-1 truncate">{entry.label}</span>
                  {entry.badge && badges?.[entry.badge] && <CountPill count={badges[entry.badge]!} />}
                </NavLink>
              )}
              {entry.pin && <PinButton name={entry.pin} label={entry.label} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A rail icon; its section's items open beside it (hover or click), the current section highlighted. */
function RailSection({ section, muted }: { section: NavSection; muted?: boolean }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const Icon = section.icon;
  const current = section.entries.some((entry) => isCurrent(pathname, entry));
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={section.label}
          title={section.label}
          onMouseEnter={() => setOpen(true)}
          data-nav-section=""
          className={cn('flex size-10 cursor-pointer items-center justify-center rounded-control hover:bg-muted', muted && 'text-muted-foreground', current && 'bg-primary-soft text-primary-text hover:bg-primary-soft')}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        {/* The design's flyout: the section's name in a dark pill, its items in a card under it. */}
        <Popover.Content side="right" align="start" sideOffset={8} onMouseLeave={() => setOpen(false)} className="z-50 flex flex-col items-start gap-1.5">
          <span className="rounded-control bg-foreground px-3 py-1.5 text-[13px] font-medium text-background">{section.label}</span>
          <div className="flex min-w-40 flex-col gap-px rounded-[10px] border border-border bg-card p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.12)]">
            {section.entries.map((entry) => (
              <Popover.Close key={entry.key} asChild>
                {entry.external ? (
                  <a href={entry.to} target="_blank" rel="noopener noreferrer" className={subClass({ isActive: false })}>
                    {entry.label}
                  </a>
                ) : (
                  <NavLink to={entry.to} className={subClass}>
                    {entry.label}
                  </NavLink>
                )}
              </Popover.Close>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Shown on hover (and always once pinned): keeps a list at the top of the sidebar in this browser. */
function PinButton({ name, label }: { name: string; label: string }) {
  const { t } = useLocale();
  const pinned = useNavState().pinned.includes(name);
  return (
    <button
      type="button"
      className={cn('cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/item:opacity-100', pinned && 'opacity-100')}
      aria-label={t(pinned ? 'shell.unpin' : 'shell.pin', { name: label })}
      aria-pressed={pinned}
      onClick={() => navStore.togglePin(name)}
    >
      {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
    </button>
  );
}

/** Users, groups, roles and the debugger (with `rbac`, for users who may see them), as one bottom section. */
function useAdministration(): NavSection | undefined {
  const { t } = useLocale();
  const session = useSession();
  if (!session.data?.rbac.view) return undefined;
  return {
    key: '~administration',
    label: t('rbac.administration'),
    icon: ShieldCheck,
    entries: [
      { key: 'users', to: '/-/users', label: t('rbac.users') },
      { key: 'groups', to: '/-/groups', label: t('rbac.groups') },
      { key: 'roles', to: '/-/roles', label: t('rbac.roles') },
      { key: 'debugger', to: '/-/debugger', label: t('debugger.title') },
    ],
  };
}
