import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LocaleSwitch, ThemeSwitch } from '@/app/preferences';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { runtimeConfig } from '@/lib/config';
import { useSession } from '@/lib/queries';
import { safeNext, setCsrfToken, setViewingAs } from '@/lib/session';

function brandName(locale: string): string {
  const name = runtimeConfig.branding.name;
  if (name === undefined) return runtimeConfig.title;
  if (typeof name === 'string') return name;
  return name[locale] ?? name[runtimeConfig.locale] ?? Object.values(name)[0] ?? runtimeConfig.title;
}

/** Sign-in (spec §7): username and password, then back to where the user was going (`?next=`). */
export function LoginPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const session = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // After a right password for an account with two-factor sign-in: the code (or a recovery code).
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (session.isSuccess) return <Navigate to={next} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError(t('auth.required'));
      return;
    }
    if (step === 'otp' && !otp.trim()) {
      setError(t('auth.otpRequired'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const signedIn = await api.login(username.trim(), password, step === 'otp' ? otp.trim() : undefined);
      setCsrfToken(signedIn.csrfToken);
      setViewingAs(undefined);
      // Nothing cached from before the sign-in (another user, or nobody) is shown to this user.
      queryClient.clear();
      queryClient.setQueryData(['session'], signedIn);
      navigate(next, { replace: true });
    } catch (failure) {
      if (failure instanceof ApiError && failure.body.code === 'TWO_FACTOR_REQUIRED') {
        // The first answer only asks for the code; later ones say it was wrong.
        setError(step === 'otp' ? failure.message : null);
        setStep('otp');
        setOtp('');
        return;
      }
      setStep('password');
      setOtp('');
      setPassword('');
      setError(failure instanceof ApiError && (failure.status === 401 || failure.status === 429 || failure.status === 404) ? failure.message : t('auth.failed'));
    } finally {
      setPending(false);
    }
  }

  const logo = runtimeConfig.branding.logo;
  return (
    <main className="flex min-h-dvh flex-col bg-muted/30">
      <div className="flex justify-end gap-2 p-4">
        <LocaleSwitch />
        <ThemeSwitch />
      </div>
      <div className="flex flex-1 items-start justify-center px-4 pt-[10vh]">
        <form onSubmit={submit} noValidate className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-background p-6 shadow-sm" aria-labelledby="login-title">
          <div className="flex flex-col items-center gap-2 text-center">
            {logo && <img src={logo} alt="" className="size-10 rounded-md object-contain" />}
            <p className="text-sm text-muted-foreground">{brandName(locale)}</p>
            <h1 id="login-title" className="text-xl font-semibold">
              {t(step === 'otp' ? 'auth.otpTitle' : 'auth.title')}
            </h1>
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {step === 'otp' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-otp">{t('auth.otp')}</Label>
              <Input
                id="login-otp"
                autoComplete="one-time-code"
                inputMode="text"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                dir="ltr"
                maxLength={40}
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                aria-describedby="login-otp-help"
              />
              <p id="login-otp-help" className="text-sm text-muted-foreground">
                {t('auth.otpHelp')}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-username">{t('auth.username')}</Label>
                <Input id="login-username" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus value={username} onChange={(event) => setUsername(event.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-password">{t('auth.password')}</Label>
                <Input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </div>
            </>
          )}
          <Button type="submit" disabled={pending}>
            {t(pending ? 'auth.signingIn' : step === 'otp' ? 'auth.verify' : 'auth.signIn')}
          </Button>
          {step === 'otp' && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setStep('password');
                setOtp('');
                setPassword('');
                setError(null);
              }}
            >
              {t('auth.startOver')}
            </Button>
          )}
        </form>
      </div>
    </main>
  );
}
