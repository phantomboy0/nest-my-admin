# M1c-2 — Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Many-to-one, owning one-to-one and owning many-to-many relations become admin fields: the list shows the related record's title (and paths like `customer.name`), lists filter, search and sort on related columns through automatic joins, forms pick related records with an async search, many-to-many values are written as lists of ids, and every record has a title.

**Architecture:** The schema builder turns TypeORM relation metadata into `relation` fields and validates dotted paths (`customer.name`) wherever `list` names fields. The list query joins the relations those paths need (`entity_customer`, `entity_customer_company`, …) and filters many-to-many values with an `EXISTS` on the join table, so pages never repeat rows. Related values are loaded after `findMany`/`findOne` by a separate reference loader (one query for every to-one path, one per many-to-many field) so they work whatever a host's finder override returned. Writes check relation ids (shape, then existence through `relationOptions()`) inside the admin transaction before the resource method runs. The default `create`/`update` turn ids into TypeORM references. Host services receive the ids as validated. A new endpoint serves picker options.

**Tech Stack:** unchanged from M1c-1 (Bun 1.4.2, TypeScript 7.0.2, NestJS 12.1.1, TypeORM 1.1.1, class-validator 0.15.1, React 19.3, Playwright 1.63; Postgres 17, MySQL 8.4 and sql.js through `NMA_TEST_DB`). No new dependencies: the picker is built on the existing `Input` and plain ARIA combobox markup.

**Spec:** `docs/superpowers/specs/2026-09-29-nest-my-admin-design.md` §5.2 (`title`, `customer.name` in `list.columns`/`search`, `relationOptions()`), §5.4 ("Relations used in list.columns are joined automatically (no N+1)"), §5.6 (relation combobox, many-to-many picker), §9.4, §11 (`GET /resources/:r/fields/:field/options`, `filter[customer…]`). Plan 2 of 4 for M1c: M1c-1 database matrix → **M1c-2 relations** (this plan) → M1c-3 entity shapes → M1c-4 lists at scale. Also `docs/superpowers/plans/m0-followups.md` ("M1c-1 follow-ups → M1c-2").

**Findings this plan is built on** (spike on 2026-09-30 against sql.js, Postgres 17 and MySQL 8.4; nothing committed):
- A relation without its own column (`@ManyToOne(() => Customer) customer`) has a join `ColumnMetadata` whose `propertyName` is the relation's (`customer`, database name `customerId`). With an explicit `@Column() sellerId` plus `@JoinColumn({ name: 'sellerId' }) seller`, there is **one** column, `propertyName: 'sellerId'`, with `relationMetadata.propertyName === 'seller'`. So `relation.joinColumns[0].propertyName` names the property that holds the id in both cases. Unique and FK errors already map to that name through `dbNames`.
- In query-builder SQL, `entity.customer` (a relation property) is rewritten to the join column: `WHERE entity.customer IN (:...ids)` works on all three drivers.
- `getManyAndCount()` with `skip/take`, a `leftJoin` and `ORDER BY entity_customer.name` fails on every driver (`no such column: distinctAlias.entity_customer_name`): TypeORM's DISTINCT pagination query only sees selected columns. Adding `addSelect('entity_customer.name')` for each sort path fixes it on all three. Filters and search on joined columns need no select.
- Many-to-many join tables are `relation.junctionEntityMetadata` (`tablePath`, `ownerColumns[0]`, `inverseColumns[0]`, each with `referencedColumn`). Saving an entity with `tags: [{ id }]` replaces its join rows on all three drivers.

## Global Constraints

- All M0, M1a, M1b and M1c-1 Global Constraints still apply (exact pins, `.js` imports in core, the isolated mount, the error contract, decimals and bigints as strings, `.pw.ts`, per-app test databases from `createTestApp`/`testDatabase()`, never commit `.idea/` or `.serena/`, no AI attribution in commits or PRs).
- **Field naming rule:** a to-one relation field is named by the property that holds the id: `relation.joinColumns[0].propertyName` (`customer`, or `sellerId` when the entity declares that column). A many-to-many field is named by the relation property (`tags`). Paths always go through relation properties: `customer.name`, `seller.name`. The label of a relation field is `humanize(relation.propertyName)` ("Seller", not "Seller id").
- **Supported relations:** `many-to-one` and owning `one-to-one` with exactly one join column, and owning `many-to-many`, to an entity with exactly one primary column, not lazy. Anything else (one-to-many, inverse sides, composite join columns, lazy relations) is not a field in M1c-2.
- **Wire format:** reads return a to-one relation as `{ id, title } | null` and a many-to-many as `Array<{ id, title }>`; writes send an id or `null`, and an array of ids. Ids have the target primary key's type, with bigints as strings. Every record in list and detail responses carries `_title: string`. A field whose name starts with `_` fails at boot.
- **Paths:** `list.columns`, `list.filters`, `list.search` and `list.sort` accept `relation.column` paths through to-one relations, up to 3 segments, validated at boot with did-you-mean suggestions. Paths are read-only. They never appear in forms.
- **Join aliases** are `<alias>_<relation>` per segment (`entity_customer`, `entity_customer_company`). This is public, so `buildListQuery` extensions can use them. A join the host already added under the same alias is reused.
- The Review Focus scenarios each get an integration test that runs on every database.

