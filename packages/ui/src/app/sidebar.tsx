import { useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { ChevronDown, ChevronsUpDown, Pin, PinOff, ShieldCheck, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import type { MetaGroup, MetaPageSummary, MetaResourceSummary } from '@nest-my-admin/core/contract';
import { UserBlock } from '@/app/user-menu';
import { Button } from '@/components/ui/button';
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
  /** The phone drawer: a close button in the brand row and larger touch targets. */
  onClose?: () => void;
}

/** One entry under a section: a resource list or a settings page. */
interface NavEntry {
  key: string;
  to: string;
  label: string;
  /** A resource list, which may be pinned (pins and recents are for lists). */
  pin?: string;
}

interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  entries: NavEntry[];
}

const itemClass = 'flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-start text-[13.5px] text-sidebar-foreground hover:bg-muted';
const subClass = ({ isActive }: { isActive: boolean }) =>
  cn('flex h-8 items-center rounded-[7px] px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground', isActive && 'bg-primary-soft font-semibold text-primary-text hover:bg-primary-soft hover:text-primary-text');

function sectionsOf(groups: MetaGroup[], pinned: MetaResourceSummary[], pinnedLabel: string): NavSection[] {
  const entry = (resource: MetaResourceSummary): NavEntry => ({ key: resource.name, to: `/${resource.name}`, label: resource.label, pin: resource.name });
  const page = (summary: MetaPageSummary): NavEntry => ({ key: `page:${summary.name}`, to: `/p/${summary.name}`, label: summary.label });
  const sections = groups.map((group) => ({
    key: group.key,
    label: group.label,
    icon: iconFor(group.icon, 'group'),
    entries: [...group.resources.map(entry), ...group.pages.map(page)],
  }));
  return pinned.length > 0 ? [{ key: '~pinned', label: pinnedLabel, icon: Pin, entries: pinned.map(entry) }, ...sections] : sections;
}

/**
 * The design's sidebar: the brand block, collapsible sections (one per group) with their lists and settings pages
 * indented under a line, administration and the signed-in user at the bottom. As a rail it shows one icon per section,
 * whose items open in a flyout.
 */
export function Sidebar({ title, logo, groups, rail = false, onClose }: SidebarProps) {
  const { t } = useLocale();
  const nav = useNavState();
  const resources = new Map(groups.flatMap((group) => group.resources.map((resource) => [resource.name, resource] as const)));
  const pinned = known(nav.pinned, new Set(resources.keys())).map((name) => resources.get(name)!);
  const sections = sectionsOf(groups, pinned, t('shell.pinned'));
  const admin = useAdministration();

  return (
    <nav aria-label={t('shell.resources')} className="flex h-full flex-col">
      <Brand title={title} logo={logo} rail={rail} onClose={onClose} />
      <div className={cn('flex flex-1 flex-col gap-0.5 overflow-y-auto', rail ? 'items-center px-0 py-2.5' : 'p-2.5')}>
        {sections.map((section) =>
          rail ? <RailSection key={section.key} section={section} /> : <OpenSection key={section.key} section={section} collapsed={nav.collapsedGroups.includes(section.key)} large={!!onClose} />,
        )}
      </div>
      <div className={cn('flex flex-col gap-1 border-t border-sidebar-border', rail ? 'items-center px-0 py-2.5' : 'p-2.5')}>
        {admin && (rail ? <RailSection section={admin} muted /> : <OpenSection section={admin} collapsed={nav.collapsedGroups.includes(admin.key)} muted />)}
        <UserBlock rail={rail} />
      </div>
    </nav>
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

function OpenSection({ section, collapsed, muted, large }: { section: NavSection; collapsed: boolean; muted?: boolean; large?: boolean }) {
  const { t } = useLocale();
  const Icon = section.icon;
  const listId = `nav-group-${section.key}`;
  return (
    <div>
      <button
        type="button"
        className={cn(itemClass, large && 'h-11 text-[15px]', muted && 'text-muted-foreground')}
        aria-expanded={!collapsed}
        aria-controls={listId}
        aria-label={t(collapsed ? 'shell.expandGroup' : 'shell.collapseGroup', { name: section.label })}
        onClick={() => navStore.toggleGroup(section.key)}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{section.label}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', collapsed && 'rotate-90 rtl:rotate-90 ltr:-rotate-90')} aria-hidden />
      </button>
      {!collapsed && (
        <ul id={listId} aria-label={section.label} className="ms-[18px] mt-0.5 mb-1 flex flex-col gap-px border-s border-sidebar-border ps-2.5">
          {section.entries.map((entry) => (
            <li key={entry.key} className="group/item flex items-center">
              <NavLink to={entry.to} className={(state) => cn(subClass(state), 'min-w-0 flex-1')}>
                <span className="truncate">{entry.label}</span>
              </NavLink>
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
  const current = section.entries.some((entry) => pathname === entry.to || pathname.startsWith(`${entry.to}/`));
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
                <NavLink to={entry.to} className={subClass}>
                  {entry.label}
                </NavLink>
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
