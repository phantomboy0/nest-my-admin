import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router';
import type { AccountSession } from '@nest-my-admin/core/contract';
import { PageMessage } from '@/components/page-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime, useLocale } from '@/i18n';
import { ApiError, api, describeError } from '@/lib/api';
import { useSession } from '@/lib/queries';
import { QrCode } from '@/app/qr-code';

/** The signed-in user's own settings (spec §7): password and signed-in devices. */
export function AccountPage() {
  const { t } = useLocale();
  const session = useSession();
  if (session.isPending) return <PageMessage>{t('common.loading')}</PageMessage>;
  if (!session.data) return null;
  // The account belongs to the superuser, not to the user being viewed as.
  if (session.data.viewAs) return <Navigate to="/" replace />;
  const { user, auth } = session.data;
  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">{t('auth.account')}</h1>
        <p className="text-sm text-muted-foreground">
          {user.displayName}
          {user.username ? ` · ${user.username}` : ''}
        </p>
      </div>
      {auth.password && <PasswordForm />}
      {auth.twoFactor && <TwoFactor />}
      {auth.sessions && <Sessions revokeOthers={auth.revokeOthers} />}
    </div>
  );
}

function PasswordForm() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: async () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setErrors({});
      setDone(true);
      await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
    },
    onError: (error) => setErrors(error instanceof ApiError && Object.keys(error.fields).length > 0 ? error.fields : { form: [describeError(error)] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    const problems: Record<string, string[]> = {};
    if (!current) problems.current = [t('validation.required')];
    if (!next) problems.next = [t('validation.required')];
    else if (next !== confirm) problems.confirm = [t('auth.mismatch')];
    setErrors(problems);
    if (Object.keys(problems).length === 0) change.mutate();
  }

  const field = (id: 'current' | 'next' | 'confirm', label: string, value: string, set: (value: string) => void, autoComplete: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`password-${id}`}>{label}</Label>
      <Input
        id={`password-${id}`}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => set(event.target.value)}
        aria-invalid={errors[id] ? true : undefined}
        aria-describedby={errors[id] ? `password-${id}-error` : undefined}
      />
      {errors[id] && (
        <p id={`password-${id}-error`} className="text-sm text-destructive">
          {errors[id]!.join(' ')}
        </p>
      )}
    </div>
  );

  return (
    <section aria-labelledby="password-title" className="flex flex-col gap-4 rounded-lg border p-4">
      <h2 id="password-title" className="font-medium">
        {t('auth.changePassword')}
      </h2>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form.join(' ')}
          </p>
        )}
        {done && (
          <p role="status" className="rounded-md border border-green-600/30 bg-green-500/10 px-3 py-2 text-sm">
            {t('auth.passwordChanged')}
          </p>
        )}
        {field('current', t('auth.currentPassword'), current, setCurrent, 'current-password')}
        {field('next', t('auth.newPassword'), next, setNext, 'new-password')}
        {field('confirm', t('auth.confirmPassword'), confirm, setConfirm, 'new-password')}
        <div>
          <Button type="submit" disabled={change.isPending}>
            {t('auth.changePassword')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Two-factor sign-in (spec §7): set up with an authenticator app, recovery codes, turn off with the password. */
function TwoFactor() {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['account-2fa'], queryFn: api.twoFactor.status });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (failure: Error) => setError(failure instanceof ApiError && Object.keys(failure.fields).length > 0 ? Object.values(failure.fields).flat().join(' ') : describeError(failure));
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['account-2fa'] });
    await queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
  };
  const setup = useMutation({ mutationFn: api.twoFactor.setup, onMutate: () => setError(null), onError: fail });
  const confirm = useMutation({
    mutationFn: () => api.twoFactor.confirm(code.trim()),
    onMutate: () => setError(null),
    onSuccess: async (result) => {
      setCodes(result.recoveryCodes);
      setCode('');
      setup.reset();
      setNotice(t('twoFactor.enabledNote'));
      await refresh();
    },
    onError: fail,
  });
  const newCodes = useMutation({
    mutationFn: () => api.twoFactor.recoveryCodes(password),
    onMutate: () => setError(null),
    onSuccess: async (result) => {
      setCodes(result.recoveryCodes);
      setPassword('');
      await refresh();
    },
    onError: fail,
  });
  const disable = useMutation({
    mutationFn: () => api.twoFactor.disable(password),
    onMutate: () => setError(null),
    onSuccess: async () => {
      setPassword('');
      setCodes(null);
      setNotice(t('twoFactor.disabledNote'));
      await refresh();
    },
    onError: fail,
  });
  const enabled = status.data?.enabled === true;
  const pending = setup.data;

  return (
    <section aria-labelledby="two-factor-title" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="two-factor-title" className="font-medium">
          {t('twoFactor.title')}
        </h2>
        {status.data && (
          <span className={enabled ? 'rounded-full bg-green-500/15 px-2 py-0.5 text-xs text-green-800 dark:text-green-300' : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'}>
            {t(enabled ? 'twoFactor.on' : 'twoFactor.off')}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="rounded-md border border-green-600/30 bg-green-500/10 px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {codes && (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3">
          <h3 className="text-sm font-medium">{t('twoFactor.recoveryTitle')}</h3>
          <p className="text-sm text-muted-foreground">{t('twoFactor.recoveryIntro')}</p>
          <ul aria-label={t('twoFactor.recoveryTitle')} dir="ltr" className="grid grid-cols-2 gap-1 font-mono text-sm">
            {codes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true), () => undefined);
              }}
            >
              {t(copied ? 'twoFactor.copied' : 'twoFactor.copy')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setCodes(null);
                setCopied(false);
              }}
            >
              {t('twoFactor.done')}
            </Button>
          </div>
        </div>
      )}
      {status.data && !enabled && !pending && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">{t('twoFactor.intro')}</p>
          <Button type="button" variant="outline" disabled={setup.isPending} onClick={() => setup.mutate()}>
            {t('twoFactor.setUp')}
          </Button>
        </div>
      )}
      {!enabled && pending && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (code.trim()) confirm.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">{t('twoFactor.scan')}</p>
          <div className="flex flex-wrap items-start gap-4">
            <QrCode text={pending.otpauthUrl} label={t('twoFactor.qr')} />
            <div className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t('twoFactor.key')}</span>
              <code dir="ltr" data-testid="two-factor-key" className="break-all font-mono">
                {pending.secret.match(/.{1,4}/g)!.join(' ')}
              </code>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="two-factor-code">{t('twoFactor.code')}</Label>
              <Input id="two-factor-code" autoComplete="one-time-code" inputMode="numeric" dir="ltr" maxLength={10} value={code} onChange={(event) => setCode(event.target.value)} />
            </div>
            <Button type="submit" disabled={confirm.isPending || !code.trim()}>
              {t('twoFactor.turnOn')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setup.reset()}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}
      {enabled && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('twoFactor.left', { count: status.data!.recoveryCodesLeft })}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="two-factor-password">{t('twoFactor.password')}</Label>
              <Input id="two-factor-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <Button type="button" variant="outline" disabled={!password || newCodes.isPending} onClick={() => newCodes.mutate()}>
              {t('twoFactor.newCodes')}
            </Button>
            <Button type="button" variant="destructive" disabled={!password || disable.isPending} onClick={() => disable.mutate()}>
              {t('twoFactor.turnOff')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/** "Chrome on macOS" from a user agent, roughly; the raw string stays in the title. */
function describeAgent(agent: string | undefined, unknown: string): string {
  if (!agent) return unknown;
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : undefined;
  const os = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Mac OS X/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : undefined;
  return [browser, os].filter(Boolean).join(' · ') || agent.slice(0, 40);
}

function Sessions({ revokeOthers }: { revokeOthers: boolean }) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ['account-sessions'], queryFn: api.sessions });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['account-sessions'] });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeSession(id), onSuccess: refresh });
  const revokeAll = useMutation({ mutationFn: () => api.revokeOtherSessions(), onSuccess: refresh });
  const items: AccountSession[] = sessions.data?.items ?? [];
  const error = revoke.error ?? revokeAll.error ?? sessions.error;
  return (
    <section aria-labelledby="sessions-title" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sessions-title" className="font-medium">
          {t('auth.sessions')}
        </h2>
        {revokeOthers && items.length > 1 && (
          <Button variant="outline" size="sm" disabled={revokeAll.isPending} onClick={() => revokeAll.mutate()}>
            {t('auth.signOutOthers')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {describeError(error)}
        </p>
      )}
      <ul aria-label={t('auth.sessions')} className="flex flex-col divide-y">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-2 font-medium" title={item.userAgent}>
                {describeAgent(item.userAgent, t('auth.unknownDevice'))}
                {item.current && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t('auth.thisDevice')}</span>}
              </span>
              <span className="text-muted-foreground">
                {t('auth.lastSeen', { when: formatDateTime(new Date(item.lastSeenAt)) })}
                {item.ip ? ` · ${item.ip}` : ''}
              </span>
            </div>
            {!item.current && (
              <Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(item.id)} aria-label={t('auth.revokeSession', { name: describeAgent(item.userAgent, t('auth.unknownDevice')) })}>
                {t('auth.revoke')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
