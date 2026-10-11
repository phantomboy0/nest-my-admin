import { describe, expect, test } from 'bun:test';
import { createToastStore } from './toast';

/** Timers the test fires by hand. */
function fakeTimers() {
  const timers = new Map<number, { run: () => void; ms: number }>();
  let id = 0;
  return {
    timers,
    setTimeout: ((run: () => void, ms: number) => {
      timers.set(++id, { run, ms });
      return id;
    }) as unknown as typeof setTimeout,
    clearTimeout: ((handle: number) => void timers.delete(handle)) as unknown as typeof clearTimeout,
  };
}

describe('toasts', () => {
  test('a toast is shown, tells its listeners, and leaves when its time is up', () => {
    const clock = fakeTimers();
    const store = createToastStore(clock);
    let changes = 0;
    store.subscribe(() => changes++);
    const id = store.show('Shipped');
    expect(store.get()).toEqual([{ id, message: 'Shipped', tone: 'success' }]);
    expect(changes).toBe(1);
    [...clock.timers.values()][0]!.run();
    expect(store.get()).toEqual([]);
  });

  test('errors stay longer; dismissing one cancels its timer', () => {
    const clock = fakeTimers();
    const store = createToastStore(clock);
    store.show('Done');
    const failed = store.show('This order is already shipped', 'error');
    const [short, long] = [...clock.timers.values()];
    expect(long!.ms).toBeGreaterThan(short!.ms);
    store.dismiss(failed);
    expect(store.get().map((toast) => toast.message)).toEqual(['Done']);
    expect(clock.timers.size).toBe(1);
    store.dismiss(failed); // twice is harmless
  });

  test('only the newest few are kept', () => {
    const clock = fakeTimers();
    const store = createToastStore(clock);
    for (let i = 1; i <= 6; i++) store.show(`Toast ${i}`);
    expect(store.get().map((toast) => toast.message)).toEqual(['Toast 3', 'Toast 4', 'Toast 5', 'Toast 6']);
    expect(clock.timers.size).toBe(4);
  });
});
