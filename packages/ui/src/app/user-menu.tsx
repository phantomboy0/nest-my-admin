import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { EllipsisVertical, History, LogOut, UserRound } from 'lucide-react';
import { Popover } from 'radix-ui';
import { DisplayMenuItems, LocaleSwitch, ThemeSwitch } from '@/app/preferences';
import { useLocale } from '@/i18n';
import { api } from '@/lib/api';
import { useSession } from '@/lib/queries';
import { setCsrfToken, setViewingAs } from '@/lib/session';
import { cn } from '@/lib/utils';

/**
 * The signed-in user at the bottom of the sidebar (the design's user block): initials, name and username, and a menu
 * with the account page, the audit log, language, display and theme preferences, and sign-out. Without sign-in it
 * still offers the preferences.
 */
export function UserBlock({ rail = false }: { rail?: boolean }) {
  const { t } = useLocale();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const data = session.data;
  if (!data) return null;
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
        <button
          type="button"
          aria-label={t('auth.userMenu', { name: user.displayName })}
          data-user-block=""
          className={cn('flex cursor-pointer items-center gap-2.5 rounded-control text-start hover:bg-muted', rail ? 'size-10 justify-center' : 'px-2.5 py-2')}
        >
          <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold">
            {initials || <UserRound className="size-4" />}
          </span>
          {!rail && (
            <>
              <span className="min-w-0 flex-1 leading-[1.35]">
                <span className="block truncate text-[13px] font-medium">{user.displayName}</span>
                {(user.username || user.email) && <span className="block truncate text-[11.5px] text-muted-foreground">{user.email ?? user.username}</span>}
              </span>
              <EllipsisVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={6} className="z-50 flex w-64 flex-col gap-1 rounded-[10px] border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,.12)]">
          {(auth.password || auth.sessions || auth.twoFactor) && !data.viewAs && (
            <Popover.Close asChild>
              <Link to="/account" className="flex h-[34px] items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-muted">
                <UserRound className="size-4" />
                {t('auth.account')}
              </Link>
            </Popover.Close>
          )}
          {data.audit.view && (
            <Popover.Close asChild>
              <Link to="/-/audit" className="flex h-[34px] items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-muted">
                <History className="size-4" />
                {t('audit.title')}
              </Link>
            </Popover.Close>
          )}
          <div className="flex flex-col gap-2 border-y border-border px-2 py-2">
            <LocaleSwitch />
            <DisplayMenuItems />
            <ThemeSwitch />
          </div>
          {auth.logout && !data.open && (
            <button type="button" className="flex h-[34px] items-center gap-2.5 rounded-md px-2 text-start text-[13px] hover:bg-muted" onClick={() => void logout()}>
              <LogOut className="size-4 rtl:-scale-x-100" />
              {t('auth.signOut')}
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
