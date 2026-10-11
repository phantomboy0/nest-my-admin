import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ADMIN_OPTIONS } from '../constants.js';
import { getAdminFieldOptions } from '../decorators/admin-field.js';
import { getAdminSettingsPageDefinition, type AdminSettingsPageDefinition, type AdminSettingsSource } from '../decorators/admin-settings-page.js';
import { AdminNotFoundError } from '../errors.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import { RESOURCE_OPERATIONS, pageCode } from '../policy/roles.js';
import { ResourceRegistry } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import { buildDtoForm, type DtoForm } from '../schema/dto-form.js';
import { dtoPropertyNames, type DtoClass } from '../schema/dto-fields.js';
import { checkLayout, type FieldConfig, type LayoutConfig } from '../schema/field-config.js';
import { humanize } from '../schema/humanize.js';
import { nestedTypeOf } from '../schema/nested-fields.js';

export interface RegisteredPage {
  /** URL segment (`/api/pages/<name>`) and permission segment (`page.<name>`). */
  name: string;
  className: string;
  /** The label as configured, in every language it was given in. */
  label: LocalizedText;
  group: string;
  icon?: string;
  dto: DtoClass;
  /** The form built from the DTO; texts in every language given. */
  form: DtoForm;
  layout?: LayoutConfig;
  /** Names of the `secret` fields: never served. */
  secrets: string[];
  source: AdminSettingsSource<any>;
  /** The default DataSource: a save runs in a transaction on it. */
  dataSource: DataSource;
}

/** Page names that are a segment of other permission codes: `*.update` must never grant a page called "update". */
const RESERVED_NAMES: readonly string[] = [...RESOURCE_OPERATIONS, 'field', 'action'];

/** Options that mean something on a resource's field only. */
const RESOURCE_ONLY = ['readonly', 'readonlyIf', 'restricted'] as const;

