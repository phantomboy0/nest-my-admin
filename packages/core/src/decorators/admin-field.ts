import 'reflect-metadata';
import { ADMIN_FIELD_METADATA } from '../constants.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { AdminCurrency } from '../schema/currency.js';

/** Inputs and displays the UI has (spec §5.6). */
export const WIDGETS = [
  'text', 'textarea', 'number', 'money', 'switch', 'checkbox', 'select', 'radio', 'date', 'datetime', 'json', 'color',
  'badge', 'slug', 'password', 'email', 'url', 'file', 'image', 'richtext',
] as const;
export type WidgetName = (typeof WIDGETS)[number];

/** Colours a badge value can take; the UI maps them to its palette in light and dark themes. */
export const BADGE_COLORS = ['gray', 'red', 'amber', 'green', 'blue', 'purple', 'pink'] as const;
export type BadgeColor = (typeof BADGE_COLORS)[number];

/** Options of a `file` or `image` field (spec §5.6, §8.2). On a `richtext` field only `maxBytes` and `visibility` apply (to the images of the editor). */
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
  /** A soft warning under the input while the field is empty (an image without alt text): it never stops a save. */
  warnIf?: { empty: true; message: LocalizedText };
  /** The `slug` widget fills itself from this field until someone edits it. */
  slugFrom?: string;
  /** The unit shown with the `money` widget (display only): a code such as `USD`, or a unit and its position. Wins over the global `currency`. */
  currency?: string | AdminCurrency;
  /** `file` and `image` widgets: type, size and visibility limits; `richtext`: `maxBytes` and `visibility` of editor images. */
  file?: FileFieldOptions;
  /** `file` and `image` widgets on a json column: a list of files instead of one. */
  many?: boolean;
  /**
   * Hidden from everyone but superusers and roles that grant `<resource>.field.<name>.view|edit` or name the field
   * in their `fields` rules (spec §6.2).
   */
  restricted?: boolean;
  /**
   * Settings pages only (`@AdminSettingsPage`): a write-only text field, such as an API key. Its value is never
   * served: the form shows whether one is stored, replaces it with what is typed, and clears it on request.
   */
  secret?: boolean;
  /**
   * The audit log never stores this field's values: a change is recorded as "changed" only (a salary, a national id,
   * a token). On a resource's field, a settings page's field, or a property of an action's input DTO, which is then
   * left out of the recorded input. `password`-widget fields and `secret` fields are sensitive without it.
   */
  sensitive?: boolean;
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
