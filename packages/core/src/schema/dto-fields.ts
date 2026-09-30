import 'reflect-metadata';
import { ValidationTypes, getMetadataStorage } from 'class-validator';
import type { FieldSchema, FieldType } from '../contract.js';
import { dtoConstraints } from './dto-constraints.js';
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
  const constraints = dtoConstraints(dto)[property] ?? {};
  const field: FieldSchema = {
    name: property,
    label: humanize(property),
    type: constraints.oneOf ? 'enum' : (DESIGN_TYPES.get(designType) ?? 'string'),
    nullable: isDtoPropertyOptional(dto, property),
    primary: false,
    readonly: false,
    persisted: false,
  };
  if (constraints.oneOf) field.enumValues = constraints.oneOf;
  if (constraints.integer) field.integer = true;
  return field;
}