/** Discovers `@AdminSettingsPage` providers, checks them at boot and keeps them by name. */
@Injectable()
export class PageRegistry implements OnModuleInit, OnApplicationBootstrap {
  private readonly pages = new Map<string, RegisteredPage>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly moduleRef: ModuleRef,
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  onModuleInit(): void {
    const seen = new Set<object>();
    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype;
      if (typeof metatype !== 'function') continue;
      const definition = getAdminSettingsPageDefinition(metatype);
      if (!definition) continue;
      const instance: unknown = wrapper.instance;
      if (!wrapper.isDependencyTreeStatic() || !instance) throw new Error(`${metatype.name}: settings pages must be singleton-scoped providers`);
      if (seen.has(instance)) continue;
      seen.add(instance);
      this.register(metatype.name, definition, instance, wrapper.host?.metatype);
    }
  }

  /** Once every resource is registered too: a page shares neither a name nor a permission code with anything else. */
  onApplicationBootstrap(): void {
    if (this.pages.size === 0) return;
    const reserved = this.registry.find('page');
    if (reserved) throw new Error(`${reserved.className}: a resource cannot be named "page" in an admin with settings pages (their permission codes are page.<name>)`);
    // `page:<name>` is how a page's files name their owner: no resource may look like one.
    const lookalike = this.registry.list().find((entry) => entry.schema.name.startsWith('page:'));
    if (lookalike) throw new Error(`${lookalike.className}: a resource name cannot start with "page:" in an admin with settings pages`);
    for (const page of this.pages.values()) {
      const resource = this.registry.find(page.name);
      if (resource) throw new Error(`${page.className}: the page name "${page.name}" is the name of a resource (${resource.className}); give the page another name`);
      for (const code of [pageCode(page.name), pageCode(page.name, 'update')]) {
        if (this.options.permissions.includes(code)) throw new Error(`nest-my-admin: the permission "${code}" is the code of a settings page (${page.className}); remove it from \`permissions\``);
      }
    }
  }

  get(name: string): RegisteredPage {
    const page = this.pages.get(name);
    if (!page) throw unknownPage(name);
    return page;
  }

  find(name: string): RegisteredPage | undefined {
    return this.pages.get(name);
  }

  list(): RegisteredPage[] {
    return [...this.pages.values()];
  }

  private register(className: string, definition: AdminSettingsPageDefinition, instance: object, moduleClass: Function | undefined): void {
    const fail = (message: string): never => {
      throw new Error(`${className}: ${message}`);
    };
    const { name, form, layout, icon, label } = definition;
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(name)) fail(`the page name "${String(name)}" must be letters, digits, - and _`);
    if (RESERVED_NAMES.includes(name)) fail(`the page name "${name}" is reserved (${RESERVED_NAMES.join(', ')})`);
    const existing = this.pages.get(name);
    if (existing) throw new Error(`Duplicate settings page name "${name}" (${existing.className} and ${className})`);
    if (typeof form !== 'function') fail('@AdminSettingsPage needs `form`: a DTO class');
    const source = instance as Partial<AdminSettingsSource<any>>;
    if (typeof source.load !== 'function' || typeof source.save !== 'function') fail('a settings page needs load(ctx) and save(changes, ctx) methods');

    const built = buildDtoForm(form, definition.fields as Record<string, FieldConfig | undefined> | undefined, fail, { secrets: true });
    for (const [field, config] of built.config) {
      // Silently ignoring `restricted` would leave a field open that its author believes hidden.
      const unsupported = RESOURCE_ONLY.find((option) => config[option] !== undefined);
      if (unsupported) fail(`fields.${field}: \`${unsupported}\` is not supported on settings pages`);
    }
    // Only the page's own fields have options: a `secret` inside a group would be served like any other value.
    for (const field of built.fields) {
      const inside = field.type === 'object' ? nestedSecret(form, field.name) : undefined;
      if (inside) fail(`fields.${field.name}: a \`secret\` field cannot be inside a group (${inside}); make it a field of the page itself`);
    }
    if (layout) checkLayout(layout, built.fields.map((field) => field.name), fail);

    let dataSource: DataSource;
    try {
      dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(), { strict: false });
    } catch {
      return fail('settings pages save in a transaction on the default TypeORM DataSource, which was not found; is TypeOrmModule.forRoot() imported?');
    }
    this.pages.set(name, {
      name,
      className,
      label: label ?? humanize(name),
      group: definition.group !== undefined ? this.registry.ensureGroup(definition.group) : this.registry.registerModuleGroup(moduleClass),
      ...(icon ? { icon } : {}),
      dto: form,
      form: built,
      ...(layout ? { layout } : {}),
      secrets: [...built.config].filter(([, config]) => config.secret === true).map(([field]) => field),
      source: source as AdminSettingsSource<any>,
      dataSource,
    });
  }
}

/** `Class.property` of the first `@AdminField({ secret: true })` in the DTOs nested under a property, if any. */
function nestedSecret(dto: DtoClass, property: string, seen = new Set<DtoClass>()): string | undefined {
  const nested = nestedTypeOf(dto, property)?.type;
  if (!nested || seen.has(nested)) return undefined;
  seen.add(nested);
  for (const [name, options] of Object.entries(getAdminFieldOptions(nested))) if (options.secret) return `${nested.name}.${name}`;
  for (const name of dtoPropertyNames(nested)) {
    const deeper = nestedSecret(nested, name, seen);
    if (deeper) return deeper;
  }
  return undefined;
}

export const unknownPage = (name: string): AdminNotFoundError => new AdminNotFoundError(`Unknown page "${name}"`);

/** The page's stored values, as its `load()` gives them (secrets included: callers decide what leaves). */
export async function loadPage(page: RegisteredPage, ctx: AdminContext): Promise<Record<string, unknown>> {
  const values: unknown = await page.source.load(ctx);
  if (typeof values !== 'object' || values === null || Array.isArray(values)) throw new Error(`${page.className}.load() must return an object of the page's values`);
  return values as Record<string, unknown>;
}
