import type { FieldConstraints, FieldSchema } from '@nest-my-admin/core/contract';

export type Widget = NonNullable<FieldSchema['widget']>;

/** The widget a field is edited with: the one configured, else one that fits its type and format. */
export function widgetOf(field: FieldSchema, constraints?: FieldConstraints): Widget {
  if (field.widget) return field.widget;
  switch (field.type) {
    case 'boolean':
      return 'checkbox';
    case 'enum':
      return 'select';
    case 'text':
      return 'textarea';
    case 'json':
    case 'object':
      return 'json';
    case 'number':
    case 'decimal':
    case 'bigint':
      return 'number';
    case 'date':
      return 'date';
    case 'datetime':
      return 'datetime';
    default:
      return constraints?.format === 'email' ? 'email' : constraints?.format === 'url' ? 'url' : 'text';
  }
}

/** A value's display label: the configured enum label, else the value itself. */
export function enumLabel(field: FieldSchema, value: string): string {
  return field.enumLabels?.[value] ?? value;
}
