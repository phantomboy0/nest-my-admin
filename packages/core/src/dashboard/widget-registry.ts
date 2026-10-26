import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { getAdminWidgetDefinition, type AdminWidgetDefinition, type AdminWidgetSource } from '../decorators/admin-widget.js';

const TYPES = ['stat', 'chart', 'table', 'progress', 'list'];

export interface RegisteredWidget extends AdminWidgetDefinition {
  className: string;
  source: AdminWidgetSource;
  order: number;
  size: 1 | 2 | 3 | 4;
  /** The permission that shows it (`dashboard.<name>` unless the widget names one). */
  code: string;
}

/** The dashboard's widgets (`@AdminWidget` providers), checked at module init and kept in order. */
@Injectable()
export class WidgetRegistry implements OnModuleInit {
  private widgets: RegisteredWidget[] = [];

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const seen = new Set<object>();
    const out: RegisteredWidget[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype;
      if (typeof metatype !== 'function') continue;
      const definition = getAdminWidgetDefinition(metatype);
      if (!definition) continue;
      const instance = wrapper.instance as Partial<AdminWidgetSource> | undefined;
      const fail = (message: string): never => {
        throw new Error(`${metatype.name}: @AdminWidget("${definition.name}"): ${message}`);
      };
      if (!wrapper.isDependencyTreeStatic() || !instance) fail('widgets must be singleton-scoped providers');
      if (seen.has(instance!)) continue;
      seen.add(instance!);
      if (typeof definition.name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(definition.name)) fail('the name must be letters, digits, - and _');
      if (out.some((widget) => widget.name === definition.name)) fail('the name is used twice');
      if (!TYPES.includes(definition.type)) fail(`unknown type "${String(definition.type)}" (use ${TYPES.join(', ')})`);
      const size = definition.size ?? 1;
      if (![1, 2, 3, 4].includes(size)) fail('size is 1, 2, 3 or 4 columns');
      const order = definition.order ?? 100;
      if (!Number.isFinite(order)) fail('order must be a finite number');
      if (typeof instance!.load !== 'function') fail('a widget needs load(params, ctx)');
      const code = definition.permission ?? `dashboard.${definition.name}`;
      if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(code) || code.includes('*')) fail(`permission "${code}" must be a permission code`);
      out.push({ ...definition, className: metatype.name, source: instance as AdminWidgetSource, order, size, code });
    }
    this.widgets = out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  list(): RegisteredWidget[] {
    return this.widgets;
  }

  find(name: string): RegisteredWidget | undefined {
    return this.widgets.find((widget) => widget.name === name);
  }

  /** Every widget permission code (for role checks and the role editor's catalog). */
  codes(): string[] {
    return [...new Set(this.widgets.map((widget) => widget.code))];
  }
}
