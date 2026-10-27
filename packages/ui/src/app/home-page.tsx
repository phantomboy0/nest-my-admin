import { DashboardPage } from '@/app/dashboard/dashboard-page';
import { GroupSections } from '@/app/group-page';
import { PageMessage } from '@/components/page-message';
import { useT } from '@/i18n';
import { navGroups } from '@/lib/menu';
import { useMeta } from '@/lib/queries';

/** Every section (the menu's, else the module groups) with its resources (and their counts) and its settings pages. */
export function HomePage() {
  const t = useT();
  const meta = useMeta();
  if (meta.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (meta.isError) return <PageMessage tone="error">{meta.error.message}</PageMessage>;
  // With a widget to show, the dashboard is the home page (meta says so before anything renders: no flash).
  if (meta.data.dashboard) return <DashboardPage />;
  const groups = navGroups(meta.data);
  if (groups.length === 0) return <PageMessage>{t('shell.noResources')}</PageMessage>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-bold">{meta.data.title}</h1>
      <GroupSections groups={groups} />
    </div>
  );
}
