import { HttpException } from '@nestjs/common';
import { QueryFailedError, type SelectQueryBuilder } from 'typeorm';
import { parseRecordId, recordIdOf } from '../crud/record-id.js';
import { relationIdsOf, type RelationId } from '../crud/relation-writes.js';
import { whereOf } from '../crud/stored-row.js';
import { validateWrite } from '../crud/validate-write.js';
import { AdminError, AdminForbiddenError, AdminForbiddenFieldsError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { codeForStatus, hostError, toErrorResponse } from '../http/error-response.js';
import type { ErrorMapper } from '../options.js';
import type { AdminPolicy, ResourceView } from '../policy/admin-policy.service.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { RecordId } from '../resource/admin-resource-base.js';
import { MAX_INLINE_ROWS } from '../schema/field-config.js';
import type { WriteChange } from '../api/write-participant.js';
import type { RegisteredInline } from './inline-config.js';

/** What the writer needs of `AdminApiService` (its write participants, checks and serializer). */
export interface InlineWriterDeps {
  policy: AdminPolicy;
  view: (entry: RegisteredResource, ctx: AdminContext) => ResourceView;
  sanitizeHtml: (html: string) => string;
  /** One change inside the parent's write, with every participant (files, audit) around the method. */
  change: <T>(change: WriteChange, tx: AdminContext, method: () => Promise<T>) => Promise<T>;
  checkRelationsExist: (entry: RegisteredResource, ids: Map<string, RelationId[]>, ctx: AdminContext, values: Record<string, unknown>) => Promise<void>;
  checkVersion: (entry: RegisteredResource, id: RecordId, expected: number | undefined, ctx: AdminContext) => Promise<void>;
  lockedFields: (entry: RegisteredResource, entity: object) => string[];
  /** A record's values as `relationOptions()` sees them (as the user sees the record, relations as ids). */
  values: (entry: RegisteredResource, entity: object, ctx: AdminContext) => Promise<Record<string, unknown>>;
  reloadIfEmpty: (entry: RegisteredResource, result: unknown, id: RecordId, ctx: AdminContext) => Promise<object>;
  errorMapper?: ErrorMapper;
}

interface PlannedCreate {
  key: string;
  index: number;
  dto: Record<string, unknown>;
  relationIds: Map<string, RelationId[]>;
}

interface PlannedUpdate {
  /** The `_id` as sent (error paths) and as the canonical encoding (matching). */
  raw: string;
  canonical: string;
  id: RecordId;
  version?: number;
  dto: Record<string, unknown>;
  relationIds: Map<string, RelationId[]>;
}

interface PlannedDelete {
  raw: string;
  canonical: string;
  id: RecordId;
}

/** One inline's changes, parsed, permission-checked and validated: nothing in it has touched the database. */
interface PlannedInline {
  inline: RegisteredInline;
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  deletes: PlannedDelete[];
  order?: string[];
}

/** The inline changes of one save (`prepare`), checked against the database (`check`) before anything is written. */
export interface InlinePlan {
  parent: RegisteredResource;
  creating: boolean;
  inlines: PlannedInline[];
}

/** What `check` read: the rows the save touches, and the order values it writes. */
interface CheckedInline {
  planned: PlannedInline;
  /** Canonical `_id` → the stored child (updates, deletes and rows only moved). */
  rows: Map<string, object>;
  /** Canonical `_id` → new position, for existing rows whose position changes. */
  moves: Map<string, number>;
  /** `_key` → position. */
  positions: Map<string, number>;
}
export type CheckedPlan = CheckedInline[];

const KEY = /^.{1,64}$/su;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Saves the `_inlines` of a parent's POST or PATCH inside the parent's write (spec §5.2 inlines), in three steps:
 *
 * 1. `prepare` (before the transaction): the shape, the child's permissions (403), its field rules (403
 *    FORBIDDEN_FIELDS) and each entry's validation by the child's DTO, as its own endpoints would (422);
 * 2. `check` (in the transaction, before the parent is written): every `_id` is a child of THIS parent inside the
 *    user's view scope and the operation's scope (else 404), `_version`s (409), `@AdminCan` rules (403), `readonlyIf`
 *    (422), the order list and the resulting count (`min`/`max`, 422). A refused save has written nothing;
 * 3. `apply` (after the parent): deletes, updates, then creates, each through the CHILD resource's own method inside
 *    `change()`, so host overrides, hooks, files and the audit log (with `meta.parent`) apply as on its endpoints. A
 *    failure there rolls back the transaction, parent included (inlines need `transactions`, checked at boot).
 */
