import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Plus } from 'lucide-react';
import type { RbacGroup, RbacRole, RbacUser } from '@nest-my-admin/core/contract';
import { Alert, PageTitle, textIn } from '@/app/admin/shared';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/i18n';
import { ApiError, api, describeError } from '@/lib/api';
import { useSession } from '@/lib/queries';
import { setViewingAs } from '@/lib/session';

export function UsersPage() {
  const { t } = useLocale();
  const session = useSession();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [draft, setDraft] = useState(search);
  const users = useQuery({ queryKey: ['rbac', 'users', search, page], queryFn: () => api.rbac.users({ search, page }) });
  if (users.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (users.isError) return <PageMessage tone="error">{describeError(users.error)}</PageMessage>;
  const { items, total, pageSize, capabilities } = users.data;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageTitle
        actions={
          session.data?.rbac.manage &&
          capabilities.create && (
            <Button asChild>
              <Link to="/-/users/new">
                <Plus />
                {t('rbac.newUser')}
              </Link>
            </Button>
          )
        }
      >
        {t('rbac.users')}
      </PageTitle>
      {!capabilities.list && <p className="text-sm text-muted-foreground">{t('rbac.usersFromMemberships')}</p>}
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setParams(draft.trim() ? { search: draft.trim() } : {});
        }}
      >
        <Input aria-label={t('rbac.searchUsers')} placeholder={t('rbac.searchUsers')} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Button type="submit" variant="outline">
          {t('filters.search')}
        </Button>
      </form>
      <ul aria-label={t('rbac.users')} className="flex flex-col divide-y rounded-lg border">
        {items.map((user) => (
          <li key={user.id}>
            <Link to={`/-/users/${encodeURIComponent(user.id)}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted/50">
              <span className="flex flex-col">
                <span className="font-medium">{user.displayName}</span>
                <span className="text-xs text-muted-foreground">{[user.username, user.email].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs">
                {user.isSuperuser && <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-purple-800 dark:text-purple-300">{t('rbac.superuser')}</span>}
                {user.isActive === false && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{t('rbac.inactive')}</span>}
                {user.twoFactor && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-800 dark:text-green-300">{t('rbac.twoFactor')}</span>}
                {user.roles.map((role) => (
                  <span key={role} className="rounded-full border px-2 py-0.5">
                    {role}
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">{t('list.noMatches')}</li>}
      </ul>
      {total > pageSize && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setParams({ ...(search ? { search } : {}), page: String(page - 1) })}>
            {t('list.previousPage')}
          </Button>
          <span>{t('list.pageOf', { page, pages: Math.ceil(total / pageSize) })}</span>
          <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setParams({ ...(search ? { search } : {}), page: String(page + 1) })}>
            {t('list.nextPage')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function UserEditorPage() {
  const { t } = useLocale();
  const { id } = useParams();
  const isNew = id === undefined;
  const roles = useQuery({ queryKey: ['rbac', 'roles'], queryFn: api.rbac.roles });
  const groups = useQuery({ queryKey: ['rbac', 'groups'], queryFn: api.rbac.groups });
  const user = useQuery({ queryKey: ['rbac', 'user', id], queryFn: () => api.rbac.user(id!), enabled: !isNew });
  const listing = useQuery({ queryKey: ['rbac', 'users', '', 1], queryFn: () => api.rbac.users({}) });
  if (roles.isPending || groups.isPending || listing.isPending || (!isNew && user.isPending)) return <PageMessage>{t('common.loading')}</PageMessage>;
  const failed = roles.error ?? groups.error ?? listing.error ?? (isNew ? null : user.error);
  if (failed) return <PageMessage tone="error">{describeError(failed)}</PageMessage>;
  return <UserEditor key={id ?? 'new'} user={isNew ? undefined : user.data} roles={roles.data!.items} groups={groups.data!.items} capabilities={listing.data!.capabilities} />;
}

function UserEditor({ user, roles, groups, capabilities }: { user?: RbacUser; roles: RbacRole[]; groups: RbacGroup[]; capabilities: { create: boolean; update: boolean; password: boolean; resetTwoFactor: boolean } }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession();
  const manage = session.data?.rbac.manage === true;
  const isSuperuser = session.data?.user.isSuperuser === true;
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [active, setActive] = useState(user?.isActive !== false);
  const [superuser, setSuperuser] = useState(user?.isSuperuser === true);
  const [chosenRoles, setChosenRoles] = useState<string[]>(user?.roles ?? []);
  const [chosenGroups, setChosenGroups] = useState<number[]>(user?.groups ?? []);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editable = manage && (!user?.isSuperuser || isSuperuser);

  const fail = (failure: Error) => {
    if (failure instanceof ApiError && Object.keys(failure.fields).length > 0) {
      setErrors(failure.fields);
      setError(failure.message);
    } else {
      setErrors({});
      setError(describeError(failure));
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const profile = capabilities.update || !user ? { displayName, email: email || null, isActive: active, ...(isSuperuser ? { isSuperuser: superuser } : {}) } : {};
      if (!user) return api.rbac.createUser({ username, displayName, email: email || null, password, ...(isSuperuser ? { isSuperuser: superuser } : {}), roles: chosenRoles, groups: chosenGroups });
      return api.rbac.updateUser(user.id, { ...profile, roles: chosenRoles, groups: chosenGroups });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['rbac'] });
      setErrors({});
      setError(null);
      setNotice(t('rbac.saved'));
      navigate(`/-/users/${encodeURIComponent(saved.id)}`, { replace: true });
    },
    onError: fail,
  });
  const resetTwoFactor = useMutation({
    mutationFn: () => api.rbac.resetTwoFactor(user!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rbac'] });
      setError(null);
      setNotice(t('rbac.twoFactorReset'));
    },
    onError: fail,
  });
  // Superusers can look at the admin as this user sees it (read-only), never as themselves.
  const canViewAs = Boolean(user) && isSuperuser && !session.data?.viewAs && user!.id !== session.data?.user.id && user!.isActive !== false;
  const setNewPassword = useMutation({
    mutationFn: () => api.rbac.setPassword(user!.id, password),
    onSuccess: () => {
      setPassword('');
      setErrors({});
      setError(null);
      setNotice(t('rbac.passwordSet'));
    },
    onError: fail,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (editable) save.mutate();
  }

  const text = (id: string, label: string, value: string, set: (value: string) => void, extra: Partial<React.ComponentProps<'input'>> = {}) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} disabled={!editable || (Boolean(user) && !capabilities.update)} onChange={(event) => set(event.target.value)} aria-invalid={errors[id.replace('user-', '')] ? true : undefined} {...extra} />
      {errors[id.replace('user-', '')] && <p className="text-sm text-destructive">{errors[id.replace('user-', '')]!.join(' ')}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-5" aria-label={t('rbac.user')}>
      <PageTitle
        actions={
          canViewAs && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setViewingAs(user!.id);
                queryClient.clear();
                navigate('/');
              }}
            >
              <Eye />
              {t('viewAs.start')}
            </Button>
          )
        }
      >
        {user ? user.displayName : t('rbac.newUser')}
      </PageTitle>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {user?.isSuperuser && !isSuperuser && <Alert tone="success">{t('rbac.superuserNote')}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {!user && text('user-username', t('auth.username'), username, setUsername, { dir: 'ltr', autoComplete: 'off' })}
        {text('user-displayName', t('rbac.displayName'), displayName, setDisplayName)}
        {text('user-email', t('rbac.email'), email, setEmail, { type: 'email', dir: 'ltr' })}
        {!user && text('user-password', t('auth.password'), password, setPassword, { type: 'password', autoComplete: 'new-password' })}
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-primary" checked={active} disabled={!editable || (Boolean(user) && !capabilities.update)} onChange={(event) => setActive(event.target.checked)} />
          {t('rbac.active')}
        </label>
        {isSuperuser && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-primary" checked={superuser} disabled={!editable} onChange={(event) => setSuperuser(event.target.checked)} />
            {t('rbac.superuser')}
          </label>
        )}
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">{t('rbac.roles')}</legend>
        {roles.map((role) => (
          <label key={role.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={chosenRoles.includes(role.name)}
              disabled={!editable}
              onChange={(event) => setChosenRoles(event.target.checked ? [...chosenRoles, role.name] : chosenRoles.filter((item) => item !== role.name))}
            />
            {textIn(role.label, locale) || role.name}
          </label>
        ))}
      </fieldset>
      {groups.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t('rbac.groups')}</legend>
          {groups.map((group) => (
            <label key={group.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={chosenGroups.includes(group.id)}
                disabled={!editable}
                onChange={(event) => setChosenGroups(event.target.checked ? [...chosenGroups, group.id] : chosenGroups.filter((item) => item !== group.id))}
              />
              {textIn(group.label, locale) || group.name}
            </label>
          ))}
        </fieldset>
      )}
      {editable && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {t(save.isPending ? 'form.saving' : user ? 'form.save' : 'rbac.createUser')}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate('/-/users')}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {user && editable && capabilities.password && (
        <section aria-labelledby="set-password" className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 id="set-password" className="font-medium">
            {t('rbac.setPassword')}
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="user-new-password">{t('auth.newPassword')}</Label>
              <Input id="user-new-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <Button type="button" variant="outline" disabled={!password || setNewPassword.isPending} onClick={() => setNewPassword.mutate()}>
              {t('rbac.setPassword')}
            </Button>
          </div>
          {errors.password && user && <p className="text-sm text-destructive">{errors.password.join(' ')}</p>}
          <p className="text-xs text-muted-foreground">{t('rbac.setPasswordNote')}</p>
        </section>
      )}
      {user?.twoFactor && editable && capabilities.resetTwoFactor && (
        <section aria-labelledby="reset-two-factor" className="flex flex-col gap-2 rounded-lg border p-4">
          <h2 id="reset-two-factor" className="font-medium">
            {t('rbac.resetTwoFactor')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('rbac.resetTwoFactorNote')}</p>
          <div>
            <Button type="button" variant="outline" disabled={resetTwoFactor.isPending} onClick={() => resetTwoFactor.mutate()}>
              {t('rbac.resetTwoFactor')}
            </Button>
          </div>
        </section>
      )}
    </form>
  );
}
