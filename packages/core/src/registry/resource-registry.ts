import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource, EntityMetadata } from 'typeorm';
import { ADMIN_OPTIONS } from '../constants.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { ResourceSchema } from '../contract.js';
import { resolveActions, toActionSchema, type RegisteredAction } from '../decorators/admin-action.js';
import { resolvePrints, toPrintSchema, type RegisteredPrint } from '../decorators/admin-print.js';
import { getAdminGroupOptions } from '../decorators/admin-group.js';
import { getAdminResourceDefinition, type AdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminNotFoundError } from '../errors.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { buildResourceSchema } from '../schema/build-resource-schema.js';
import { getAdminFieldOptions } from '../decorators/admin-field.js';
import { nestedProtected, protectedInside, protectedOption, type ProtectedInside } from '../schema/dto-form.js';
import { dtoPropertyNames } from '../schema/dto-fields.js';
import { mergeFieldConfig, withIdLabel, type FieldConfig } from '../schema/field-config.js';
import { operatorsFor } from '../schema/filter-operators.js';
import { relationFields, type RelationLike } from '../schema/relation-fields.js';
import { compileTitle, type TitleFn } from '../schema/titles.js';
import type { LocalizedText } from '../i18n/localized-text.js';
import { humanize, kebabCase } from '../schema/humanize.js';
import { dbNamesFor, type DbNames } from './db-names.js';
import { hookWarnings } from './hook-warnings.js';
import { resolveInlines, type RegisteredInline } from '../inlines/inline-config.js';
import { checkTabs } from '../crud/list-tabs.js';
import { addComputedSort, checkComputed, type ChildQuery, type CompiledComputed } from '../crud/computed-columns.js';
import type { ComputedColumn } from '../resource/admin-resource-base.js';

export interface RegisteredResource {
  schema: ResourceSchema;
  resource: AdminResourceBase<any>;
  className: string;
  entity: Function;
  dataSource: DataSource;
  /** Database column and constraint names → entity properties (for mapping constraint errors to fields). */
  dbNames: DbNames;
  metadata: EntityMetadata;
  /** Relation fields by field name. */
  relations: ReadonlyMap<string, RelationMetadataLike>;
  /** The record's display name (`@AdminResource({ title })`). */
  title: TitleFn;
  /** Relation fields sortable by their target's title column: field → path (`customer` → `customer.name`). */
  sortPaths: Map<string, string>;
  /** The resource label as configured, in every language it was given in. */
  label: LocalizedText;
  /** For each `schema.related` entry: the field's label when it is shown as "Resource (Field)". */
  relatedFieldLabels: Array<string | undefined>;
  /** Merged field options (`@AdminField` and `fields`), texts in every language given. */
  fieldConfig: Map<string, FieldConfig>;
  /** The resource's `@AdminAction`s by name, in declaration order, texts in every language given. */
  actions: ReadonlyMap<string, RegisteredAction>;
  /** The resource's `@AdminPrint` templates by name. */
  prints: ReadonlyMap<string, RegisteredPrint>;
  /** `list.export`, checked: the columns (field names) and the row cap; absent when the list has no export. */
  export?: { columns: string[]; max: number };
  /** Where the resource stands among the resources of its group (`@AdminResource({ order })`, default 100). */
  order: number;
  /** Stepper fields with a history child: where their «reached at» times come from (spec §5.7). */
  steppers: Map<string, { child: RegisteredResource; link: string; value: string; at: string; where: Record<string, string> }>;
  /** `list.computed`, checked and compiled at boot (spec §5.4). */
  computed: Map<string, CompiledComputed>;
  /** Listed in navigation (sidebar, home, group pages, palette, global search): `nav`, else false for inline children. */
  nav: boolean;
  /** The `nav` option as set, before the inline-child default is applied. */
  navOption?: boolean;
  /** The child resources its form edits inline (`{ inline: ChildAdmin }` in `form.layout`), in layout order. */
  inlines: RegisteredInline[];
}

/** TypeORM's RelationMetadata as the admin reads it (TypeORM does not export the class from its root). */
export type RelationMetadataLike = RelationLike & { inverseEntityMetadata: EntityMetadata };