export class InlineWriter {
  constructor(private readonly deps: InlineWriterDeps) {}

  /** Step 1, before the transaction. `raw` is the body's `_inlines` (undefined when it has none). */
  async prepare(parent: RegisteredResource, raw: unknown, ctx: AdminContext, creating: boolean): Promise<InlinePlan> {
    const { policy } = this.deps;
    const perms = policy.permissionsOf(ctx);
    // An inline whose child or link field the user may not see is not there for them (as in the schema).
    const viewable = parent.inlines.filter((inline) => policy.canSeeInline(inline.child, inline.link, ctx));
    const sent = raw === undefined ? {} : raw;
    const shape: Record<string, string[]> = {};
    if (!isObject(sent)) throw new AdminValidationError({ _inlines: ['must be an object of inline name → changes'] });
    for (const name of Object.keys(sent)) {
      // An inline the user cannot view is not there for them (as in the schema).
      if (!viewable.some((inline) => inline.name === name)) shape[`_inlines.${name}`] = [`is not an inline of ${parent.schema.label}`];
    }
    if (Object.keys(shape).length > 0) throw new AdminValidationError(shape);

    // A new parent checks every inline it shows (`min` counts rows that will exist); an update only those it changes.
    const inlines = viewable.filter((inline) => creating || Object.hasOwn(sent, inline.name));
    const parsed = inlines.map((inline) => parseChanges(inline, sent[inline.name] ?? {}, shape));
    if (Object.keys(shape).length > 0) throw new AdminValidationError(shape, 'The inline changes are malformed');

    // 403 before anything else: the child's operations, then its field rules.
    for (const { inline, creates, updates, deletes, order } of parsed) {
      const { child } = inline;
      if (creates.length > 0) {
        if (!child.schema.creatable) throw new AdminForbiddenError(`${child.schema.label} records are created as one of their kinds`);
        policy.require(child, 'create', ctx);
      }
      if (updates.length > 0) policy.require(child, 'update', ctx);
      if (deletes.length > 0) policy.require(child, 'delete', ctx);
      // Ruling 4: reordering writes the order field, so it takes the right to update that field.
      if (order !== undefined && inline.order !== undefined && !this.deps.view(child, ctx).schema.form.update.includes(inline.order)) {
        throw new AdminForbiddenError(`You may not reorder ${child.schema.label} records`);
      }
    }
    const forbidden: Record<string, string[]> = {};
    for (const { inline, creates, updates } of parsed) {
      const at = `_inlines.${inline.name}`;
      creates.forEach((entry, index) => collect(forbidden, `${at}.create.${index}`, () => policy.checkWriteFields(inline.child, entry.body, inline.child.schema.form.create, ctx)));
      for (const entry of updates) collect(forbidden, `${at}.update.${entry.raw}`, () => policy.checkWriteFields(inline.child, entry.body, inline.child.schema.form.update, ctx));
    }
    if (Object.keys(forbidden).length > 0) throw new AdminForbiddenFieldsError(forbidden);

    // Each entry as the child's own endpoint validates it; all errors of the save at once.
    const errors: Record<string, string[]> = {};
    const planned: PlannedInline[] = [];
    for (const { inline, creates, updates, deletes, order } of parsed) {
      const { child } = inline;
      const schema = this.deps.view(child, ctx).schema;
      const resource = child.resource;
      const at = `_inlines.${inline.name}`;
      const setsOrder = (body: Record<string, unknown>, path: string) => {
        if (order !== undefined && inline.order !== undefined && Object.hasOwn(body, inline.order)) errors[`${path}.${inline.order}`] = ['is set by the order list'];
      };
      const result: PlannedInline = { inline, creates: [], updates: [], deletes, ...(order !== undefined ? { order } : {}) };
      for (const [index, entry] of creates.entries()) {
        const path = `${at}.create.${index}`;
        setsOrder(entry.body, path);
        const dto = await validated(errors, path, () =>
          validateWrite(entry.body, { allowed: schema.form.create, dto: resource.form?.create, fields: schema.fields, sanitizeHtml: this.deps.sanitizeHtml, ignore: [inline.link] }),
        );
        const relationIds = dto ? relationsOf(errors, path, dto, schema) : undefined;
        if (dto && relationIds) result.creates.push({ key: entry.key, index, dto: dto as Record<string, unknown>, relationIds });
      }
      for (const entry of updates) {
        const path = `${at}.update.${entry.raw}`;
        setsOrder(entry.body, path);
        const dto = await validated(errors, path, () =>
          validateWrite(entry.body, { allowed: schema.form.update, dto: resource.form?.update ?? resource.form?.create, partial: true, fields: schema.fields, sanitizeHtml: this.deps.sanitizeHtml }),
        );
        const relationIds = dto ? relationsOf(errors, path, dto, schema) : undefined;
        if (dto && relationIds) result.updates.push({ raw: entry.raw, canonical: entry.canonical, id: entry.id, ...(entry.version !== undefined ? { version: entry.version } : {}), dto: dto as Record<string, unknown>, relationIds });
      }
      planned.push(result);
    }
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
    return { parent, creating, inlines: planned };
  }

