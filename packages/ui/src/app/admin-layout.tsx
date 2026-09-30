import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import type { MetaGroup } from '@nest-my-admin/core/contract';
import { LocaleSwitch, ThemeSwitch } from '@/app/preferences';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { runtimeConfig } from '@/lib/config';
import { useMeta } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function AdminLayout() {
  const meta = useMeta();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const t = useT();

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const title = meta.data?.title ?? runtimeConfig.title;
  const groups = meta.data?.groups ?? [];

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 border-e bg-sidebar text-sidebar-foreground md:block">
        <ResourceNav title={title} groups={groups} />
      </aside>

      {navOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" aria-hidden onClick={() => setNavOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-72 max-w-[85vw] border-e bg-sidebar text-sidebar-foreground shadow-xl">
            <ResourceNav title={title} groups={groups} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t('shell.menu')} onClick={() => setNavOpen(true)}>
            <Menu />
          </Button>
          <span className="font-semibold md:hidden">{title}</span>
          <div className="ms-auto flex items-center gap-2">
            <LocaleSwitch />
            <ThemeSwitch />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function ResourceNav({ title, groups }: { title: string; groups: MetaGroup[] }) {
  return (
    <nav aria-label={useT()('shell.resources')} className="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div className="px-2 py-1 text-lg font-semibold">{title}</div>
      {groups.map((group) => (
        <div key={group.key}>
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
          <ul className="flex flex-col gap-0.5">
            {group.resources.map((resource) => (
              <li key={resource.name}>
                <NavLink
                  to={`/${resource.name}`}
                  className={({ isActive }) =>
                    cn('block rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent', isActive && 'bg-sidebar-accent font-medium')
                  }
                >
                  {resource.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
