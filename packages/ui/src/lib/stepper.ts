import type { FieldSchema } from '@nest-my-admin/core/contract';
import { formatTime, translate as tr } from '@/i18n';

export interface Step {
  key: string;
  label: string;
  state: 'done' | 'current' | 'future';
  /** When it was reached (`_steps`), as a time of day; null when not reached or not known. */
  at: string | null;
  /** Under the current step: «since HH:MM». */
  caption: string | null;
}

/**
 * The steps of a stepper field (spec §5.7): done before the record's value, current at it, future after. Without a
 * value, or with an excluded one (cancelled), every step is ahead and none is current.
 */
export function stepperModel(field: FieldSchema, value: unknown, reached: Record<string, string | null> | undefined): Step[] {
  const values = field.steps?.values ?? field.enumValues ?? [];
  const index = typeof value === 'string' ? values.indexOf(value) : -1;
  return values.map((key, position) => {
    const when = reached?.[key];
    const at = when ? formatTime(new Date(when)) : null;
    const state = index === -1 ? 'future' : position < index ? 'done' : position === index ? 'current' : 'future';
    return { key, label: field.enumLabels?.[key] ?? key, state, at: state === 'future' ? null : at, caption: state === 'current' && at ? tr('stepper.since', { time: at }) : null };
  });
}
