# M1c-3 — Entity Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entities that are not one flat table with one key work in the admin:
- composite primary keys (encoded record ids);
- embedded columns and nested DTOs (sub-forms, and arrays of sub-forms);
- single-table inheritance (one resource per child entity);
- `@VersionColumn` optimistic concurrency (a 409 carrying the current record);
- `@DeleteDateColumn` soft delete (trash, restore and purge endpoints).

**Architecture:**
- **Record ids.** Every record carries `_id`, the encoded record id the UI puts in URLs. `parseRecordId` turns it back into a scalar (one key) or a key object (composite).
- **Nested fields.** Embedded columns and `@ValidateNested` DTO properties become `object` fields with child `fields`. Writes send nested objects, and field errors use dotted paths (`address.city`, `lines.0.qty`), as class-validator already reports them.
- **Inheritance.** Child entities of single-table inheritance get their own resources (autoRegister included). The root resource lists every row with its discriminator and cannot create.
- **Versions.** When a resource has a version column, the UI sends `If-Match: "<version>"` on PATCH and DELETE. The API locks the row inside the write transaction and compares, answering a stale write with 409 `CONFLICT` plus `current`.
- **Soft delete.** With a delete-date column, the default `delete` soft-deletes. Lists accept `trashed=only|with`, and new restore and purge endpoints call new resource methods.

**Tech Stack:** unchanged from M1c-2 (no new dependencies).

**Spec:** §5.4 (embedded → nested group, inheritance → one resource per child, composite keys → encoded ids, `@VersionColumn` → 409 + diff dialog, `@DeleteDateColumn` → trash/restore/purge), §5.3 (`@ValidateNested` + `@Type` → sub-form / array of sub-forms), §9.4 (409 → diff dialog), §11 (error codes). Plan 3 of 4 for M1c: M1c-1 database matrix → M1c-2 relations → **M1c-3 entity shapes** (this plan) → M1c-4 lists at scale. Also `m0-followups.md` (record id `new` shadowed by the create route; distinguishable version conflicts; nested DTOs; CHECK constraints → 422).

**Findings this plan is built on** (spike on 2026-09-30 on sql.js, Postgres 17 and MySQL 8.4; nothing committed):
- **Embedded columns.** `@Column(() => Address) address` gives columns with `embeddedMetadata`, `propertyName: 'city'` and `propertyPath: 'address.city'` (database name `addressCity`). `metadata.embeddeds[0]` has `propertyName: 'address'` and its `columns`. `WHERE entity.address.city = :c` and `ORDER BY entity.address.city` work on all three drivers. Entities load `address` as an `Address` instance.
- **Single-table inheritance.** With `@TableInheritance` the root metadata is `tableType: 'regular'` and holds every child's columns plus the discriminator column (`isDiscriminator: true`). Children are `tableType: 'entity-child'` with `discriminatorValue` and only their own and the inherited columns. A child repository's queries filter by the discriminator automatically, and the root repository returns child instances.
- **Composite keys.** `findOneBy({ orderId: 1, sku: 'a,b' })` works. Key values may contain `,` or `~`.
- **Versions.** `save()` of a stale entity silently overwrites a newer version on every driver (the version just increments). `find({ lock: { mode: 'optimistic', version } })` only checks at read time, so the admin must compare inside its transaction, holding a row lock on Postgres and MySQL (SQLite writes are already serialized).
- **Soft delete.** `softRemove` sets `deletedAt`. Query builders exclude deleted rows unless `.withDeleted()` is called, and `restore(id)` clears it. The admin's default `delete` currently calls `remove()`, a hard delete, even when the entity has a delete-date column.

## Global Constraints

- All earlier Global Constraints still apply (exact pins, `.js` imports, isolated mount, error contract, per-app test databases, no AI attribution, never commit `.idea/` or `.serena/`).
- **Encoded record ids.** Each key part is `String(value)` with `~` → `~0` and `,` → `~1`, parts joined by `,` in primary-column order. An encoded id that equals `new` is written `~new`, so the UI's `/:resource/new` route never shadows a record. `_id` is on every record in every response, and the UI builds every record URL from it (with `encodeURIComponent`).
- **Contract:**
  - `ResourceSchema.primaryKey: string` becomes `primaryKeys: string[]` (internal contract; the UI changes in lockstep).
  - `RecordId` becomes `string | number | Record<string, string | number>`. Single-key resources keep getting scalars in `findOne/update/delete`, composite ones get the key object.
