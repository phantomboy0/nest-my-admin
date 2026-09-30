import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminRecord, FieldSchema, ListResponse, ResourceSchema } from '@nest-my-admin/core/contract';
import { DisplayValue, ValueBadge } from '@/app/widgets/badge';
import { Button } from '@/components/ui/button';
import { formatNumber, useT } from '@/i18n';
import { api } from '@/lib/api';
import { formatCell } from '@/lib/format';
import { cn } from '@/lib/utils';

interface MobileListProps {
  schema: ResourceSchema;
  /** The list query without `page` and `after`: the pages are this list's own. */
  query: string;
  /** Columns for cards when the resource has no `list.mobile`. */
  columns: FieldSchema[];
  trash: boolean;
  selectMode: boolean;
  selected: Set<string>;
  onSelect: (selected: Set<string>) => void;
  /** The restore button of a card in the trash. */
  restore: (item: AdminRecord) => ReactNode;
  empty: ReactNode;
}

const hasNext = (page: ListResponse) => (page.total !== null ? page.page * page.pageSize < page.total : page.hasMore === true);

/**
 * Cards for phones (spec §9.3) with infinite scroll: offset pages or keyset cursors, loaded as the end of the list
 * comes into view (and with a "Load more" button). A new filter, search or sort is a new query, so it starts over.
 */
export function MobileList({ schema, query, columns, trash, selectMode, selected, onSelect, restore, empty }: MobileListProps) {
  const t = useT();
  const keyset = schema.list.pagination === 'keyset';
  const list = useInfiniteQuery({
    queryKey: ['list', schema.name, 'cards', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(query);
      if (pageParam) params.set(keyset ? 'after' : 'page', pageParam);
      return api.list(schema.name, params);
    },
    getNextPageParam: (last) => (keyset ? (last.nextCursor ?? undefined) : hasNext(last) ? String(last.page + 1) : undefined),
  });
  // A record that moved between pages while scrolling is shown once.
  const seen = new Set<string>();
  const items = (list.data?.pages ?? []).flatMap((page) => page.items).filter((item) => {
    const id = String(item._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const total = list.data?.pages[0]?.total ?? null;

  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const target = end.current;
    if (!target || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    }, { rootMargin: '200px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={schema.label} aria-busy={list.isFetching} className="flex flex-col gap-2">
        {list.isPending &&
          Array.from({ length: 4 }, (_, index) => (
            <li key={`skeleton-${index}`} aria-hidden className="h-20 animate-pulse rounded-lg border bg-muted/40" />
          ))}
        {items.map((item) => {
          const id = String(item._id);
          const card = <MobileCard schema={schema} item={item} columns={columns} />;
          return (
            <li key={id}>
              {trash ? (
                <div className="flex items-start justify-between gap-2 rounded-lg border p-3">
                  {card}
                  {restore(item)}
                </div>
              ) : selectMode ? (
                <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3', selected.has(id) && 'border-primary bg-primary/5')}>
                  <input type="checkbox" className="mt-1 size-4 accent-primary" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={t('list.selectRow', { name: String(item._title ?? id) })} />
                  {card}
                </label>
              ) : (
                <Link to={`/${schema.name}/${encodeURIComponent(id)}`} className="block rounded-lg border p-3 active:bg-muted">
                  {card}
                </Link>
              )}
            </li>
          );
        })}
        {list.isSuccess && items.length === 0 && <li className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">{empty}</li>}
      </ul>
      {list.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{t('list.loadFailed')}</span>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t('list.retry')}
          </Button>
        </div>
      )}
      <div ref={end} className="flex flex-col items-center gap-2 py-2 text-sm text-muted-foreground">
        {items.length > 0 && (
          <span>{total !== null ? t('list.showingOf', { shown: formatNumber(items.length), total: formatNumber(total) }) : t('list.showing', { shown: formatNumber(items.length) })}</span>
        )}
        {hasNextPage && (
          <Button variant="outline" size="sm" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {t(isFetchingNextPage ? 'common.loading' : 'list.loadMore')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** A card: from `list.mobile` (title, subtitle, badge, meta line), or the title and the columns. */
function MobileCard({ schema, item, columns }: { schema: ResourceSchema; item: AdminRecord; columns: FieldSchema[] }) {
  const config = schema.list.mobile;
  const title = typeof item._title === 'string' ? item._title : String(item._id);
  if (!config) {
    return (
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
          {columns
            .filter((column) => formatCell(item[column.name], column) !== item._title) // the title is shown above
            .map((column) => (
              <Fragment key={column.name}>
                <dt className="text-muted-foreground">{column.label}</dt>
                <dd className="truncate">
                  <DisplayValue value={item[column.name]} field={column} />
                </dd>
              </Fragment>
            ))}
        </dl>
      </div>
    );
  }
  const field = (name: string | undefined) => (name ? schema.fields.find((candidate) => candidate.name === name) : undefined);
  const titleField = field(config.title);
  const subtitleField = field(config.subtitle);
  const badgeField = field(config.badge);
  const meta = config.meta.map(field).filter((entry): entry is FieldSchema => entry !== undefined);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{titleField ? formatCell(item[titleField.name], titleField) : title}</span>
        {badgeField && item[badgeField.name] !== null && item[badgeField.name] !== undefined && <ValueBadge value={item[badgeField.name]} field={badgeField} className="shrink-0" />}
      </div>
      {subtitleField && <span className="truncate text-sm text-muted-foreground">{formatCell(item[subtitleField.name], subtitleField)}</span>}
      {meta.length > 0 && (
        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
          {meta.map((entry) => (
            <div key={entry.name} className="flex gap-1">
              <dt className="text-muted-foreground">{entry.label}</dt>
              <dd>
                <DisplayValue value={item[entry.name]} field={entry} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
