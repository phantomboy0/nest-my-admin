import 'reflect-metadata';
import { ADMIN_GROUP_METADATA } from '../constants.js';
import type { LocalizedText } from '../i18n/localized-text.js';

export interface AdminGroupOptions {
  /** Defaults to kebab-case of the module class name without its `Module` suffix. */
  key?: string;
  /** `'Sales'` or `{ en: 'Sales', fa: 'فروش' }`. Defaults to the humanized module name. */
  label?: LocalizedText;
  icon?: string;
  /** Lower comes first in the sidebar. Default 100. */
  order?: number;
}

/** Customises the sidebar group formed by the resources a Nest module provides. */
export function AdminGroup(options: AdminGroupOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(ADMIN_GROUP_METADATA, options, target);
  };
}

export function getAdminGroupOptions(moduleClass: Function): AdminGroupOptions | undefined {
  return Reflect.getOwnMetadata(ADMIN_GROUP_METADATA, moduleClass);
}