- **Nested fields:** the object field is named like the embedded or DTO property (`address`), with children named relative to it (`city`). Constraints and errors are keyed by dotted path (`address.city`, `lines.0.qty`). A dotted path through an embedded column (`address.city`) is valid in `list.*`, like a relation path.
- **No behaviour change for flat single-key entities** other than the new `_id` key and `primaryKeys`.
- **Review Focus:** each scenario gets an integration test that runs on every database.

## Review Focus

1. **Composite ids with separators:** a composite key whose string part contains `,` and `~` must round-trip through list → URL → GET/PATCH/DELETE. So must a single string key named `new`. → Task 1.
2. **A partial PATCH of one embedded field** (`{ address: { zip: '1' } }`) must keep the other embedded fields, and errors must land on `address.city`. → Task 2.
3. **Two editors, one record:** the second PATCH with the old `If-Match` is 409 with `current`, and nothing is written. So is a DELETE with a stale version. A PATCH without `If-Match` still works (API clients). → Task 4.
4. **Deleting a soft-deletable record** hides it from lists, `findOne` and relation options. `trashed=only` shows it, and restore brings it back. Purge removes the row, and a purge of a record other rows reference is a 409. → Task 5.
5. **A child resource of single-table inheritance** creates rows with the right discriminator, and its list shows only that child's rows. The root resource shows all rows and refuses to create. → Task 3.

## File Structure

```
packages/core/src/
  contract.ts                          (primaryKeys, _id, 'object' fields, creatable, version, softDelete, AdminErrorBody.current)
  crud/record-id.ts (+ test)           (encode/decode, composite)
  schema/build-resource-schema.ts      (composite keys, embedded + nested object fields, inheritance, version, softDelete)
  schema/nested-fields.ts (+ test)     (embedded metadata / nested DTOs → object fields)
  schema/relation-fields.ts            (resolvePath through embeddeds)
  crud/serialize.ts                    (_id, nested objects, embedded paths)
  crud/validate-write.ts               (nested allowed keys without a DTO)
  crud/list-query.ts · list-query-builder.ts (trashed, embedded paths)
  resource/admin-resource-base.ts      (composite findOne, softRemove, restore, purge)
  api/admin-api.service.ts             (If-Match, locks, restore, purge)
  http/admin-http.server.ts            (restore/purge routes, If-Match)
  http/error-response.ts               (CHECK → 422)
  registry/resource-registry.ts        (composite keys, entity-child tables in autoRegister)
  errors.ts                            (AdminConflictError with current)
packages/core/test/
  fixtures/shapes.ts                   (Line composite, Shop embedded + version + soft delete, Content/Post/Video)
  composite-keys.test.ts · embedded.test.ts · inheritance.test.ts · versions.test.ts · soft-delete.test.ts
packages/ui/src/                       (_id URLs, object sub-forms and arrays of sub-forms, If-Match + conflict dialog, delete wording)
examples/demo-api/                     (Product @VersionColumn and soft delete; E2E conflict dialog)
README.md · CLAUDE.md · m0-followups.md
```

---

### Task 1: Composite keys and encoded record ids

- [ ] **Tests first.**
  - `record-id.test.ts`: encode and decode round-trips, including `,`, `~` and `new`. Also:
    - a bad arity is a 404;
    - an integer part that is not an integer is a 404;
    - uuids are checked per part.
  - `composite-keys.test.ts` (every database), on `Line { @PrimaryColumn orderId: number; @PrimaryColumn sku: string; qty }`:
    - The schema has `primaryKeys: ['orderId', 'sku']`.
    - Create returns `_id: '1,a~1b~0c'` for sku `a,b~c`.
    - GET, PATCH and DELETE work by that id (URL-encoded).
    - List items carry `_id`.
    - Sorting by a single column adds every key as a tie-breaker.
    - autoRegister no longer skips composite keys.
    - A `Keyed { @PrimaryColumn() code: string }` record with code `new` is `_id: '~new'` and readable.
  - The existing tests are updated for `primaryKeys` and `_id`.
