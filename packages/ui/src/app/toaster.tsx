import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { toastStore, useToasts } from '@/lib/toast';
import { cn } from '@/lib/utils';

/**
 * The toasts on screen (`lib/toast.ts`), in a corner over the page. A live region that is always in the document, so
 * screen readers announce what is added to it; errors are alerts.
 */
export function Toaster() {
  const t = useT();
  const toasts = useToasts();
  return (
    <div role="region" aria-label={t('toast.region')} className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:start-auto sm:w-96">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex w-full items-start gap-2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg',
            toast.tone === 'error' ? 'border-destructive/50' : 'border-green-600/40',
          )}
        >
          <span className={cn('min-w-0 flex-1 break-words', toast.tone === 'error' && 'text-destructive')}>{toast.message}</span>
          <button type="button" className="rounded-md p-0.5 text-muted-foreground hover:text-foreground" aria-label={t('toast.dismiss')} onClick={() => toastStore.dismiss(toast.id)}>
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