## Review Focus

1. **Sorting a paginated list by `customer.name`** must return disjoint pages in the right order, including rows whose customer is `null`, on every driver. → Task 2 (`relations-list.test.ts`).
2. **A many-to-many filter (`filter[tags][in]=a,b`)** must not repeat a record that has both tags, and `total` must count records, not join rows. → Task 2.
3. **A host `findMany` override that returns entities without relations loaded** must still get `{ id, title }` values and `customer.name` columns. → Task 2 (`OrderAdmin` fixture overrides `findMany` with `this.repository.find(...)`-style loading in one test resource).
4. **Writing a missing or out-of-options id** (restricted by `relationOptions()`) must be a 422 on that field and write nothing, including a many-to-many id list with one bad id. → Task 3 (`relations-write.test.ts`).
5. **Deleting a record that others still reference** answers 409 with a message that says so, and the UI shows it. → Task 3 (API) and Task 5 (E2E: delete a category that has products).

## File Structure

```
packages/core/src/
  contract.ts                                   (modify: 'relation' type, RelationSchema, RelationRef, OptionsResponse, _title)
  decorators/admin-resource.ts                  (modify: title option)
  schema/relation-fields.ts        (+ .test.ts) (new: relation metadata → fields; path resolution)
  schema/build-resource-schema.ts  (+ .test.ts) (modify: relation fields, dotted paths, reserved names)
  schema/filter-operators.ts       (+ .test.ts) (modify: relation operators)
  schema/field-paths.ts                         (new: FieldPath<T> type, depth 3)
  schema/titles.ts                 (+ .test.ts) (new: title definitions → (entity) => string)
  crud/list-query.ts               (+ .test.ts) (modify: relation ids, dotted fields)
  crud/list-query-builder.ts                    (modify: joins, EXISTS, addSelect for sort)
  crud/references.ts                            (new: reference loader)
  crud/serialize.ts                (+ .test.ts) (modify: extras, ids)
  crud/relation-writes.ts          (+ .test.ts) (new: id shape checks, existence checks, ids → references)
  resource/admin-resource-base.ts               (modify: relationOptions, ids → references, applyListParams(metadata))
  registry/resource-registry.ts                 (modify: link relation targets, titles, byEntity lookup)
  api/admin-api.service.ts                      (modify: reference loading, relation checks, options)
  http/admin-http.server.ts                     (modify: options route)
  http/error-response.ts                        (modify: delete-referenced message)
  index.ts                                      (modify: exports)
packages/core/test/
  fixtures/orders.ts                            (new: Company, Customer, Tag, Order + admins)
  relations-meta.test.ts · relations-list.test.ts · relations-write.test.ts (new)
packages/ui/src/
  app/relation-input.tsx                        (new: single and multi picker)
  app/field-input.tsx · app/list-page.tsx · app/filter-bar.tsx · app/form-page.tsx (modify)
  lib/form-values.ts · lib/format.ts · lib/api.ts (+ tests) (modify)
examples/demo-api/src/catalog/                  (modify: Category, Tag; product.categoryId, product.tags)
examples/demo-api/test/catalog-admin.test.ts · e2e/products.pw.ts (modify)
README.md · CLAUDE.md · docs/superpowers/plans/m0-followups.md
```

---

### Task 1: Relation fields, paths and titles in the schema

**Files:** create `schema/relation-fields.ts`, `schema/titles.ts`, `schema/field-paths.ts`, `test/fixtures/orders.ts`, `test/relations-meta.test.ts`; modify `contract.ts`, `decorators/admin-resource.ts`, `schema/build-resource-schema.ts`, `schema/filter-operators.ts`, `registry/resource-registry.ts`, `resource/admin-resource-base.ts` (types only), `index.ts`.

