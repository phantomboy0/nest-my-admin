import type { ComputedColumnSchema, ComputedValue, Tone } from '@nest-my-admin/core/contract';
import { formatNumber, formatNumberText } from '@/i18n';
import { formatMoney } from '@/lib/money';

/** What a computed cell shows (spec §5.4), ready to render: texts already in the chosen digits and units. */
export interface CellModel {
  kind: ComputedColumnSchema['kind'];
  text?: string;
  subline?: string;
  /** `money`: the unit and where it goes; `previous` is the struck earlier price. */
  unit?: string;
  unitPosition?: 'after' | 'before';
  previous?: string;
  tone?: Tone;
  /** `image`: its URL; absent for the placeholder. */
  src?: string;
  /** `toggle`. */
  on?: boolean;
}

const DASH = '—';
const isEmpty = (value: unknown) => value === null || value === undefined || value === '';

export function cellModel(column: ComputedColumnSchema, cell: ComputedValue | undefined): CellModel {
  const value = cell?.value;
  switch (column.kind) {
    case 'image':
      return typeof value === 'string' && value !== '' ? { kind: 'image', src: value } : { kind: 'image' };
    case 'toggle':
      return { kind: 'toggle', on: value === true };
    case 'money': {
      if (isEmpty(value)) return { kind: 'money', text: DASH };
      const money = formatMoney(String(value), isEmpty(cell?.previous) ? {} : { previous: String(cell!.previous) });
      return {
        kind: 'money',
        text: money.main,
        ...(money.unit ? { unit: money.unit, unitPosition: money.position } : {}),
        ...(money.previous !== undefined ? { previous: money.previous } : {}),
      };
    }
    case 'badge':
      return { kind: 'badge', text: cell?.label ?? (isEmpty(value) ? DASH : String(value)), ...(cell?.tone ? { tone: cell.tone } : {}) };
    case 'count':
      return { kind: 'count', text: typeof value === 'number' ? formatNumber(value) : isEmpty(value) ? DASH : formatNumberText(String(value)) };
    case 'title':
      return { kind: 'title', text: isEmpty(value) ? DASH : String(value), ...(isEmpty(cell?.subline) ? {} : { subline: String(cell!.subline) }) };
  }
}
