import 'reflect-metadata';
import { ADMIN_FIELD_METADATA } from '../constants.js';
import type { LocalizedText } from '../i18n/localized-text.js';

/** Inputs and displays the UI has (spec §5.6). Rich text and files arrive with uploads (M4). */
export const WIDGETS = [
  'text', 'textarea', 'number', 'money', 'switch', 'checkbox', 'select', 'radio', 'date', 'datetime', 'json', 'color',
  'badge', 'slug', 'password', 'email', 'url',
] as const;
export type WidgetName = (typeof WIDGETS)[number];

/** Colours a badge value can take; the UI maps them to its palette in light and dark themes. */
export const BADGE_COLORS = ['gray', 'red', 'amber', 'green', 'blue', 'purple', 'pink'] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];

type ShowIfValue = string | number | boolean | null;

/** Static field options: on entity or DTO properties (`@AdminField`) and in a resource's `fields` config. */
export interface AdminFieldOptions {
  label?: LocalizedText;
  /** A sentence under the input. */
  help?: LocalizedText;
  placeholder?: LocalizedText;
  widget?: WidgetName;
  /** Labels of enum values (`{ draft: { en: 'Draft', fa: 'پیش‌نویس' } }`); the values sent stay the raw ones. */
  enumLabels?: Record<string, LocalizedText>;
  /** Badge colour per value, for the `badge` widget. */
  colors?: Record<string, BadgeColor>;
  /** Shown only while other fields have these values (evaluated live in the browser; not a permission). */
  showIf?: Record<string, ShowIfValue | ShowIfValue[]>;
  /** Shown on edit forms but never written by update. */
  readonly?: boolean;
  /** The `slug` widget fills itself from this field until someone edits it. */
  slugFrom?: string;
  /** Currency code shown with the `money` widget (display only). */
  currency?: string;
}

/** Customises how a property appears in the admin (spec §5.3 layer 3). Later layers (resource `fields`) win. */
export function AdminField(options: AdminFieldOptions): PropertyDecorator {
  return (target, property) => {
    const owner = target.constructor;
    const inherited = (Reflect.getMetadata(ADMIN_FIELD_METADATA, owner) as Record<string, AdminFieldOptions> | undefined) ?? {};
    Reflect.defineMetadata(ADMIN_FIELD_METADATA, { ...inherited, [String(property)]: { ...inherited[String(property)], ...options } }, owner);
  };
}

export function getAdminFieldOptions(target: Function | undefined): Record<string, AdminFieldOptions> {
  return (target && (Reflect.getMetadata(ADMIN_FIELD_METADATA, target) as Record<string, AdminFieldOptions> | undefined)) ?? {};
}
