import type { DtoFormSchema, FieldConstraints, FieldSchema } from '../contract.js';
import { dtoConstraints, isConditionalProperty } from './dto-constraints.js';
import { getAdminFieldOptions } from '../decorators/admin-field.js';
import { dtoOnlyField, dtoPropertyNames, type DtoClass } from './dto-fields.js';
import { applyFieldConfig, checkFieldConfig, mergeFieldConfig, type FieldConfig } from './field-config.js';
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
    const inside = field.type === 'object' ? nestedOption(dto, field.name, 'sensitive') : undefined;
    if (inside) failed(sensitiveInside(field.name, inside));
  }
  return { fields, constraints, required: names.filter((name) => constraints[name]!.required === true), config };
}

/**
 * `Class.property` of the first `@AdminField` with `option` set in the DTOs nested under a property, if any. Field
 * options apply to a form's own fields only, so `secret` or `sensitive` inside a group would protect nothing.
 */
export function nestedOption(dto: DtoClass, property: string, option: 'secret' | 'sensitive', seen = new Set<DtoClass>()): string | undefined {
  const nested = nestedTypeOf(dto, property)?.type;
  if (!nested || seen.has(nested)) return undefined;
  seen.add(nested);
  for (const [name, options] of Object.entries(getAdminFieldOptions(nested))) if (options[option]) return `${nested.name}.${name}`;
  for (const name of dtoPropertyNames(nested)) {
    const deeper = nestedOption(nested, name, option, seen);
    if (deeper) return deeper;
  }
  return undefined;
}

export const sensitiveInside = (field: string, inside: string): string =>
  `fields.${field}: \`sensitive\` on ${inside} is inside a group, where it is not applied; mark the group itself (\`fields.${field}.sensitive\`)`;

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
export function localizeDtoForm(form: DtoForm, locale: string, defaultLocale: string, files: { maxBytes?: number; enabled?: boolean } = {}): DtoFormSchema {
  return {
    fields: form.fields.map((field) => applyFieldConfig(field, form.config.get(field.name), locale, defaultLocale, files.maxBytes, files.enabled)),
    constraints: form.constraints,
    required: form.required,
  };
}
