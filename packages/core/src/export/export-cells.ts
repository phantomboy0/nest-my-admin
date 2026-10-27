import type { FieldSchema, RelationRef } from '../contract.js';
import type { Cell } from './xlsx.js';

const YES_NO: Record<string, [string, string]> = { en: ['Yes', 'No'], fa: ['بله', 'خیر'] };

/** A decimal or bigint string as a number when a double holds it exactly, else the text. */
function numeric(text: string): number | string {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const digits = text.replace(/^-/, '').replace('.', '').replace(/^0+/, '');
  return digits.length <= 15 ? Number(text) : text;
}

/**
 * One exported cell from a serialized record value (`serializeRecord`): numbers stay numbers, enums show their labels,
 * relations their titles, booleans yes/no in `locale`, dates real dates. `offset` (minutes east of UTC) shifts
 * date-times to the exporter's clock, since a spreadsheet cell has no time zone.
 */
export function toCell(value: unknown, field: FieldSchema, locale: string, offset: number): Cell {
  if (value === null || value === undefined) return null;
  if (field.type === 'relation') {
    const refs = (Array.isArray(value) ? value : [value]) as RelationRef[];
    return refs.map((ref) => ref.title ?? String(ref.id)).join(locale.startsWith('fa') ? '، ' : ', ');
  }
  switch (field.type) {
    case 'number':
      return typeof value === 'number' ? value : String(value);
    case 'decimal':
    case 'bigint':
      return numeric(String(value));
    case 'boolean': {
      const [yes, no] = YES_NO[locale.split('-')[0]!] ?? YES_NO.en!;
      return value ? yes : no;
    }
    case 'enum':
      return field.enumLabels?.[String(value)] ?? String(value);
    case 'date': {
      const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
      return Number.isNaN(date.getTime()) ? String(value) : { date, time: false };
    }
    case 'datetime': {
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : { date: new Date(date.getTime() + offset * 60_000), time: true };
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}
