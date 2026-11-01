import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import request from 'supertest';
import {
  AdminAction,
  AdminField,
  AdminFieldError,
  AdminSource,
  AdminSourceBase,
  inMemoryList,
  type ActionOutcome,
  type AdminContext,
  type ListConfig,
  type ListParams,
} from '../src/index.js';
import type { ResourceSchema } from '../src/contract.js';
import { ADMIN_AUDIT_ENTITIES } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';

/** A row as the "API" answers it. */
class DnsRow {
  @IsString() id: string;
  @IsString() name: string;
  @IsIn(['a', 'cname', 'txt']) type: string;
  @IsString() value: string;
  @IsBoolean() cloud: boolean;
  @IsInt() ttl: number;
}

class CreateDnsDto {
  @IsString() @Length(1, 60) name: string;
  @IsIn(['a', 'cname', 'txt']) type: string;
  @IsString() @Length(1, 200) value: string;
  @IsOptional() @IsBoolean() cloud?: boolean;
}

class UpdateDnsDto {
  @IsOptional() @IsString() @Length(1, 200) value?: string;
  @IsOptional() @IsBoolean() cloud?: boolean;
}

class TtlDto {
  @IsInt() @Min(60) ttl: number;
}

/** The outside system: rows live here, not in a table. */
const remote = new Map<string, DnsRow>();
let nextId = 1;
const seed = () => {
  remote.clear();
  nextId = 1;
  for (const [name, type, value, cloud] of [
    ['www', 'a', '10.0.0.1', true],
    ['api', 'a', '10.0.0.2', true],
    ['mail', 'cname', 'mx.example.com', false],
    ['docs', 'cname', 'pages.example.com', true],
    ['@', 'txt', 'v=spf1 -all', false],
  ] as const) {
    const id = `r${nextId++}`;
    remote.set(id, { id, name, type, value, cloud, ttl: 120 });
  }
};
const seen: Array<{ method: string; manager: unknown }> = [];

@AdminSource(DnsRow, { name: 'dns', label: 'DNS records', title: 'name' })
class DnsAdmin extends AdminSourceBase<DnsRow, string> {
  list: ListConfig<DnsRow> = {
    columns: ['name', 'type', 'value', 'cloud'],
    search: ['name', 'value'],
    filters: ['type', 'cloud'],
    sort: 'name',
  };
  form = { create: CreateDnsDto, update: UpdateDnsDto };
  fields = { cloud: { label: 'Behind the CDN' } };

  async findMany(params: ListParams, ctx: AdminContext) {
    seen.push({ method: 'findMany', manager: ctx.manager });
    return inMemoryList([...remote.values()], params);
  }

  async findOne(id: string) {
    return remote.get(id) ?? null;
  }

  override async create(dto: object, ctx: AdminContext) {
    seen.push({ method: 'create', manager: ctx.manager });
    const input = dto as CreateDnsDto;
    if (input.name === 'taken') throw new AdminFieldError({ name: 'is taken at the provider' });
    const id = `r${nextId++}`;
    const row: DnsRow = { id, name: input.name, type: input.type, value: input.value, cloud: input.cloud ?? false, ttl: 120 };
    remote.set(id, row);
    return row;
  }

  override async update(id: string, dto: object) {
    const row = remote.get(id)!;
    Object.assign(row, dto);
    return row;
  }

  override async delete(id: string) {
    remote.delete(id);
  }

  @AdminAction({ label: 'Set TTL', input: TtlDto })
  async setTtl(row: DnsRow, input: TtlDto): Promise<ActionOutcome> {
    remote.get(row.id)!.ttl = input.ttl;
    return { message: `${row.name}: TTL ${input.ttl}` };
  }

  @AdminAction({ target: 'resource', label: 'Purge cache' })
  async purgeCache(): Promise<ActionOutcome> {
    return { message: `purged ${remote.size} records` };
  }
}

class BackupRow {
  @IsString() file: string;
  @IsInt() size: number;
  @AdminField({ label: 'Taken at' }) @IsString() takenAt: string;
}

/** A read-only source keyed by a field other than `id`. */
@AdminSource(BackupRow, { name: 'backup', primaryKey: 'file' })
class BackupAdmin extends AdminSourceBase<BackupRow, string> {
  list = { columns: ['file', 'size', 'takenAt'], sortable: ['takenAt'], sort: '-takenAt' as const };
  rows: BackupRow[] = [
    { file: 'a.sql.gz', size: 10, takenAt: '2026-10-30T01:00:00Z' },
    { file: 'b.sql.gz', size: 20, takenAt: '2026-10-31T01:00:00Z' },
  ];
  async findMany(params: ListParams) {
    return inMemoryList(this.rows, params);
  }
  async findOne(file: string) {
    return this.rows.find((row) => row.file === file) ?? null;
  }
}

@Module({ providers: [DnsAdmin, BackupAdmin] })
class SourcesModule {}

let app: INestApplication;
const api = () => request(app.getHttpServer());
const base = '/admin/api/resources';

