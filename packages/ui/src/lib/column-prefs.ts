import { useSyncExternalStore } from 'react';

export type Density = 'comfortable' | 'compact';

/** A resource's list columns as someone arranged them (per browser; per user in M3). */
export interface ColumnPrefs {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  density: Density;
}

export const MIN_WIDTH = 60;
export const MAX_WIDTH = 600;
const DEFAULTS: ColumnPrefs = { order: [], hidden: [], widths: {}, density: 'comfortable' };
const keyFor = (resource: string) => `nma.columns.${resource}`;

/**
 * The columns to show, in order: the saved order for columns the schema still has, then new schema columns in schema
 * order, minus hidden ones. Columns the schema dropped disappear quietly.
 */
export function visibleColumns(schemaColumns: string[], prefs: ColumnPrefs): string[] {
  return orderedColumns(schemaColumns, prefs).filter((name) => !prefs.hidden.includes(name));
}

export function orderedColumns(schemaColumns: string[], prefs: ColumnPrefs): string[] {
  const saved = prefs.order.filter((name) => schemaColumns.includes(name));
  return [...saved, ...schemaColumns.filter((name) => !saved.includes(name))];
}

export function createColumnStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined) {
  const cache = new Map<string, ColumnPrefs>();
  const listeners = new Set<() => void>();
  const read = (resource: string): ColumnPrefs => {
    let prefs = cache.get(resource);
    if (!prefs) {
      prefs = DEFAULTS;
      try {
        const saved = storage?.getItem(keyFor(resource));
        if (saved) prefs = { ...DEFAULTS, ...(JSON.parse(saved) as Partial<ColumnPrefs>) };
      } catch {
        prefs = DEFAULTS;
      }
      cache.set(resource, prefs);
    }
    return prefs;
  };
  const write = (resource: string, prefs: ColumnPrefs) => {
    cache.set(resource, prefs);
    try {
      storage?.setItem(keyFor(resource), JSON.stringify(prefs));
    } catch {
      // kept for this visit
    }
    for (const listener of listeners) listener();
  };
  return {
    get: read,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle(resource: string, column: string) {
      const prefs = read(resource);
      const hidden = prefs.hidden.includes(column) ? prefs.hidden.filter((name) => name !== column) : [...prefs.hidden, column];
      write(resource, { ...prefs, hidden });
    },
    /** Moves a column one place (`-1` earlier, `1` later) within the full order. */
    move(resource: string, schemaColumns: string[], column: string, delta: -1 | 1) {
      const prefs = read(resource);
      const order = orderedColumns(schemaColumns, prefs);
      const from = order.indexOf(column);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= order.length) return;
      [order[from], order[to]] = [order[to]!, order[from]!];
      write(resource, { ...prefs, order });
    },
    setWidth(resource: string, column: string, width: number) {
      const prefs = read(resource);
      const clamped = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
      write(resource, { ...prefs, widths: { ...prefs.widths, [column]: clamped } });
    },
    setDensity(resource: string, density: Density) {
      write(resource, { ...read(resource), density });
    },
    reset(resource: string) {
      try {
        storage?.removeItem(keyFor(resource));
      } catch {
        // nothing saved to forget
      }
      cache.set(resource, DEFAULTS);
      for (const listener of listeners) listener();
    },
  };
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const columnStore = createColumnStore(browserStorage());

export function useColumnPrefs(resource: string): ColumnPrefs {
  return useSyncExternalStore(columnStore.subscribe, () => columnStore.get(resource));
}