  /**
   * Inside the transaction, before the parent is written: reads what the save touches and decides every 404, 409,
   * 403 and 422 left, so that a refused save writes nothing. `parentEntity` is the stored parent (undefined when it
   * is being created: it has no children yet, so any `_id` is not one of them).
   */
  async check(plan: InlinePlan, parentEntity: object | undefined, tx: AdminContext): Promise<CheckedPlan> {
    const out: CheckedPlan = [];
    const errors: Record<string, string[]> = {};
    for (const planned of plan.inlines) out.push(await this.checkInline(planned, parentEntity, tx, errors));
    if (Object.keys(errors).length > 0) throw new AdminValidationError(errors);
    return out;
  }

  private async checkInline(planned: PlannedInline, parentEntity: object | undefined, tx: AdminContext, errors: Record<string, string[]>): Promise<CheckedInline> {
    const { policy } = this.deps;
    const { inline, creates, updates, deletes, order } = planned;
    const { child } = inline;
    const keys = child.schema.primaryKeys;
    const at = `_inlines.${inline.name}`;
    const label = child.schema.label;
    const notFound = (raw: string) => new AdminNotFoundError(`${label} "${raw}" not found`);
    const linkValue = parentEntity ? (parentEntity as Record<string, unknown>)[inline.referenced] : undefined;
    const positions = new Map<string, number>();
    const moves = new Map<string, number>();
    const rows = new Map<string, object>();

    if (!parentEntity || linkValue === null || linkValue === undefined) {
      // No children can be named: a new parent (or one whose referenced value is empty) has none.
      const first = updates[0]?.raw ?? deletes[0]?.raw ?? order?.find((item) => !creates.some((entry) => entry.key === item));
      if (first !== undefined) throw notFound(first);
      if (order !== undefined) this.checkOrder(planned, [], new Set(), errors, positions);
      this.checkCount(inline, creates.length, errors);
      return { planned, rows, moves, positions };
    }

    // Children of THIS parent that the user sees: the child's query() and the user's view scopes, as its findOne.
    const children = (): SelectQueryBuilder<any> => {
      const manager = tx.manager ?? child.dataSource.manager;
      const qb = manager.getRepository(child.metadata.target).createQueryBuilder('nma_child');
      const restricted = policy.applyScopes(child.resource.query(qb, tx), child, 'view', tx);
      return restricted.andWhere(`nma_child.${inline.link} = :nmaInlineParent`, { nmaInlineParent: linkValue });
    };

    // The order list is checked against the rows the user sees, and decides which of them move.
    let visible: object[] | undefined;
    if (order !== undefined && inline.order !== undefined) {
      visible = await children()
        .select([...keys, inline.order].map((name) => `nma_child.${name}`))
        .take(MAX_INLINE_ROWS + 1)
        .getMany();
      if (visible.length > MAX_INLINE_ROWS) {
        errors[at] = [`has more than ${MAX_INLINE_ROWS} rows; reorder them in their own list`];
      } else {
        const existing = visible.map((row) => recordIdOf(row, keys));
        const deleted = new Set(deletes.map((entry) => entry.canonical));
        const known = new Map(existing.map((id, index) => [id, visible![index]!] as const));
        // Named in `order` but not a row of this parent the user sees (nor a new row's `_key`): as for update and delete.
        for (const item of order) {
          if (creates.some((entry) => entry.key === item)) continue;
          const canonical = canonicalId(child, item);
          if (canonical === undefined || !known.has(canonical)) throw notFound(item);
        }
        for (const entry of creates) if (known.has(entry.key)) errors[`${at}.create.${entry.index}._key`] = ['is the id of an existing row'];
        const remaining = existing.filter((id) => !deleted.has(id));
        this.checkOrder(planned, remaining, deleted, errors, positions);
        for (const [item, position] of positions) {
          const row = known.get(item);
          if (row && Number((row as Record<string, unknown>)[inline.order]) !== position) moves.set(item, position);
        }
        // Positions of new rows are kept by `_key`; those of existing rows only when they move.
        for (const id of existing) positions.delete(id);
      }
    }

    // Every named row: a child of this parent in the user's view (404 for the whole save otherwise).
    const named = new Map<string, { raw: string; id: RecordId }>();
    for (const entry of [...updates, ...deletes]) named.set(entry.canonical, { raw: entry.raw, id: entry.id });
    for (const canonical of moves.keys()) if (!named.has(canonical)) named.set(canonical, { raw: canonical, id: parseRecordId(canonical, child.schema) });
    if (named.size > 0) {
      const found = await children()
        .setFindOptions({ loadEagerRelations: true })
        .andWhereInIds([...named.values()].map((entry) => entry.id))
        .getMany();
      for (const entity of found as object[]) rows.set(recordIdOf(entity, keys), entity);
      for (const [canonical, entry] of named) if (!rows.has(canonical)) throw notFound(entry.raw);
      // ...and inside the scopes of what is done to it.
      const updated = [...updates.map((entry) => entry.canonical), ...[...moves.keys()]];
      const allowedUpdates = await policy.allowedIds(child, [...new Set(updated)].map((canonical) => named.get(canonical)!.id), 'update', tx);
      for (const canonical of updated) if (!allowedUpdates.has(canonical)) throw notFound(named.get(canonical)!.raw);
      const allowedDeletes = await policy.allowedIds(child, deletes.map((entry) => entry.id), 'delete', tx);
      for (const entry of deletes) if (!allowedDeletes.has(entry.canonical)) throw notFound(entry.raw);
    }

    // Versions (409 naming the row), then `@AdminCan` (403), then `readonlyIf` (422).
    for (const entry of updates) {
      if (entry.version === undefined) continue;
      try {
        await this.deps.checkVersion(child, entry.id, entry.version, tx);
      } catch (error) {
        throw atRow(error, `${at}.update.${entry.raw}`, child, this.deps.errorMapper);
      }
    }
    for (const entry of deletes) {
      if (!policy.recordRule(child, 'delete', rows.get(entry.canonical)!, tx)) throw new AdminForbiddenError(`You may not delete ${label} "${entry.raw}"`);
    }
    for (const canonical of new Set([...updates.map((entry) => entry.canonical), ...moves.keys()])) {
      if (!policy.recordRule(child, 'update', rows.get(canonical)!, tx)) throw new AdminForbiddenError(`You may not update ${label} "${named.get(canonical)!.raw}"`);
    }
    for (const entry of updates) {
      const locked = this.deps.lockedFields(child, rows.get(entry.canonical)!).filter((name) => Object.hasOwn(entry.dto, name));
      for (const name of locked) errors[`${at}.update.${entry.raw}.${name}`] = ['is read-only'];
    }
    if (inline.order !== undefined) {
      for (const canonical of moves.keys()) {
        if (this.deps.lockedFields(child, rows.get(canonical)!).includes(inline.order)) errors[at] = [`${label} "${named.get(canonical)!.raw}" cannot be moved`];
      }
    }

    // The count of rows that will exist (as the user sees them).
    if (creates.length > 0 || (deletes.length > 0 && inline.min !== undefined)) {
      const before = visible && visible.length <= MAX_INLINE_ROWS ? visible.length : await children().getCount();
      this.checkCount(inline, before - deletes.length + creates.length, errors);
    }
    return { planned, rows, moves, positions };
  }

