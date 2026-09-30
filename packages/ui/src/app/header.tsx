import { Fragment } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronRight, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { MetaResponse } from '@nest-my-admin/core/contract';
import { CommandPalette } from '@/app/command-palette';
import { DisplayMenu, LocaleSwitch, ThemeSwitch } from '@/app/preferences';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { navStore, useNavState } from '@/lib/nav-state';
import { useRecord } from '@/lib/queries';

interface Crumb {
  label: string;
  to?: string;
}

/** Home › Group › Resource › Record, from the URL and the meta. */
export function useCrumbs(meta: MetaResponse | undefined): Crumb[] {
  const { t } = useLocale();
  const [first, second] = useLocation()
    .pathname.split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  const recordId = first && first !== 'g' && second && second !== 'new' ? second : undefined;
  const record = useRecord(first ?? '', recordId);
  const crumbs: Crumb[] = [{ label: t('shell.home'), to: '/' }];
  if (!first || !meta) return crumbs;
  if (first === 'g') {
    const group = meta.groups.find((candidate) => candidate.key === second);
    if (group) crumbs.push({ label: group.label });
    return crumbs;
  }
  const group = meta.groups.find((candidate) => candidate.resources.some((resource) => resource.name === first));
  const resource = group?.resources.find((candidate) => candidate.name === first);
  if (!group || !resource) return crumbs;
  crumbs.push({ label: group.label, to: `/g/${group.key}` }, { label: resource.label, to: `/${resource.name}` });
  if (second === 'new') crumbs.push({ label: t('form.new', { name: resource.label }) });
  else if (recordId) crumbs.push({ label: typeof record.data?._title === 'string' ? record.data._title : `#${recordId}` });
  return crumbs;
}

export function Header({ meta, onOpenMenu }: { meta: MetaResponse | undefined; onOpenMenu: () => void }) {
  const { t } = useLocale();
  const nav = useNavState();
  const crumbs = useCrumbs(meta);
  const last = crumbs.length - 1;
  return (
    <header className="flex h-14 items-center gap-2 border-b px-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('shell.menu')} onClick={onOpenMenu}>
        <Menu />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        aria-label={t(nav.railCollapsed ? 'shell.expandSidebar' : 'shell.collapseSidebar')}
        aria-pressed={nav.railCollapsed}
        onClick={() => navStore.toggleRail()}
      >
        {nav.railCollapsed ? <PanelLeftOpen className="rtl:-scale-x-100" /> : <PanelLeftClose className="rtl:-scale-x-100" />}
      </Button>
      <nav aria-label={t('shell.breadcrumbs')} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
          {crumbs.map((crumb, index) => (
            <Fragment key={`${index}:${crumb.label}`}>
              {index > 0 && <ChevronRight className="size-3.5 shrink-0 rtl:rotate-180" aria-hidden />}
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
      <div className="flex items-center gap-2">
        <CommandPalette />
        <LocaleSwitch />
        <DisplayMenu />
        <div className="hidden sm:flex">
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}