beforeAll(async () => {
  app = await createTestApp({ imports: [SourcesModule] });
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  seed();
  seen.length = 0;
});

describe('schema and meta', () => {
  test('a source is listed and described like any resource', async () => {
    const meta = await api().get('/admin/api/meta');
    const names = meta.body.groups.flatMap((group: { resources: Array<{ name: string }> }) => group.resources.map((resource) => resource.name));
    expect(names).toEqual(expect.arrayContaining(['dns', 'backup']));
    const schema: ResourceSchema = (await api().get(`/admin/api/meta/resources/dns`)).body;
    expect(schema.primaryKeys).toEqual(['id']);
    expect(schema.fields.map((field) => [field.name, field.type])).toEqual([
      ['id', 'string'], ['name', 'string'], ['type', 'enum'], ['value', 'string'], ['cloud', 'boolean'], ['ttl', 'number'],
    ]);
    expect(schema.fields.find((field) => field.name === 'cloud')!.label).toBe('Behind the CDN');
    expect(schema.source).toEqual({ create: true, update: true, delete: true });
    expect(schema.creatable).toBe(true);
    expect(schema.form.create).toEqual(['name', 'type', 'value', 'cloud']);
    expect(schema.form.update).toEqual(['value', 'cloud']);
    expect(schema.softDelete).toBe(false);
    expect(schema.actions.map((action) => action.name)).toEqual(['setTtl', 'purgeCache']);
  });

  test('a source without writes offers none', async () => {
    const schema: ResourceSchema = (await api().get(`/admin/api/meta/resources/backup`)).body;
    expect(schema.primaryKeys).toEqual(['file']);
    expect(schema.source).toEqual({ create: false, update: false, delete: false });
    expect(schema.creatable).toBe(false);
    expect(schema.permissions).toEqual({ create: false, update: false, delete: false, purge: false });
    expect(schema.fields.find((field) => field.name === 'takenAt')!.label).toBe('Taken at');
  });
});

describe('list and get', () => {
  test('search, filters, sort and paging reach findMany, with no manager', async () => {
    const all = await api().get(`${base}/dns`);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(5);
    expect(all.body.items.map((item: { name: string }) => item.name)).toEqual(['@', 'api', 'docs', 'mail', 'www']);
    expect(seen).toEqual([{ method: 'findMany', manager: undefined }]);

    const cnames = await api().get(`${base}/dns?filter[type][eq]=cname&sort=-name`);
    expect(cnames.body.items.map((item: { name: string }) => item.name)).toEqual(['mail', 'docs']);
    const found = await api().get(`${base}/dns?search=example`);
    expect(found.body.items.map((item: { name: string }) => item.name)).toEqual(['docs', 'mail']);
    const paged = await api().get(`${base}/dns?page=2&pageSize=2`);
    expect(paged.body.items.map((item: { name: string }) => item.name)).toEqual(['docs', 'mail']);
    expect(paged.body.total).toBe(5);
  });

  test('a record by id, and 404 when findOne finds none', async () => {
    const one = await api().get(`${base}/dns/r1`);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ _id: 'r1', name: 'www', cloud: true, _title: 'www' });
    expect((await api().get(`${base}/dns/nope`)).status).toBe(404);
    const backup = await api().get(`${base}/backup/b.sql.gz`);
    expect(backup.body).toMatchObject({ _id: 'b.sql.gz', size: 20 });
  });
});

describe('writes', () => {
  test('create is validated by the create form, runs without a transaction and answers the row', async () => {
    const bad = await api().post(`${base}/dns`).send({ name: '', type: 'mx', value: 'x' });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.fields).sort()).toEqual(['name', 'type']);
    expect(remote.size).toBe(5);

    const created = await api().post(`${base}/dns`).send({ name: 'shop', type: 'a', value: '10.0.0.9' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ _id: 'r6', name: 'shop', cloud: false });
    expect(remote.get('r6')!.value).toBe('10.0.0.9');
    expect(seen).toEqual([{ method: 'create', manager: undefined }]);

    const refused = await api().post(`${base}/dns`).send({ name: 'taken', type: 'a', value: '1' });
    expect(refused.status).toBe(422);
    expect(refused.body.fields).toEqual({ name: ['is taken at the provider'] });
  });

  test('update takes only the update form; delete and bulk delete remove rows', async () => {
    const patched = await api().patch(`${base}/dns/r1`).send({ cloud: false });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ cloud: false, value: '10.0.0.1' });
    expect((await api().patch(`${base}/dns/r1`).send({ name: 'renamed' })).status).toBe(422);
    expect(remote.get('r1')!.name).toBe('www');

    expect((await api().delete(`${base}/dns/r2`)).status).toBe(204);
    expect(remote.has('r2')).toBe(false);
    const bulk = await api().post(`${base}/dns/bulk-delete`).send({ ids: ['r3', 'r4'] });
    expect(bulk.status).toBe(200);
    expect([...remote.keys()]).toEqual(['r1', 'r5']);
  });

  test('a source without writes refuses them (403) and keeps its rows', async () => {
    expect((await api().post(`${base}/backup`).send({ file: 'c', size: 1, takenAt: 'x' })).status).toBe(403);
    expect((await api().patch(`${base}/backup/a.sql.gz`).send({ size: 2 })).status).toBe(403);
    expect((await api().delete(`${base}/backup/a.sql.gz`)).status).toBe(403);
    expect((await api().get(`${base}/backup`)).body.total).toBe(2);
  });
});

