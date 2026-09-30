import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import type { RbacGroup, RbacRole } from '@nest-my-admin/core/contract';
import { Alert, PageTitle, fromLocalized, textIn, toLocalized } from '@/app/admin/shared';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/i18n';
import { api, describeError } from '@/lib/api';
import { runtimeConfig } from '@/lib/config';
import { useSession } from '@/lib/queries';

export function GroupsPage() {
  const { t, locale } = useLocale();
  const session = useSession();
  const groups = useQuery({ queryKey: ['rbac', 'groups'], queryFn: api.rbac.groups });
  if (groups.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (groups.isError) return <PageMessage tone="error">{describeError(groups.error)}</PageMessage>;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageTitle
        actions={
          session.data?.rbac.manage && (
            <Button asChild>
              <Link to="/-/groups/new">
                <Plus />
                {t('rbac.newGroup')}
              </Link>
            </Button>
          )
        }
      >
        {t('rbac.groups')}
      </PageTitle>
      {groups.data.items.length === 0 && <p className="text-sm text-muted-foreground">{t('rbac.noGroups')}</p>}
      <ul aria-label={t('rbac.groups')} className="flex flex-col divide-y rounded-lg border empty:hidden">
        {groups.data.items.map((group) => (
          <li key={group.id}>
            <Link to={`/-/groups/${group.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
              <span className="font-medium">{textIn(group.label, locale) || group.name}</span>
              <span className="text-xs text-muted-foreground">{t('rbac.groupSummary', { roles: group.roles.length, members: group.members.length })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GroupEditorPage() {
  const { t } = useLocale();
  const { id } = useParams();
  const isNew = id === undefined;
  const roles = useQuery({ queryKey: ['rbac', 'roles'], queryFn: api.rbac.roles });
  const group = useQuery({ queryKey: ['rbac', 'group', id], queryFn: () => api.rbac.group(Number(id)), enabled: !isNew });
  if (roles.isPending || (!isNew && group.isPending)) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (roles.isError) return <PageMessage tone="error">{describeError(roles.error)}</PageMessage>;
  if (!isNew && group.isError) return <PageMessage tone="error">{describeError(group.error)}</PageMessage>;
  return <GroupEditor key={id ?? 'new'} roles={roles.data.items} group={isNew ? undefined : group.data} />;
}

function GroupEditor({ roles, group }: { roles: RbacRole[]; group?: RbacGroup }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const readOnly = session.data?.rbac.manage !== true;
  const [name, setName] = useState(group?.name ?? '');
  const [label, setLabel] = useState(fromLocalized(group?.label));
  const [chosen, setChosen] = useState<string[]>(group?.roles ?? []);
  const [members, setMembers] = useState<string[]>(group?.members ?? []);
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['rbac', 'users', search], queryFn: () => api.rbac.users({ search }), enabled: search.trim().length > 0 });
  // Names of members, from the first page of users and from users picked in this session.
  const everyone = useQuery({ queryKey: ['rbac', 'users', '', 1], queryFn: () => api.rbac.users({}) });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const nameOf = (id: string) => picked[id] ?? everyone.data?.items.find((user) => user.id === id)?.displayName ?? id;
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.rbac.saveGroup({ name: name.trim(), label: toLocalized(label) ?? null, roles: chosen, members }, group?.id),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['rbac'] });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      navigate(`/-/groups/${saved.id}`, { replace: true });
      setError(null);
    },
    onError: (failure) => setError(describeError(failure)),
  });
  const remove = useMutation({
    mutationFn: () => api.rbac.deleteGroup(group!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rbac'] });
      navigate('/-/groups');
    },
    onError: (failure) => setError(describeError(failure)),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!readOnly) save.mutate();
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-5" aria-label={t('rbac.group')}>
      <PageTitle>{group ? textIn(group.label, locale) || group.name : t('rbac.newGroup')}</PageTitle>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="group-name">{t('rbac.name')}</Label>
          <Input id="group-name" dir="ltr" value={name} disabled={readOnly} onChange={(event) => setName(event.target.value)} />
        </div>
        {runtimeConfig.locales.map((code) => (
          <div key={code} className="flex flex-col gap-1.5">
            <Label htmlFor={`group-label-${code}`}>{t('rbac.labelIn', { language: code })}</Label>
            <Input id={`group-label-${code}`} value={label[code] ?? ''} disabled={readOnly} onChange={(event) => setLabel({ ...label, [code]: event.target.value })} />
          </div>
        ))}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t('rbac.roles')}</legend>
        {roles.map((role) => (
          <label key={role.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={chosen.includes(role.name)}
              disabled={readOnly}
              onChange={(event) => setChosen(event.target.checked ? [...chosen, role.name] : chosen.filter((item) => item !== role.name))}
            />
            {textIn(role.label, locale) || role.name}
          </label>
        ))}
      </fieldset>
      <section aria-labelledby="members-title" className="flex flex-col gap-2">
        <h2 id="members-title" className="font-medium">
          {t('rbac.members')}
        </h2>
        <ul aria-label={t('rbac.members')} className="flex flex-wrap gap-2">
          {members.map((member) => (
            <li key={member} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm">
              {nameOf(member)}
              {!readOnly && (
                <button type="button" aria-label={t('picker.remove', { name: nameOf(member) })} onClick={() => setMembers(members.filter((item) => item !== member))}>
                  <X className="size-3.5" />
                </button>
              )}
            </li>
          ))}
          {members.length === 0 && <li className="text-sm text-muted-foreground">{t('rbac.noMembers')}</li>}
        </ul>
        {!readOnly && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="member-search">{t('rbac.addMember')}</Label>
            <Input id="member-search" value={search} placeholder={t('rbac.searchUsers')} onChange={(event) => setSearch(event.target.value)} />
            <ul aria-label={t('rbac.searchResults')} className="flex flex-wrap gap-2">
              {(found.data?.items ?? [])
                .filter((user) => !members.includes(user.id))
                .map((user) => (
                  <li key={user.id}>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPicked({ ...picked, [user.id]: user.displayName });
                        setMembers([...members, user.id]);
                      }}
                    >
                      <Plus />
                      {user.displayName}
                      {user.username ? ` (${user.username})` : ''}
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || !name.trim()}>
            {t(save.isPending ? 'form.saving' : 'form.save')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/-/groups')}>
            {t('common.cancel')}
          </Button>
          {group && (
            <Button type="button" variant="outline" className="ms-auto" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('form.delete')}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
