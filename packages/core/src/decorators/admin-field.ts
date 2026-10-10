import 'reflect-metadata';
import { ADMIN_FIELD_METADATA } from '../constants.js';
import type { LocalizedText } from '../i18n/localized-text.js';

/** Inputs and displays the UI has (spec §5.6). Rich text arrives with M4-1 task 3. */
export const WIDGETS = [
  'text', 'textarea', 'number', 'money', 'switch', 'checkbox', 'select', 'radio', 'date', 'datetime', 'json', 'color',
  'badge', 'slug', 'password', 'email', 'url', 'file', 'image',
] as const;
export type WidgetName = (typeof WIDGETS)[number];

/** Colours a badge value can take; the UI maps them to its palette in light and dark themes. */
export const BADGE_COLORS = ['gray', 'red', 'amber', 'green', 'blue', 'purple', 'pink'] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];

/** Options of a `file` or `image` field (spec §5.6, §8.2). */
export interface FileFieldOptions {
  /** Types allowed, matched against the sniffed type: `['image/*']`, `['application/pdf', 'image/png']`. Default: images for `image`, anything for `file`. */
  accept?: string[];
  /** Largest file in bytes. Default: `files.maxBytes` of the module (10 MiB). */
  maxBytes?: number;
  /** `private` (default): bytes are served only through the admin, after the record-view check. `public`: linked through `publicUrl` when the storage has one. */
  visibility?: 'public' | 'private';
}

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
  /** `file` and `image` widgets: type, size and visibility limits. */
  file?: FileFieldOptions;
  /** `file` and `image` widgets on a json column: a list of files instead of one. */
  many?: boolean;
  /**
   * Hidden from everyone but superusers and roles that grant `<resource>.field.<name>.view|edit` or name the field
   * in their `fields` rules (spec §6.2).
   */
  restricted?: boolean;
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
