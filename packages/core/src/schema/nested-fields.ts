import { plainToInstance } from 'class-transformer';
import { ValidationTypes, getMetadataStorage } from 'class-validator';
import type { FieldSchema } from '../contract.js';
import { columnToField, type ColumnLike } from './column-field.js';
import { dtoOnlyField, dtoPropertyNames, isDtoPropertyOptional, type DtoClass } from './dto-fields.js';
import { humanize } from './humanize.js';

/** The subset of TypeORM's EmbeddedMetadata this package reads. */
export interface EmbeddedLike {
  propertyName: string;
  columns: ColumnLike[];
  embeddeds: EmbeddedLike[];
  parentEmbeddedMetadata?: EmbeddedLike;
}

/** The outermost embedded a column belongs to (`address` for `address.geo.lat`). */
export function topEmbedded(embedded: EmbeddedLike): EmbeddedLike {
  let current = embedded;
  while (current.parentEmbeddedMetadata) current = current.parentEmbeddedMetadata;
  return current;
}

/**
 * `@Column(() => Address) address` → `{ name: 'address', type: 'object', fields: [city, zip] }`, nested embeddeds
 * as nested objects. Child names are relative (`city`); their dotted path is `address.city` (TypeORM's propertyPath).
 */
export function embeddedField(embedded: EmbeddedLike): FieldSchema {
  const fields: FieldSchema[] = [
    ...embedded.columns.filter((column) => column.isSelect && !column.relationMetadata).map(columnToField),
    ...embedded.embeddeds.map(embeddedField),
  ];
  return {
    name: embedded.propertyName,
    label: humanize(embedded.propertyName),
    type: 'object',
    nullable: false,
    primary: false,
    readonly: fields.length > 0 && fields.every((field) => field.readonly),
    persisted: true,
    fields,
  };
}

/**
 * The class a `@ValidateNested()` property is transformed into (from `@Type(() => X)`), and whether the property is
 * an array of them. Found by letting class-transformer build a probe, so it works with whichever copy of
 * class-transformer the host's decorators registered with.
 */
export function nestedTypeOf(dto: DtoClass, property: string): { type: DtoClass; many: boolean } | undefined {
  const metas = getMetadataStorage()
    .getTargetValidationMetadatas(dto, '', true, false)
    .filter((meta) => meta.propertyName === property);
  const nested = metas.find((meta) => meta.type === ValidationTypes.NESTED_VALIDATION);
  if (!nested) return undefined;
  const many = nested.each === true || metas.some((meta) => meta.name === 'isArray');
  let probe: unknown;
  try {
    probe = (plainToInstance(dto, { [property]: many ? [{}] : {} }) as Record<string, unknown>)[property];
  } catch {
    return undefined;
  }
  const instance = many && Array.isArray(probe) ? probe[0] : probe;
  const type = typeof instance === 'object' && instance !== null ? (instance.constructor as DtoClass) : undefined;
  if (type && type !== Object) return { type, many };
  const designType: unknown = Reflect.getMetadata('design:type', dto.prototype, property);
  if (!many && typeof designType === 'function' && ![Object, Array, String, Number, Boolean, Date].includes(designType as never)) {
    return { type: designType as DtoClass, many };
  }
  return undefined;
}

/** An object field described by a nested DTO (`@ValidateNested() @Type(() => LineDto) lines: LineDto[]`). */
export function dtoObjectField(dto: DtoClass, property: string, nested: { type: DtoClass; many: boolean }, seen = new Set<DtoClass>()): FieldSchema {
  const inner = new Set(seen).add(nested.type);
  const fields = dtoPropertyNames(nested.type).map((name) => {
    const child = nestedTypeOf(nested.type, name);
    return child && !inner.has(child.type) ? dtoObjectField(nested.type, name, child, inner) : dtoOnlyField(nested.type, name);
  });
  return {
    name: property,
    label: humanize(property),
    type: 'object',
    nullable: isDtoPropertyOptional(dto, property),
    primary: false,
    readonly: false,
    persisted: false,
    fields,
    ...(nested.many ? { many: true } : {}),
  };
}
