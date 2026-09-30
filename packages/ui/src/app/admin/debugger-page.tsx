import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ExplainRoleSource, PermissionExplanation } from '@nest-my-admin/core/contract';
import { PageTitle, textIn } from '@/app/admin/shared';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale, type MessageKey } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { cn } from '@/lib/utils';

type Level = 'hidden' | 'view' | 'edit';
const LEVEL_KEY: Record<Level, MessageKey> = { hidden: 'rbac.rule.hidden', view: 'rbac.rule.readonly', edit: 'rbac.rule.edit' };

/** Why a user may or may not do things with a resource (spec §6.7), from `/api/rbac/explain`. */
export function DebuggerPage() {
  const { t } = useLocale();
  const [params, setParams] = useSearchParams();
  const userId = params.get('user') ?? '';
  const resource = params.get('resource') ?? '';
  const record = params.get('record') ?? '';
  const catalog = useQuery({ queryKey: ['rbac', 'catalog'], queryFn: api.rbac.catalog });
  const chosen = useQuery({ queryKey: ['rbac', 'user', userId], queryFn: () => api.rbac.user(userId), enabled: userId !== '' });
  const [search, setSearch] = useState('');
  const [draftResource, setDraftResource] = useState(resource);
  const [draftRecord, setDraftRecord] = useState(record);
  const [draftUser, setDraftUser] = useState(userId);
  const matches = useQuery({ queryKey: ['rbac', 'users', search, 1], queryFn: () => api.rbac.users({ search }), enabled: search.trim().length > 0 });
  const explanation = useQuery({
    queryKey: ['rbac', 'explain', userId, resource, record],
    queryFn: () => api.rbac.explain({ user: userId, resource, record: record || undefined }),
    enabled: userId !== '' && resource !== '',
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (draftUser) next.user = draftUser;
    if (draftResource) next.resource = draftResource;
    if (draftRecord.trim()) next.record = draftRecord.trim();
    setParams(next);
  }

  const chosenName = draftUser === userId ? chosen.data?.displayName : undefined;
  return (
    <div className="flex max-w-5xl flex-col gap-5">
      <PageTitle>{t('debugger.title')}</PageTitle>
      <p className="-mt-3 text-sm text-muted-foreground">{t('debugger.intro')}</p>
      <form onSubmit={submit} className="grid gap-4 rounded-lg border p-4 md:grid-cols-3" aria-label={t('debugger.title')}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="debug-user">{t('debugger.user')}</Label>
          <Input id="debug-user" placeholder={t('rbac.searchUsers')} value={search} onChange={(event) => setSearch(event.target.value)} autoComplete="off" />
          {search.trim() && (
            <ul aria-label={t('rbac.searchResults')} className="flex flex-col rounded-md border text-sm">
              {(matches.data?.items ?? []).slice(0, 6).map((user) => (
                <li key={user.id}>
                  <button
                    type="button"
                    className="w-full px-2 py-1.5 text-start hover:bg-accent"
                    onClick={() => {
                      setDraftUser(user.id);
                      setSearch('');
                    }}
                  >
                    {user.displayName}
                    {user.username && <span className="text-muted-foreground"> · {user.username}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {draftUser && (
            <p className="text-sm" data-testid="debug-chosen-user">
              {chosenName ?? draftUser}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="debug-resource">{t('debugger.resource')}</Label>
          <select id="debug-resource" className="h-9 rounded-md border bg-background px-2 text-sm" value={draftResource} onChange={(event) => setDraftResource(event.target.value)}>
            <option value="">—</option>
            {(catalog.data?.resources ?? []).map((item) => (
              <option key={item.name} value={item.name}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="debug-record">{t('debugger.record')}</Label>
          <Input id="debug-record" dir="ltr" value={draftRecord} onChange={(event) => setDraftRecord(event.target.value)} />
        </div>
        <div className="md:col-span-3">
          <Button type="submit" disabled={!draftUser || !draftResource}>
            {t('debugger.explain')}
          </Button>
        </div>
      </form>
      {!userId || !resource ? (
        <p className="text-sm text-muted-foreground">{t('debugger.pick')}</p>
      ) : explanation.isPending ? (
        <PageMessage>{t('common.loading')}</PageMessage>
      ) : explanation.isError ? (
        <PageMessage tone="error">{describeError(explanation.error)}</PageMessage>
      ) : (
        <Explanation data={explanation.data} />
      )}
    </div>
  );
}

function Verdict({ allowed }: { allowed: boolean }) {
  const { t } = useLocale();
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', allowed ? 'bg-green-500/15 text-green-800 dark:text-green-300' : 'bg-destructive/10 text-destructive')}>
      {t(allowed ? 'debugger.allowed' : 'debugger.denied')}
    </span>
  );
}

function Explanation({ data }: { data: PermissionExplanation }) {
  const { t, locale } = useLocale();
  const source = (item: ExplainRoleSource) => (item.kind === 'group' ? t('debugger.source.group', { group: item.group ?? '' }) : t(`debugger.source.${item.kind}`));
  const scopeText = (value: 'all' | string[]) => (value === 'all' ? t('debugger.allRows') : value.length === 0 ? t('debugger.noRows') : t('debugger.someRows', { scopes: value.join(', ') }));
  return (
    <div className="flex flex-col gap-5" data-testid="explanation">
      <section aria-labelledby="debug-roles" className="flex flex-col gap-2">
        <h2 id="debug-roles" className="font-medium">
          {t('debugger.roles')} · {data.user.displayName}
        </h2>
        {data.superuser ? (
          <p className="text-sm">{t('debugger.superuser')}</p>
        ) : data.roles.length === 0 ? (
          <p className="text-sm">{t('debugger.noRoles')}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {data.roles.map((role) => (
              <li key={role.name}>
                <span className="font-medium">{textIn(role.label, locale) || role.name}</span>{' '}
                <span className="text-muted-foreground">({role.sources.map(source).join(', ')})</span>
                {!role.known && <span className="ms-2 text-destructive">{t('debugger.unknownRole')}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="debug-operations" className="flex flex-col gap-2">
        <h2 id="debug-operations" className="font-medium">
          {t('debugger.operations')} · {data.resource.label}
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {data.operations.map((operation) => (
                <tr key={operation.operation}>
                  <th scope="row" className="w-32 px-3 py-2 text-start font-medium">
                    {t(`rbac.op.${operation.operation}`)}
                  </th>
                  <td className="w-24 px-3 py-2">
                    <Verdict allowed={operation.allowed} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {data.superuser
                      ? ''
                      : operation.grantedBy.length === 0
                        ? t('debugger.noGrant')
                        : operation.grantedBy.map((grant) => t(grant.via ? 'debugger.viaUpdate' : 'debugger.grant', { pattern: grant.pattern, role: grant.role })).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="debug-fields" className="flex flex-col gap-2">
        <h2 id="debug-fields" className="font-medium">
          {t('debugger.fields')}
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">{t('debugger.field')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('debugger.result')}</th>
                <th className="px-3 py-2 text-start font-medium">{t('debugger.byRole')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.fields.map((field) => (
                <tr key={field.name} data-field={field.name}>
                  <th scope="row" className="px-3 py-2 text-start font-medium">
                    {field.label}
                    {field.restricted && <span className="ms-2 rounded-full border px-1.5 text-xs font-normal text-muted-foreground">{t('rbac.restricted')}</span>}
                  </th>
                  <td className="px-3 py-2">
                    {t(LEVEL_KEY[field.level])}
                    {field.forced && <span className="block text-xs text-muted-foreground">{t('debugger.forced')}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {field.byRole.map((item) => `${item.role}: ${t(LEVEL_KEY[item.level])}${item.rule ? ` (${item.rule})` : ''}${item.code ? ` (${item.code})` : ''}`).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="debug-scopes" className="flex flex-col gap-2">
        <h2 id="debug-scopes" className="font-medium">
          {t('debugger.scopes')}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {data.scopes.map((scope) => (
            <li key={scope.operation}>
              <span className="font-medium">{t(`rbac.op.${scope.operation}`)}:</span> {scopeText(scope.result)}
              {scope.byRole.length > 0 && <span className="text-muted-foreground"> ({scope.byRole.map((item) => `${item.role}: ${scopeText(item.scopes)}`).join(' · ')})</span>}
              {scope.global.length > 0 && <span className="text-muted-foreground"> · {t('debugger.globalScopes', { scopes: scope.global.join(', ') })}</span>}
            </li>
          ))}
        </ul>
      </section>

      {data.record && (
        <section aria-labelledby="debug-record-title" className="flex flex-col gap-2">
          <h2 id="debug-record-title" className="font-medium">
            {t('debugger.recordTitle', { id: data.record.id })}
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {(['view', 'update', 'delete'] as const).map((operation) => (
              <li key={operation} className="flex flex-wrap items-center gap-2" data-operation={operation}>
                <span className="w-24 font-medium">{t(`rbac.op.${operation}`)}</span>
                <Verdict allowed={data.record![operation]} />
                {data.record!.reasons[operation] && <span className="text-muted-foreground">{t(`debugger.reason.${data.record!.reasons[operation]!}`)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
