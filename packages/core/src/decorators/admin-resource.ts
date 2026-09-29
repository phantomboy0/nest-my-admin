import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { ADMIN_RESOURCE_METADATA } from '../constants.js';

export interface AdminResourceOptions {
  /** URL segment and permission prefix. Defaults to kebab-case of the entity class name. */
  name?: string;
  label?: string;
  /** Sidebar group key. Defaults to the group of the Nest module that provides the resource. */
  group?: string;
  icon?: string;
  /** TypeORM DataSource name. Defaults to the default DataSource. */
  dataSource?: string;
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
