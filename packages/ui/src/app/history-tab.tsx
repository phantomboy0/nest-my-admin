import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminRecord, ResourceSchema } from '@nest-my-admin/core/contract';
import { AuditEntries } from '@/app/audit-entries';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { auditNames } from '@/lib/audit';
import { useMeta } from '@/lib/queries';

/** `['history', resource, id]`: invalidated by a save and by an action on the record. */
export const historyKey = (resource: string, id?: string) => (id === undefined ? ['history', resource] : ['history', resource, id]);

/**
 * A record's history (spec §10.2): who changed what and when, cut to what this reader may see. Loaded when the tab
 * is opened, 50 entries at a time. It only reads: nothing here touches the form next to it.
 */
export function HistoryTab({ schema, id, record }: { schema: ResourceSchema; id: string; record: AdminRecord | undefined }) {
  const t = useT();
  const meta = useMeta();
  const history = useInfiniteQuery({
    queryKey: historyKey(schema.name, id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.history(schema.name, id, pageParam),
    getNextPageParam: (last) => last.next,
    staleTime: 0, // the record may have been changed from a list or by someone else since the tab was last open
  });
  if (history.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (history.isError && !history.data) return <PageMessage tone="error">{describeError(history.error)}</PageMessage>;
  const entries = history.data.pages.flatMap((page) => page.entries);
  if (entries.length === 0) return <PageMessage>{t('audit.empty')}</PageMessage>;
  const schemaOf = (resource: string) => (resource === schema.name ? schema : undefined);
  return (
    <div className="flex flex-col gap-3">
      <AuditEntries entries={entries} now={new Date(history.dataUpdatedAt)} names={auditNames(meta.data, schemaOf)} schemaOf={schemaOf} titleOf={(field, refId) => referenceTitle(record, field, refId)} />
      {history.isError && <PageMessage tone="error">{describeError(history.error)}</PageMessage>}
      {history.hasNextPage && (
        <Button type="button" variant="outline" size="sm" className="self-center" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          {t(history.isFetchingNextPage ? 'common.loading' : 'list.loadMore')}
        </Button>
      )}
    </div>
  );
}

/** The title the open record already carries for a related id (its current references); no request is made for others. */
function referenceTitle(record: AdminRecord | undefined, field: string, id: string): string | undefined {
  const value = record?.[field];
  const refs = (Array.isArray(value) ? value : [value]) as Array<{ id?: unknown; title?: unknown } | null | undefined>;
  const ref = refs.find((candidate) => typeof candidate === 'object' && candidate !== null && String(candidate.id) === id);
  return typeof ref?.title === 'string' ? ref.title : undefined;
}
