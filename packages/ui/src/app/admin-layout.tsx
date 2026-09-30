import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, X } from 'lucide-react';
import { Header } from '@/app/header';
import { Sidebar } from '@/app/sidebar';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { runtimeConfig } from '@/lib/config';
import { navStore, useNavState } from '@/lib/nav-state';
import { PageMessage } from '@/components/page-message';
import { ApiError, describeError } from '@/lib/api';
import { useMeta, useSession } from '@/lib/queries';
import { setViewingAs, viewingAs } from '@/lib/session';
import { cn } from '@/lib/utils';

function labelIn(label: string | Record<string, string> | undefined, locale: string): string | undefined {
  if (label === undefined || typeof label === 'string') return label;
  return label[locale] ?? label[runtimeConfig.locale] ?? Object.values(label)[0];
}

/** Signed in first: without a session the admin shows the login page, keeping where the user was going. */
export function AdminLayout() {
  const { t } = useLocale();
  const session = useSession();
  const location = useLocation();
  const queryClient = useQueryClient();
  // Viewing as someone who is gone (or after signing in as a non-superuser): stop, and read the real session again.
  const staleViewAs = session.isError && viewingAs() !== undefined && session.error instanceof ApiError && (session.error.status === 403 || session.error.status === 404);
  useEffect(() => {
    if (!staleViewAs) return;
    setViewingAs(undefined);
    queryClient.clear();
  }, [staleViewAs, queryClient]);
  if (session.isPending || staleViewAs) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (session.isError) {
    if (session.error instanceof ApiError && session.error.status === 401) {
      return <Navigate to={`/login?${new URLSearchParams({ next: location.pathname + location.search })}`} replace />;
    }
    return (
      <PageMessage tone="error">
        {describeError(session.error)}{' '}
        <Button variant="outline" size="sm" onClick={() => void session.refetch()}>
          {t('list.retry')}
        </Button>
      </PageMessage>
    );
  }
  return <Shell />;
}

/** A superuser looking through another user's eyes: who, read-only, and the way back. */
function ViewAsBanner() {
  const { t } = useLocale();
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const data = session.data;
  if (!data?.viewAs) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-3 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950">
      <Eye className="size-4" aria-hidden />
      <span>{t('viewAs.banner', { name: data.user.displayName })}</span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-amber-950/30 bg-amber-50 text-amber-950 hover:bg-amber-100"
        onClick={() => {
          const target = data.user.id;
          setViewingAs(undefined);
          queryClient.clear();
          navigate(`/-/users/${encodeURIComponent(target)}`);
        }}
      >
        {t('viewAs.stop')}
      </Button>
    </div>
  );
}

function Shell() {
  const meta = useMeta();
  const { t, locale } = useLocale();
  const nav = useNavState();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawer = useRef<HTMLDivElement>(null);

  const groups = meta.data?.groups ?? [];
  const title = labelIn(runtimeConfig.branding.name, locale) ?? meta.data?.title ?? runtimeConfig.title;
  const logo = runtimeConfig.branding.logo;

  useEffect(() => {
    setMenuOpen(false);
    // A list or record page of a known resource counts as a visit (recents).
    const resource = decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] ?? '');
    if (groups.some((group) => group.resources.some((candidate) => candidate.name === resource))) navStore.visit(resource);
  }, [location.pathname, groups]);

  useEffect(() => {
    if (meta.data) document.title = meta.data.title;
  }, [meta.data]);

  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.querySelector<HTMLElement>('a, button, input')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className={cn('hidden shrink-0 border-e bg-sidebar text-sidebar-foreground md:block', nav.railCollapsed ? 'w-16' : 'w-64')}>
        <Sidebar title={title} logo={logo} groups={groups} rail={nav.railCollapsed} />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t('shell.menu')} ref={drawer}>
          <div className="absolute inset-0 bg-black/40" aria-hidden onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col border-e bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex justify-end p-2">
              <Button variant="ghost" size="icon" aria-label={t('shell.closeMenu')} onClick={() => setMenuOpen(false)}>
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <Sidebar title={title} logo={logo} groups={groups} />
            </div>
          </aside>
        </div>
      )}

      {/* inert while the drawer is open: focus and screen readers stay in the menu */}
      <div className="flex min-w-0 flex-1 flex-col" inert={menuOpen || undefined}>
        <ViewAsBanner />
        <Header meta={meta.data} onOpenMenu={() => setMenuOpen(true)} />
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