describe('actions', () => {
  test('a record action gets the row from findOne; a resource action runs', async () => {
    const run = await api().post(`${base}/dns/actions/setTtl`).send({ ids: ['r1'], input: { ttl: 300 } });
    expect(run.status).toBe(200);
    expect(run.body.message).toBe('www: TTL 300');
    expect(remote.get('r1')!.ttl).toBe(300);
    expect((await api().post(`${base}/dns/actions/setTtl`).send({ ids: ['r1'], input: { ttl: 5 } })).status).toBe(422);
    const all = await api().post(`${base}/dns/actions/purgeCache`).send({});
    expect(all.body.message).toBe('purged 5 records');
  });
});

describe('search and audit', () => {
  test('global search finds source rows through findMany', async () => {
    const res = await api().get('/admin/api/search?q=example');
    const group = res.body.groups.find((candidate: { resource: string }) => candidate.resource === 'dns');
    expect(group.items.map((item: { _title: string }) => item._title).sort()).toEqual(['docs', 'mail']);
  });

  test('with the audit log on, source writes work and leave no entry', async () => {
    const audited = await createTestApp({ imports: [SourcesModule], entities: [...ADMIN_AUDIT_ENTITIES], admin: { audit: {} } });
    try {
      const http = () => request(audited.getHttpServer());
      expect((await http().post(`${base}/dns`).send({ name: 'logged', type: 'a', value: '1.1.1.1' })).status).toBe(201);
      expect((await http().patch(`${base}/dns/r1`).send({ value: '2.2.2.2' })).status).toBe(200);
      expect((await http().delete(`${base}/dns/r2`)).status).toBe(204);
      const log = await http().get('/admin/api/audit');
      expect(log.status).toBe(200);
      expect(log.body.entries.filter((entry: { resource?: string }) => entry.resource === "dns")).toEqual([]);
    } finally {
      await audited.close();
    }
  });
});

describe('boot checks', () => {
  const boot = async (provider: Function) => {
    @Module({ providers: [provider as never] })
    class BootModule {}
    const booted = await createTestApp({ imports: [BootModule] });
    await booted.close();
  };

  test('table-only features fail at boot with a sentence', async () => {
    @AdminSource(BackupRow, { name: 'tabbed', primaryKey: 'file' })
    class Tabbed extends AdminSourceBase<BackupRow, string> {
      list = { tabs: [{ key: 'big', label: 'Big', where: () => {} }] } as ListConfig<BackupRow>;
      async findMany(params: ListParams) {
        return inMemoryList([], params);
      }
      async findOne() {
        return null;
      }
    }
    await expect(boot(Tabbed)).rejects.toThrow('Tabbed: list.tabs: not available on an @AdminSource (it needs a database table)');

    @AdminSource(BackupRow, { name: 'pictured', primaryKey: 'file' })
    class Pictured extends AdminSourceBase<BackupRow, string> {
      fields = { file: { widget: 'image' as const } };
      async findMany(params: ListParams) {
        return inMemoryList([], params);
      }
      async findOne() {
        return null;
      }
    }
    await expect(boot(Pictured)).rejects.toThrow('the "image" widget is not available on an @AdminSource');
  });

  test('the row class and primary key are checked', async () => {
    class Bare {
      name: string;
    }
    @AdminSource(Bare, { name: 'bare' })
    class BareAdmin extends AdminSourceBase<Bare, string> {
      async findMany(params: ListParams) {
        return inMemoryList([], params);
      }
      async findOne() {
        return null;
      }
    }
    await expect(boot(BareAdmin)).rejects.toThrow('BareAdmin: row Bare: no property has a class-validator decorator');

    @AdminSource(BackupRow, { name: 'keyless' })
    class Keyless extends AdminSourceBase<BackupRow, string> {
      async findMany(params: ListParams) {
        return inMemoryList([], params);
      }
      async findOne() {
        return null;
      }
    }
    await expect(boot(Keyless)).rejects.toThrow('Keyless: primaryKey: "id" is not a decorated property of BackupRow');
  });

  test('@AdminSource needs AdminSourceBase', async () => {
    // The types refuse it too; the cast stands for plain JavaScript.
    @(AdminSource(BackupRow, { name: 'plain', primaryKey: 'file' }) as (target: Function) => void)
    class Plain {}
    await expect(boot(Plain)).rejects.toThrow('Plain is decorated with @AdminSource but does not extend AdminSourceBase');
  });
});