- [ ] **Implement:**
  - `encodeRecordId`/`parseRecordId`;
  - `buildResourceSchema` accepts N keys;
  - `applyListParams` adds every key as a tie-breaker;
  - the base `findOne` uses a key object for composites;
  - `serializeRecord` adds `_id`;
  - the reference loader keys records by `_id`;
  - relations to composite-key targets are still not fields.
- [ ] **UI:**
  - record URLs, row keys and mobile cards use `_id`;
  - the detail column filter drops every key column.
- [ ] **Verify** on all three databases, then commit `feat: composite primary keys and encoded record ids`.

### Task 2: Embedded columns and nested DTOs

- [ ] **Tests first.**
  - `nested-fields.test.ts`:
    - `Shop.address` (embedded) → `{ name: 'address', type: 'object', fields: [city, zip] }`.
    - A DTO `@ValidateNested() @Type(() => AddressDto) address` → the object's fields from `AddressDto`, with its constraints under `address.city`.
    - `@IsArray() @ValidateNested({ each: true }) @Type(() => LineDto) lines` → `{ type: 'object', many: true }`.
    - Unknown nested keys are rejected without a DTO (`address.country: is not a writable field`).
  - `embedded.test.ts` (every database):
    - Create with a nested address.
    - Reads are nested.
    - `list.columns: ['address.city']` gives a flat key.
    - `filter[address.city][contains]` and `sort=address.city` work.
    - A partial PATCH `{ address: { zip } }` keeps `city` (Review Focus 2).
    - DTO errors come back as `fields['address.city']`.
- [ ] **Implement:**
  - `nestedFields(metadata)` builds the embedded object fields, and `dtoObjectFields(dto)` reads class-transformer `@Type` metadata (`defaultMetadataStorage.findTypeMetadata`) for `@ValidateNested` properties;
  - `resolvePath` walks embeddeds;
  - `dtoConstraints` recurses into nested DTOs, keyed by dotted paths;
  - `validateWrite` without a DTO checks nested keys against the object's children;
  - the default `update` merges embedded objects field by field.
- [ ] **UI:**
  - An `object` field renders a `fieldset` with its children. `many` renders repeatable rows with Add and Remove.
  - `toFormValues` and `toPayload` handle nested values: in edit mode only changed children are sent, and a `many` array is sent whole.
  - `validatePayload` checks dotted constraints.
  - Server errors keyed `address.city` show on that input.
- [ ] **Verify**, then commit `feat: embedded columns and nested DTOs as sub-forms`.

### Task 3: Single-table inheritance

- [ ] **Tests first (`inheritance.test.ts`, every database).** `Content` (root, discriminator `kind`) with `Post` and `Video` children:
  - explicit `PostAdmin` and `VideoAdmin`, and `autoRegister` registering children (it previously skipped them);
  - the child schema has no discriminator field;
  - creating a post stores `kind = 'post'`, and the post list shows only posts (Review Focus 5);
  - a root `ContentAdmin` lists all rows with a read-only `kind` enum (`post`, `video`) and has `creatable: false`;
  - POST to the root is 400 with a message naming the child resources.
- [ ] **Implement:**
  - discriminator columns are read-only fields, hidden on child resources;
  - `ResourceSchema.creatable` is false for an inheritance root with children;
  - autoRegister includes `entity-child` metadata and skips roots that have children only when nothing registered them.
- [ ] **UI:** hide "New" when `creatable` is false.
- [ ] **Verify**, then commit `feat: single-table inheritance: one resource per child entity`.

### Task 4: `@VersionColumn` optimistic concurrency

