import 'reflect-metadata';
import { ADMIN_ACTIONS_METADATA } from '../constants.js';
import type { ActionSchema } from '../contract.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import { buildDtoForm, localizeDtoForm, type DtoForm } from '../schema/dto-form.js';
import type { DtoClass } from '../schema/dto-fields.js';
import { humanize } from '../schema/humanize.js';
import { didYouMean } from '../schema/suggest.js';
import { getCanRuleNames } from './admin-scope.js';

export interface AdminActionOptions {
  /** `'Mark shipped'` or `{ en: 'Mark shipped', fa: 'ارسال شد' }`. Defaults to the humanized method name. */
  label?: LocalizedText;
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
   */
  input?: DtoClass;
  icon?: string;
}

/** What an action method may return: a message for the person who ran it. */
export interface ActionOutcome {
  message?: LocalizedText;
}

/** An `@AdminAction` as declared. `name` is the method name: the URL segment and the `{resource}.action.{name}` code. */
export interface ActionDefinition extends AdminActionOptions {
  name: string;
}

/** An action checked at boot, with every default filled in and its input form built. */
export interface RegisteredAction {
  name: string;
  label: LocalizedText;
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
export function AdminAction(options: AdminActionOptions = {}): MethodDecorator {
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
export function resolveActions(resourceClass: Function, reserved: readonly string[], fail: (message: string) => never): Map<string, RegisteredAction> {
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
    const { confirm, input, icon, label } = definition;
    if (confirm !== undefined && typeof confirm !== 'boolean' && !isText(confirm)) fail(`${where}: confirm must be true, false or a text`);
    if (label !== undefined && !isText(label)) fail(`${where}: label must be a text`);
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
      label: label ?? humanize(name),
      target,
      bulk,
      atomic,
      ...(confirm !== undefined && confirm !== false ? { confirm } : {}),
      variant,
      ...(icon ? { icon } : {}),
      ...(input ? { input, form } : {}),
    });
  }
  // A rule under a name nothing checks would silently never apply.
  for (const rule of getCanRuleNames(resourceClass)) {
    if (rule === 'update' || rule === 'delete') continue;
    const action = actions.get(rule);
    if (!action) fail(`@AdminCan("${rule}") names no record action${didYouMean(rule, ['update', 'delete', ...actions.keys()])}`);
    if (action!.target === 'resource') fail(`@AdminCan("${rule}"): "${rule}" runs on the resource, not on a record`);
  }
  return actions;
}

function isText(value: unknown): value is LocalizedText {
  if (typeof value === 'string') return true;
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((text) => typeof text === 'string');
}

/** The action as one request gets it, texts in `locale`. */
export function toActionSchema(action: RegisteredAction, locale: string, defaultLocale: string): ActionSchema {
  const { confirm } = action;
  return {
    name: action.name,
    label: resolveText(action.label, locale, defaultLocale),
    target: action.target,
    bulk: action.bulk,
    atomic: action.atomic,
    ...(confirm !== undefined ? { confirm: confirm === true ? true : resolveText(confirm, locale, defaultLocale) } : {}),
    variant: action.variant,
    ...(action.icon ? { icon: action.icon } : {}),
    ...(action.form ? { input: localizeDtoForm(action.form, locale, defaultLocale) } : {}),
  };
}
