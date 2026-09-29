import { Inject, Injectable } from '@nestjs/common';
import type { AdminRecord, ListResponse, MetaResponse, ResourceSchema } from '../contract.js';
import { ADMIN_OPTIONS } from '../constants.js';
import { parseListQuery } from '../crud/list-query.js';
import { parseRecordId } from '../crud/record-id.js';
import { serializeRecord } from '../crud/serialize.js';
import { validateWrite } from '../crud/validate-write.js';
import { AdminNotFoundError } from '../errors.js';
import type { ResolvedAdminOptions } from '../options.js';
import { ResourceRegistry, type RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';

@Injectable()
export class AdminApiService {
  constructor(
    private readonly registry: ResourceRegistry,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  meta(): MetaResponse {
    const resources = this.registry.list();
    const groups = this.registry
      .groupList()
      .map((group) => ({
        group,
        resources: resources
          .filter((entry) => entry.schema.group === group.key)
          .map(({ schema }) => ({ name: schema.name, label: schema.label, ...(schema.icon ? { icon: schema.icon } : {}) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .filter((entry) => entry.resources.length > 0)
      .sort((a, b) => a.group.order - b.group.order || a.group.label.localeCompare(b.group.label))
      .map(({ group, resources: items }) => ({
        key: group.key,
        label: group.label,
        ...(group.icon ? { icon: group.icon } : {}),
        resources: items,
      }));
    return { schemaVersion: 1, title: this.options.title, groups };
  }

  schema(name: string): ResourceSchema {
    return this.registry.get(name).schema;
  }

  async list(name: string, query: URLSearchParams, ctx: AdminContext): Promise<ListResponse> {
    const { schema, resource } = this.registry.get(name);
    const params = parseListQuery(query, schema);
    const { items, total } = await resource.findMany(params, ctx);
    return { items: items.map((item) => serializeRecord(item, schema.fields)), total, page: params.page, pageSize: params.pageSize };
  }

  async get(name: string, rawId: string, ctx: AdminContext): Promise<AdminRecord> {
    const { schema, resource } = this.registry.get(name);
    const entity = await resource.findOne(parseRecordId(rawId, schema), ctx);
    if (!entity) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    return serializeRecord(entity, schema.fields);
  }

  async create(name: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const dto = await validateWrite(body, { allowed: schema.form.create, dto: resource.form?.create });
    const created: unknown = await resource.create(dto, ctx);
    if (typeof created !== 'object' || created === null) {
      throw new Error(`${entry.className}.create() must return the created entity`);
    }
    return serializeRecord(created, schema.fields);
  }

  async update(name: string, rawId: string, body: unknown, ctx: AdminContext): Promise<AdminRecord> {
    const entry = this.registry.get(name);
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    if (!(await resource.findOne(id, ctx))) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    const updateDto = resource.form?.update;
    const dto = await validateWrite(body, {
      allowed: schema.form.update,
      dto: updateDto ?? resource.form?.create,
      partial: !updateDto,
    });
    const updated: unknown = await resource.update(id, dto, ctx);
    return serializeRecord(await this.reloadIfEmpty(entry, updated, id, ctx), schema.fields);
  }

  /** Host services often return nothing from update(); fall back to reading the record. */
  private async reloadIfEmpty(entry: RegisteredResource, result: unknown, id: string | number, ctx: AdminContext): Promise<object> {
    if (typeof result === 'object' && result !== null) return result;
    const reloaded = await entry.resource.findOne(id, ctx);
    if (!reloaded) throw new AdminNotFoundError(`${entry.schema.label} "${id}" not found`);
    return reloaded;
  }
}
