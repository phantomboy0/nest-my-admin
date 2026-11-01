import 'reflect-metadata';
import { ADMIN_ACTIONS_METADATA } from '../constants.js';
import type { ActionSchema } from '../contract.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import { buildDtoForm, localizeDtoForm, type DtoForm } from '../schema/dto-form.js';
import { dtoPropertyNames, type DtoClass } from '../schema/dto-fields.js';
import { describeValue, HostContractError, isLocalizedText } from '../host-contract.js';
import { humanize } from '../schema/humanize.js';
import { didYouMean } from '../schema/suggest.js';
import { getCanRuleNames } from './admin-scope.js';
import type { ScopedText } from '../i18n/texts.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { Awaitable, RecordMethodDecorator, TypedMethodDecorator } from './typed.js';

export interface AdminActionOptions {
  /**
   * `'Mark shipped'` or `{ en: 'Mark shipped', fa: 'ارسال شد' }`. Defaults to the humanized method name. A label per
   * record: `{ static, for }`, where `for(record)` names the action for that record («انتقال به آماده ارسال») or
   * returns `null` to hide it there (a run is then refused too); `static` names it where no record is at hand (bulk
   * menus, the role editor, the audit log).
   */
  label?: LocalizedText | { static: LocalizedText; for: (record: any) => LocalizedText | null };
  /** The record's next step: a filled button, last in the record's header. One per resource, record actions without `input`. */
  primary?: boolean;
  /**
   * `record` (default): the method is `(record, input, ctx)` and runs on a record the user may view and update
   * (the detail page; a list selection too with `bulk`). `resource`: the method is `(input, ctx)` and runs once,
   * without ids (a list toolbar button).
   */
  target?: 'record' | 'resource';
  /** Also offered on a list selection: the method runs once per selected record. */
  bulk?: boolean;
  /**
   * Bulk runs: `false` (default) gives each record its own transaction, so one failure does not undo the others
   * (`{ ok, failed }`); `true` checks every record first (scopes, `@AdminCan`) and then runs them all in one
   * transaction, so any failure undoes everything. Needs the admin's transactions (the default).
   */
  atomic?: boolean;
  /** Ask before running: `true` for the default question, or the question itself. */
  confirm?: boolean | LocalizedText;
  /** `destructive` is shown as a dangerous button. */
  variant?: 'default' | 'destructive';
  /**
   * A DTO for a form in the dialog. It is validated like a write (whitelist, class-validator) before the method
   * runs; `@AdminField` on its properties sets labels, help and widgets. Files and rich text are not supported.
   * Left out, the class of the method's input parameter is used (it needs `emitDecoratorMetadata`); `false` says
   * the action takes no input, where the parameter types cannot be read.
   */
  input?: DtoClass | false;
  icon?: string;
}

/** What an action method may return: a message for the person who ran it. */
export interface ActionOutcome {
  message?: LocalizedText;
}

/** What an action method returns: nothing, or an `ActionOutcome`. */
export type ActionReturn = ActionOutcome | void | null | undefined;

/** An `@AdminAction` as declared. `name` is the method name: the URL segment and the `{resource}.action.{name}` code. */
export interface ActionDefinition extends AdminActionOptions {
  name: string;
}

/** An action checked at boot, with every default filled in and its input form built. */
export interface RegisteredAction {
  name: string;
  label: LocalizedText;
  /** The per-record label (`label.for`): `null` hides the action on that record. */
  labelFor?: (record: any) => LocalizedText | null;
  primary: boolean;
  target: 'record' | 'resource';
  bulk: boolean;
  atomic: boolean;
  confirm?: true | LocalizedText;
  variant: 'default' | 'destructive';
  icon?: string;
  input?: DtoClass;
  form?: DtoForm;
}

