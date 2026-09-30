import { Navigate } from 'react-router';
import { PageMessage } from '@/components/page-message';
import { useT } from '@/i18n';
import { useMeta } from '@/lib/queries';

export function HomePage() {
  const t = useT();
  const meta = useMeta();
  if (meta.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (meta.isError) return <PageMessage tone="error">{meta.error.message}</PageMessage>;
  const first = meta.data.groups[0]?.resources[0];
  if (!first) return <PageMessage>{t('shell.noResources')}</PageMessage>;
  return <Navigate to={`/${first.name}`} replace />;
}
