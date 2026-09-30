import { ValidationTypes, getMetadataStorage } from 'class-validator';
import type { FieldConstraints } from '../contract.js';
import type { DtoClass } from './dto-fields.js';

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** A custom message is usable only when its placeholders can be resolved without a value. */
function patternMessage(message: unknown, property: string, dtoName: string): { message?: string } {
  if (typeof message !== 'string') return {};
  const filled = message.replaceAll('$property', property).replaceAll('$target', dtoName);
  return /\$(value|constraint)/.test(filled) ? {} : { message: filled };
}

/** True when the DTO marks the property with @ValidateIf: the server may skip every rule on it. */
export function isConditionalProperty(dto: DtoClass, property: string): boolean {
  return getMetadataStorage()
    .getTargetValidationMetadatas(dto, '', true, false)
    .some((meta) => meta.propertyName === property && meta.type === ValidationTypes.CONDITIONAL_VALIDATION && meta.name !== 'isOptional');
}

/** True when a `new dto()` carries a value for the property (a class initializer): plainToInstance fills it, so the client need not send it. */
export function hasDtoInitializer(dto: DtoClass, property: string): boolean {
  try {
    const instance = new dto() as Record<string, unknown>;
    return Object.hasOwn(instance, property) && instance[property] !== undefined;
  } catch {
    return false;
  }
}

/** Browser-checkable constraints per DTO property, compiled from class-validator metadata (spec §5.3, §9.4). */
export function dtoConstraints(dto: DtoClass): Record<string, FieldConstraints> {
  const result: Record<string, FieldConstraints> = {};
  const optional = new Set<string>();
  const conditional = new Set<string>(); // @ValidateIf: the server may skip every rule, so the browser checks none
  for (const meta of getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false)) {
    const constraints = (result[meta.propertyName] ??= {});
    if (meta.type === ValidationTypes.CONDITIONAL_VALIDATION) {
      (meta.name === 'isOptional' ? optional : conditional).add(meta.propertyName);
      continue;
    }
    if (meta.each) continue; // array-element rules do not describe the field itself
    const [first, second] = (meta.constraints ?? []) as unknown[];
    switch (meta.name) {
      case 'isLength': {
        const min = num(first);
        const max = num(second);
        if (min !== undefined && min > 0) constraints.minLength = min;
        if (max !== undefined) constraints.maxLength = max;
        break;
      }
      case 'minLength':
        if (num(first) !== undefined) constraints.minLength = num(first);
        break;
      case 'maxLength':
        if (num(first) !== undefined) constraints.maxLength = num(first);
        break;
      case 'min':
        if (num(first) !== undefined) constraints.min = num(first);
        break;
      case 'max':
        if (num(first) !== undefined) constraints.max = num(first);
        break;
      case 'isInt':
        constraints.integer = true;
        break;
      case 'isEmail':
        constraints.format = 'email';
        break;
      case 'isUrl':
        constraints.format = 'url';
        break;
      case 'isUuid':
        constraints.format = 'uuid';
        break;
      case 'isIn':
        if (Array.isArray(first) && first.every((value) => typeof value === 'string')) constraints.oneOf = first; // non-string choices are left to the server
        break;
      case 'matches': {
        const regex = first instanceof RegExp ? first : new RegExp(String(first), typeof second === 'string' ? second : undefined);
        constraints.pattern = {
          source: regex.source,
          flags: regex.flags.replace(/[gy]/g, ''), // stateful flags make class-validator's RegExp.test() unreliable
          ...patternMessage(meta.message, meta.propertyName, dto.name),
        };
        break;
      }
    }
  }
  for (const [name, constraints] of Object.entries(result)) {
    if (conditional.has(name)) result[name] = { required: false };
    else constraints.required = !optional.has(name) && !hasDtoInitializer(dto, name);
  }
  return result;
}
