import type { DtoFormSchema, FieldConstraints, FieldSchema } from '../contract.js';
import { dtoConstraints, isConditionalProperty } from './dto-constraints.js';
import { getAdminFieldOptions, type AdminFieldOptions } from '../decorators/admin-field.js';
import { dtoOnlyField, dtoPropertyNames, type DtoClass } from './dto-fields.js';
import { applyFieldConfig, checkFieldConfig, mergeFieldConfig, type FieldConfig, type FieldText } from './field-config.js';
import { dtoObjectField, nestedTypeOf } from './nested-fields.js';

/**
 * A form described by a DTO alone (an action's input, a settings page): no entity and no resource behind it.
 * Texts are kept as configured, in every language; `localizeDtoForm` makes the schema one request gets.
 */
export interface DtoForm {
  /** One field per property with a class-validator decorator, in declaration order; labels are the humanized names. */
  fields: FieldSchema[];
  /** What the browser checks before submitting; fields inside objects by dotted path (`lines.*.qty`). */
  constraints: Record<string, FieldConstraints>;
  /** Top-level fields that must be sent. */
  required: string[];
  /** Field options: `@AdminField` on the DTO, then `fieldsConfig` on top (option by option). */
  config: Map<string, FieldConfig>;
}

/**
 * Builds the form of `dto`. `fieldsConfig` adds labels, help, widgets, `showIf`… per field, like a resource's
 * `fields`. Configuration mistakes go to `fail` (default: an Error naming the DTO). `secret` fields are a mistake
 * unless `allow.secrets` (settings pages).
 */
export function buildDtoForm(dto: DtoClass, fieldsConfig?: Record<string, FieldConfig | undefined>, fail?: (message: string) => never, allow: { secrets?: boolean } = {}): DtoForm {
  const failed =
    fail ??
    ((message: string): never => {
      throw new Error(`${dto.name}: ${message}`);
    });
  const names = dtoPropertyNames(dto);
  if (names.length === 0) failed('no property has a class-validator decorator, so the form would be empty');
  for (const name of names) if (name.startsWith('_')) failed(`property "${name}": names starting with "_" are reserved for the admin`);

  const fromDto = dtoConstraints(dto);
  const fields: FieldSchema[] = [];
  const constraints: Record<string, FieldConstraints> = {};
  for (const name of names) {
    const conditional = isConditionalProperty(dto, name);
    const nested = nestedTypeOf(dto, name);
    const field = nested ? dtoObjectField(dto, name, nested) : dtoOnlyField(dto, name);
    fields.push(field);
    // @ValidateIf: the server may skip every rule on the property, so the browser checks none.
    constraints[name] = conditional ? {} : withRequired(fromDto[name]);
    if (nested && !conditional) addNestedConstraints(constraints, field, name, nested.type);
  }

  const config = mergeFieldConfig([dto], fieldsConfig);
  checkFieldConfig(fields, config, failed, allow);
  for (const field of fields) {
    // A settings page says it in its own words for `secret` (it runs its check right after this one).
    const inside = field.type === 'object' ? nestedProtected(dto, field.name, allow.secrets ? ['sensitive', 'password'] : undefined) : undefined;
    if (inside) failed(protectedInside(field.name, inside));
  }
  return { fields, constraints, required: names.filter((name) => constraints[name]!.required === true), config };
}

/** Options that keep a value out of responses or out of the audit log. They work on a form's own fields only. */
export type ProtectedOption = 'secret' | 'sensitive' | 'password';
const PROTECTED: readonly ProtectedOption[] = ['secret', 'sensitive', 'password'];

/** A property that carries a protected option where it does nothing: `where` is `Class.property`. */
export interface ProtectedInside {
  where: string;
  option: ProtectedOption;
}

/** The protected option (of those in `among`) an `@AdminField` sets, if any. */
export function protectedOption(options: AdminFieldOptions, among: readonly ProtectedOption[] = PROTECTED): ProtectedOption | undefined {
  return among.find((option) => (option === 'password' ? options.widget === 'password' : options[option] === true));
}

/**
 * The first `@AdminField` with `secret`, `sensitive` or the `password` widget in the DTOs nested under a property,
 * if any. Field options are read for a form's own fields only (`nested-fields.ts` builds a group's fields from the
 * DTO alone), so inside a group they would protect nothing: the value would be served, and stored in the audit log.
 */
export function nestedProtected(dto: DtoClass, property: string, among: readonly ProtectedOption[] = PROTECTED, seen = new Set<DtoClass>()): ProtectedInside | undefined {
  const nested = nestedTypeOf(dto, property)?.type;
  if (!nested || seen.has(nested)) return undefined;
  seen.add(nested);
  for (const [name, options] of Object.entries(getAdminFieldOptions(nested))) {
    const option = protectedOption(options, among);
    if (option) return { where: `${nested.name}.${name}`, option };
  }
  for (const name of dtoPropertyNames(nested)) {
    const deeper = nestedProtected(nested, name, among, seen);
    if (deeper) return deeper;
  }
  return undefined;
}

/** The boot error for a protected option inside a group. */
export function protectedInside(field: string, inside: ProtectedInside): string {
  const what = inside.option === 'password' ? "`widget: 'password'`" : `\`${inside.option}\``;
  return `fields.${field}: ${what} on ${inside.where} is inside a group, where it is not applied (the audit log would store the value); move the field to the top level of the form`;
}

/** `required` is present only when true, as in a resource's form constraints. */
function withRequired(source: FieldConstraints | undefined): FieldConstraints {
  const { required, ...rest } = source ?? {};
  return required === true ? { ...rest, required: true } : rest;
}

/** Constraints of the fields inside an object, keyed `address.city` (`lines.*.qty` for lists), from the nested DTO. */
function addNestedConstraints(out: Record<string, FieldConstraints>, field: FieldSchema, path: string, nestedDto: DtoClass): void {
  const fromDto = dtoConstraints(nestedDto);
  for (const child of field.fields ?? []) {
    const childPath = `${path}.${field.many ? '*.' : ''}${child.name}`;
    const conditional = isConditionalProperty(nestedDto, child.name);
    out[childPath] = conditional ? {} : withRequired(fromDto[child.name]);
    const deeper = child.type === 'object' && !conditional ? nestedTypeOf(nestedDto, child.name) : undefined;
    if (deeper) addNestedConstraints(out, child, childPath, deeper.type);
  }
}

/** The form as one request gets it: field options applied, texts in `locale`. */
export function localizeDtoForm(form: DtoForm, fieldText: FieldText, files: { maxBytes?: number; enabled?: boolean } = {}): DtoFormSchema {
  return {
    fields: form.fields.map((field) => applyFieldConfig(field, form.config.get(field.name), fieldText, files.maxBytes, files.enabled)),
    constraints: form.constraints,
    required: form.required,
  };
}