  /** `order` lists every row left (`remaining` ids, then the new rows' keys) exactly once; positions by index. */
  private checkOrder(planned: PlannedInline, remaining: string[], deleted: Set<string>, errors: Record<string, string[]>, positions: Map<string, number>): void {
    const { inline, creates, order } = planned;
    const at = `_inlines.${inline.name}`;
    const expected = new Set([...remaining, ...creates.map((entry) => entry.key)]);
    const seen = new Set<string>();
    for (const [index, item] of order!.entries()) {
      const canonical = creates.some((entry) => entry.key === item) ? item : (canonicalId(inline.child, item) ?? item);
      if (deleted.has(canonical)) {
        errors[at] = [`order names "${item}", which this save deletes`];
        return;
      }
      if (seen.has(canonical)) {
        errors[at] = [`order names "${item}" twice`];
        return;
      }
      seen.add(canonical);
      positions.set(canonical, index);
    }
    const missing = [...expected].filter((item) => !seen.has(item));
    if (missing.length > 0) errors[at] = [`order must list every row; missing: ${missing.join(', ')}`];
  }

  private checkCount(inline: RegisteredInline, count: number, errors: Record<string, string[]>): void {
    const at = `_inlines.${inline.name}`;
    if (inline.min !== undefined && count < inline.min) errors[at] = [`must have at least ${inline.min} ${inline.min === 1 ? 'row' : 'rows'}`];
    else if (count > inline.max) errors[at] = [`may have at most ${inline.max} rows`];
  }

