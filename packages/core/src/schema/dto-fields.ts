import 'reflect-metadata';
import { ValidationTypes, getMetadataStorage } from 'class-validator';
import type { FieldSchema, FieldType } from '../contract.js';
import { humanize } from './humanize.js';

export type DtoClass = new (...args: any[]) => object;

function validationMetadata(dto: DtoClass) {
  return getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
}

/** Properties that carry at least one class-validator decorator (own first, then inherited). */
export function dtoPropertyNames(dto: DtoClass): string[] {
  return [...new Set(validationMetadata(dto).map((meta) => meta.propertyName))];
}

/** True when the property is decorated with @IsOptional (or @ValidateIf). */
export function isDtoPropertyOptional(dto: DtoClass, property: string): boolean {
  return validationMetadata(dto).some(
    (meta) => meta.propertyName === property && meta.type === ValidationTypes.CONDITIONAL_VALIDATION,
  );
}

const DESIGN_TYPES = new Map<unknown, FieldType>([
  [String, 'string'],
  [Number, 'number'],
  [Boolean, 'boolean'],
  [Date, 'datetime'],
]);

/** Schema for a DTO property that has no entity column (e.g. `password`, hashed by the host service). */
export function dtoOnlyField(dto: DtoClass, property: string): FieldSchema {
  const designType: unknown = Reflect.getMetadata('design:type', dto.prototype, property);
  return {
    name: property,
    label: humanize(property),
    type: DESIGN_TYPES.get(designType) ?? 'string',
    nullable: isDtoPropertyOptional(dto, property),
    primary: false,
    readonly: false,
    persisted: false,
  };
}
