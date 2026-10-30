import { useEffect, useRef, useState, type RefObject, type ReactNode } from 'react';
import { useBlocker, type Blocker } from 'react-router';
import { BlockingAlert } from '@/app/blocking-alert';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';

/**
 * Unsaved changes: in-app navigation asks first (render `LeaveBar` with the blocker), closing the tab asks through
 * the browser. Call `release()` before navigating away on purpose (after a save or a delete).
 */
export function useUnsavedGuard(dirty: boolean): { blocker: Blocker; release: () => void } {
  const released = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !released.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return {
    blocker,
    release: () => {
      released.current = true;
    },
  };
}

/** "Leave without saving?" for a blocked navigation: a blocking alert, where Escape and the backdrop mean stay. */
export function LeaveBar({ blocker }: { blocker: Blocker }) {
  const t = useT();
  if (blocker.state !== 'blocked') return null;
  return (
    <BlockingAlert labelledBy="leave-title" onDismiss={() => blocker.reset()} className="flex flex-wrap items-center gap-2">
      <p id="leave-title" className="min-w-0 flex-1 basis-full text-sm font-medium sm:basis-0">
        {t('form.leaveTitle')}
      </p>
      <Button type="button" variant="outline" onClick={() => blocker.reset()}>
        {t('form.stay')}
      </Button>
      <Button type="button" variant="destructive" onClick={() => blocker.proceed()}>
        {t('form.leave')}
      </Button>
    </BlockingAlert>
  );
}

/**
 * ⌘S / Ctrl+S submits the form (after `before`, which says how this submit differs from a button's). While a modal
 * dialog is open over the form it does nothing (the browser's own "save page" stays suppressed).
 */
export function useSaveShortcut(form: RefObject<HTMLFormElement | null>, before?: () => void): void {
  const prepare = useRef(before);
  prepare.current = before;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      // A modal dialog over the form (an action's dialog over the record): the shortcut is not for the page beneath.
      const modal = document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
      if (modal && !modal.contains(form.current)) return;
      prepare.current?.();
      form.current?.requestSubmit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [form]);
}

/**
 * The fields with uploads on their way: saving now would leave those files out. `refuse()` is for a save asked for
 * meanwhile (⌘S; the buttons are disabled): `onDone` runs once the uploads have finished, to take the message back.
 */
export function useUploadGate(onDone: () => void): { busy: boolean; setBusy: (name: string, busy: boolean) => void; refuse: () => void } {
  const [uploading, setUploading] = useState<string[]>([]);
  const [waited, setWaited] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (uploading.length > 0 || !waited) return;
    setWaited(false);
    done.current();
  }, [uploading.length, waited]);
  return {
    busy: uploading.length > 0,
    setBusy: (name, busy) => setUploading((names) => (busy === names.includes(name) ? names : busy ? [...names, name] : names.filter((other) => other !== name))),
    refuse: () => setWaited(true),
  };
}

/**
 * The design's save bar: a card stuck to the bottom of the form, saying so when there are unsaved changes,
 * with the form's buttons at the end (the primary one last).
 */
export function SaveBar({ dirty, children }: { dirty: boolean; children: ReactNode }) {
  const t = useT();
  return (
    <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-card border bg-card px-4 py-2.5 shadow-[0_12px_32px_rgba(0,0,0,.12)]">
      {dirty && (
        <p role="status" className="flex items-center gap-2 text-[13px] font-semibold">
          <span aria-hidden className="size-2 rounded-full bg-amber-500" />
          {t('form.unsaved')}
        </p>
      )}
      <div className="ms-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** ⌘S / Ctrl+S as a key hint inside a button. */
export function SaveKey() {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <kbd aria-hidden className="rounded border border-current/30 px-1 font-sans text-[10.5px] opacity-80">
      {mac ? '⌘S' : 'Ctrl S'}
    </kbd>
  );
}
