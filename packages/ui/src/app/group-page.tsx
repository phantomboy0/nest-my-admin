import { Link, useParams } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import type { MetaGroup, MetaResourceSummary } from '@nest-my-admin/core/contract';
import { PageMessage } from '@/components/page-message';
import { formatNumber, useLocale } from '@/i18n';
import { api } from '@/lib/api';
import { iconFor } from '@/lib/icons';
import { useMeta } from '@/lib/queries';

/** A module landing page (spec §9.1): the group's resources with their record counts. */
export function GroupPage() {
  const { t } = useLocale();
  const { group: key } = useParams();
  const meta = useMeta();
  if (meta.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (meta.isError) return <PageMessage tone="error">{meta.error.message}</PageMessage>;
  const group = meta.data.groups.find((candidate) => candidate.key === key);
  if (!group) return <PageMessage>{t('common.pageNotFound')}</PageMessage>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{group.label}</h1>
      <ResourceCards resources={group.resources} />
    </div>
  );
}

/** Every group's cards (the home page). */
export function GroupSections({ groups }: { groups: MetaGroup[] }) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`group-${group.key}`} className="flex flex-col gap-3">
          <h2 id={`group-${group.key}`} className="text-lg font-semibold">
            <Link to={`/g/${group.key}`} className="hover:underline">
              {group.label}
            </Link>
          </h2>
          <ResourceCards resources={group.resources} />
        </section>
      ))}
    </div>
  );
}

/**
 * One card per resource with its record count: a one-row list request each, so counts follow the resource's count
 * mode ("about N" for estimates, nothing for uncounted lists).
 */
export function ResourceCards({ resources }: { resources: MetaResourceSummary[] }) {
  const { t, locale } = useLocale();
  const counts = useQueries({
    queries: resources.map((resource) => ({
      queryKey: ['count', resource.name],
      queryFn: () => api.list(resource.name, new URLSearchParams({ pageSize: '1' })),
      staleTime: 60_000,
    })),
  });
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {resources.map((resource, index) => {
        const Icon = iconFor(resource.icon, 'resource');
        const data = counts[index]?.data;
        const count =
          data && data.total !== null
            ? t(data.estimated ? 'shell.aboutRecords' : 'shell.records', { count: formatNumber(data.total, locale) })
            : undefined;
        return (
          <li key={resource.name}>
            <Link to={`/${resource.name}`} className="flex items-center gap-3 rounded-lg border p-4 hover:bg-muted/50">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <Icon className="size-5 text-muted-foreground" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{resource.label}</span>
                {count && <span className="text-sm text-muted-foreground">{count}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