/**
 * A custom action of a resource (spec §5.2): a button on a record, on a list selection (`bulk`) or on the list
 * (`target: 'resource'`). The method name is the action's name; running it needs `{resource}.action.{name}`, and for
 * record actions `{resource}.update`, the user's row scopes and any `@AdminCan('<name>')` rule. It runs inside the
 * admin's write transaction (`ctx.manager`), unless the admin runs with `transactions: false`: then nothing a method
 * wrote is undone when it throws, and `atomic` actions are refused at boot. Throw an `HttpException` (or
 * `AdminFieldError` for input fields) to refuse.
 */
export function AdminAction<I extends object>(
  options: AdminActionOptions & { target: 'resource'; input: new (...args: any[]) => I },
): TypedMethodDecorator<(input: I, ctx: AdminContext) => Awaitable<ActionReturn>>;
export function AdminAction(options: AdminActionOptions & { target: 'resource' }): TypedMethodDecorator<(input: any, ctx: AdminContext) => Awaitable<ActionReturn>>;
export function AdminAction<I extends object>(
  options: AdminActionOptions & { target?: 'record'; input: new (...args: any[]) => I },
): RecordMethodDecorator<[input: I, ctx: AdminContext], Awaitable<ActionReturn>>;
export function AdminAction(options?: AdminActionOptions & { target?: 'record' }): RecordMethodDecorator<[input: any, ctx: AdminContext], Awaitable<ActionReturn>>;
export function AdminAction(options?: AdminActionOptions): TypedMethodDecorator<(...args: any[]) => Awaitable<ActionReturn>>;
export function AdminAction(options: AdminActionOptions = {}): TypedMethodDecorator<(...args: any[]) => Awaitable<ActionReturn>> {
  return (target, propertyKey) => {
    if (typeof propertyKey !== 'string') throw new TypeError('@AdminAction must decorate a method with a string name');
    const owner = target.constructor;
    const inherited = (Reflect.getMetadata(ADMIN_ACTIONS_METADATA, owner) as Record<string, ActionDefinition> | undefined) ?? {};
    // A copy, so a subclass never changes its parent's table.
    Reflect.defineMetadata(ADMIN_ACTIONS_METADATA, { ...inherited, [propertyKey]: { ...options, name: propertyKey } }, owner);
  };
}

/** The actions declared on a resource class (inherited ones first), by name. */
export function getActions(resourceClass: Function): Map<string, ActionDefinition> {
  return new Map(Object.entries((Reflect.getMetadata(ADMIN_ACTIONS_METADATA, resourceClass) as Record<string, ActionDefinition> | undefined) ?? {}));
}

/** Names that are permissions or code segments already. */
const OPERATIONS = ['view', 'create', 'update', 'delete', 'restore', 'purge'];
const UPLOAD_WIDGETS = ['file', 'image', 'richtext'];

/**
 * Boot-time checks of a resource class's actions and of its `@AdminCan` names; returns the actions ready to run.
 * `reserved` are the method names of `AdminResourceBase`, which an action must not take over.
 */
/** A class the method's parameter was declared as (emitted with `emitDecoratorMetadata`); not `Object` (an interface, `any`) or a built-in. */
const BUILT_INS: unknown[] = [Object, String, Number, Boolean, Array, Promise, Function, Date, Map, Set];
const declaredClass = (type: unknown): Function | undefined => (typeof type === 'function' && !BUILT_INS.includes(type) ? type : undefined);
const related = (a: Function, b: Function) => a === b || a.prototype instanceof b || b.prototype instanceof a;

/**
 * Boot-time checks of a resource class's actions and of its `@AdminCan` names; returns the actions ready to run.
 * `reserved` are the method names of `AdminResourceBase`, which an action must not take over; `row` is the class of
 * the records (the entity, or a source's row), checked against a record action's first parameter.
 *
 * The method's parameter types (when the build emits them: tsc, SWC, Bun; not esbuild or Vite) are checked against the
 * action: `input` must be the class of its input parameter, and an action without `input` takes it from that parameter.
 */
