import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource, EntityMetadata } from 'typeorm';
import { ADMIN_OPTIONS } from '../constants.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { ResourceSchema } from '../contract.js';
import { getAdminGroupOptions } from '../decorators/admin-group.js';
import { getAdminResourceDefinition, type AdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminNotFoundError } from '../errors.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { buildResourceSchema } from '../schema/build-resource-schema.js';
import { operatorsFor } from '../schema/filter-operators.js';
import { relationFields, type RelationLike } from '../schema/relation-fields.js';
import { compileTitle, type TitleFn } from '../schema/titles.js';
import { humanize, kebabCase } from '../schema/humanize.js';
import { dbNamesFor, type DbNames } from './db-names.js';
import { hookWarnings } from './hook-warnings.js';

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
}

/** TypeORM's RelationMetadata as the admin reads it (TypeORM does not export the class from its root). */
export type RelationMetadataLike = RelationLike & { inverseEntityMetadata: EntityMetadata };

export interface RegisteredGroup {
  key: string;
  label: string;
  icon?: string;
  order: number;
}

const DEFAULT_GROUP_ORDER = 100;

const AUTO_GROUP = { key: 'entities', label: 'Entities', order: 1000 } as const;

/** Default resource used by autoRegister. */
class AutoRegisteredResource extends AdminResourceBase {}

@Injectable()
export class ResourceRegistry implements OnModuleInit {
  private readonly logger = new Logger('NestMyAdmin');
  private readonly resources = new Map<string, RegisteredResource>();
  private readonly groups = new Map<string, RegisteredGroup>();
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
  }

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

  private registerModuleGroup(moduleClass: Function | undefined): string {
    const baseName = moduleClass ? moduleClass.name.replace(/Module$/, '') || moduleClass.name : 'General';
    const options = moduleClass ? getAdminGroupOptions(moduleClass) : undefined;
    const key = options?.key ?? kebabCase(baseName);
    if (!this.groups.has(key)) {
      this.groups.set(key, {
        key,
        label: options?.label ?? humanize(baseName),
        ...(options?.icon ? { icon: options.icon } : {}),
        order: options?.order ?? DEFAULT_GROUP_ORDER,
      });
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

    const schema = buildResourceSchema({ definition, resource, metadata, moduleGroup, className });
    const existing = this.resources.get(schema.name);
    if (existing) {
      throw new Error(
        `Duplicate admin resource name "${schema.name}" (${existing.className} and ${className}); set a unique @AdminResource({ name })`,
      );
    }
    if (!this.groups.has(schema.group)) {
      this.groups.set(schema.group, { key: schema.group, label: humanize(schema.group), order: DEFAULT_GROUP_ORDER });
    }
    const title = compileTitle(definition.title, metadata, (message) => {
      throw new Error(`${className}: ${message}`);
    });
    const relations = new Map(
      relationFields(metadata).map(({ field, relation }) => [field.name, relation as RelationMetadataLike]),
    );
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
