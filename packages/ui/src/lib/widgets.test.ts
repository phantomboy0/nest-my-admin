import { describe, expect, test } from 'bun:test';
import type { FieldSchema } from '@nest-my-admin/core/contract';
import { enumLabel, widgetOf } from './widgets';

const field = (type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name: 'x', label: 'X', type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});

describe('widgetOf', () => {
  test('the configured widget wins', () => {
    expect(widgetOf(field('decimal', { widget: 'money' }))).toBe('money');
    expect(widgetOf(field('boolean', { widget: 'switch' }))).toBe('switch');
  });
  test('inferred from type and format', () => {
    expect(widgetOf(field('boolean'))).toBe('checkbox');
    expect(widgetOf(field('enum'))).toBe('select');
    expect(widgetOf(field('text'))).toBe('textarea');
    expect(widgetOf(field('json'))).toBe('json');
    expect(widgetOf(field('bigint'))).toBe('number');
    expect(widgetOf(field('datetime'))).toBe('datetime');
    expect(widgetOf(field('string'), { format: 'email' })).toBe('email');
    expect(widgetOf(field('string'))).toBe('text');
  });
  test('enum labels fall back to the value', () => {
    const status = field('enum', { enumValues: ['draft', 'live'], enumLabels: { draft: 'Draft' } });
    expect(enumLabel(status, 'draft')).toBe('Draft');
    expect(enumLabel(status, 'live')).toBe('live');
  });
});
