import 'reflect-metadata';
import type { WhereExpressionBuilder } from 'typeorm';
import { ADMIN_CAN_METADATA, ADMIN_SCOPES_METADATA } from '../constants.js';

/**
 * What a scope returns: a column map (`{ ownerId: ctx.user.id }`; an array means IN, null means IS NULL), or a
 * callback that adds conditions for anything else (`(where, alias) => where.where(`${alias}.total > 0`)`).
 */
export type ScopeCondition = Record<string, unknown> | ((where: WhereExpressionBuilder, alias: string) => void);

/**
 * A named row scope (spec §6.4): `@AdminScope('own') own(ctx) { return { ownerId: ctx.user.id }; }`. Roles assign
 * scopes per resource and operation; the method runs per request and must not throw for a normal user.
 */
export function AdminScope(name: string): MethodDecorator {
  return (target, propertyKey) => {
    const owner = target.constructor;
    const inherited = (Reflect.getMetadata(ADMIN_SCOPES_METADATA, owner) as Record<string, string | symbol> | undefined) ?? {};
    Reflect.defineMetadata(ADMIN_SCOPES_METADATA, { ...inherited, [name]: propertyKey }, owner);
  };
}

export function getScopes(target: Function): Record<string, string | symbol> {
  return (Reflect.getMetadata(ADMIN_SCOPES_METADATA, target) as Record<string, string | symbol> | undefined) ?? {};
}

export type RecordOperation = 'update' | 'delete';

/**
 * A per-record rule (spec §6.3): `@AdminCan('update') canEdit(record, ctx) { return record.status === 'draft'; }`.
 * Records carry the answer in `_perm`; PATCH and DELETE re-check it (403). The name of a record `@AdminAction`
 * (`@AdminCan('ship')`) rules that action the same way: `_perm.actions` lists it only where the rule agrees, and
 * running it elsewhere is a 403. Any other name fails at boot.
 */
export function AdminCan(operation: RecordOperation | (string & {})): MethodDecorator {
  return (target, propertyKey) => {
    const owner = target.constructor;
    const inherited = (Reflect.getMetadata(ADMIN_CAN_METADATA, owner) as Record<string, Array<string | symbol>> | undefined) ?? {};
    const list = [...(inherited[operation] ?? [])];
    if (!list.includes(propertyKey)) list.push(propertyKey);
    Reflect.defineMetadata(ADMIN_CAN_METADATA, { ...inherited, [operation]: list }, owner);
  };
}

/** The rule methods for an operation (`update`, `delete`) or a record action's name. */
export function getCanRules(target: Function, operation: string): Array<string | symbol> {
  const rules = Reflect.getMetadata(ADMIN_CAN_METADATA, target) as Record<string, Array<string | symbol>> | undefined;
  return rules && Object.hasOwn(rules, operation) ? rules[operation]! : [];
}

/** Every name the class has `@AdminCan` rules for. */
export function getCanRuleNames(target: Function): string[] {
  return Object.keys((Reflect.getMetadata(ADMIN_CAN_METADATA, target) as Record<string, unknown> | undefined) ?? {});
}
