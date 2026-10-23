import { useEffect, useRef, useState, type RefObject } from 'react';
import { useBlocker, type Blocker } from 'react-router';
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

/** The inline "Leave without saving?" bar of a blocked navigation. */
export function LeaveBar({ blocker }: { blocker: Blocker }) {
  const t = useT();
  if (blocker.state !== 'blocked') return null;
  return (
    <div role="alertdialog" aria-labelledby="leave-title" className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-background p-3 shadow-sm">
      <p id="leave-title" className="flex-1 text-sm font-medium">
        {t('form.leaveTitle')}
      </p>
      <Button type="button" variant="outline" autoFocus onClick={() => blocker.reset()}>
        {t('form.stay')}
      </Button>
      <Button type="button" variant="destructive" onClick={() => blocker.proceed()}>
        {t('form.leave')}
      </Button>
    </div>
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
