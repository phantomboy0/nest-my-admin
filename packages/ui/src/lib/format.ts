import type { FieldSchema } from '@nest-my-admin/core/contract';

export function formatCell(value: unknown, field: FieldSchema): string {
  if (value === null || value === undefined) return '—';
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.type === 'json') return JSON.stringify(value);
  if (field.type === 'datetime') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }
  return String(value);
}
