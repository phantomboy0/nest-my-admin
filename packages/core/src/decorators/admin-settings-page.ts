import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { ADMIN_PAGE_METADATA } from '../constants.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { LayoutConfig } from '../schema/field-config.js';
import type { AdminFieldOptions } from './admin-field.js';

export interface AdminSettingsPageOptions<T extends object = any> {
  /** `'Payments'` or `{ en: 'Payments', fa: 'پرداخت' }`. Defaults to the humanized page name. */
  label?: LocalizedText;
  /** Sidebar group key. Defaults to the group of the Nest module that provides the page. */
  group?: string;
  icon?: string;
  /**
   * The DTO describing the form: one field per property with a class-validator decorator. A save is validated like a
   * PATCH: only what was sent, whitelisted. `@AdminField` on its properties sets labels, help and widgets.
   */
  form: new (...args: any[]) => T;
  /**
   * Options per field, on top of the DTO's `@AdminField`s: labels, help, widgets, `showIf`, and `secret: true` for
   * write-only text fields. `readonly`, `readonlyIf` and `restricted` do not exist on pages.
   */
  fields?: { [K in Extract<keyof T, string>]?: AdminFieldOptions };
  /** Sections and tabs, like a resource's `form.layout`. */
  layout?: LayoutConfig;
}

/**
 * What a settings page class implements: where its values come from and where they go.
 *
 * - `load` returns the stored values (secrets included: the admin never serves them, it only reports whether each is set).
 * - `save` gets only the keys that were sent. A secret is a new non-empty string, or `null` to clear it; a file field
 *   is an `AdminFile` (store its `key`, which is what `load` returns) or `null`.
 *
 * Both run with the admin's context; `save` runs inside a transaction on the default DataSource (`ctx.manager`), and
 * `load` is called inside it too, before and after. Use `ctx.manager` when it is set: on Postgres and MySQL a write
 * on another connection is outside the transaction. Throw `AdminFieldError` (or an `HttpException`) from `save` to
 * refuse.
 */
export interface AdminSettingsSource<T extends object = Record<string, unknown>> {
  load(ctx: AdminContext): Partial<T> | Promise<Partial<T>>;
  save(changes: Partial<T>, ctx: AdminContext): void | Promise<void>;
}

export interface AdminSettingsPageDefinition extends AdminSettingsPageOptions {
  name: string;
}

/**
 * Marks a provider as a settings page: a singleton form under `/pages/<name>`, backed by the class's `load` and
 * `save` (`AdminSettingsSource`). Viewing it needs `page.<name>`, saving `page.<name>.update`. The name is letters,
 * digits, `-` and `_`, and not the name of a resource.
 */
export function AdminSettingsPage<T extends object>(name: string, options: AdminSettingsPageOptions<T>): ClassDecorator {
  return (target) => {
    const definition: AdminSettingsPageDefinition = { ...options, name };
    Reflect.defineMetadata(ADMIN_PAGE_METADATA, definition, target);
    Injectable()(target);
  };
}

export function getAdminSettingsPageDefinition(target: Function): AdminSettingsPageDefinition | undefined {
  return Reflect.getOwnMetadata(ADMIN_PAGE_METADATA, target);
}
