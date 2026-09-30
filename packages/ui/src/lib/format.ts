import type { FieldSchema } from '@nest-my-admin/core/contract';

export function formatCell(value: unknown, field: FieldSchema): string {
  if (value === null || value === undefined) return '—';
  if (field.type === 'relation') {
    const refs = (Array.isArray(value) ? value : [value]) as Array<{ title?: unknown }>;
    return refs.length === 0 ? '—' : refs.map((ref) => String(ref.title)).join(', ');
  }
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'json' || field.type === 'object') return JSON.stringify(value);
  if (field.type === 'datetime') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  return String(value);
}
