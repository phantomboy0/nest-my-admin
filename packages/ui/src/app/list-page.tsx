import { Fragment, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ListChecks, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import type { AdminRecord, BulkResult, FieldSchema } from '@nest-my-admin/core/contract';
import { ActionButton } from '@/app/action-button';
import { ColumnMenu, ResizeHandle } from '@/app/column-menu';
import { EditableCell } from '@/app/editable-cell';
import { FilterBar } from '@/app/filter-bar';
import { MobileList } from '@/app/mobile-list';
import { QuickView } from '@/app/quick-view';
import { DisplayValue } from '@/app/widgets/badge';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, useT } from '@/i18n';
import { bulkActions, resourceActions, selectionResult } from '@/lib/actions';
import { api, describeError } from '@/lib/api';
import { useColumnPrefs, visibleColumns } from '@/lib/column-prefs';
import { formatCell } from '@/lib/format';
import { useIsMobile } from '@/lib/use-media';
import { cn } from '@/lib/utils';
import { isRef } from '@/lib/form-values';
import { encodeRecordId } from '@/lib/record-id';
import { hasActiveFilters, listQueryFromUrl, pageSizeOptions, paging, rangeText, withChanges, type ParamChanges } from '@/lib/list-state';
import { useList, useSchema } from '@/lib/queries';

