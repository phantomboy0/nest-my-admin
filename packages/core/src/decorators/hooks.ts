import 'reflect-metadata';
import { ADMIN_HOOKS_METADATA } from '../constants.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { ReturnsNothing, RowOf } from './typed.js';

export type HookKind = 'beforeSave' | 'afterSave' | 'beforeDelete';
export type SaveMode = 'create' | 'update';
/** `soft`: moved to the trash (@DeleteDateColumn); `hard`: the row is removed (no trash, or a purge). */
export type DeleteMode = 'soft' | 'hard';

type HookTable = Record<HookKind, Array<string | symbol>>;

function hook(kind: HookKind): (target: object, propertyKey: string | symbol) => void {
  return (target, propertyKey) => {
    const owner = target.constructor;
    const inherited = Reflect.getMetadata(ADMIN_HOOKS_METADATA, owner) as HookTable | undefined;
    // Copy so a subclass never mutates its parent's list.
    const table: HookTable = {
      beforeSave: [...(inherited?.beforeSave ?? [])],
      afterSave: [...(inherited?.afterSave ?? [])],
      beforeDelete: [...(inherited?.beforeDelete ?? [])],
    };
    if (!table[kind].includes(propertyKey)) table[kind].push(propertyKey);
    Reflect.defineMetadata(ADMIN_HOOKS_METADATA, table, owner);
  };
}

/** A hook decorator: the method takes `(first, ctx, mode)` and returns nothing (sync or async). */
type HookDecorator<First, Mode> = <P extends object, T extends (first: First extends 'row' ? RowOf<P> : any, ctx: AdminContext, mode: Mode) => unknown>(
  target: P,
  propertyKey: string | symbol,
  descriptor: TypedPropertyDescriptor<T> & ReturnsNothing<T>,
) => void;

/** `(dto, ctx, mode)` — runs before the default create/update saves; may mutate `dto`. Returns nothing. */
export const BeforeSave = (): HookDecorator<'dto', SaveMode> => hook('beforeSave');
/** `(entity, ctx, mode)` — runs after the default create/update saved. Returns nothing. */
export const AfterSave = (): HookDecorator<'row', SaveMode> => hook('afterSave');
/** `(entity, ctx, mode: DeleteMode)` — runs before the default delete and purge; throw to refuse. Returns nothing. */
export const BeforeDelete = (): HookDecorator<'row', DeleteMode> => hook('beforeDelete');

export function getHooks(target: Function, kind: HookKind): Array<string | symbol> {
  return (Reflect.getMetadata(ADMIN_HOOKS_METADATA, target) as HookTable | undefined)?.[kind] ?? [];
}
