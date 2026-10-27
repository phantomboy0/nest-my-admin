import { Fragment } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronLeft, Menu, PanelRight } from 'lucide-react';
import type { MetaResponse } from '@nest-my-admin/core/contract';
import { CommandPalette } from '@/app/command-palette';
import { ThemeToggle } from '@/app/preferences';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { navStore, useNavState } from '@/lib/nav-state';
import { navGroups } from '@/lib/menu';
import { useRecord, useSchema } from '@/lib/queries';

interface Crumb {
  label: string;
  to?: string;
}

/** Home › Group › Resource › Record (or Home › Group › Settings page), from the URL and the meta. */
export function useCrumbs(meta: MetaResponse | undefined): Crumb[] {
  const { t } = useLocale();
  const [first, second, third] = useLocation()
    .pathname.split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  const recordId = first && first !== 'g' && first !== 'p' && first !== '-' && second && second !== 'new' ? second : undefined;
  const record = useRecord(first ?? '', recordId);
  // A resource with no navigation entry (`nav: false`) is named by its own schema (already loaded by its page).
  const resourceRoute = Boolean(first) && !['g', 'p', '-', 'account'].includes(first!);
  const schema = useSchema(first ?? '', resourceRoute && meta !== undefined && !navGroups(meta).some((group) => group.resources.some((resource) => resource.name === first)));
  // With a dashboard, home is the dashboard.
  const crumbs: Crumb[] = [{ label: t(meta?.dashboard ? 'shell.dashboard' : 'shell.home'), to: '/' }];
  if (first === 'account' && !second) return [...crumbs, { label: t('auth.account') }];
  if (first === '-' && (second === 'users' || second === 'groups' || second === 'roles' || second === 'debugger' || second === 'audit')) {
    const section = { users: t('rbac.users'), groups: t('rbac.groups'), roles: t('rbac.roles'), debugger: t('debugger.title'), audit: t('audit.title') }[second];
    crumbs.push({ label: t('rbac.administration') }, { label: section, to: `/-/${second}` });
    if (third) crumbs.push({ label: third === 'new' ? t('list.new') : third });
    return crumbs;
  }
  if (!first || !meta) return crumbs;
  const groups = navGroups(meta);
  if (first === 'g') {
    const group = groups.find((candidate) => candidate.key === second);
    if (group) crumbs.push({ label: group.label });
    return crumbs;
  }
  if (first === 'p') {
    const group = groups.find((candidate) => candidate.pages.some((page) => page.name === second));
    const page = group?.pages.find((candidate) => candidate.name === second);
    if (group && page) crumbs.push({ label: group.label, to: `/g/${group.key}` }, { label: page.label });
    return crumbs;
  }
  const group = groups.find((candidate) => candidate.resources.some((resource) => resource.name === first));
  const resource = group?.resources.find((candidate) => candidate.name === first);
  if (!group || !resource) {
    if (!schema.data) return crumbs;
    crumbs.push({ label: schema.data.label, to: `/${first}` });
    if (recordId) crumbs.push({ label: typeof record.data?._title === 'string' ? record.data._title : `#${recordId}` });
    return crumbs;
  }
  crumbs.push({ label: group.label, to: `/g/${group.key}` }, { label: resource.label, to: `/${resource.name}` });
  if (second === 'new') crumbs.push({ label: t('form.new', { name: resource.label }) });
  else if (recordId) crumbs.push({ label: typeof record.data?._title === 'string' ? record.data._title : `#${recordId}` });
  return crumbs;
}

/** The design's top bar: menu (phone) or sidebar toggle, a divider, breadcrumbs, then search (⌘K) and the theme. */
export function Header({ meta, onOpenMenu }: { meta: MetaResponse | undefined; onOpenMenu: () => void }) {
  const { t } = useLocale();
  const nav = useNavState();
  const crumbs = useCrumbs(meta);
  const last = crumbs.length - 1;
  return (
    <header className="flex h-14 items-center gap-2 border-b border-border bg-card px-5">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('shell.menu')} onClick={onOpenMenu} data-sidebar-toggle="">
        <Menu />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        aria-label={t(nav.railCollapsed ? 'shell.expandSidebar' : 'shell.collapseSidebar')}
        aria-pressed={nav.railCollapsed}
        onClick={() => navStore.toggleRail()}
        data-sidebar-toggle=""
      >
        <PanelRight className="ltr:-scale-x-100" />
      </Button>
      <div className="hidden h-5 w-px bg-border md:block" aria-hidden />
      <nav aria-label={t('shell.breadcrumbs')} className="min-w-0 flex-1 ps-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {crumbs.map((crumb, index) => (
            <Fragment key={`${index}:${crumb.label}`}>
              {index > 0 && <ChevronLeft className="size-3.5 shrink-0 ltr:rotate-180" aria-hidden />}
              <li className={index === last ? 'truncate font-medium text-foreground' : 'hidden truncate sm:block'}>
                {crumb.to && index !== last ? (
                  <Link to={crumb.to} className="hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span aria-current={index === last ? 'page' : undefined}>{crumb.label}</span>
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </nav>
      <div className="flex items-center gap-1.5">
        <CommandPalette />
        <ThemeToggle />
      </div>
    </header>
  );
}
