import 'reflect-metadata';
import { ADMIN_GROUP_METADATA } from '../constants.js';

export interface AdminGroupOptions {
  /** Defaults to kebab-case of the module class name without its `Module` suffix. */
  key?: string;
  label?: string;
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