- [ ] **Tests first (`versions.test.ts`, every database), on `Shop` with `@VersionColumn() version`:**
  - The schema has `version: 'version'`.
  - PATCH with the current `If-Match: "1"` → 200 and version 2.
  - PATCH with `If-Match: "1"` again → 409 `{ code: 'CONFLICT', current: { …version: 2 } }`, and nothing is written (Review Focus 3).
  - A malformed `If-Match` → 400.
  - PATCH without `If-Match` → 200.
  - DELETE with a stale version → 409.
  - Two concurrent PATCHes with the same version on Postgres and MySQL: exactly one wins, because the row lock makes the second wait and then fail.
- [ ] **Implement:**
  - `AdminConflictError(message, current?)`, whose body carries `current` (the serialized record);
  - `write()` for update and delete with a version reads the row inside the transaction with `pessimistic_write` (not on SQLite-family drivers), compares, then calls the resource.
  - The version check runs before the resource method, so it covers host services too.
- [ ] **UI:**
  - The form keeps the loaded version and sends `If-Match`.
  - On a 409 with `current`, a dialog lists the fields whose saved value differs from what the user started from. It offers "Keep my changes" (resend with the current version) and "Load theirs" (reload the record).
- [ ] **Verify**, then commit `feat: optimistic concurrency with @VersionColumn (If-Match, 409 with the current record)`.

### Task 5: Soft delete

- [ ] **Tests first (`soft-delete.test.ts`, every database), on `Shop` with `@DeleteDateColumn() deletedAt`:**
  - The schema has `softDelete: true`.
  - DELETE soft-deletes: the record is gone from the list, from GET (404), and from relation options of an entity pointing to shops (Review Focus 4).
  - `?trashed=only` lists deleted records; `?trashed=with` lists both.
  - `POST …/:id/restore` brings a record back; restoring a record that is not deleted is 404.
  - `DELETE …/:id?purge=true` hard-deletes a trashed record (and a live one); purging a referenced record is 409.
  - `trashed` on a resource without soft delete is 422.
  - `@BeforeDelete` hooks get `'soft' | 'purge'`.
- [ ] **Implement:**
  - `ListParams.trashed`;
  - `buildListQuery` applies `withDeleted()` plus `deletedAt IS NOT NULL` for `only`;
  - base `findOne(id, ctx, { withDeleted })`;
  - base `delete` = `softRemove` when the entity has a delete-date column;
  - new base `restore(id, ctx)` and `purge(id, ctx)`;
  - routes and API methods, which run in the write transaction.
- [ ] **UI (minimal; the trash page is M4):**
  - the delete confirmation says "Move to trash" when `softDelete`;
  - the list has a "Trash" toggle (`trashed=only`) whose rows show Restore.
- [ ] **Verify**, then commit `feat: soft delete: trash, restore and purge`.

### Task 6: Follow-ups, demo, E2E, docs

- [ ] CHECK constraint violations (SQLite `CHECK constraint failed`, Postgres `23514`, MySQL `ER_CHECK_CONSTRAINT_VIOLATED`) → 422 `VALIDATION`, with fields when the constraint name maps (unit tests plus one integration test on every database).
- [ ] Demo: `Product` gets `@VersionColumn() version` and `@DeleteDateColumn() deletedAt`, and the demo tests are updated.
- [ ] E2E:
  - two tabs edit the same product, and the second save shows the conflict dialog; "Keep my changes" saves;
  - deleting a draft product moves it to trash, and the Trash toggle restores it.
- [ ] README (composite ids, nested fields, inheritance, versions, soft delete), CLAUDE.md, and m0-followups (done items; new follow-ups).
- [ ] Verify everything: `typecheck`, `test`, `test:postgres`, `test:mysql`, `compat`, `pack:smoke` and `e2e`. Then commit `feat(demo): versions and soft delete; E2E; docs`.

## After this plan

- **M1c-4 Lists at scale**, as planned in M1c-1 plus the M1c-2 follow-ups:
  - count modes and keyset pagination;
  - multiple DataSources;
  - the `query(qb, ctx)` hook decision;
  - inverse relations as read-only data;
  - lazy relations;
  - relation sort by title;
  - dependent `relationOptions`.
