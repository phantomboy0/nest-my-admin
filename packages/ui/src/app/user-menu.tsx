import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, UserRound } from 'lucide-react';
import { Popover } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/i18n';
import { api } from '@/lib/api';
import { useSession } from '@/lib/queries';
import { setCsrfToken, setViewingAs } from '@/lib/session';

/** The signed-in user: name, the account page and sign-out. Hidden for an admin without sign-in. */
export function UserMenu() {
  const { t } = useLocale();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const data = session.data;
  if (!data || data.open) return null;
  const { user, auth } = data;
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0]!.toUpperCase())
    .join('');

  async function logout() {
    try {
      await api.logout();
    } finally {
      setCsrfToken(undefined);
      setViewingAs(undefined);
      queryClient.clear();
      navigate('/login', { replace: true });
    }
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="outline" size="icon-sm" className="rounded-full text-xs font-semibold" aria-label={t('auth.userMenu', { name: user.displayName })}>
          {initials || <UserRound />}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 flex w-60 flex-col gap-1 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="border-b px-2 py-2">
            <div className="truncate text-sm font-medium">{user.displayName}</div>
            {(user.username || user.email) && <div className="truncate text-xs text-muted-foreground">{user.email ?? user.username}</div>}
          </div>
          {(auth.password || auth.sessions || auth.twoFactor) && !data.viewAs && (
            <Popover.Close asChild>
              <Link to="/account" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                <UserRound className="size-4" />
                {t('auth.account')}
              </Link>
            </Popover.Close>
          )}
          {auth.logout && (
            <button type="button" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent" onClick={() => void logout()}>
              <LogOut className="size-4 rtl:-scale-x-100" />
              {t('auth.signOut')}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
