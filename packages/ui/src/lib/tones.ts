import type { FieldSchema, Tone } from '@nest-my-admin/core/contract';

export type BadgeColor = NonNullable<FieldSchema['colors']>[string];

const TONES: Record<BadgeColor, Tone> = { gray: 'neutral', red: 'bad', amber: 'warn', green: 'ok', blue: 'info', purple: 'primary', pink: 'bad' };

/** The design has five status tones and the accent; a field's older badge colours map onto them. */
export function toneOf(color: BadgeColor): Tone {
  return TONES[color] ?? 'neutral';
}
