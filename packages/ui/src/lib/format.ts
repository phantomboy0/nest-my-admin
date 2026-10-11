import type { FieldSchema } from '@nest-my-admin/core/contract';
import { formatDate, formatDateTime, formatNumberText, translate as tr } from '@/i18n';
import { groupMoney } from '@/lib/money';

export function formatCell(value: unknown, field: FieldSchema): string {
  if (value === null || value === undefined) return '—';
  if (field.type === 'relation') {
    const refs = (Array.isArray(value) ? value : [value]) as Array<{ title?: unknown }>;
    return refs.length === 0 ? '—' : refs.map((ref) => String(ref.title)).join(', ');
  }
  if (field.file) return (Array.isArray(value) ? value : [value]).map((key) => String(key).split('/').pop()).join(', ') || '—';
  if (field.widget === 'richtext') return richTextExcerpt(String(value)) || '—';
  if (field.type === 'boolean') return tr(value ? 'common.yes' : 'common.no');
  if (field.type === 'enum') return field.enumLabels?.[String(value)] ?? String(value);
  if (field.widget === 'money') return `${formatNumberText(groupMoney(String(value), field.scale))}${field.currency ? ` ${field.currency}` : ''}`;
  if (field.type === 'number' || field.type === 'decimal' || field.type === 'bigint') return formatNumberText(String(value));
  if (field.type === 'date') return formatDate(String(value));
  if (field.type === 'json' || field.type === 'object') return JSON.stringify(value);
  if (field.type === 'datetime') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : formatDateTime(date);
  }
  return String(value);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** The text of rich-text HTML for lists and titles: tags dropped, blocks separated by a space, at most `max` characters. */
export function richTextExcerpt(html: string, max = 120): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name]!)
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}
