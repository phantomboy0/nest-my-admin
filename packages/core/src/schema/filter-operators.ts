import type { FieldSchema, FieldType, FilterOperator } from '../contract.js';

const EQUALITY: FilterOperator[] = ['eq', 'ne', 'in', 'nin'];
const RANGE: FilterOperator[] = ['lt', 'lte', 'gt', 'gte', 'between'];

const OPERATORS_BY_TYPE: Record<FieldType, FilterOperator[]> = {
  string: [...EQUALITY, 'contains', 'startsWith'],
  text: ['contains', 'startsWith'],
  uuid: EQUALITY,
  enum: EQUALITY,
  number: [...EQUALITY, ...RANGE],
  bigint: [...EQUALITY, ...RANGE],
  decimal: [...EQUALITY, ...RANGE],
  date: [...EQUALITY, ...RANGE],
  datetime: RANGE, // exact equality on timestamps is never what a person means
  boolean: ['eq', 'ne'],
  json: [],
  other: [],
  object: [],
  relation: EQUALITY, // to-one; to-many relations only support `in` (has any of), see operatorsFor
};

/** Column types that `?search=` can match with a case-insensitive LIKE. */
export const SEARCHABLE_TYPES: readonly FieldType[] = ['string', 'text'];

export function operatorsFor(field: FieldSchema): FilterOperator[] {
  if (field.relation?.kind === 'to-many') return ['in'];
  const operators = OPERATORS_BY_TYPE[field.type];
  if (operators.length === 0) return [];
  return field.nullable ? [...operators, 'isNull'] : [...operators];
}
