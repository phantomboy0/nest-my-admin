import type { DataSource } from 'typeorm';

/** TypeORM drivers that share ONE query runner (and one transaction depth counter) across all callers. */
export const SINGLE_CONNECTION_DRIVERS = new Set(['sqljs', 'sqlite', 'better-sqlite3', 'capacitor', 'cordova', 'expo', 'react-native', 'nativescript']);

/** Tail of the write queue per single-connection DataSource. */
const tails = new WeakMap<DataSource, Promise<unknown>>();

/**
 * Runs `work` when nothing else the admin writes is using the DataSource's one connection: on a single-connection
 * driver a second BEGIN would nest into (and roll back with) the first, and a statement sent meanwhile would join
 * someone else's transaction. So the admin's writes queue there; on every other driver `work` runs at once.
 * A write whose host code never settles blocks every later admin write on that SQLite DataSource. Never call it
 * for a DataSource from inside work already queued on it: it would wait for itself.
 */
export function exclusive<T>(dataSource: DataSource, work: () => Promise<T>): Promise<T> {
  if (!SINGLE_CONNECTION_DRIVERS.has(dataSource.options.type)) return work();
  const result = (tails.get(dataSource) ?? Promise.resolve()).then(work);
  tails.set(dataSource, result.catch(() => undefined));
  return result;
}
