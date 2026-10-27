import { afterEach, describe, expect, test } from 'bun:test';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { applyDisplay, applyLocale } from '@/i18n';
import { stepperModel } from './stepper';

const field = {
  name: 'fulfillment', label: 'Fulfillment', type: 'enum', nullable: true, primary: false, readonly: false, persisted: true,
  enumValues: ['queued', 'confirmed', 'preparing', 'cancelled'],
  enumLabels: { queued: 'Queued', confirmed: 'Confirmed', preparing: 'Preparing', cancelled: 'Cancelled' },
  widget: 'stepper',
  steps: { values: ['queued', 'confirmed', 'preparing'], exclude: ['cancelled'], history: true },
} as FieldSchema;
const reached = { queued: '2026-10-25T10:42:00.000Z', confirmed: '2026-10-25T10:50:00.000Z' };
const states = (value: string | null) => stepperModel(field, value, reached).map((step) => step.state);

describe('stepper', () => {
  afterEach(() => {
    applyLocale('en');
    applyDisplay({ calendar: 'gregorian', digits: 'latn' });
  });

  test('done before the value, current at it, future after', () => {
    expect(states('queued')).toEqual(['current', 'future', 'future']);
    expect(states('confirmed')).toEqual(['done', 'current', 'future']);
    expect(states('preparing')).toEqual(['done', 'done', 'current']);
  });

  test('no value: every step ahead; an excluded value: no current step', () => {
    expect(states(null)).toEqual(['future', 'future', 'future']);
    expect(states('cancelled')).toEqual(['future', 'future', 'future']);
  });

  test('labels, the time each step was reached, and «since» under the current one', () => {
    const steps = stepperModel(field, 'confirmed', reached);
    expect(steps.map((step) => step.label)).toEqual(['Queued', 'Confirmed', 'Preparing']);
    expect(steps[0]!.at).toMatch(/\d{2}:\d{2}/);
    expect(steps[1]!.caption).toMatch(/^since \d{2}:\d{2}$/);
    expect(steps[2]).toMatchObject({ at: null, caption: null });
  });
});
