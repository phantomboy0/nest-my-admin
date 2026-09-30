import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { ADMIN_OPTIONS } from '../constants.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { ResourceSchema } from '../contract.js';
import { getAdminGroupOptions } from '../decorators/admin-group.js';
import { getAdminResourceDefinition, type AdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminNotFoundError } from '../errors.js';
import { AdminResourceBase } from '../resource/admin-resource-base.js';
import { buildResourceSchema } from '../schema/build-resource-schema.js';
import { humanize, kebabCase } from '../schema/humanize.js';

export interface RegisteredResource {
  schema: ResourceSchema;
  resource: AdminResourceBase<any>;
  className: string;
  entity: Function;
  /** Database column name → entity property name (for mapping constraint errors to fields). */
  columnProperties: ReadonlyMap<string, string>;
}

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
      this.register(metatype.name, definition, instance, moduleGroup);
    }
    if (this.options.autoRegister) this.registerAutoResources();
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
    this.resources.set(schema.name, {
      schema,
      resource,
      className,
      entity: definition.entity,
      columnProperties: new Map(metadata.columns.map((column) => [column.databaseName, column.propertyName])),
    });
  }

  private registerAutoResources(): void {
    let dataSource: DataSource;
    try {
      dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(), { strict: false });
    } catch {
      throw new Error('nest-my-admin: autoRegister needs the default TypeORM DataSource (TypeOrmModule.forRoot())');
    }
    const covered = new Set(this.list().map((entry) => entry.entity));
    for (const metadata of dataSource.entityMetadatas) {
      const entity = metadata.target;
      if (typeof entity !== 'function' || covered.has(entity) || metadata.tableType !== 'regular') continue;
      if (metadata.primaryColumns.length !== 1) {
        this.logger.warn(`autoRegister skipped ${entity.name}: composite primary keys are not supported yet`);
        continue;
      }
      if (this.resources.has(kebabCase(entity.name))) {
        this.logger.warn(`autoRegister skipped ${entity.name}: a resource named "${kebabCase(entity.name)}" already exists`);
        continue;
      }
      if (!this.groups.has(AUTO_GROUP.key)) this.groups.set(AUTO_GROUP.key, { ...AUTO_GROUP });
      try {
        this.register(`${entity.name}Admin (auto)`, { entity, group: AUTO_GROUP.key }, new AutoRegisteredResource(), AUTO_GROUP.key);
      } catch (error) {
        this.logger.warn(`autoRegister skipped ${entity.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
