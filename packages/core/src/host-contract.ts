/**
 * Runtime checks of what host code returns where the admin needs a particular shape (spec: «fail loudly»): a wrong
 * value is a programming error, so it fails the request with a sentence naming the method and what it returned,
 * instead of being misread (an `async` scope read as «no restriction»).
 */

/** A Promise or any other thenable. */
export const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';

/** A short description of a value for an error message: `a Promise`, `an array`, `the string "x"`, `undefined`. */
export function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (isThenable(value)) return 'a Promise (is the method async?)';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return `the string ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'object') {
    const name = (value as object).constructor?.name;
    return name && name !== 'Object' ? `a ${name}` : 'an object';
  }
  return `the ${typeof value} ${String(value)}`;
}

/** Host code broke its contract: a 500 whose message (logged with the correlation id) says what to fix. */
export class HostContractError extends Error {
  constructor(message: string) {
    super(`nest-my-admin: ${message}`);
    this.name = 'HostContractError';
  }
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** What `findMany` must answer: `{ items: [...], total: number | null }` (and the optional paging fields). */
export function checkFindMany<T>(found: T, where: string): T {
  const value = found as unknown as Record<string, unknown> | null | undefined;
  const fail = (what: string) => {
    throw new HostContractError(`${where}.findMany() returned ${what}; it answers { items: [...], total: number | null } (inMemoryList(rows, params) builds that from an array)`);
  };
  if (!isPlainObject(value)) fail(describeValue(found));
  if (!Array.isArray(value!.items)) fail(`items that are ${describeValue(value!.items)}`);
  const total = value!.total;
  if (total !== null && total !== undefined && (typeof total !== 'number' || !Number.isFinite(total) || total < 0)) fail(`a total of ${describeValue(total)}`);
  if ((value!.items as unknown[]).some((item) => typeof item !== "object" || item === null)) fail('items that are not all records (objects)');
  return found;
}

/** A text: a string, or a plain object of strings by locale (`{ en, fa }`), never a Promise or a class instance. */
export const isLocalizedText = (value: unknown): boolean => typeof value === 'string' || (isPlainObject(value) && Object.values(value).every((text) => typeof text === 'string'));

/** What `query()` and `relationOptions()` hand back: the query builder, never a Promise of it or nothing. */
export function checkQueryBuilder<Q>(value: Q, where: string): Q {
  // By shape, not instanceof: a host may resolve its own copy of typeorm.
  const qb = value as { andWhere?: unknown; getQuery?: unknown } | null;
  if (typeof qb === 'object' && qb !== null && typeof qb.andWhere === 'function' && typeof qb.getQuery === 'function') return value;
  throw new HostContractError(`${where} must return the query builder (add to the one it was given and return it), but it returned ${describeValue(value)}`);
}

/** A list of strings (`resolveRoles`), or nothing. */
export function checkStringList(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  throw new HostContractError(`${where} must return an array of role names, but it returned ${describeValue(value)}`);
}

/** A record a write method answered: an object, or nothing (the admin then reloads it). */
export function checkWriteResult(value: unknown, where: string): unknown {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value) && !isThenable(value))) return value;
  throw new HostContractError(`${where} must return the saved record (or nothing, to have it reloaded), but it returned ${describeValue(value)}`);
}

/** A record `findOne`/`getUser` answered: an object, or null. */
export function checkFoundRecord<T>(value: T, where: string): T {
  if (value === undefined || value === null || (typeof value === 'object' && !Array.isArray(value))) return value;
  throw new HostContractError(`${where} must return the record or null, but it returned ${describeValue(value)}`);
}

/** A yes/no answer given at once. */
export function checkBoolean(value: unknown, where: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new HostContractError(`${where} must return true or false, but it returned ${describeValue(value)}`);
}

/** An object of values: a plain object or a class instance, never an array or a Promise. */
export const isRecordObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) && !isThenable(value);