export interface RegisteredGroup {
  key: string;
  label: LocalizedText;
  icon?: string;
  order: number;
}

const DEFAULT_GROUP_ORDER = 100;

/** `order` of a resource or a settings page that sets none: the same default as a group's. */
export const DEFAULT_MEMBER_ORDER = 100;

/** The `order` option of a resource or a settings page, checked at boot. */
export function memberOrder(order: unknown, fail: (message: string) => never): number {
  if (order === undefined) return DEFAULT_MEMBER_ORDER;
  if (typeof order !== 'number' || !Number.isFinite(order)) return fail(`\`order\` must be a finite number, got ${typeof order === 'string' ? JSON.stringify(order) : String(order)}`);
  return order;
}

const AUTO_GROUP = { key: 'entities', label: 'Entities', order: 1000 } as const;

/** Method and property names of the base class: an action that took one over would replace how the admin reads or writes. */
const BASE_MEMBERS = [...Object.getOwnPropertyNames(AdminResourceBase.prototype), 'list', 'form', 'fields'];

/** Default resource used by autoRegister. */
class AutoRegisteredResource extends AdminResourceBase {}

@Injectable()
export class ResourceRegistry implements OnModuleInit {
  private readonly logger = new Logger('NestMyAdmin');
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly groups = new Map<string, RegisteredGroup>();
  /** Groups known by key alone so far: a module with that key replaces the placeholder. */
  private readonly keyedGroups = new Set<string>();
  /** What the `@AdminGroup` modules say about each key (see `claims()`). */
  private groupClaims?: Map<string, RegisteredGroup>;
  /** Titles of entities that have no resource (targets of relations), compiled on first use. */
  private readonly defaultTitles = new WeakMap<EntityMetadata, TitleFn>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly moduleRef: ModuleRef,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  onModuleInit(): void {
    const seen = new Set<object>();
    for (const wrapper of this.discovery.getProviders()) {
      const metatype = wrapper.metatype;
      if (typeof metatype !== 'function') continue;
      const definition = getAdminResourceDefinition(metatype);
      if (!definition) continue;

      const instance: unknown = wrapper.instance;
      if (!wrapper.isDependencyTreeStatic() || !instance) {
        throw new Error(`${metatype.name}: admin resources must be singleton-scoped providers`);
      }
      if (seen.has(instance)) continue;
      seen.add(instance);
      if (!(instance instanceof AdminResourceBase)) {
        throw new Error(`${metatype.name} is decorated with @AdminResource but does not extend AdminResourceBase`);
      }
      const moduleGroup = this.registerModuleGroup(wrapper.host?.metatype);
      for (const warning of hookWarnings(instance, metatype.name)) this.logger.warn(warning);
      this.register(metatype.name, definition, instance, moduleGroup);
    }
    this.registerAutoResources(this.options.autoRegister);
    this.linkRelations();
    resolveInlines(this.list());
    // Stepper histories: the child resource that logs the field's changes, linked to this resource.
    for (const entry of this.list()) {
      for (const [field, options] of entry.fieldConfig) {
        if (options.widget !== 'stepper' || !options.history) continue;
        const where = `${entry.className}: fields.${field}.history`;
        const child = this.list().find((candidate) => candidate.resource.constructor === options.history!.inline);
        if (!child) throw new Error(`${where}: inline is not a registered admin resource`);
        const link = [...child.relations].find(([, relation]) => relation.inverseEntityMetadata.target === entry.entity)?.[1].propertyName;
        if (!link) throw new Error(`${where}: ${child.schema.name} has no relation to ${entry.schema.name}`);
        const { value, at } = options.history;
        const whereFields = options.history.where ?? {};
        for (const name of [value, at, ...Object.keys(whereFields)]) {
          if (!child.schema.fields.some((candidate) => candidate.name === name)) throw new Error(`${where}: unknown field "${name}" on ${child.schema.name}`);
        }
        entry.steppers.set(field, { child, link, value, at, where: whereFields });
      }
    }
    // Relation aside cards: the target resource and its fields, now that every resource is known.
    for (const entry of this.list()) {
      for (const [index, card] of (entry.schema.form.aside ?? []).entries()) {
        if (!card.relation) continue;
        const where = `${entry.className}: form.layout.aside[${index}]`;
        const target = entry.schema.fields.find((field) => field.name === card.relation!.field)?.relation?.resource;
        const targetEntry = target ? this.find(target) : undefined;
        if (!targetEntry) throw new Error(`${where}: the relation "${card.relation.field}" points at an entity without an admin resource`);
        card.relation.resource = targetEntry.schema.name;
        for (const field of card.fields) {
          if (!targetEntry.schema.fields.some((candidate) => candidate.name === field)) throw new Error(`${where}: unknown field "${field}" on ${targetEntry.schema.name}`);
        }
      }
    }
    // Sortable computed columns order by a subquery over the rows the viewer may read.
    for (const entry of this.list()) {
      if (![...entry.computed.values()].some((column) => column.column.sortable)) continue;
      entry.resource.attachComputedSort((qb, field, ctx) => {
        const column = entry.computed.get(field);
        return column?.column.sortable ? addComputedSort(qb, column, entry.metadata, ctx, this.childQuery) : undefined;
      });
    }
    // Inline children are edited on their parent's page: out of navigation unless they ask to stay.
    for (const child of this.list().flatMap((entry) => entry.inlines.map((inline) => inline.child))) {
      if (child.navOption === undefined) child.nav = false;
    }
    // A parent and its inlines are saved together or not at all: a promise only a transaction can keep.
    const parent = this.list().find((entry) => entry.inlines.length > 0);
    if (parent && !this.options.transactions) {
      throw new Error(`${parent.className}: form.layout has inlines, which are saved with their parent in one transaction; the admin's transactions are off (\`transactions: false\`)`);
    }
  }