export function resolveActions(resourceClass: Function, reserved: readonly string[], fail: (message: string) => never, row?: Function): Map<string, RegisteredAction> {
  const actions = new Map<string, RegisteredAction>();
  for (const definition of getActions(resourceClass).values()) {
    const { name } = definition;
    const where = `@AdminAction "${name}"`;
    if (OPERATIONS.includes(name)) fail(`${where} collides with the built-in ${name}; give the method another name`);
    if (reserved.includes(name)) fail(`${where} overrides AdminResourceBase.${name}(); give the method another name`);
    if (!/^[a-z][a-z0-9_]*$/i.test(name) || name === 'field' || name === 'action') fail(`${where}: the method name must be a word (letters, digits, _) other than field and action`);
    const target = definition.target ?? 'record';
    if (target !== 'record' && target !== 'resource') fail(`${where}: target must be "record" or "resource"`);
    const variant = definition.variant ?? 'default';
    if (variant !== 'default' && variant !== 'destructive') fail(`${where}: variant must be "default" or "destructive"`);
    const bulk = definition.bulk === true;
    const atomic = definition.atomic === true;
    if (target === 'resource' && (bulk || atomic)) fail(`${where}: \`bulk\` and \`atomic\` are for record actions`);
    if (atomic && !bulk) fail(`${where}: \`atomic\` needs \`bulk: true\``);
    const { confirm, icon, label } = definition;
    const noInput = definition.input === false;
    let input = definition.input === false ? undefined : definition.input;
    const params = Reflect.getMetadata('design:paramtypes', resourceClass.prototype, name) as unknown[] | undefined;
    const method = (resourceClass.prototype as Record<string, unknown>)[name];
    const takesInput = typeof method === 'function' && method.length > (target === 'record' ? 1 : 0);
    if (params === undefined && input === undefined && !noInput && takesInput) {
      fail(
        `${where}: the method takes an input parameter, but its type cannot be read (emitDecoratorMetadata is off, or the build drops it: esbuild, Vite, tsx); set \`input\` to its DTO class, or \`input: false\` if it takes none`,
      );
    }
    const recordParam = target === 'record' ? declaredClass(params?.[0]) : undefined;
    if (recordParam && row && !related(recordParam, row)) fail(`${where}: the method's first parameter is ${recordParam.name}, but the action runs on ${row.name} records`);
    const inputParam = declaredClass(params?.[target === 'record' ? 1 : 0]);
    const inputLike = inputParam !== undefined && inputParam !== row && dtoPropertyNames(inputParam as DtoClass).length > 0;
    if (input !== undefined && typeof input === 'function' && inputParam && inputParam !== input && !(input.prototype instanceof inputParam)) {
      fail(`${where}: \`input\` is ${input.name} but the method's input parameter is ${inputParam.name}; use the same class (or leave \`input\` out to take the parameter's)`);
    }
    if (noInput && inputLike) fail(`${where}: \`input: false\`, but the method's input parameter is ${inputParam!.name}`);
    if (input === undefined && !noInput && inputLike) {
      if (definition.primary === true) fail(`${where}: a primary action runs in one click and takes no input, but the method's input parameter is ${inputParam!.name}`);
      input = inputParam as DtoClass;
    }
    if (confirm !== undefined && typeof confirm !== 'boolean' && !isText(confirm)) fail(`${where}: confirm must be true, false or a text`);
    const perRecord = typeof label === 'object' && label !== null && 'for' in label;
    if (perRecord) {
      const { static: fixed, for: labelFor } = label as { static?: LocalizedText; for: unknown };
      if (typeof labelFor !== 'function') fail(`${where}: label.for must be a function (record) => text | null`);
      if (fixed === undefined || !isText(fixed)) fail(`${where}: a per-record label needs \`static\`, the label where no record is at hand (bulk menus, roles, the audit log)`);
    } else if (label !== undefined && !isText(label)) fail(`${where}: label must be a text`);
    const primary = definition.primary === true;
    if (primary && target !== 'record') fail(`${where}: \`primary\` is a record's next step; resource actions cannot be primary`);
    if (primary && input !== undefined) fail(`${where}: a primary action runs in one click, so it takes no \`input\``);
    if (icon !== undefined && typeof icon !== 'string') fail(`${where}: icon must be an icon name`);
    let form: DtoForm | undefined;
    if (input !== undefined) {
      if (typeof input !== 'function') fail(`${where}: input must be a DTO class`);
      form = buildDtoForm(input, undefined, (message) => fail(`${where}: input ${input.name}: ${message}`));
      // There is nowhere to keep an action's uploads, and nothing sanitizes its HTML.
      for (const [field, options] of form.config) {
        if (UPLOAD_WIDGETS.includes(options.widget ?? '')) fail(`${where}: input field "${field}" uses the "${options.widget}" widget; action inputs cannot take files or rich text`);
      }
    }
    actions.set(name, {
      name,
      label: perRecord ? (label as { static: LocalizedText }).static : ((label as LocalizedText | undefined) ?? humanize(name)),
      ...(perRecord ? { labelFor: checkedLabelFor(`${resourceClass.name} @AdminAction "${name}" label.for`, (label as { for: (record: unknown) => LocalizedText | null }).for) } : {}),
      primary,
      target,
      bulk,
      atomic,
      ...(confirm !== undefined && confirm !== false ? { confirm } : {}),
      variant,
      ...(icon ? { icon } : {}),
      ...(input ? { input, form } : {}),
    });
  }
  const primaries = [...actions.values()].filter((action) => action.primary);
  if (primaries.length > 1) fail(`@AdminAction: only one action can be \`primary\` (${primaries.map((action) => action.name).join(', ')})`);
  // A rule under a name nothing checks would silently never apply.
  for (const rule of getCanRuleNames(resourceClass)) {
    // `create` is an inline child's rule on its parent, checked once inlines are resolved (the registry).
    if (rule === 'update' || rule === 'delete' || rule === 'create') continue;
    const action = actions.get(rule);
    if (!action) fail(`@AdminCan("${rule}") names no record action${didYouMean(rule, ['update', 'delete', 'create', ...actions.keys()])}`);
    if (action!.target === 'resource') fail(`@AdminCan("${rule}"): "${rule}" runs on the resource, not on a record`);
  }
  return actions;
}

