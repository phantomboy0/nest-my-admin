import { describe, expect, test } from 'bun:test';
import { MAX_RECENT, createNavStore, known } from './nav-state';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
};

describe('nav state', () => {
  test('pins toggle and survive a reload', () => {
    const storage = memory();
    const store = createNavStore(storage);
    store.togglePin('order');
    store.togglePin('customer');
    store.togglePin('order');
    expect(store.get().pinned).toEqual(['customer']);
    expect(createNavStore(storage).get().pinned).toEqual(['customer']);
  });

  test('recents: newest first, no duplicates, at most five', () => {
    const store = createNavStore(memory());
    for (const name of ['a', 'b', 'c', 'a', 'd', 'e', 'f', 'g']) store.visit(name);
    expect(store.get().recent).toEqual(['g', 'f', 'e', 'd', 'a']);
    expect(store.get().recent).toHaveLength(MAX_RECENT);
  });

  test('collapsed groups and the rail', () => {
    const store = createNavStore(memory());
    store.toggleGroup('sales');
    store.toggleRail();
    expect(store.get()).toMatchObject({ collapsedGroups: ['sales'], railCollapsed: true });
  });

  test('storage that throws (private mode) falls back to memory', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createNavStore(broken);
    store.togglePin('order');
    expect(store.get().pinned).toEqual(['order']);
    expect(createNavStore(undefined).get().pinned).toEqual([]);
  });

  test('unknown resources are dropped', () => {
    expect(known(['order', 'gone'], new Set(['order']))).toEqual(['order']);
  });
});
