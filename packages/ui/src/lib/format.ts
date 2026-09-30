import type { FieldSchema } from '@nest-my-admin/core/contract';
import { formatDateTime, translate as tr } from '@/i18n';
import { groupMoney } from '@/lib/money';

export function formatCell(value: unknown, field: FieldSchema): string {
  if (value === null || value === undefined) return '—';
  if (field.type === 'relation') {
    const refs = (Array.isArray(value) ? value : [value]) as Array<{ title?: unknown }>;
    return refs.length === 0 ? '—' : refs.map((ref) => String(ref.title)).join(', ');
  }
  if (field.type === 'boolean') return tr(value ? 'common.yes' : 'common.no');
  if (field.type === 'enum') return field.enumLabels?.[String(value)] ?? String(value);
  if (field.widget === 'money') return `${groupMoney(String(value), field.scale)}${field.currency ? ` ${field.currency}` : ''}`;
  if (field.type === 'json' || field.type === 'object') return JSON.stringify(value);
  if (field.type === 'datetime') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : formatDateTime(date);
  }
  return String(value);
}