  /**
   * After the parent: every change through the child resource's own method, inside the parent's write. Deletes, then
   * updates (with their new positions), rows that only move, then creates (link and position set by the server).
   */
  async apply(plan: InlinePlan, checked: CheckedPlan, parentEntity: object, tx: AdminContext): Promise<void> {
    const { parent } = plan;
    const parentRef = { resource: parent.schema.name, recordId: recordIdOf(parentEntity, parent.schema.primaryKeys) };
    let parentValues: Record<string, unknown> | undefined;
    // The parent's values as the user sees them, body over stored (`values._parent` of relationOptions()).
    const withParent = async (values: Record<string, unknown>) => ({ ...values, _parent: (parentValues ??= { _resource: parent.schema.name, ...(await this.deps.values(parent, parentEntity, tx)) }) });
    const hasIds = (ids: Map<string, RelationId[]>) => [...ids.values()].some((list) => list.length > 0);

    for (const { planned, rows, moves, positions } of checked) {
      const { inline, creates, updates, deletes } = planned;
      const { child } = inline;
      const resource = child.resource;
      const at = `_inlines.${inline.name}`;
      const run = async <T>(path: string, change: WriteChange, method: () => Promise<T>): Promise<T> => {
        try {
          return await this.deps.change({ ...change, parent: parentRef }, tx, method);
        } catch (error) {
          throw atRow(error, path, child, this.deps.errorMapper);
        }
      };

      for (const entry of deletes) {
        await run(`${at}.delete.${entry.raw}`, { kind: 'delete', target: child, existing: rows.get(entry.canonical)!, id: entry.id }, () => resource.delete(entry.id, tx));
      }
      for (const entry of updates) {
        const existing = rows.get(entry.canonical)!;
        const dto = moves.has(entry.canonical) ? { ...entry.dto, [inline.order!]: moves.get(entry.canonical) } : entry.dto;
        await run(`${at}.update.${entry.raw}`, { kind: 'update', target: child, existing, id: entry.id, dto }, async () => {
          if (hasIds(entry.relationIds)) {
            const values = { ...(await this.deps.values(child, existing, tx)), ...dto };
            await this.deps.checkRelationsExist(child, entry.relationIds, tx, await withParent(values));
          }
          return this.deps.reloadIfEmpty(child, await resource.update(entry.id, dto, tx), entry.id, tx);
        });
      }
      const updated = new Set(updates.map((entry) => entry.canonical));
      for (const [canonical, position] of moves) {
        if (updated.has(canonical)) continue;
        const id = parseRecordId(canonical, child.schema);
        const dto = { [inline.order!]: position };
        await run(at, { kind: 'update', target: child, existing: rows.get(canonical)!, id, dto }, async () => this.deps.reloadIfEmpty(child, await resource.update(id, dto, tx), id, tx));
      }
      const link = (parentEntity as Record<string, unknown>)[inline.referenced];
      for (const entry of creates) {
        const position = positions.get(entry.key);
        const dto = { ...entry.dto, ...(position !== undefined ? { [inline.order!]: position } : {}), [inline.link]: link };
        await run(`${at}.create.${entry.index}`, { kind: 'create', target: child, dto }, async () => {
          if (hasIds(entry.relationIds)) await this.deps.checkRelationsExist(child, entry.relationIds, tx, await withParent(dto));
          const result: unknown = await resource.create(dto, tx);
          if (typeof result !== 'object' || result === null) throw new Error(`${child.className}.create() must return the created entity`);
          return result;
        });
      }
    }
  }
}

