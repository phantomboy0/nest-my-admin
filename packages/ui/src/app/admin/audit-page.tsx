import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import type { ResourceSchema } from '@nest-my-admin/core/contract';
import { Alert, PageTitle } from '@/app/admin/shared';
import { AuditEntries } from '@/app/audit-entries';
import { DateInput } from '@/app/date-input';
import { selectClass } from '@/app/filter-bar';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/i18n';
import { ApiError, api, describeError } from '@/lib/api';
import { auditFilterChanges, auditNames, auditQueryFromUrl, clearAuditFilters, hasAuditFilters, type AuditFilter } from '@/lib/audit';
import { withChanges } from '@/lib/list-state';
import { useMeta, useSession } from '@/lib/queries';

/** Events worth suggesting; the filter takes any event, or a family with `.*`. */
const EVENT_HINTS = ['auth.*', 'auth.login', 'auth.login_failed', 'auth.view_as', 'rbac.*', 'rbac.role.changed', 'rbac.user_roles.changed', 'page.*'];
const RECORD_EVENTS = ['*', 'created', 'updated', 'deleted', 'restored', 'purged', 'action.*'];

/**
 * The audit log (spec §10.2) for holders of `audit.view`: every recorded change, sign-in and permission change,
 * newest first, each cut to what this reader may see. The filters live in the URL, like a list's.
 */
export function AuditPage() {
  const { t, locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const meta = useMeta();
  // The session says whether this reader may be here: without `audit.view` nothing of the page is shown or asked for.
  const session = useSession();
  const allowed = session.data?.audit.view === true;
  const query = auditQueryFromUrl(params);
  const audit = useInfiniteQuery({
    queryKey: ['audit', query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.audit(query, pageParam),
    getNextPageParam: (last) => last.next,
    staleTime: 0,
    enabled: allowed,
    retry: false, // a refusal (403, 404) or an unreadable filter (422) will not get better
  });
  const entries = audit.data?.pages.flatMap((page) => page.entries) ?? [];

  // Labels and formatters come from the schemas of the resources on the page: one cached request per resource the
  // reader has in their meta, never one per entry.
  const known = new Set((meta.data?.groups ?? []).flatMap((group) => group.resources.map((resource) => resource.name)));
  const wanted = [...new Set(entries.map((entry) => entry.resource).filter((name): name is string => name !== undefined && known.has(name)))].sort();
  const schemas = useQueries({ queries: wanted.map((name) => ({ queryKey: ['schema', name, locale], queryFn: () => api.schema(name), retry: false })) });
  const schemaOf = (name: string): ResourceSchema | undefined => schemas[wanted.indexOf(name)]?.data;

  // The same for settings pages the reader may view: their fields' labels.
  const pages = new Set((meta.data?.groups ?? []).flatMap((group) => group.pages.map((page) => page.name)));
  const wantedPages = [...new Set(entries.map((entry) => entry.meta?.page).filter((name): name is string => name !== undefined && pages.has(name)))].sort();
  const pageSchemas = useQueries({ queries: wantedPages.map((name) => ({ queryKey: ['page', name, locale], queryFn: () => api.page(name), retry: false })) });
  const pageFieldsOf = (name: string) => pageSchemas[wantedPages.indexOf(name)]?.data?.schema.fields;

  // The function form, as on the list page. In the installed react-router it is handed the params of the last
  // render, not the live URL: two changes made before a render do not compose (the second starts from the same
  // params as the first). Every filter here changes one key per event, so that does not come up.
  const set = (key: AuditFilter, value: string) => setParams((current) => withChanges(current, auditFilterChanges(key, value)));
  const refused = audit.error instanceof ApiError && (audit.error.status === 403 || audit.error.status === 404);

  if (session.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (!allowed || refused) {
    return (
      <div className="flex max-w-4xl flex-col gap-4">
        <PageTitle>{t('audit.title')}</PageTitle>
        <PageMessage tone="error">{refused ? describeError(audit.error!) : t(session.data?.audit.enabled ? 'audit.notAllowed' : 'audit.off')}</PageMessage>
      </div>
    );
  }
  const resources = (meta.data?.groups ?? []).flatMap((group) => group.resources);
  const resource = params.get('resource') ?? '';
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageTitle>{t('audit.title')}</PageTitle>
      <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">{t('filters.filters')}</legend>
        <TextFilter label={t('audit.filter.actor')} value={params.get('actor') ?? ''} onCommit={(value) => set('actor', value)} />
        <TextFilter
          label={t('audit.filter.event')}
          placeholder={t('audit.filter.eventHint')}
          value={params.get('event') ?? ''}
          onCommit={(value) => set('event', value)}
          hints={[...(resource ? RECORD_EVENTS.map((event) => `${resource}.${event}`) : []), ...EVENT_HINTS]}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-resource">{t('audit.filter.resource')}</Label>
          <select id="audit-resource" className={selectClass} value={resource} onChange={(event) => set('resource', event.target.value)}>
            <option value="">{t('common.all')}</option>
            {/* A resource from the URL that this reader's meta does not list stays selectable (the answer is empty). */}
            {resource && !resources.some((candidate) => candidate.name === resource) && <option value={resource}>{resource}</option>}
            {resources.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.label}
              </option>
            ))}
          </select>
        </div>
        <TextFilter
          label={t('audit.filter.record')}
          placeholder={resource ? undefined : t('audit.filter.recordHint')}
          value={resource ? (params.get('record') ?? '') : ''}
          disabled={!resource}
          onCommit={(value) => set('record', value)}
        />
        {(['from', 'to'] as const).map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`audit-${key}`}>{t(`filters.${key}`)}</Label>
            <DateInput id={`audit-${key}`} label={t(`filters.${key}`)} value={params.get(key) ?? ''} onChange={(value) => set(key, value)} />
          </div>
        ))}
        {hasAuditFilters(params) && (
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setParams((current) => withChanges(current, clearAuditFilters()))}>
              {t('filters.clear')}
            </Button>
          </div>
        )}
      </fieldset>
      {audit.isError && <Alert>{describeError(audit.error)}</Alert>}
      {audit.isPending ? (
        <PageMessage>{t('common.loading')}</PageMessage>
      ) : entries.length === 0 ? (
        !audit.isError && <PageMessage>{t(hasAuditFilters(params) ? 'audit.noMatches' : 'audit.empty')}</PageMessage>
      ) : (
        <AuditEntries entries={entries} now={new Date(audit.dataUpdatedAt)} names={auditNames(meta.data, schemaOf)} schemaOf={schemaOf} pageFieldsOf={pageFieldsOf} onActor={(id) => set('actor', id)} showSubject />
      )}
      {audit.hasNextPage && (
        <Button type="button" variant="outline" size="sm" className="self-center" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
          {t(audit.isFetchingNextPage ? 'common.loading' : 'list.loadMore')}
        </Button>
      )}
    </div>
  );
}

interface TextFilterProps {
  label: string;
  value: string;
  /** Called on Enter and on leaving the input, when the text changed. */
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hints?: string[];
}

/** A text filter that applies on Enter or blur (each keystroke would be a request and a history entry). */
function TextFilter({ label, value, onCommit, placeholder, disabled, hints }: TextFilterProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="text"
        dir="auto"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        list={hints ? `${id}-hints` : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {hints && (
        <datalist id={`${id}-hints`}>
          {hints.map((hint) => (
            <option key={hint} value={hint} />
          ))}
        </datalist>
      )}
    </div>
  );
}
