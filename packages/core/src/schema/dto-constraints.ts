import { ValidationTypes, getMetadataStorage } from 'class-validator';
import type { FieldConstraints } from '../contract.js';
import type { DtoClass } from './dto-fields.js';

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Browser-checkable constraints per DTO property, compiled from class-validator metadata (spec §5.3, §9.4). */
export function dtoConstraints(dto: DtoClass): Record<string, FieldConstraints> {
  const result: Record<string, FieldConstraints> = {};
  const optional = new Set<string>();
  for (const meta of getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false)) {
    const constraints = (result[meta.propertyName] ??= {});
    if (meta.type === ValidationTypes.CONDITIONAL_VALIDATION) {
      optional.add(meta.propertyName);
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
        if (Array.isArray(first)) constraints.oneOf = first.map(String);
        break;
      case 'matches': {
        const regex = first instanceof RegExp ? first : new RegExp(String(first), typeof second === 'string' ? second : undefined);
        constraints.pattern = {
          source: regex.source,
          flags: regex.flags,
          ...(typeof meta.message === 'string' ? { message: meta.message } : {}),
        };
        break;
      }
    }
  }
  for (const [name, constraints] of Object.entries(result)) constraints.required = !optional.has(name);
  return result;
}
