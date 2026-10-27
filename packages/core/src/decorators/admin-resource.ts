import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { ADMIN_RESOURCE_METADATA } from '../constants.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { TitleDefinition } from '../schema/titles.js';

export interface AdminResourceOptions {
  /** URL segment and permission prefix. Defaults to kebab-case of the entity class name. */
  name?: string;
  /** `'Orders'` or `{ en: 'Orders', fa: 'سفارش‌ها' }`. Defaults to the humanized entity name. */
  label?: LocalizedText;
  /** Sidebar group key. Defaults to the group of the Nest module that provides the resource. */
  group?: string;
  icon?: string;
  /**
   * Where the resource stands among the resources of its group: lower comes first, then by label. Default 100.
   * (A group lists its resources first, then its settings pages.)
   */
  order?: number;
  /**
   * Whether the resource has its own entry in the sidebar, home, group pages, palette and global search. Default
   * `true`, except for a resource another resource edits inline (`{ inline: ThisAdmin }` in a form layout): those are
   * edited on their parent's page and default to `false`. Either way the resource keeps its URLs, permissions,
   * history and audit entries.
   */
  nav?: boolean;
  /**
   * The record's display name in lists, pickers and headers: a column name, or a function of the entity.
   * Functions see columns (relations only when the loader joined them). Default: the first string column called
   * name, title, label, displayName, fullName, username, email, code or sku; else `#<id>`.
   */
  title?: TitleDefinition;
  /** TypeORM DataSource name. Defaults to the default DataSource. */
  dataSource?: string;
  /**
   * Nothing is created, changed or deleted through the admin, whatever the roles say: no New, Save, Delete, editable
   * cells or inline add and remove are offered, and the API answers 403. Its `@AdminAction`s still run (they need
   * `<resource>.action.<name>` and, on records, `<resource>.update` as usual). For logs, snapshots like orders, and
   * records only the host's own code writes.
   */
  readonly?: boolean;
  /** Custom permission codes of this resource: `['view_all']` declares `<name>.view_all` for roles and `ctx.can()`. */
  permissions?: string[];
}

export interface AdminResourceDefinition extends AdminResourceOptions {
  entity: Function;
}

/** Marks a provider as an admin resource for `entity`. The class must extend AdminResourceBase. */
export function AdminResource(entity: Function, options: AdminResourceOptions = {}): ClassDecorator {
  return (target) => {
    const definition: AdminResourceDefinition = { ...options, entity };
    Reflect.defineMetadata(ADMIN_RESOURCE_METADATA, definition, target);
    Injectable()(target);
  };
}

export function getAdminResourceDefinition(target: Function): AdminResourceDefinition | undefined {
  return Reflect.getOwnMetadata(ADMIN_RESOURCE_METADATA, target);
}