**Interfaces:**
```ts
// contract.ts
export type FieldType = … | 'relation';
export interface RelationSchema {
  /** 'to-one': many-to-one or owning one-to-one; 'to-many': owning many-to-many. */
  kind: 'to-one' | 'to-many';
  /** The registered resource for the target entity (links and pickers); absent when the target has none. */
  resource?: string;
  /** Type of the target's primary key: ids are sent, filtered and returned with it (bigint as string). */
  idType: 'number' | 'bigint' | 'string' | 'uuid';
}
FieldSchema.relation?: RelationSchema;       // set when type === 'relation'
export interface RelationRef { id: string | number; title: string }
export interface OptionsResponse { items: RelationRef[] }
// AdminResourceOptions
title?: string | ((record: any) => string);  // a column name, or a function of the loaded entity
// schema/field-paths.ts
export type FieldPath<T> = …;                // 'name' | 'customer' | 'customer.name' | 'customer.company.name' (depth 3)
```
`ListConfig<T>` uses `FieldPath<T>` for `columns`, `filters`, `search` and `sort` (`FieldPath<T> | \`-${FieldPath<T>}\``).

- [ ] **Step 1: Tests first.**
  - `relation-fields.test.ts` builds on real sql.js metadata for `Order { customer (many-to-one, not null), sellerId + seller (explicit column), invoiceCompany (one-to-one owner), tags (many-to-many owner to a uuid Tag) }` and `Customer { company }`. It checks field names, labels ("Seller"), `relation.kind`, `idType`, `nullable`, `integer`, and that inverse one-to-many, lazy relations and composite join columns yield no field.
  - `build-resource-schema.test.ts` additions:
    - Default columns include to-one relations and exclude many-to-many.
    - Default writable (no DTO) includes to-one and many-to-many relation fields, and `requiredOnCreate` has the non-nullable `customer`.
    - Dotted paths are accepted in `columns`, `filters`, `search` and `sort`, and appear in `fields` as read-only fields labelled "Customer name" with the target column's type.
    - Unknown paths fail at boot: `list.columns: unknown path "customer.nam" on Order; did you mean "customer.name"?`.
    - A path through a many-to-many relation fails at boot, and so does searching a non-text path.
    - A `_title` column fails at boot.
    - `sortable` holds the plain columns plus the dotted paths named anywhere in `list`, and never a relation field.
    - Relation filter operators: `eq ne in nin` (+`isNull` when nullable) for to-one, `in` for to-many.
  - `titles.test.ts`:
    - A column title picks that column's value.
    - A function title works, and one that throws or returns a non-string falls back to `#<id>`.
    - By default the first of `name, title, label, displayName, fullName, username, email, code, sku` that is a string column is used, else `#<id>`.
    - An unknown title column fails at boot.
  - `relations-meta.test.ts` (integration): `GET /meta/resources/order` has `relation.resource` set to the registered `customer`, and `relation.resource` is absent for a target that has no resource and `autoRegister: false`.
- [ ] **Step 2: Implement.**
  - `relationFields(metadata)` returns `{ field, relation }` pairs. `resolvePath(metadata, 'customer.company.name')` returns the relation chain and the final column, or a reason for the error.
  - The builder skips join columns in `isSupportedColumn` (as today) and adds the relation fields in column order.
  - The registry resolves `relation.resource` after all resources are registered (`linkRelations()`), keeps `title: (entity) => string` per entry, and exposes `titleFor(entity: Function)`, which is used for targets without a resource too.
- [ ] **Step 3: Verify** with `bun run typecheck && bun test packages/core` on sql.js, then with `NMA_TEST_DB=postgres` and `NMA_TEST_DB=mysql` for the new integration file.
- [ ] **Step 4: Commit** `feat: relation fields, dotted list paths and record titles in the resource schema`.

### Task 2: Lists: joins, relation filters and loaded references

**Files:** create `crud/references.ts`, `test/relations-list.test.ts`; modify `crud/list-query.ts`, `crud/list-query-builder.ts`, `crud/serialize.ts`, `resource/admin-resource-base.ts`, `api/admin-api.service.ts`.