interface ParsedInline {
  inline: RegisteredInline;
  creates: Array<{ key: string; body: Record<string, unknown> }>;
  updates: Array<{ raw: string; canonical: string; id: RecordId; version?: number; body: Record<string, unknown> }>;
  deletes: PlannedDelete[];
  order?: string[];
}

/** The shape of one inline's changes; problems go to `errors` by path. Invalid `_id`s are 404s, as on the child's own routes. */
function parseChanges(inline: RegisteredInline, raw: unknown, errors: Record<string, string[]>): ParsedInline {
  const { child } = inline;
  const at = `_inlines.${inline.name}`;
  const out: ParsedInline = { inline, creates: [], updates: [], deletes: [] };
  if (!isObject(raw)) {
    errors[at] = ['must be an object with create, update, delete and order'];
    return out;
  }
  for (const key of Object.keys(raw)) if (!['create', 'update', 'delete', 'order'].includes(key)) errors[`${at}.${key}`] = ['is not create, update, delete or order'];
  const list = (name: string): unknown[] | undefined => {
    const value = raw[name];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
      errors[`${at}.${name}`] = ['must be a list'];
      return undefined;
    }
    if (value.length > MAX_INLINE_ROWS) {
      errors[at] = [`takes at most ${MAX_INLINE_ROWS} entries in ${name}`];
      return undefined;
    }
    return value;
  };
  const creates = list('create') ?? [];
  const updates = list('update') ?? [];
  const deletes = list('delete') ?? [];
  const order = list('order');
  if (creates.length + updates.length + deletes.length > MAX_INLINE_ROWS) errors[at] = [`takes at most ${MAX_INLINE_ROWS} entries`];
  if (errors[at]) return out;

  // Nested inlines are refused; so is the link, which the server sets (and an update may not change).
  const bodyOf = (entry: Record<string, unknown>, path: string, own: string[]): Record<string, unknown> => {
    if (Object.hasOwn(entry, '_inlines')) errors[`${path}._inlines`] = ['inlines are one level deep'];
    if (Object.hasOwn(entry, inline.link)) errors[`${path}.${inline.link}`] = ['is set by the parent'];
    return Object.fromEntries(Object.entries(entry).filter(([key]) => !own.includes(key) && key !== '_inlines' && key !== inline.link));
  };

  const keys = new Set<string>();
  creates.forEach((entry, index) => {
    const path = `${at}.create.${index}`;
    if (!isObject(entry)) {
      errors[path] = ['must be an object'];
      return;
    }
    const key = entry._key;
    if (typeof key !== 'string' || !KEY.test(key)) errors[`${path}._key`] = ['must be a text of 1 to 64 characters'];
    else if (keys.has(key)) errors[`${path}._key`] = ['is used twice'];
    else keys.add(key);
    out.creates.push({ key: String(key), body: bodyOf(entry, path, ['_key']) });
  });

  const ids = new Set<string>();
  updates.forEach((entry, index) => {
    if (!isObject(entry)) {
      errors[`${at}.update.${index}`] = ['must be an object'];
      return;
    }
    const raw = entry._id;
    if (typeof raw !== 'string' || raw === '') {
      errors[`${at}.update.${index}._id`] = ['must be the id of a row'];
      return;
    }
    const path = `${at}.update.${raw}`;
    const version = entry._version;
    if (version !== undefined && (typeof version !== 'number' || !Number.isInteger(version))) errors[`${path}._version`] = ['must be the version of the row (an integer)'];
    const id = parseRecordId(raw, child.schema); // an id that cannot exist is a 404, as on the child's own routes
    const canonical = recordIdOf(whereOf(child, id), child.schema.primaryKeys);
    if (ids.has(canonical)) errors[at] = [`"${raw}" is updated twice`];
    ids.add(canonical);
    out.updates.push({ raw, canonical, id, ...(typeof version === 'number' ? { version } : {}), body: bodyOf(entry, path, ['_id', '_version']) });
  });

  if (deletes.some((entry) => typeof entry !== 'string' || entry === '')) errors[`${at}.delete`] = ['must be a list of row ids'];
  else {
    const removed = new Set<string>();
    for (const raw of deletes as string[]) {
      const id = parseRecordId(raw, child.schema);
      const canonical = recordIdOf(whereOf(child, id), child.schema.primaryKeys);
      if (ids.has(canonical)) errors[at] = [`"${raw}" is both updated and deleted`];
      else if (removed.has(canonical)) errors[at] = [`"${raw}" is deleted twice`];
      removed.add(canonical);
      out.deletes.push({ raw, canonical, id });
    }
  }

  if (order !== undefined) {
    if (inline.order === undefined) errors[`${at}.order`] = ['this inline has no order'];
    else if (order.some((item) => typeof item !== 'string' || item === '')) errors[`${at}.order`] = ['must be a list of row ids and new rows\' keys'];
    else out.order = order as string[];
  }
  return out;
}

