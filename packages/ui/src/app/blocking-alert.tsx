import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OVERLAY_ANIMATED_CLASS } from '@/components/ui/overlay';
import { cn } from '@/lib/utils';
import { nextFocusIndex } from '@/lib/focus-trap';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface BlockingAlertProps {
  /** Id of the element that holds the alert's text. */
  labelledBy: string;
  describedBy?: string;
  /** Escape and a click on the backdrop; leave it out for an alert that must be answered with a button. */
  onDismiss?: () => void;
  /** Where focus lands (default: the first button). */
  initialFocus?: string;
  className?: string;
  children: ReactNode;
}

/**
 * An alert that blocks the next step: the app behind it is dimmed and blurred, focus stays between its buttons,
 * the page does not scroll, and Escape / the backdrop answer the safe way (`onDismiss`).
 */
export function BlockingAlert({ labelledBy, describedBy, onDismiss, initialFocus, className, children }: BlockingAlertProps) {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = (initialFocus ? panel.current?.querySelector<HTMLElement>(initialFocus) : null) ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismiss.current) {
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
      } else if (event.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        event.preventDefault();
        items[nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)]?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      if (before?.isConnected) before.focus();
    };
  }, [initialFocus]);

  return createPortal(
    <>
      <div data-testid="alert-backdrop" aria-hidden className={OVERLAY_ANIMATED_CLASS} onClick={() => dismiss.current?.()} />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={cn(
          'fixed inset-x-3 top-[12vh] z-50 mx-auto max-h-[76vh] max-w-lg overflow-y-auto rounded-card border border-amber-500/50 bg-background p-4 shadow-xl motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-150',
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