  /** A child entity's rows as `ctx`'s user may read them: through its resource (query() and scopes) when it has one. */
  readonly childQuery: ChildQuery = (entity, alias, ctx) => {
    const child = this.list().find((entry) => entry.entity === entity);
    if (child) return child.resource.readQuery(alias, ctx);
    const owner = this.list().find((entry) => entry.dataSource.hasMetadata(entity));
    const manager = ctx?.manager ?? owner?.dataSource.manager;
    if (!manager) throw new Error(`nest-my-admin: no DataSource holds ${entity.name}`);
    return manager.getRepository(entity).createQueryBuilder(alias);
  };

  get(name: string): RegisteredResource {
    const entry = this.resources.get(name);
    if (!entry) throw new AdminNotFoundError(`Unknown resource "${name}"`);
    return entry;
  }

  find(name: string): RegisteredResource | undefined {
    return this.resources.get(name);
  }

  list(): RegisteredResource[] {
    return [...this.resources.values()];
  }

  /** The resource registered for an entity class on a DataSource (the first one, when several share it). */
  forEntity(entity: Function | string, dataSource: DataSource): RegisteredResource | undefined {
    for (const entry of this.resources.values()) if (entry.entity === entity && entry.dataSource === dataSource) return entry;
    return undefined;
  }

  /** How records of an entity are titled: its resource's `title`, or the default for its columns. */
  titleFor(metadata: EntityMetadata, dataSource: DataSource): TitleFn {
    const entry = this.forEntity(metadata.target, dataSource);
    if (entry) return entry.title;
    let title = this.defaultTitles.get(metadata);
    if (!title) {
      title = compileTitle(undefined, metadata, (message) => {
        throw new Error(message);
      });
      this.defaultTitles.set(metadata, title);
    }
    return title;
  }

  groupList(): RegisteredGroup[] {
    return [...this.groups.values()];
  }

