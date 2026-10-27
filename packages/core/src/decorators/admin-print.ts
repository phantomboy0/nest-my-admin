import 'reflect-metadata';
import { ADMIN_PRINTS_METADATA } from '../constants.js';
import type { PrintSchema } from '../contract.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';
import { humanize } from '../schema/humanize.js';

/** Paper sizes by name; any other string is used as the CSS `@page { size }` value. */
export const PAPERS: Record<string, string> = { A4: 'A4', A5: 'A5', label: '100mm 150mm' };

export interface AdminPrintOptions {
  /** `'Invoice'` or `{ en: 'Invoice', fa: 'فاکتور' }`. Defaults to the humanized method name. */
  label?: LocalizedText;
  icon?: string;
  /** `A4` (default), `A5`, `label` (100×150 mm) or a CSS `@page` size such as `'80mm 200mm'`. */
  paper?: string;
  /** Also offered on a list selection: one page per record, up to 100. */
  bulk?: boolean;
}

/** A print template checked at boot. */
export interface RegisteredPrint {
  name: string;
  label: LocalizedText;
  icon?: string;
  /** The CSS `@page` size. */
  size: string;
  bulk: boolean;
}

/**
 * A print template of a resource (an invoice, a shipping label): the method `(records, ctx)` returns the body HTML of
 * the printed page, one or more records (`bulk`). Build it with the `html` tag, which escapes every value. The admin
 * wraps it in a page sized for `paper` that prints itself. Printing needs `{resource}.view`, the user's row scopes and
 * `{resource}.print.{name}`; each printed record is written to the audit log. Throw an `HttpException` to refuse.
 */
export function AdminPrint(options: AdminPrintOptions = {}): MethodDecorator {
  return (target, propertyKey) => {
    if (typeof propertyKey !== 'string') throw new TypeError('@AdminPrint must decorate a method with a string name');
    const owner = target.constructor;
    const inherited = (Reflect.getMetadata(ADMIN_PRINTS_METADATA, owner) as Record<string, AdminPrintOptions & { name: string }> | undefined) ?? {};
    Reflect.defineMetadata(ADMIN_PRINTS_METADATA, { ...inherited, [propertyKey]: { ...options, name: propertyKey } }, owner);
  };
}

/** Boot checks of a resource class's print templates; `taken` are names already in use (base methods, actions). */
export function resolvePrints(resourceClass: Function, taken: readonly string[], fail: (message: string) => never): Map<string, RegisteredPrint> {
  const prints = new Map<string, RegisteredPrint>();
  const declared = (Reflect.getMetadata(ADMIN_PRINTS_METADATA, resourceClass) as Record<string, AdminPrintOptions & { name: string }> | undefined) ?? {};
  for (const definition of Object.values(declared)) {
    const { name } = definition;
    const where = `@AdminPrint "${name}"`;
    if (taken.includes(name)) fail(`${where}: the name is taken (a base method or an action); give the method another name`);
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) fail(`${where}: the method name must be a word (letters, digits, _)`);
    const paper = definition.paper ?? 'A4';
    if (typeof paper !== 'string' || !/^[a-z0-9 .]+$/i.test(paper)) fail(`${where}: paper must be A4, A5, label or a CSS page size`);
    if (definition.icon !== undefined && typeof definition.icon !== 'string') fail(`${where}: icon must be an icon name`);
    prints.set(name, {
      name,
      label: definition.label ?? humanize(name),
      ...(definition.icon ? { icon: definition.icon } : {}),
      size: PAPERS[paper] ?? paper,
      bulk: definition.bulk === true,
    });
  }
  return prints;
}

/** The permission code of a print template. */
export const printCode = (resource: string, name: string): string => `${resource}.print.${name}`;

export function toPrintSchema(print: RegisteredPrint, locale: string, defaultLocale: string): PrintSchema {
  return { name: print.name, label: resolveText(print.label, locale, defaultLocale), bulk: print.bulk, ...(print.icon ? { icon: print.icon } : {}) };
}
