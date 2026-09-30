import { GroupSections } from '@/app/group-page';
import { PageMessage } from '@/components/page-message';
import { useT } from '@/i18n';
import { useMeta } from '@/lib/queries';

/** Every group with its resources and counts. */
export function HomePage() {
  const t = useT();
  const meta = useMeta();
  if (meta.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (meta.isError) return <PageMessage tone="error">{meta.error.message}</PageMessage>;
  if (meta.data.groups.length === 0) return <PageMessage>{t('shell.noResources')}</PageMessage>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{meta.data.title}</h1>
      <GroupSections groups={meta.data.groups} />
    </div>
  );
}