/** The canonical `_id` of a sent id, or undefined when it cannot be one. */
function canonicalId(child: RegisteredResource, raw: string): string | undefined {
  try {
    return recordIdOf(whereOf(child, parseRecordId(raw, child.schema)), child.schema.primaryKeys);
  } catch {
    return undefined;
  }
}

/** Runs a field check; its FORBIDDEN_FIELDS go to `out` under `path`. */
function collect(out: Record<string, string[]>, path: string, check: () => void): void {
  try {
    check();
  } catch (error) {
    if (!(error instanceof AdminForbiddenFieldsError)) throw error;
    for (const [field, messages] of Object.entries(error.fields ?? {})) out[`${path}.${field}`] = messages;
  }
}

/** The validated DTO, or undefined with its errors put under `path`. */
async function validated(errors: Record<string, string[]>, path: string, run: () => Promise<object>): Promise<object | undefined> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof AdminValidationError)) throw error;
    for (const [field, messages] of Object.entries(error.fields ?? {})) errors[`${path}.${field}`] = messages;
    return undefined;
  }
}

function relationsOf(errors: Record<string, string[]>, path: string, dto: object, schema: Parameters<typeof relationIdsOf>[1]): Map<string, RelationId[]> | undefined {
  try {
    return relationIdsOf(dto, schema);
  } catch (error) {
    if (!(error instanceof AdminValidationError)) throw error;
    for (const [field, messages] of Object.entries(error.fields ?? {})) errors[`${path}.${field}`] = messages;
    return undefined;
  }
}

/**
 * An error of one child row as the save answers it: a client error keeps its status and code, with its fields under
 * the row's path (a message without fields goes on the row itself), so the UI shows it on that row. Database
 * constraint errors are read with the CHILD's names. A host 401 is a 400 (`hostError`). Anything else is left as
 * it is (a 500, logged by the HTTP layer).
 */
function atRow(error: unknown, path: string, child: RegisteredResource, errorMapper: ErrorMapper | undefined): unknown {
  error = hostError(error);
  let status: number;
  let code: AdminError['code'];
  let message: string;
  let fields: Record<string, string[]> | undefined;
  if (error instanceof AdminError) {
    ({ status, code, message, fields } = error);
  } else if (error instanceof HttpException && error.getStatus() < 500) {
    status = error.getStatus();
    code = codeForStatus(status);
    message = error.message;
  } else if (error instanceof QueryFailedError || errorMapper) {
    const mapped = toErrorResponse(error, '', { error: () => undefined }, { dbNames: child.dbNames, errorMapper, deleting: path.includes('.delete.') });
    if (mapped.status >= 500) return error;
    ({ status } = mapped);
    ({ code, message, fields } = mapped.body);
  } else {
    return error;
  }
  if (status >= 500) return error;
  const placed = fields && Object.keys(fields).length > 0 ? Object.fromEntries(Object.entries(fields).map(([field, messages]) => [`${path}.${field}`, messages])) : { [path]: [message] };
  return new AdminError(code, status, message, placed);
}
