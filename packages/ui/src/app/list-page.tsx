import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { AdminRecord, FieldSchema } from '@nest-my-admin/core/contract';
import { FilterBar } from '@/app/filter-bar';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useT } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { formatCell } from '@/lib/format';
import { isRef } from '@/lib/form-values';
import { encodeRecordId } from '@/lib/record-id';
import { hasActiveFilters, listQueryFromUrl, paging, withChanges, type ParamChanges } from '@/lib/list-state';
import { useList, useSchema } from '@/lib/queries';

export function ListPage() {
  const { resource = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const sortParam = searchParams.get('sort') ?? undefined;
  const schema = useSchema(resource);
  const list = useList(resource, listQueryFromUrl(searchParams));
  const queryClient = useQueryClient();
  const t = useT();
  const restore = useMutation({
    mutationFn: (id: string) => api.restore(resource, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['list', resource] }),
  });
  const trash = searchParams.get('trashed') === 'only';
  const [trail, setTrail] = useState<string[]>([]);
  const hasAfter = searchParams.has('after');
  useEffect(() => {
    if (!hasAfter) setTrail([]); // back on the first page (a new filter or sort, or Previous from page 2)
  }, [hasAfter]);

  if (schema.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (schema.isError) return <PageMessage tone="error">{schema.error.message}</PageMessage>;

  const s = schema.data;
  const columns = s.list.columns
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
  const recordPath = (item: AdminRecord) => `/${s.name}/${encodeURIComponent(String(item._id))}`;

  function updateParams(changes: ParamChanges) {
    setSearchParams((previous) => withChanges(previous, changes));
  }

  function toggleSort(field: string) {
    const ascending = sort.field === field && sort.direction === 'asc';
    updateParams({ sort: ascending ? `-${field}` : field });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{s.label}</h1>
        {s.softDelete && (
          <Button variant={trash ? 'secondary' : 'outline'} className="ms-auto" aria-pressed={trash} onClick={() => updateParams({ trashed: trash ? null : 'only' })}>
            <Trash2 />
            {t('list.trash')}
          </Button>
        )}
        {s.creatable && !trash && (
          <Button asChild>
            <Link to={`/${s.name}/new`}>
              <Plus />
              {t('list.new')}
            </Link>
          </Button>
        )}
      </div>

      <FilterBar schema={s} params={searchParams} onChange={updateParams} />

      {list.isError && <PageMessage tone="error">{describeError(list.error)}</PageMessage>}
      {restore.isError && <PageMessage tone="error">{describeError(restore.error)}</PageMessage>}
      {trash && <p className="text-sm text-muted-foreground">{t('list.trashNote')}</p>}

      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.name} aria-sort={sort.field === column.name ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {s.list.sortable.includes(column.name) ? (
                    <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort(column.name)}>
                      {column.label}
                      {sort.field === column.name &&
                        (sort.direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                    </button>
                  ) : (
                    column.label
                  )}
                </TableHead>
              ))}
              {trash && <TableHead className="w-0"><span className="sr-only">{t('list.actions')}</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item._id)} className={trash ? undefined : 'cursor-pointer'} onClick={trash ? undefined : () => navigate(recordPath(item))}>
                {columns.map((column, index) => (
                  <TableCell key={column.name}>
                    {index === 0 && !trash ? (
                      <Link to={recordPath(item)} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                        {formatCell(item[column.name], column)}
                      </Link>
                    ) : (
                      <CellValue value={item[column.name]} field={column} />
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
                <TableCell colSpan={columns.length + (trash ? 1 : 0)} className="text-center text-muted-foreground">
                  {t(hasActiveFilters(searchParams) ? 'list.noMatches' : 'list.noRecords')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((item) => (
          <li key={String(item._id)}>
            {trash ? (
              <div className="flex items-start justify-between gap-2 rounded-lg border p-3">
                <Card item={item} columns={detailColumns} />
                <RestoreButton item={item} pending={restore.isPending} onRestore={(id) => restore.mutate(id)} />
              </div>
            ) : (
              <Link to={recordPath(item)} className="block rounded-lg border p-3 active:bg-muted">
                <Card item={item} columns={detailColumns} />
              </Link>
            )}
          </li>
        ))}
        {list.isSuccess && items.length === 0 && <li className="text-center text-sm text-muted-foreground">{t(hasActiveFilters(searchParams) ? 'list.noMatches' : 'list.noRecords')}</li>}
      </ul>

      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{pager.summary}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label={t('list.previousPage')} disabled={!hasPrevious} onClick={previousPage}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <span>
            {pager.label}
          </span>
          <Button variant="outline" size="icon-sm" aria-label={t('list.nextPage')} disabled={!pager.hasNext} onClick={nextPage}>
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A cell; a related record links to its own page when its resource is registered. */
function CellValue({ value, field }: { value: unknown; field: FieldSchema }) {
  const target = field.relation?.resource;
  if (!target || value === null || value === undefined) return <>{formatCell(value, field)}</>;
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

/** A mobile card's content: the record title, then the other columns. */
function Card({ item, columns }: { item: AdminRecord; columns: FieldSchema[] }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="font-medium">{typeof item._title === 'string' ? item._title : String(item._id)}</div>
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
        {columns
          .filter((column) => formatCell(item[column.name], column) !== item._title) // the title is shown above
          .map((column) => (
            <Fragment key={column.name}>
              <dt className="text-muted-foreground">{column.label}</dt>
              <dd className="truncate">{formatCell(item[column.name], column)}</dd>
            </Fragment>
          ))}
      </dl>
    </div>
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
