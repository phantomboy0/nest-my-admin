import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { ADMIN_WIDGET_METADATA } from '../constants.js';
import type { WidgetData, WidgetParams, WidgetType } from '../contract.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { AdminContext } from '../resource/admin-context.js';

export interface AdminWidgetOptions {
  type: WidgetType;
  title: LocalizedText;
  /** Lower comes first on the dashboard. Default 100. */
  order?: number;
  /** Columns it spans on the desktop grid (4 columns; phones show one). Default 1. */
  size?: 1 | 2 | 3 | 4;
  /** The permission that shows it. Default `dashboard.<name>`; widgets may share one. */
  permission?: string;
}

/**
 * What a dashboard widget class implements: its data for a period (spec §5.8). Return the shape of its `type`:
 * `stat`, `chart`, `table`, `progress` or `list` (`WidgetData`). The admin checks the permission and the period first.
 */
export interface AdminWidgetSource {
  load(params: WidgetParams, ctx: AdminContext): Promise<WidgetData>;
}

export interface AdminWidgetDefinition extends AdminWidgetOptions {
  name: string;
}

/** A dashboard widget: a provider whose `load` answers its data. The dashboard replaces the home page once one exists. */
export function AdminWidget(name: string, options: AdminWidgetOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(ADMIN_WIDGET_METADATA, { ...options, name } satisfies AdminWidgetDefinition, target);
    Injectable()(target);
  };
}

export function getAdminWidgetDefinition(target: Function): AdminWidgetDefinition | undefined {
  return Reflect.getOwnMetadata(ADMIN_WIDGET_METADATA, target);
}