  /**
   * The group each `@AdminGroup` module configures, by key: the label, icon and order of that key's group, whoever its
   * members are (the module's own resources and pages, or those of other modules that say `group: '<key>'`) and
   * whichever provider is discovered first. Read from every module of the app, so a module that only carries the
   * decorator counts. Two modules with one key: the first in discovery order wins, with a warning when they differ.
   */
  private claims(): Map<string, RegisteredGroup> {
    if (this.groupClaims) return this.groupClaims;
    const claims = new Map<string, RegisteredGroup>();
    const owners = new Map<string, Function>();
    // Every module is a provider of itself, so the hosts of all providers are all the modules.
    const modules = new Set<Function>();
    for (const wrapper of this.discovery.getProviders()) {
      const moduleClass = wrapper.host?.metatype;
      if (typeof moduleClass === 'function') modules.add(moduleClass);
    }
    for (const moduleClass of modules) {
      if (!getAdminGroupOptions(moduleClass)) continue;
      const group = groupOfModule(moduleClass);
      const first = claims.get(group.key);
      if (!first) {
        claims.set(group.key, group);
        owners.set(group.key, moduleClass);
      } else if (owners.get(group.key) !== moduleClass && JSON.stringify(first) !== JSON.stringify(group)) {
        const winner = owners.get(group.key)!.name;
        this.logger.warn(`@AdminGroup "${group.key}" is configured by ${winner} and differently by ${moduleClass.name}; ${winner} wins. Keep the label, icon and order of a group on one module.`);
      }
    }
    return (this.groupClaims = claims);
  }

  /** The sidebar group of a Nest module (`@AdminGroup` customises it), created on first use; answers its key. */
  registerModuleGroup(moduleClass: Function | undefined): string {
    const own = groupOfModule(moduleClass);
    // A group first named by key only (`group: 'settings'`) is the module's all the same, whichever was seen first.
    if (!this.groups.has(own.key) || this.keyedGroups.delete(own.key)) this.groups.set(own.key, this.claims().get(own.key) ?? own);
    return own.key;
  }

  /**
   * A group named by key (`group: 'settings'`): the group an `@AdminGroup` module configures for that key, else one
   * with a humanized label (which a module named like the key replaces when it turns up).
   */
  ensureGroup(key: string): string {
    if (!this.groups.has(key)) {
      const claimed = this.claims().get(key);
      this.groups.set(key, claimed ?? { key, label: humanize(key), order: DEFAULT_GROUP_ORDER });
      if (!claimed) this.keyedGroups.add(key);
    }
    return key;
  }

  private register(
    className: string,
    definition: AdminResourceDefinition,
    resource: AdminResourceBase<any>,
    moduleGroup: string,
  ): void {
    const dataSourceName = definition.dataSource ?? 'default';
    let dataSource: DataSource;
    try {
      dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(dataSourceName), { strict: false });
    } catch {
      throw new Error(`${className}: TypeORM DataSource "${dataSourceName}" not found; is TypeOrmModule.forRoot() imported?`);
    }
    if (!dataSource.hasMetadata(definition.entity)) {
      throw new Error(`${className}: entity ${definition.entity.name} is not registered in DataSource "${dataSourceName}"`);
    }
    const metadata = dataSource.getMetadata(definition.entity);
    resource.attachRepository(dataSource.getRepository(definition.entity));