export function ListPage() {
  const { resource = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const sortParam = searchParams.get('sort') ?? undefined;
  const schema = useSchema(resource);
  const mobile = useIsMobile();
  // Phones load their own pages (infinite scroll), so the paged table query does not run there.
  const list = useList(resource, listQueryFromUrl(searchParams), !mobile); // same key as listQuery below
  const [selectMode, setSelectMode] = useState(false);
  const queryClient = useQueryClient();
  const t = useT();
  const restore = useMutation({
    mutationFn: (id: string) => api.restore(resource, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['list', resource] }),
  });
  const trash = searchParams.get('trashed') === 'only';
  const prefs = useColumnPrefs(resource);
  const listQuery = listQueryFromUrl(searchParams);
  const cardQuery = (() => {
    const query = new URLSearchParams(listQuery);
    query.delete('page');
    query.delete('after');
    return query.toString();
  })();
  // Selection belongs to the page on screen: a new page, filter or sort starts empty.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [listQuery, resource]);
  const [quickView, setQuickView] = useState<AdminRecord | undefined>();
  const [confirmingBulk, setConfirmingBulk] = useState(false);
  // What the last run on a selection did (a bulk delete or a bulk action), shown under the selection bar.
  const [bulkOutcome, setBulkOutcome] = useState<{ title: string; result: BulkResult } | undefined>();
  useEffect(() => setBulkOutcome(undefined), [resource]);
  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) => api.bulkDelete(resource, ids),
    onSuccess: async (result) => {
      setSelected(new Set());
      setConfirmingBulk(false);
      setBulkOutcome({ title: t('list.bulkDeleted', { count: result.ok.length }), result });
      await queryClient.invalidateQueries({ queryKey: ['list', resource] });
    },
    onError: () => setConfirmingBulk(false),
  });
  const [trail, setTrail] = useState<string[]>([]);
  const hasAfter = searchParams.has('after');
  useEffect(() => {
    if (!hasAfter) setTrail([]); // back on the first page (a new filter or sort, or Previous from page 2)
  }, [hasAfter]);

  if (schema.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (schema.isError) return <PageMessage tone="error">{schema.error.message}</PageMessage>;

  const s = schema.data;
  const columns = visibleColumns(s.list.columns, prefs)
    .map((name) => s.fields.find((field) => field.name === name))
    .filter((field): field is FieldSchema => field !== undefined);
  const detailColumns = columns.filter((column) => !s.primaryKeys.includes(column.name));
  const sort = sortParam
    ? { field: sortParam.replace(/^-/, ''), direction: sortParam.startsWith('-') ? 'desc' : 'asc' }
    : s.list.defaultSort;
  const items = list.data?.items ?? [];
  const keyset = s.list.pagination === 'keyset';
  const after = searchParams.get('after');
  // Keyset lists: the cursors of the pages before this one ('' is the first page), so Previous can walk back.
  const pager = keyset
    ? { summary: paging(list.data, 1).summary, label: t('list.page', { page: trail.length + 1 }), hasNext: Boolean(list.data?.nextCursor) }
    : paging(list.data, page);
  const hasPrevious = keyset ? trail.length > 0 : page > 1;

  function nextPage() {
    if (!keyset) return updateParams({ page: String(page + 1) });
    setTrail([...trail, after ?? '']);
    updateParams({ after: list.data?.nextCursor ?? null });
  }

  function previousPage() {
    if (!keyset) return updateParams({ page: String(page - 1) });
    const previous = trail[trail.length - 1];
    setTrail(trail.slice(0, -1));
    updateParams({ after: previous || null });
  }
  // Selection serves bulk delete and bulk actions: without either there is nothing to select for.
  const can = s.permissions ?? { create: true, update: true, delete: true, purge: true };
  const selectable = !trash && (can.delete || bulkActions(s, []).length > 0);
  // Bulk actions at least one selected record allows (phone cards are not on this page's list: the server decides).
  const selectedActions = bulkActions(s, items.filter((item) => selected.has(String(item._id))));
  const recordPath = (item: AdminRecord) => `/${s.name}/${encodeURIComponent(String(item._id))}`;

  function updateParams(changes: ParamChanges) {
    setSearchParams((previous) => withChanges(previous, changes));
  }

  function toggleSort(field: string) {
    const ascending = sort.field === field && sort.direction === 'asc';
    updateParams({ sort: ascending ? `-${field}` : field });
  }

  // On phones the bar floats over the cards, dark (the design's phone list).
  const onDark = 'border-transparent bg-transparent text-inherit hover:bg-background/15';
  const selectionBar = selectable && selected.size > 0 && (
        <div role="region" aria-label={t('list.selected', { count: selected.size })} className={cn(
            'flex flex-wrap items-center gap-2 text-sm',
            mobile
              ? 'fixed inset-x-3 bottom-4 z-30 rounded-[14px] bg-foreground py-1.5 ps-2 pe-1.5 text-background shadow-[0_12px_32px_rgba(0,0,0,.25)]'
              : 'border-b bg-primary-soft px-3.5 py-2',
          )}>
          <span className={cn('font-semibold', mobile ? 'flex-1 text-sm' : 'pe-1.5 text-primary')}>{t('list.selected', { count: selected.size })}</span>
          {selectedActions.map((action) => (
            <ActionButton
              key={action.name}
              resource={s.name}
              action={action}
              ids={[...selected]}
              size="sm"
              className={mobile ? onDark : undefined}
              onDone={(outcome, ids) => {
                const result = selectionResult(outcome, ids);
                setSelected(new Set());
                bulkDelete.reset();
                setBulkOutcome({ title: t('action.bulkDone', { action: action.label, count: result.ok.length }), result });
              }}
            />
          ))}
          {!can.delete ? null : confirmingBulk ? (
            <Button variant="destructive" size="sm" disabled={bulkDelete.isPending} onClick={() => bulkDelete.mutate([...selected])}>
              {t('list.confirmDeleteSelected', { count: selected.size })}
            </Button>
          ) : (
            <Button
              variant="outline"
              size={mobile ? 'icon-sm' : 'sm'}
              className={mobile ? onDark : 'text-destructive'}
              aria-label={mobile ? t('list.deleteSelected') : undefined}
              onClick={() => setConfirmingBulk(true)}
            >
              <Trash2 />
              {!mobile && t('list.deleteSelected')}
            </Button>
          )}
          <Button
            variant="ghost"
            size={mobile ? 'icon-sm' : 'sm'}
            className={mobile ? cn(onDark, '-order-1') : 'ms-auto'}
            aria-label={mobile ? t('list.clearSelection') : undefined}
            onClick={() => setSelected(new Set())}
          >
            {mobile ? <X /> : t('list.clearSelection')}
          </Button>
        </div>
  );

  return (
    <div className={cn('flex flex-col gap-4', mobile && selected.size > 0 && 'pb-16')}>
      <div className={cn('flex flex-wrap gap-3', mobile ? 'items-center gap-2' : 'items-end')}>
        <div className={cn('flex gap-0.5', mobile ? 'items-baseline gap-1.5' : 'flex-col')}>
          <h1 className={mobile ? 'text-base font-semibold' : 'text-[22px] font-bold'}>{s.label}</h1>
          {list.data && list.data.total !== null && <p className="text-[13px] text-muted-foreground">{paging(list.data, page).summary}</p>}
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {s.softDelete && can.delete && (
            <Button
              variant={trash ? 'secondary' : 'outline'}
              size={mobile ? 'icon' : 'default'}
              aria-pressed={trash}
              aria-label={mobile ? t('list.trash') : undefined}
              onClick={() => updateParams({ trashed: trash ? null : 'only' })}
            >
              <Trash2 />
              {!mobile && t('list.trash')}
            </Button>
          )}
          {mobile && selectable && (
            <Button
              variant={selectMode ? 'secondary' : 'outline'}
              size="icon"
              aria-pressed={selectMode}
              aria-label={t(selectMode ? 'list.done' : 'list.select')}
              onClick={() => {
                setSelectMode(!selectMode);
                setSelected(new Set());
              }}
            >
              <ListChecks />
            </Button>
          )}
          {!trash && resourceActions(s).map((action) => <ActionButton key={action.name} resource={s.name} action={action} onDone={() => undefined} />)}
          {s.creatable && !trash && (
            <Button asChild size={mobile ? 'icon' : 'default'} className={cn(mobile && 'size-10')}>
              <Link to={`/${s.name}/new`} aria-label={mobile ? t('list.new') : undefined}>
                <Plus />
                {!mobile && t('list.new')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <FilterBar schema={s} params={searchParams} onChange={updateParams} trailing={<ColumnMenu schema={s} prefs={prefs} />} />

      {list.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>
            {t('list.loadFailed')} {describeError(list.error)}
          </span>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t('list.retry')}
          </Button>
        </div>
      )}
      {restore.isError && <PageMessage tone="error">{describeError(restore.error)}</PageMessage>}
      {trash && <p className="text-sm text-muted-foreground">{t('list.trashNote')}</p>}

      {mobile && selectionBar}
      {bulkOutcome && <BulkSummary title={bulkOutcome.title} result={bulkOutcome.result} items={items} />}
      {bulkDelete.isError && <PageMessage tone="error">{describeError(bulkDelete.error)}</PageMessage>}

      {mobile ? (
        <MobileList
          schema={s}
          query={cardQuery}
          columns={detailColumns}
          trash={trash}
          selectMode={selectMode}
          selected={selected}
          onSelect={setSelected}
          restore={(item) => <RestoreButton item={item} pending={restore.isPending} onRestore={(id) => restore.mutate(id)} />}
          empty={
            <>
              {t(hasActiveFilters(searchParams) ? 'list.noMatches' : 'list.noRecords')}
              {!hasActiveFilters(searchParams) && s.creatable && !trash && (
                <Button asChild size="sm" variant="outline">
                  <Link to={`/${s.name}/new`}>
                    <Plus />
                    {t('list.new')}
                  </Link>
                </Button>
              )}
            </>
          }
        />
      ) : (
        <>
          <section className="overflow-hidden rounded-card border bg-card shadow-card">
          {selectionBar}
          <div className="overflow-x-auto">
            <Table className={cn(prefs.density === 'compact' && '[&_td]:py-1 [&_th]:h-8')}>
              <TableHeader>
                <TableRow>
                  {selectable && (
                    <TableHead className="w-0">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        aria-label={t('list.selectPage')}
                        checked={items.length > 0 && items.every((item) => selected.has(String(item._id)))}
                        onChange={(event) => setSelected(event.target.checked ? new Set(items.map((item) => String(item._id))) : new Set())}
                      />
                    </TableHead>
                  )}
                  {columns.map((column) => (
                    <TableHead
                      key={column.name}
                      className="relative"
                      style={prefs.widths[column.name] ? { width: prefs.widths[column.name], minWidth: prefs.widths[column.name] } : undefined}
                      aria-sort={sort.field === column.name ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      {s.list.sortable.includes(column.name) ? (
                        <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(column.name)}>
                          {column.label}
                          {sort.field === column.name &&
                            (sort.direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                        </button>
                      ) : (
                        column.label
                      )}
                      <ResizeHandle resource={s.name} column={column.name} label={column.label} width={prefs.widths[column.name]} />
                    </TableHead>
                  ))}
                  {trash && <TableHead className="w-0"><span className="sr-only">{t('list.actions')}</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.isPending &&
                  Array.from({ length: 5 }, (_, row) => (
                    <TableRow key={`skeleton-${row}`} aria-hidden>
                      {selectable && <TableCell />}
                      {columns.map((column) => (
                        <TableCell key={column.name}>
                          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                {items.map((item) => (
                  <TableRow
                    key={String(item._id)}
                    data-state={selected.has(String(item._id)) ? 'selected' : undefined}
                    className={trash ? undefined : 'cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none'}
                    tabIndex={trash ? undefined : 0}
                    onClick={trash ? undefined : () => setQuickView(item)}
                    onKeyDown={
                      trash
                        ? undefined
                        : (event) => {
                            if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
                            // Without this, the same Enter would activate the sheet's first button (Close) as it opens.
                            event.preventDefault();
                            setQuickView(item);
                          }
                    }
                  >
                    {selectable && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={t('list.selectRow', { name: String(item._title ?? item._id) })}
                          checked={selected.has(String(item._id))}
                          onChange={(event) => {
                            const next = new Set(selected);
                            if (event.target.checked) next.add(String(item._id));
                            else next.delete(String(item._id));
                            setSelected(next);
                          }}
                        />
                      </TableCell>
                    )}
                    {columns.map((column, index) => (
                      <TableCell key={column.name}>
                        {index === 0 && !trash ? (
                          <Link to={recordPath(item)} className="font-semibold hover:underline" onClick={(event) => event.stopPropagation()}>
                            {formatCell(item[column.name], column)}
                          </Link>
                        ) : !trash && s.list.editable.includes(column.name) && !(Array.isArray(item._readonly) && item._readonly.includes(column.name)) && (item._perm as { update?: boolean } | undefined)?.update !== false ? (
                          <EditableCell schema={s} item={item} field={column} />
                        ) : (
                          <CellValue value={item[column.name]} field={column} record={item} />
                        )}
                      </TableCell>
                    ))}
                    {trash && (
                      <TableCell>
                        <RestoreButton item={item} pending={restore.isPending} onRestore={(id) => restore.mutate(id)} />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {list.isSuccess && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={columns.length + (trash || selectable ? 1 : 0)} className="text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2 py-6">
                        {t(hasActiveFilters(searchParams) ? 'list.noMatches' : 'list.noRecords')}
                        {!hasActiveFilters(searchParams) && s.creatable && !trash && (
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/${s.name}/new`}>
                              <Plus />
                              {t('list.new')}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t px-3.5 py-2.5 text-[13px] text-muted-foreground">
            <span>{rangeText(list.data, keyset ? 1 : page, items.length) || pager.summary}</span>
            <div className="ms-auto flex items-center gap-2">
              {!keyset && (
                <label className="flex items-center gap-2">
                  {t('list.rowsPerPage')}
                  <select
                    className="h-8 rounded-lg border border-input bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    value={list.data?.pageSize ?? s.list.pageSize}
                    onChange={(event) => updateParams({ pageSize: Number(event.target.value) === s.list.pageSize ? null : event.target.value })}
                  >
                    {pageSizeOptions(s.list.pageSize).map((size) => (
                      <option key={size} value={size}>
                        {formatNumber(size)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span>{pager.label}</span>
              <Button variant="outline" size="icon-sm" aria-label={t('list.previousPage')} disabled={!hasPrevious} onClick={previousPage}>
                <ChevronLeft className="rtl:rotate-180" />
              </Button>
              <Button variant="outline" size="icon-sm" aria-label={t('list.nextPage')} disabled={!pager.hasNext} onClick={nextPage}>
                <ChevronRight className="rtl:rotate-180" />
              </Button>
            </div>
          </div>
          </section>
        </>
      )}
      <QuickView schema={s} item={quickView} onClose={() => setQuickView(undefined)} />
    </div>
  );
}

/** A cell; a related record links to its own page when its resource is registered. */
function CellValue({ value, field, record }: { value: unknown; field: FieldSchema; record: AdminRecord }) {
  const target = field.relation?.resource;
  if (!target || value === null || value === undefined) return <DisplayValue value={value} field={field} record={record} />;
  const refs = (Array.isArray(value) ? value : [value]).filter(isRef);
  if (refs.length === 0) return <>{formatCell(value, field)}</>;
  return (
    <>
      {refs.map((ref, index) => (
        <Fragment key={String(ref.id)}>
          {index > 0 && ', '}
          <Link to={`/${target}/${encodeURIComponent(encodeRecordId([ref.id]))}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>
            {ref.title}
          </Link>
        </Fragment>
      ))}
    </>
  );
}


function RestoreButton({ item, pending, onRestore }: { item: AdminRecord; pending: boolean; onRestore: (id: string) => void }) {
  const t = useT();
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} aria-label={t('list.restoreRecord', { name: String(item._title ?? item._id) })} onClick={() => onRestore(String(item._id))}>
      <RotateCcw />
      {t('list.restore')}
    </Button>
  );
}

/** "2 deleted · 1 failed" (or "Ship: 2 done · 1 failed") with each failure's record and reason. */
function BulkSummary({ title, result, items }: { title: string; result: BulkResult; items: AdminRecord[] }) {
  const t = useT();
  const name = (id: string) => {
    const item = items.find((candidate) => String(candidate._id) === id);
    return typeof item?._title === 'string' ? item._title : `#${id}`;
  };
  return (
    <div role="status" className="rounded-lg border px-3 py-2 text-sm">
      <p>
        {title}
        {result.failed.length > 0 && ` · ${t('list.bulkFailed', { count: result.failed.length })}`}
      </p>
      {result.failed.length > 0 && (
        <ul className="mt-1 list-disc ps-5 text-destructive">
          {result.failed.map((failure) => (
            <li key={failure.id}>
              {name(failure.id)}: {failure.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
