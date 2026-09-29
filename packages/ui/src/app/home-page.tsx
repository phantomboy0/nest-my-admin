import { Navigate } from 'react-router';
import { PageMessage } from '@/components/page-message';
import { useMeta } from '@/lib/queries';

export function HomePage() {
  const meta = useMeta();
  if (meta.isPending) return <PageMessage>Loading…</PageMessage>;
  if (meta.isError) return <PageMessage tone="error">{meta.error.message}</PageMessage>;
  const first = meta.data.groups[0]?.resources[0];
  if (!first) return <PageMessage>No admin resources are registered yet. Decorate a provider with @AdminResource.</PageMessage>;
  return <Navigate to={`/${first.name}`} replace />;
}
