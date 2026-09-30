import { Fragment } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { AdminRecord, FieldSchema } from '@nest-my-admin/core/contract';
import { FilterBar } from '@/app/filter-bar';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { describeError } from '@/lib/api';
import { formatCell } from '@/lib/format';
import { isRef } from '@/lib/form-values';
import { encodeRecordId } from '@/lib/record-id';
import { hasActiveFilters, listQueryFromUrl, withChanges, type ParamChanges } from '@/lib/list-state';
import { useList, useSchema } from '@/lib/queries';

export function ListPage() {
  const { resource = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const sortParam = searchParams.get('sort') ?? undefined;
  const schema = useSchema(resource);
  const list = useList(resource, listQueryFromUrl(searchParams));

  if (schema.isPending) return <PageMessage>Loading…</PageMessage>;
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
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
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
        {s.creatable && (
          <Button asChild>
            <Link to={`/${s.name}/new`}>
              <Plus />
              New
            </Link>
          </Button>
        )}
      </div>

      <FilterBar schema={s} params={searchParams} onChange={updateParams} />

      {list.isError && <PageMessage tone="error">{describeError(list.error)}</PageMessage>}

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={String(item._id)} className="cursor-pointer" onClick={() => navigate(recordPath(item))}>
                {columns.map((column, index) => (
                  <TableCell key={column.name}>
                    {index === 0 ? (
                      <Link to={recordPath(item)} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                        {formatCell(item[column.name], column)}
                      </Link>
                    ) : (
                      <CellValue value={item[column.name]} field={column} />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {list.isSuccess && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center text-muted-foreground">
                  {hasActiveFilters(searchParams) ? 'No records match.' : 'No records yet.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-2 md:hidden">
        {items.map((item) => (
          <li key={String(item._id)}>
            <Link to={recordPath(item)} className="block rounded-lg border p-3 active:bg-muted">
              <div className="font-medium">{typeof item._title === 'string' ? item._title : String(item._id)}</div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-sm">
                {detailColumns
                  .filter((column) => formatCell(item[column.name], column) !== item._title) // the title is shown above
                  .map((column) => (
                  <Fragment key={column.name}>
                    <dt className="text-muted-foreground">{column.label}</dt>
                    <dd className="truncate">{formatCell(item[column.name], column)}</dd>
                  </Fragment>
                  ))}
              </dl>
            </Link>
          </li>
        ))}
        {list.isSuccess && items.length === 0 && <li className="text-center text-sm text-muted-foreground">{hasActiveFilters(searchParams) ? 'No records match.' : 'No records yet.'}</li>}
      </ul>

      <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>{list.data ? `${list.data.total} total` : ''}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <span>
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= totalPages} onClick={() => updateParams({ page: String(page + 1) })}>
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
