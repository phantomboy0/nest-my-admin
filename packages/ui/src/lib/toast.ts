import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
  tone: 'success' | 'error';
}

/** How long a toast stays: errors longer, since they are read, not glanced at. */
const LIFETIME = { success: 5_000, error: 10_000 } as const;
/** More than this at once is noise: the oldest go first. */
const MAX_SHOWN = 4;

type Timers = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>;

/** Short messages shown over the page for a few seconds (the result of an action). Plain state, no React inside. */
export function createToastStore(timers: Timers = globalThis) {
  let toasts: Toast[] = [];
  let nextId = 1;
  const pending = new Map<number, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  const set = (next: Toast[]) => {
    toasts = next;
    for (const listener of listeners) listener();
  };
  const dismiss = (id: number) => {
    const timer = pending.get(id);
    if (timer !== undefined) timers.clearTimeout(timer);
    pending.delete(id);
    if (toasts.some((toast) => toast.id === id)) set(toasts.filter((toast) => toast.id !== id));
  };
  return {
    get: () => toasts,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show(message: string, tone: Toast['tone'] = 'success'): number {
      const id = nextId++;
      const next = [...toasts, { id, message, tone }];
      for (const dropped of next.slice(0, Math.max(0, next.length - MAX_SHOWN))) dismiss(dropped.id);
      set([...toasts, { id, message, tone }]);
      pending.set(id, timers.setTimeout(() => dismiss(id), LIFETIME[tone]));
      return id;
    },
    dismiss,
  };
}

export const toastStore = createToastStore();

/** Shows `message` for a few seconds. */
export const toast = (message: string, tone: Toast['tone'] = 'success'): number => toastStore.show(message, tone);

export function useToasts(): Toast[] {
  return useSyncExternalStore(toastStore.subscribe, toastStore.get);
}