function isText(value: unknown): value is LocalizedText {
  return isLocalizedText(value);
}

/** The action as one request gets it, texts through `text` (keys `actions.<name>.…` of the resource). */
export function toActionSchema(action: RegisteredAction, text: ScopedText): ActionSchema {
  const { confirm } = action;
  const at = `actions.${action.name}`;
  return {
    name: action.name,
    label: text(action.label, `${at}.label`),
    target: action.target,
    bulk: action.bulk,
    atomic: action.atomic,
    ...(confirm !== undefined ? { confirm: confirm === true ? true : text(confirm, `${at}.confirm`) } : {}),
    variant: action.variant,
    ...(action.primary ? { primary: true } : {}),
    ...(action.icon ? { icon: action.icon } : {}),
    ...(action.form ? { input: localizeDtoForm(action.form, (value, path) => text(value, `${at}.fields.${path}`)) } : {}),
  };
}

/** `label.for` as called: a text, or `null` (not on this record); anything else (a Promise of an `async` one) fails loudly. */
function checkedLabelFor(where: string, labelFor: (record: unknown) => LocalizedText | null): (record: unknown) => LocalizedText | null {
  return (record) => {
    const value: unknown = labelFor(record);
    if (value !== null && !isLocalizedText(value)) throw new HostContractError(`${where} returned ${describeValue(value)}; it answers at once with a text, or null where the action does not apply (it cannot be async)`);
    return value as LocalizedText | null;
  };
}
