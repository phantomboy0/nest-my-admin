import 'reflect-metadata';
import { ADMIN_HOOKS_METADATA } from '../constants.js';

export type HookKind = 'beforeSave' | 'afterSave' | 'beforeDelete';
export type SaveMode = 'create' | 'update';
/** `soft`: moved to the trash (@DeleteDateColumn); `hard`: the row is removed (no trash, or a purge). */
export type DeleteMode = 'soft' | 'hard';

type HookTable = Record<HookKind, Array<string | symbol>>;

function hook(kind: HookKind): MethodDecorator {
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

/** `(dto, ctx, mode)` — runs before the default create/update saves; may mutate `dto`. */
export const BeforeSave = (): MethodDecorator => hook('beforeSave');
/** `(entity, ctx, mode)` — runs after the default create/update saved. */
export const AfterSave = (): MethodDecorator => hook('afterSave');
/** `(entity, ctx, mode: DeleteMode)` — runs before the default delete and purge; throw to refuse. */
export const BeforeDelete = (): MethodDecorator => hook('beforeDelete');

export function getHooks(target: Function, kind: HookKind): Array<string | symbol> {
  return (Reflect.getMetadata(ADMIN_HOOKS_METADATA, target) as HookTable | undefined)?.[kind] ?? [];
}