**Interfaces:**
```ts
export function applyListParams<T>(qb: SelectQueryBuilder<T>, params: ListParams, metadata: EntityMetadata): SelectQueryBuilder<T>;
export function ensureJoins(qb: SelectQueryBuilder<any>, relationPath: string[]): string;   // returns the alias of the last join
export interface ReferenceContext { registry: ResourceRegistry; manager: EntityManager }
export function loadReferences(entry: RegisteredResource, entities: object[], fieldNames: string[], context: ReferenceContext): Promise<Map<object, Record<string, unknown>>>;
export function serializeRecord(entity: object, fields: FieldSchema[], extras?: Record<string, unknown>, title?: string): AdminRecord;
```
- [ ] **Step 1: Tests first (`relations-list.test.ts`, every database).** Seed 2 companies, 4 customers (one without a company), 3 tags and 7 orders. Then check:
  - `customer.name` and `customer.company.name` columns come back as flat keys (`'customer.name': 'Ada'`), with `null` where the chain breaks.
  - `customer` is `{ id, title }`, `tags` is `[{ id, title }]` ordered by id, and `_title` is on every item.
  - `filter[customer][eq|in|ne|nin]` and `filter[sellerId][isNull]` work.
  - `filter[customer.name][contains]=ad` and `search=` match across `number` and `customer.name`.
  - `sort=customer.name` and `sort=-customer.company.name` return disjoint pages whose union is every order, in order (Review Focus 1).
  - `filter[tags][in]=<a>,<b>` returns each order once and `total` counts orders (Review Focus 2).
  - A malformed id (`filter[customer][eq]=abc`, a non-uuid tag) is a 422 on that key.
  - A resource whose `findMany` override returns entities loaded by `repository.find()` without relations still gets references (Review Focus 3).
  - `GET /resources/order/:id` returns every relation field, including many-to-many not listed in `columns`.
  - Query count: a page of 7 orders with two to-one columns and one many-to-many column takes at most 4 queries (a TypeORM `logger` that counts `SELECT`s after the list query).
- [ ] **Step 2: Implement.**
  - `parseScalar` handles `relation` by `idType`.
  - `applyListParams` resolves each name. A column or to-one relation compiles to `alias.property`. A path gets its joins, and sort paths also get `addSelect`. `to-many … in` compiles to `EXISTS (SELECT 1 FROM <junction> nma_jN WHERE nma_jN.<owner> = alias.<pk> AND nma_jN.<inverse> IN (:...p))`, with identifiers escaped by the driver.
  - The reference loader runs one `leftJoinAndSelect` query over every to-one path needed, keyed by primary key (`whereInIds`), plus one query per many-to-many field. It builds `RelationRef`s with the target's `titleFor` and serializes path values with their field schema.
  - `AdminApiService.list` loads references for relation fields and paths in `list.columns`. `get`, `create` and `update` load every relation field, using `ctx.manager` inside writes.
- [ ] **Step 3: Verify** with `bun test packages/core`, `NMA_TEST_DB=postgres bun test packages/core` and `NMA_TEST_DB=mysql bun test packages/core`.
- [ ] **Step 4: Commit** `feat: relation filters, dotted-path joins and loaded references in lists and records`.

### Task 3: Writes, picker options and relation errors

**Files:** create `crud/relation-writes.ts` (+ test), `test/relations-write.test.ts`; modify `resource/admin-resource-base.ts`, `api/admin-api.service.ts`, `http/admin-http.server.ts`, `http/error-response.ts` (+ test), `index.ts`.

**Interfaces:**
```ts
// AdminResourceBase
/** Restricts the records a relation field may point to (picker options and writes). `qb` selects the target as `option`. */
relationOptions(field: string, qb: SelectQueryBuilder<any>, ctx: AdminContext): SelectQueryBuilder<any>;
// GET /resources/:r/fields/:field/options?search=&ids=  →  OptionsResponse (max 20 for search, max 100 ids)
export function checkRelationShapes(body: Record<string, unknown>, schema: ResourceSchema): void;   // AdminValidationError
export function toRelationReferences(dto: object, metadata: EntityMetadata): object;             // ids → { pk: id }
```
- [ ] **Step 1: Tests first.**
  - Unit tests for id shapes:
    - Integers must be safe integers.
    - Bigints are digit strings or safe integers.
    - UUIDs are UUIDs.
    - `null` is only allowed when the field is nullable.
    - A many-to-many value must be an array of up to 1000 ids; duplicates collapse.
    - A non-array or non-id value names the field.
  - Unit test: the delete-conflict message is "Other records still refer to this record".
  - Integration (`relations-write.test.ts`, every database):
    - Create and update through the default resource with `customer: id`, `tags: [ids]` and `tags: []` (clears).
    - The response has the refs.
    - A missing customer id, and a tag list with one missing id, is a 422 on that field with nothing written (Review Focus 4).
    - `relationOptions()` restricting customers to `active` rejects an inactive one on write and hides it from options.
    - Options: `search` matches the target resource's `list.search`, `ids` resolves titles, unknown fields are 404, non-relation fields are 400, and there are at most 20 results.
    - A host `create` override receives the plain ids.
    - Deleting a referenced customer is a 409 with the new message (Review Focus 5).
