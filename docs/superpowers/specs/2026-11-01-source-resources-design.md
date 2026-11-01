# Source resources: admin lists whose rows are not database rows

Status: owner said "just do option (a)" (2026-11-01); the design below is the builder's, not reviewed line by line.

## Why

nest-my-admin shows only TypeORM entities. Hosts with data that lives elsewhere (an HTTP API, files, live process
state) mirror it into a table to get a list page. The first host doing that is mosallas-manager: its DNS records (Arvan
API) and backups (files on the server) are copied into SQLite, with a Sync button and minute-old data. Settings pages
already solved the one-form case with `load`/`save`; this does the same for lists.

## What

```ts
export class DnsRecordRow {            // the row: class-validator decorators make the fields, like an action DTO
  @IsString() id: string;
  @IsString() name: string;
  @IsIn(['a', 'cname']) type: string;
  @IsBoolean() cloud: boolean;
}

@AdminSource(DnsRecordRow, { name: 'dns-record', label: 'DNS records', primaryKey: 'id' }) // primaryKey defaults to 'id'
export class DnsRecordSource extends AdminSourceBase<DnsRecordRow, string> {
  list: ListConfig<DnsRecordRow> = { columns: ['name', 'type', 'cloud'], search: ['name'], filters: ['type'], sort: 'name' };
  form = { create: CreateDnsDto, update: UpdateDnsDto };   // as on any resource
  async findMany(params: ListParams, ctx: AdminContext) { return inMemoryList(await this.arvan.list(), params); }
  async findOne(id: string, ctx: AdminContext) { … }               // null → 404
  override async create(dto: object, ctx: AdminContext) { … }      // optional: no New/403 without it
  override async update(id: string, dto: object, ctx: AdminContext) { … } // optional
  override async delete(id: string, ctx: AdminContext) { … }      // optional
  @AdminAction({ label: 'Re-check' }) async recheck(row: DnsRecordRow) { … }
}
```

- A source is a resource like any other in the UI: list (search, filters, sort, paging), record page, create, edit,
  delete, bulk delete, record/bulk/resource actions, `@AdminField` config, `form.layout`, permissions
  (`<name>.view|create|update|delete`, field rules, `@AdminCan` record rules), menu, badges via `findMany`, global
  search when `list.search` is set.
- `findMany(params)` gets the same `ListParams` a table resource's `findMany` gets (already filtered to the fields the viewer
  may use) and returns `{ items, total }`. `inMemoryList(rows, params)` does search, filters, sort and paging in
  memory for sources that fetch everything (most will).
- Ids are strings on the wire as always; `findOne`/`update`/`delete` get the decoded id (a string, or a number when the
  primary key field is a number).
- Writes: validated against the create/update DTO like a resource's; no transaction and no `ctx.manager` (there is no
  DataSource). Errors map like resource errors (`AdminFieldError` → 422, HttpException passes).

## Not for sources (boot fails with a sentence saying so)

Relations and relation pickers, inlines (as parent or child), computed columns, list tabs, keyset pagination,
`list.count` other than exact, soft delete/restore/purge, versions (If-Match), steppers with history, export and
print templates (later), row scopes (`scopes` are query filters: sources are skipped by them; `appliesTo` is a function, so this is documented rather than checked), the audit log (writes to a source are not audited in this
version; documented).

## How (as built)

- The source class is the resource: `AdminSourceBase` extends `AdminResourceBase`, so the API service, actions and
  policy keep one path. Its default `create`/`update`/`delete` throw 403; `AdminSourceBase.writesOf` tells which ones a
  class overrides, and the schema's `source: { create, update, delete }` turns the others off in the UI and the policy.
- The row class is turned into a stand-in for TypeORM metadata (`sourceMetadata`: one column per class-validator
  property, the primary keys marked), so `buildResourceSchema` and every `list`/`form`/`fields` check run unchanged.
- `RegisteredResource` gets `source?: true`, and `dataSource` becomes optional; readers that need it check.
- Writes of sources skip `WriteRunner`'s transaction and participants (files, audit).
- Version 0.8.0: a new resource kind is a minor release in 0.x.