    const order = memberOrder(definition.order, (message) => {
      throw new Error(`${className}: ${message}`);
    });
    const schema = buildResourceSchema({ definition, resource, metadata, moduleGroup, className });
    checkTabs(schema, resource.list?.tabs, (message) => {
      throw new Error(`${className}: ${message}`);
    });
    const computed = checkComputed(resource.list?.computed as Record<string, ComputedColumn> | undefined, metadata, (name) => schema.fields.find((field) => field.name === name)?.enumValues, (message) => {
      throw new Error(`${className}: ${message}`);
    });
    const actions = resolveActions(resource.constructor, BASE_MEMBERS, (message) => {
      throw new Error(`${className}: ${message}`);
    });
    // All-or-nothing is a promise only a transaction can keep.
    const atomic = [...actions.values()].find((action) => action.atomic);
    if (atomic && !this.options.transactions) {
      throw new Error(`${className}: @AdminAction "${atomic.name}" is \`atomic\`, which needs the admin's transactions; they are off (\`transactions: false\`)`);
    }
    // Texts in the first language given, like the fields; AdminApiService localizes per request.
    schema.actions = [...actions.values()].map((action) => toActionSchema(action, '', ''));
    const prints = resolvePrints(resource.constructor, [...BASE_MEMBERS, ...actions.keys()], (message) => {
      throw new Error(`${className}: ${message}`);
    });
    schema.prints = [...prints.values()].map((print) => toPrintSchema(print, '', ''));
    const exported = checkExport(resource.list?.export, schema, (message) => {
      throw new Error(`${className}: list.export: ${message}`);
    });
    if (exported) schema.list.export = { max: exported.max };
    const existing = this.resources.get(schema.name);
    if (existing) {
      throw new Error(
        `Duplicate admin resource name "${schema.name}" (${existing.className} and ${className}); set a unique @AdminResource({ name })`,
      );
    }
    this.ensureGroup(schema.group);
    const title = compileTitle(definition.title, metadata, (message) => {
      throw new Error(`${className}: ${message}`);
    });
    const relations = new Map(
      relationFields(metadata).map(({ field, relation }) => [field.name, relation as RelationMetadataLike]),
    );
    // `sensitive`, `secret` and the `password` widget are options of the resource's own fields: inside a group (a
    // nested DTO, an embedded entity) nothing reads them, and the audit log would store the value all the same.
    for (const dto of new Set([resource.form?.create, resource.form?.update])) {
      for (const name of dto ? dtoPropertyNames(dto) : []) {
        const inside = nestedProtected(dto!, name);
        if (inside) throw new Error(`${className}: ${protectedInside(name, inside)}`);
      }
    }
    for (const embedded of metadata.embeddeds) {
      const inside = embeddedProtected(embedded);
      if (inside) throw new Error(`${className}: ${protectedInside(embedded.propertyName, inside)}`);
    }
    this.resources.set(schema.name, {
      schema,
      resource,
      className,
      entity: definition.entity,
      dataSource,
      dbNames: dbNamesFor(metadata),
      metadata,
      relations,
      title,
      sortPaths: new Map(),
      label: definition.label ?? schema.label,
      relatedFieldLabels: [],
      fieldConfig: withIdLabel(
        schema.fields,
        mergeFieldConfig([definition.entity, resource.form?.create, resource.form?.update ?? resource.form?.create], resource.fields as Record<string, FieldConfig | undefined>),
      ),
      actions,
      prints,
      ...(exported ? { export: exported } : {}),
      order,
      computed,
      steppers: new Map(),
      nav: definition.nav ?? true,
      ...(definition.nav !== undefined ? { navOption: definition.nav } : {}),
      inlines: [],
    });
  }

  /** Points each relation field at the resource of its target entity, now that every resource is registered. */
  /**
   * Once every resource is known: points each relation field at its target's resource, lists it on the target as a
   * related list (making the field filterable for that link), and makes to-one relations sortable by the target's
   * title column when the title is one.
   */
  private linkRelations(): void {
    for (const entry of this.resources.values()) {
      const { schema } = entry;
      for (const [name, relation] of entry.relations) {
        const field = schema.fields.find((candidate) => candidate.name === name);
        if (!field?.relation) continue;
        const targetMetadata = relation.inverseEntityMetadata;
        const target = this.forEntity(targetMetadata.target, entry.dataSource);
        if (target) {
          field.relation.resource = target.schema.name;
          const operator = field.relation.kind === 'to-one' ? 'eq' : 'in';
          const several = [...entry.relations.values()].filter((other) => other.inverseEntityMetadata === targetMetadata).length > 1;
          target.schema.related.push({ label: several ? `${schema.label} (${field.label})` : schema.label, resource: schema.name, field: name, operator });
          target.relatedFieldLabels.push(several ? field.label : undefined);
          if (!schema.list.filters.some((filter) => filter.field === name)) schema.list.filters.push({ field: name, operators: operatorsFor(field) });
        }
        const titleColumn = this.titleFor(targetMetadata, entry.dataSource).column;
        const nullableSortsOk = schema.list.pagination !== 'keyset';
        if (field.relation.kind === 'to-one' && titleColumn && nullableSortsOk && !schema.list.sortable.includes(name)) {
          schema.list.sortable.push(name);
          entry.sortPaths.set(name, `${relation.propertyName}.${titleColumn}`);
        }
      }
    }
  }

  /**
   * A default resource for every entity of the listed DataSources that has none. A name already taken is prefixed
   * with the DataSource name (`reports-widget`) outside the default DataSource, and skipped with a warning in it.
   */
  private registerAutoResources(dataSourceNames: string[]): void {
    for (const dataSourceName of dataSourceNames) {
      let dataSource: DataSource;
      try {
        dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(dataSourceName), { strict: false });
      } catch {
        throw new Error(`nest-my-admin: autoRegister needs the TypeORM DataSource "${dataSourceName}" (TypeOrmModule.forRoot())`);
      }
      for (const metadata of dataSource.entityMetadatas) {
        const entity = metadata.target;
        if (typeof entity !== 'function' || this.forEntity(entity, dataSource) || !['regular', 'entity-child'].includes(metadata.tableType)) continue;
        let name = kebabCase(entity.name);
        if (this.resources.has(name)) {
          const prefixed = `${kebabCase(dataSourceName)}-${name}`;
          if (dataSourceName === 'default' || this.resources.has(prefixed)) {
            this.logger.warn(`autoRegister skipped ${entity.name}: a resource named "${name}" already exists`);
            continue;
          }
          this.logger.warn(`autoRegister named ${entity.name} of DataSource "${dataSourceName}" "${prefixed}": "${name}" is taken`);
          name = prefixed;
        }
        if (!this.groups.has(AUTO_GROUP.key)) this.groups.set(AUTO_GROUP.key, { ...AUTO_GROUP });
        try {
          const definition = { entity, name, group: AUTO_GROUP.key, dataSource: dataSourceName };
          this.register(`${entity.name}Admin (auto)`, definition, new AutoRegisteredResource(), AUTO_GROUP.key);
        } catch (error) {
          this.logger.warn(`autoRegister skipped ${entity.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}

/** The group a module forms by itself: its `@AdminGroup` options over the defaults from its class name. */
function groupOfModule(moduleClass: Function | undefined): RegisteredGroup {
  const baseName = moduleClass ? moduleClass.name.replace(/Module$/, '') || moduleClass.name : 'General';
  const options = moduleClass ? getAdminGroupOptions(moduleClass) : undefined;
  return {
    key: options?.key ?? kebabCase(baseName),
    label: options?.label ?? humanize(baseName),
    ...(options?.icon ? { icon: options.icon } : {}),
    order: options?.order ?? DEFAULT_GROUP_ORDER,
  };
}

/** The first `@AdminField` with a protected option in an embedded entity or the ones inside it, if any. */
function embeddedProtected(embedded: { type: Function | string; embeddeds: unknown[] }): ProtectedInside | undefined {
  if (typeof embedded.type === 'function') {
    for (const [name, options] of Object.entries(getAdminFieldOptions(embedded.type))) {
      const option = protectedOption(options);
      if (option) return { where: `${embedded.type.name}.${name}`, option };
    }
  }
  for (const child of embedded.embeddeds) {
    const deeper = embeddedProtected(child as { type: Function | string; embeddeds: unknown[] });
    if (deeper) return deeper;
  }
  return undefined;
}

/** Rows an export may hold by default, and at most. */
const EXPORT_MAX = 10_000;
const EXPORT_LIMIT = 100_000;

/** `list.export` checked against the schema: field columns only (not computed ones), a sane row cap. */
function checkExport(option: unknown, schema: ResourceSchema, fail: (message: string) => never): { columns: string[]; max: number } | undefined {
  if (option === undefined || option === false) return undefined;
  if (option !== true && (typeof option !== 'object' || option === null)) fail('use true or { columns?, max? }');
  const config = option === true ? {} : (option as { columns?: unknown; max?: unknown });
  const fields = new Set(schema.fields.map((field) => field.name));
  const columns = config.columns ?? schema.list.columns.filter((name) => fields.has(name));
  if (!Array.isArray(columns) || columns.length === 0) fail('columns must be a non-empty list of field names');
  for (const name of columns as unknown[]) if (typeof name !== 'string' || !fields.has(name)) fail(`unknown field "${String(name)}"`);
  const max = config.max ?? EXPORT_MAX;
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > EXPORT_LIMIT) fail(`max must be an integer from 1 to ${EXPORT_LIMIT}`);
  return { columns: columns as string[], max: max as number };
}
