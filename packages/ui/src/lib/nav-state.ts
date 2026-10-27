import { useSyncExternalStore } from 'react';

/** What the sidebar remembers in this browser: pinned resources, recent ones, collapsed groups, the icon-only rail. */
export interface NavState {
  pinned: string[];
  recent: string[];
  collapsedGroups: string[];
  /** Sections opened although they start collapsed (a curated menu's, «advanced»). */
  expandedGroups: string[];
  railCollapsed: boolean;
}

const STORAGE_KEY = 'nma.nav';
export const MAX_RECENT = 5;
const EMPTY: NavState = { pinned: [], recent: [], collapsedGroups: [], expandedGroups: [], railCollapsed: false };

/** localStorage when it works, memory when it does not (private mode, blocked storage). */
export function createNavStore(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined) {
  let state: NavState = EMPTY;
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved) state = { ...EMPTY, ...(JSON.parse(saved) as Partial<NavState>) };
  } catch {
    state = EMPTY;
  }
  const listeners = new Set<() => void>();
  const set = (next: NavState) => {
    state = next;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // kept in memory for this visit
    }
    for (const listener of listeners) listener();
  };
  const toggle = (list: string[], item: string) => (list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]);
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    togglePin: (resource: string) => set({ ...state, pinned: toggle(state.pinned, resource) }),
    visit: (resource: string) => {
      if (state.recent[0] === resource) return;
      set({ ...state, recent: [resource, ...state.recent.filter((entry) => entry !== resource)].slice(0, MAX_RECENT) });
    },
    /** Opens or closes a section; `byDefault` is whether it starts collapsed (see `sectionCollapsed`). */
    toggleGroup: (group: string, byDefault = false) => {
      const collapsed = sectionCollapsed(state, group, byDefault);
      const without = (list: string[]) => list.filter((entry) => entry !== group);
      set({ ...state, collapsedGroups: collapsed ? without(state.collapsedGroups) : [...without(state.collapsedGroups), group], expandedGroups: collapsed ? [...without(state.expandedGroups), group] : without(state.expandedGroups) });
    },
    toggleRail: () => set({ ...state, railCollapsed: !state.railCollapsed }),
  };
}

export type NavStore = ReturnType<typeof createNavStore>;

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const navStore = createNavStore(browserStorage());

export function useNavState(): NavState {
  return useSyncExternalStore(navStore.subscribe, navStore.get);
}

/** Keeps only resources that still exist (a pinned resource may have been removed from the admin). */
export function known(names: string[], resources: Set<string>): string[] {
  return names.filter((name) => resources.has(name));
}

/** Whether a section is collapsed: the person's last choice for it, else `byDefault`. */
export function sectionCollapsed(state: NavState, key: string, byDefault: boolean): boolean {
  if (state.collapsedGroups.includes(key)) return true;
  if (state.expandedGroups.includes(key)) return false;
  return byDefault;
}
