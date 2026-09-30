import type { FieldSchema, FilterOperator, ResourceSchema } from '@nest-my-admin/core/contract';
import { formatDateTime, translate as tr } from '@/i18n';

/** One active filter as the chip row shows it. Relation chips carry ids; the chip looks their titles up. */
export interface FilterChip {
  key: string;
  label: string;
  /** Readable value; for relation chips, the text shown until titles load. */
  value: string;
  /** Relation filters: the field and ids to title. */
  ref?: { field: string; ids: string[]; prefix: string };
  /** URL parameters to delete to remove this chip. */
  remove: string[];
}

const FILTER_KEY = /^filter\[([^\][]+)\]\[([^\][]+)\]$/;

function display(field: FieldSchema, raw: string): string {
  if (field.type === 'boolean') return tr(raw === 'true' ? 'common.yes' : 'common.no');
  if (field.type === 'enum') return field.enumLabels?.[raw] ?? raw;
  if (field.type === 'datetime') {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : formatDateTime(date);
  }
  return raw;
}

/** The chips for the list parameters in the URL: one per search and per filtered field (ranges combine). */
export function filterChips(schema: ResourceSchema, params: URLSearchParams): FilterChip[] {
  const chips: FilterChip[] = [];
  const search = params.get('search');
  if (search) chips.push({ key: 'search', label: tr('filters.search'), value: `“${search}”`, remove: ['search'] });

  const byField = new Map<string, Array<{ operator: FilterOperator; raw: string; key: string }>>();
  for (const [key, raw] of params) {
    const match = FILTER_KEY.exec(key);
    if (!match || raw === '') continue;
    const [, name, operator] = match;
    byField.set(name!, [...(byField.get(name!) ?? []), { operator: operator as FilterOperator, raw, key }]);
  }

  for (const [name, conditions] of byField) {
    const field = schema.fields.find((candidate) => candidate.name === name);
    if (!field) continue;
    const parts: string[] = [];
    let ref: FilterChip['ref'];
    const lower = conditions.find((condition) => condition.operator === 'gte' || condition.operator === 'gt');
    const upper = conditions.find((condition) => condition.operator === 'lte' || condition.operator === 'lt');
    if (lower && upper) parts.push(`${display(field, lower.raw)} – ${display(field, upper.raw)}`);
    for (const { operator, raw } of conditions) {
      if ((operator === 'gte' || operator === 'gt' || operator === 'lte' || operator === 'lt') && lower && upper) continue;
      const list = raw.split(',').map((value) => display(field, value));
      if (field.type === 'relation' && ['eq', 'ne', 'in', 'nin'].includes(operator)) {
        const prefix = operator === 'ne' || operator === 'nin' ? tr('filters.not') : '';
        ref = { field: name, ids: raw.split(','), prefix };
        parts.push(`${prefix}${raw.split(',').map((id) => `#${id}`).join(', ')}`);
        continue;
      }
      switch (operator) {
        case 'isNull':
          parts.push(tr(raw === 'true' ? 'filters.empty' : 'filters.notEmpty'));
          break;
        case 'ne':
        case 'nin':
          parts.push(`${tr('filters.not')}${list.join(', ')}`);
          break;
        case 'gte':
        case 'gt':
          parts.push(`≥ ${list[0]}`);
          break;
        case 'lte':
        case 'lt':
          parts.push(`≤ ${list[0]}`);
          break;
        case 'between':
          parts.push(list.join(' – '));
          break;
        case 'contains':
          parts.push(`“${raw}”`);
          break;
        case 'startsWith':
          parts.push(`${raw}…`);
          break;
        default:
          parts.push(list.join(', '));
      }
    }
    chips.push({ key: `filter:${name}`, label: field.label, value: parts.join('; '), ...(ref ? { ref } : {}), remove: conditions.map((condition) => condition.key) });
  }
  return chips;
}