- [ ] **Step 2: Implement.**
  - The API runs `checkRelationShapes` after `validateWrite`.
  - Inside `write()`, before the resource method, it checks existence for each sent relation field: one `whereInIds` query per field through `relationOptions`.
  - The default `create`/`update` run `toRelationReferences`.
  - The options route calls `AdminApiService.options()`.
- [ ] **Step 3: Verify** on all three databases.
- [ ] **Step 4: Commit** `feat: relation writes with existence checks, relationOptions() and the options endpoint`.

### Task 4: UI — pickers, relation cells, relation filters, titles

**Files:** create `packages/ui/src/app/relation-input.tsx`; modify `field-input.tsx`, `form-page.tsx`, `list-page.tsx`, `filter-bar.tsx`, `lib/form-values.ts`, `lib/format.ts`, `lib/api.ts`, `lib/queries.ts` and their tests.

- [ ] **Step 1: Tests first (bun unit tests).**
  - `toFormValues` keeps `RelationRef | null` and `RelationRef[]`.
  - `toPayload` sends `id`/`null` and id arrays, sends only changed relations in edit mode (compared by id, order-insensitive for many-to-many), and leaves a cleared non-nullable to-one out on create.
  - `formatCell` shows the title, and joins many-to-many titles with ", ".
- [ ] **Step 2: Implement.**
  - `RelationInput` is an ARIA combobox (`role=combobox`, `aria-expanded`, `aria-controls`, a `listbox` with `option`s). It searches the options endpoint after 250 ms, supports arrow keys, Enter and Escape, and has a Clear button when nullable. The multi variant shows chips with a remove button each.
  - List cells link a relation title to `/<resource>/<id>` when `relation.resource` is set.
  - Only sortable columns are clickable headers.
  - A to-one filter uses the picker with `eq`, and resolves the title of an id from the URL through `?ids=`. A many-to-many filter uses the multi picker with `in`.
  - The edit header shows `record._title`.
  - The mobile card title uses `_title`.
- [ ] **Step 3: Verify** with `bun run typecheck`, `bun test packages/ui` and `bun run build`.
- [ ] **Step 4: Commit** `feat(ui): relation pickers, relation cells and filters, record titles`.

### Task 5: Demo, E2E, docs and follow-ups

- [ ] **Step 1: Demo.**
  - `Category` (name unique) and `Tag` (name) entities with resources in the catalog module.
  - `Product` gets `@Column({ nullable: true }) categoryId` plus `@ManyToOne(() => Category, { onDelete: 'RESTRICT' }) @JoinColumn({ name: 'categoryId' }) category`, and `@ManyToMany(() => Tag) @JoinTable() tags`.
  - The DTOs get `@IsOptional() @IsInt() categoryId` and `@IsOptional() @IsArray() @IsInt({ each: true }) tags`. `ProductsService` maps `tags` ids to references itself (service-first).
  - `ProductAdmin.list` gets the columns `category.name` and `tags`, the filters `categoryId` and `tags`, and the search `category.name`.
  - Seed data covers categories and tags.
- [ ] **Step 2: Tests.**
  - `catalog-admin.test.ts`: create with category and tags through the service, filter by category, and a 409 when deleting a category in use.
  - `products.pw.ts` (desktop and mobile):
    - Pick a category by typing, add two tags, and save.
    - The list shows the category name and tags.
    - Filter by category.
    - Deleting a category that has products shows "Other records still refer to this record" (Review Focus 5).
- [ ] **Step 3: Docs.** README (relations section: naming rule, paths, `title`, `relationOptions`, wire format), CLAUDE.md (architecture lines for references and relation writes), and m0-followups (the M1c-2 items done; new follow-ups).
- [ ] **Step 4: Verify everything:** `bun run typecheck`, `bun run test`, `bun run test:postgres`, `bun run test:mysql`, `bun run compat`, `bun run pack:smoke` and `bun run e2e`.
- [ ] **Step 5: Commit** `feat(demo): categories and tags; relation E2E; docs`.

## After this plan

- **M1c-3 Entity shapes** and **M1c-4 Lists at scale** as planned in M1c-1. M1c-4 also takes:
  - inverse relations (one-to-many and inverse many-to-many) as read-only "Related" data;
  - lazy relations;
  - sorting a relation field by its target's title column;
  - `relationOptions()` receiving the form's current values (dependent options, spec §5.2 `values`).
