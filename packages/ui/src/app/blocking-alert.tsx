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
  /** Selector of the element that gets focus first (default: the first button); pick the safe choice. */
  initialFocus?: string;
  className?: string;
  children: ReactNode;
}

/** The alerts on screen, the last one on top. Only the top one takes Tab and Escape; the page is locked while any is open. */
const stack: symbol[] = [];
let restore: (() => void) | null = null;

function lockPage() {
  const root = document.getElementById('root');
  const html = document.documentElement;
  const before = { overflow: document.body.style.overflow, gutter: html.style.scrollbarGutter, inert: root?.hasAttribute('inert') ?? false };
  document.body.style.overflow = 'hidden';
  html.style.scrollbarGutter = 'stable'; // the scrollbar's room stays, so the page does not jump sideways
  root?.setAttribute('inert', '');
  restore = () => {
    document.body.style.overflow = before.overflow;
    html.style.scrollbarGutter = before.gutter;
    if (!before.inert) root?.removeAttribute('inert');
  };
}

/**
 * An alert that blocks the next step: the app behind it is dimmed, blurred and inert, focus stays between its buttons,
 * the page does not scroll, and Escape / the backdrop answer the safe way (`onDismiss`). Alerts may stack.
 * Do not open one over a modal Radix dialog (that dialog's own focus trap would fight this one).
 */
export function BlockingAlert({ labelledBy, describedBy, onDismiss, initialFocus, className, children }: BlockingAlertProps) {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const id = Symbol('alert');
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (stack.length === 0) lockPage();
    stack.push(id);
    const target = (initialFocus ? panel.current?.querySelector<HTMLElement>(initialFocus) : null) ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current;
    target?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || !panel.current) return;
      if (event.key === 'Escape' && dismiss.current) {
        event.preventDefault();
        event.stopPropagation();
        dismiss.current();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const next = items[nextFocusIndex(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey)];
        (next ?? panel.current).focus(); // nothing focusable (a disabled button lost focus): the panel itself
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      stack.splice(stack.indexOf(id), 1);
      if (stack.length === 0) {
        restore?.();
        restore = null;
      }
      if (before?.isConnected && stack.length === 0) before.focus();
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
        data-state="open"
        tabIndex={-1}
        className={cn(
          'fixed inset-x-3 top-[12vh] z-50 mx-auto max-h-[76vh] max-w-lg overflow-y-auto rounded-card border border-amber-500/50 bg-background p-4 shadow-xl outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-2 motion-safe:duration-150',
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
