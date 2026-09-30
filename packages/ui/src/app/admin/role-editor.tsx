import { Fragment, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import type { RbacCatalog, RbacRole } from '@nest-my-admin/core/contract';
import { Alert, PageTitle, fromLocalized, textIn, toLocalized } from '@/app/admin/shared';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/i18n';
import { ApiError, api, describeError } from '@/lib/api';
import { runtimeConfig } from '@/lib/config';
import { useSession } from '@/lib/queries';
import { catalogCodes, grants, togglePermission } from '@/lib/role-draft';
import { cn } from '@/lib/utils';

type FieldRule = NonNullable<RbacRole['fields']>[string][string];
type ScopedOp = 'view' | 'update' | 'delete';
const SCOPED: ScopedOp[] = ['view', 'update', 'delete'];

/** `/-/roles/:name` and `/-/roles/new`. */
export function RoleEditorPage() {
  const { t } = useLocale();
  const { name } = useParams();
  const isNew = name === undefined;
  const catalog = useQuery({ queryKey: ['rbac', 'catalog'], queryFn: api.rbac.catalog });
  const role = useQuery({ queryKey: ['rbac', 'role', name], queryFn: () => api.rbac.role(name!), enabled: !isNew });
  if (catalog.isPending || (!isNew && role.isPending)) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (catalog.isError) return <PageMessage tone="error">{describeError(catalog.error)}</PageMessage>;
  if (!isNew && role.isError) return <PageMessage tone="error">{describeError(role.error)}</PageMessage>;
  return <RoleEditor key={name ?? 'new'} catalog={catalog.data} role={isNew ? undefined : role.data} />;
}

function RoleEditor({ catalog, role }: { catalog: RbacCatalog; role?: RbacRole }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const readOnly = role?.system === true || session.data?.rbac.manage !== true;
  const known = catalogCodes(catalog);
  const [name, setName] = useState(role?.name ?? '');
  const [label, setLabel] = useState(fromLocalized(role?.label));
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [fields, setFields] = useState<NonNullable<RbacRole['fields']>>(role?.fields ?? {});
  const [scopes, setScopes] = useState<NonNullable<RbacRole['scopes']>>(role?.scopes ?? {});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { label: toLocalized(label), permissions, fields: clean(fields), scopes: clean(scopes) };
      return role ? api.rbac.updateRole(role.name, body) : api.rbac.createRole({ name: name.trim(), ...body });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['rbac'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate(`/-/roles/${encodeURIComponent(saved.name)}`, { replace: true });
      setError(null);
    },
    onError: (failure) => setError(failure instanceof ApiError ? [failure.message, ...Object.values(failure.fields).flat()].join(' — ') : describeError(failure)),
  });
  const remove = useMutation({
    mutationFn: () => api.rbac.deleteRole(role!.name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rbac'] });
      navigate('/-/roles');
    },
    onError: (failure) => setError(describeError(failure)),
  });

  const toggle = (code: string, on: boolean) => setPermissions((current) => togglePermission(current, code, on, known));
  const setField = (resource: string, field: string, rule: FieldRule | '') =>
    setFields((current) => {
      const next = { ...current, [resource]: { ...current[resource] } };
      if (rule === '') delete next[resource]![field];
      else next[resource]![field] = rule;
      return next;
    });
  const toggleScope = (resource: string, op: ScopedOp, scope: string, on: boolean) =>
    setScopes((current) => {
      const existing = current[resource]?.[op];
      const list = new Set(Array.isArray(existing) ? existing : existing ? [existing] : []);
      if (on) list.add(scope);
      else list.delete(scope);
      return { ...current, [resource]: { ...current[resource], [op]: [...list] } };
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!readOnly) save.mutate();
  }

  const groups = [...new Set(catalog.resources.map((resource) => resource.group))];
  return (
    <form onSubmit={submit} className="flex max-w-5xl flex-col gap-5" aria-label={t('rbac.role')}>
      <PageTitle>{role ? textIn(role.label, locale) || role.name : t('rbac.newRole')}</PageTitle>
      {role?.system && <Alert tone="success">{t('rbac.systemNote')}</Alert>}
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role-name">{t('rbac.name')}</Label>
          <Input id="role-name" dir="ltr" value={name} disabled={Boolean(role)} onChange={(event) => setName(event.target.value)} />
        </div>
        {runtimeConfig.locales.map((code) => (
          <div key={code} className="flex flex-col gap-1.5">
            <Label htmlFor={`role-label-${code}`}>{t('rbac.labelIn', { language: code })}</Label>
            <Input id={`role-label-${code}`} value={label[code] ?? ''} disabled={readOnly} onChange={(event) => setLabel({ ...label, [code]: event.target.value })} />
          </div>
        ))}
      </div>

      <section aria-labelledby="matrix-title" className="flex flex-col gap-2">
        <h2 id="matrix-title" className="font-medium">
          {t('rbac.matrix')}
        </h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-3 py-2 text-start font-medium">{t('rbac.resource')}</th>
                {catalog.operations.map((op) => (
                  <th key={op} className="px-2 py-2 text-center font-medium">
                    {t(`rbac.op.${op}` as const)}
                  </th>
                ))}
                <th className="w-0" />
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group}>
                  {catalog.resources
                    .filter((resource) => resource.group === group)
                    .map((resource) => {
                      const expanded = open === resource.name;
                      const detailsId = `role-details-${resource.name}`;
                      return (
                        <Fragment key={resource.name}>
                          <tr className="border-b last:border-0">
                            <th scope="row" className="px-3 py-2 text-start font-normal">
                              {resource.label}
                            </th>
                            {catalog.operations.map((op) => {
                              const code = `${resource.name}.${op}`;
                              return (
                                <td key={op} className="px-2 py-2 text-center">
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-primary"
                                    aria-label={t('rbac.grant', { operation: t(`rbac.op.${op}` as const), resource: resource.label })}
                                    checked={grants(permissions, code)}
                                    disabled={readOnly}
                                    onChange={(event) => toggle(code, event.target.checked)}
                                  />
                                </td>
                              );
                            })}
                            <td className="px-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-expanded={expanded}
                                aria-controls={detailsId}
                                aria-label={t('rbac.details', { resource: resource.label })}
                                onClick={() => setOpen(expanded ? null : resource.name)}
                              >
                                <ChevronDown className={cn('transition-transform', expanded && 'rotate-180')} />
                              </Button>
                            </td>
                          </tr>
                          {expanded && (
                            <tr id={detailsId} className="border-b bg-muted/20">
                              <td colSpan={catalog.operations.length + 2} className="px-3 py-3">
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <div className="flex flex-col gap-2">
                                    <h3 className="text-xs font-medium text-muted-foreground">{t('rbac.fields')}</h3>
                                    {resource.fields.map((field) => (
                                      <label key={field.name} className="flex items-center justify-between gap-3">
                                        <span>
                                          {field.label}
                                          {field.restricted && <span className="ms-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-800 dark:text-amber-300">{t('rbac.restricted')}</span>}
                                        </span>
                                        <select
                                          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                                          value={fields[resource.name]?.[field.name] ?? ''}
                                          disabled={readOnly}
                                          aria-label={t('rbac.fieldRule', { field: field.label })}
                                          onChange={(event) => setField(resource.name, field.name, event.target.value as FieldRule | '')}
                                        >
                                          <option value="">{t(field.restricted ? 'rbac.rule.defaultHidden' : 'rbac.rule.default')}</option>
                                          <option value="hidden">{t('rbac.rule.hidden')}</option>
                                          <option value="readonly">{t('rbac.rule.readonly')}</option>
                                          <option value="edit">{t('rbac.rule.edit')}</option>
                                        </select>
                                      </label>
                                    ))}
                                  </div>
                                  <div className="flex flex-col gap-3">
                                    {resource.scopes.length > 0 && (
                                      <div className="flex flex-col gap-2">
                                        <h3 className="text-xs font-medium text-muted-foreground">{t('rbac.scopes')}</h3>
                                        {SCOPED.map((op) => {
                                          const current = scopes[resource.name]?.[op];
                                          const selected = Array.isArray(current) ? current : current ? [current] : [];
                                          return (
                                            <fieldset key={op} className="flex flex-wrap items-center gap-3">
                                              <legend className="me-2 text-sm">{t(`rbac.op.${op}` as const)}:</legend>
                                              {resource.scopes.map((scope) => (
                                                <label key={scope} className="flex items-center gap-1.5">
                                                  <input
                                                    type="checkbox"
                                                    className="size-4 accent-primary"
                                                    checked={selected.includes(scope)}
                                                    disabled={readOnly}
                                                    onChange={(event) => toggleScope(resource.name, op, scope, event.target.checked)}
                                                  />
                                                  {scope}
                                                </label>
                                              ))}
                                              {selected.length === 0 && <span className="text-xs text-muted-foreground">{t('rbac.allRows')}</span>}
                                            </fieldset>
                                          );
                                        })}
                                      </div>
                                    )}
                                    {resource.custom.length > 0 && (
                                      <div className="flex flex-col gap-2">
                                        <h3 className="text-xs font-medium text-muted-foreground">{t('rbac.custom')}</h3>
                                        {resource.custom.map((custom) => {
                                          const code = `${resource.name}.${custom}`;
                                          return (
                                            <label key={custom} className="flex items-center gap-2">
                                              <input type="checkbox" className="size-4 accent-primary" checked={grants(permissions, code)} disabled={readOnly} onChange={(event) => toggle(code, event.target.checked)} />
                                              <code className="text-xs">{code}</code>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {catalog.global.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t('rbac.global')}</legend>
          {catalog.global.map((code) => (
            <label key={code} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={grants(permissions, code)} disabled={readOnly} onChange={(event) => toggle(code, event.target.checked)} />
              <code className="text-xs">{code}</code>
            </label>
          ))}
        </fieldset>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || (!role && !name.trim())}>
            {t(save.isPending ? 'form.saving' : 'form.save')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/-/roles')}>
            {t('common.cancel')}
          </Button>
          {role && (
            <Button type="button" variant="outline" className="ms-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('form.delete')}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}

/** Drops empty per-resource entries before saving. */
function clean<T extends Record<string, Record<string, unknown>>>(value: T): T | undefined {
  const entries = Object.entries(value)
    .map(([key, inner]) => [key, Object.fromEntries(Object.entries(inner).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)))] as const)
    .filter(([, inner]) => Object.keys(inner).length > 0);
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined;
}
