import type { AdminContext } from '../resource/admin-context.js';
import type { AdminResourceBase } from '../resource/admin-resource-base.js';

/** A value or a Promise of it. */
export type Awaitable<T> = T | Promise<T>;

/**
 * A method decorator that only accepts methods of the signature `M`: decorating a method that takes or returns
 * something else is a compile error, at the decorator.
 */
export type TypedMethodDecorator<M> = <T extends M>(target: object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => void;

/** A class decorator that only accepts classes whose instances are `I`. */
export type TypedClassDecorator<I> = <C extends abstract new (...args: any[]) => I>(target: C) => void;

/** The row type of a resource class (`AdminResourceBase<Order>` → `Order`); `any` outside one. */
export type RowOf<P> = P extends AdminResourceBase<infer T, any> ? T : any;

/** Refuses (at compile time) a method that returns a value where nothing is read. */
export type ReturnsNothing<M> = M extends (...args: any[]) => infer R
  ? [Awaited<R>] extends [void | undefined]
    ? unknown
    : { 'nest-my-admin: this method must return nothing (its value would be ignored)': never }
  : unknown;

/** A method of a resource whose first parameter is one of its rows. */
export type RecordMethodDecorator<Rest extends unknown[], R> = <P extends object, T extends (record: RowOf<P>, ...rest: Rest) => R>(
  target: P,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<T>,
) => void;

export type { AdminContext };
