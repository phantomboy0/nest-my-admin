import type { AdminRecord, FieldSchema, FormLayoutInline, InlineChangeSet, InlineChanges, ResourceSchema } from '@nest-my-admin/core/contract';
import { toFormValues, toPayload, type FormValues } from '@/lib/form-values';
import { validatePayload } from '@/lib/validate';

/**
 * One row of an inline in the form: an existing child (`id`, its `record`) or a new one (`key` only, `n1`, `n2`…).
 * `key` names the row everywhere in the form (errors, React keys, `order`): the `_id` of an existing row.
 */
export interface InlineRow {
  key: string;
  id?: string;
  record?: AdminRecord;
  values: FormValues;
}

/** An inline's rows as the form edits them. */
export type InlineRowsState = Record<string, InlineRow[]>;

/** Errors of one inline: by row key, then by field path; `inline` for the inline as a whole (count, order). */
export interface InlineErrors {
  rows: Record<string, Record<string, string[]>>;
  inline: string[];
}

/** The fields an inline edits: the layout's list, as the child's schema has them, without the order field (the server writes it). */
export function inlineFields(inline: FormLayoutInline, child: ResourceSchema): FieldSchema[] {
  return inline.fields.filter((name) => name !== inline.order).flatMap((name) => child.fields.filter((field) => field.name === name));
}

/** The rows a record starts with (none for a new record or a copy: Duplicate does not copy children). */
export function inlineRowsOf(inline: FormLayoutInline, child: ResourceSchema, record: AdminRecord | undefined): InlineRow[] {
  const read = (record?._inlines as Record<string, { rows: AdminRecord[] }> | undefined)?.[inline.inline];
  const fields = inlineFields(inline, child);
  return (read?.rows ?? []).map((row) => ({ key: String(row._id), id: String(row._id), record: row, values: toFormValues(fields, row) }));
}

/** A new, empty row. */
export function newInlineRow(inline: FormLayoutInline, child: ResourceSchema, key: string): InlineRow {
  return { key, values: toFormValues(inlineFields(inline, child)) };
}

/** Fields of an existing row that this row says may not change (`_readonly`), or every field without update. */
export function lockedFields(row: InlineRow, child: ResourceSchema): Set<string> {
  if (!row.record) return new Set();
  const perm = row.record._perm as { update?: boolean } | undefined;
  if (child.permissions?.update === false || perm?.update === false) return new Set(child.fields.map((field) => field.name));
  const locked = Array.isArray(row.record._readonly) ? (row.record._readonly as string[]) : [];
  return new Set([...child.form.readonly, ...locked]);
}

/**
 * The changes of one inline, from the rows it started with and the rows it has now: only changed fields of changed
 * rows, new rows with their `_key`, removed rows by `_id`, and `order` only when the sequence of rows changed (and
 * the inline has an order field this user may write). Undefined when nothing changed. `errors` are the conversion
 * and constraint errors, by row key and field path.
 */
export function inlineChangeSet(
  inline: FormLayoutInline,
  child: ResourceSchema,
  initial: InlineRow[],
  current: InlineRow[],
): { changes?: InlineChangeSet; errors: Record<string, Record<string, string[]>> } {
  const fields = inlineFields(inline, child);
  const errors: Record<string, Record<string, string[]>> = {};
  const create: NonNullable<InlineChangeSet['create']> = [];
  const update: NonNullable<InlineChangeSet['update']> = [];
  const before = new Map(initial.map((row) => [row.key, row]));
  for (const row of current) {
    const started = before.get(row.key);
    if (started?.id !== undefined) {
      const locked = lockedFields(row, child);
      const { payload, errors: converted } = toPayload(fields.filter((field) => !locked.has(field.name)), row.values, started.values);
      const found = { ...validatePayload(payload, child.form.constraints.update, 'update'), ...converted };
      if (Object.keys(found).length > 0) errors[row.key] = found;
      if (Object.keys(payload).length === 0) continue;
      const version = child.version ? started.record?.[child.version] : undefined;
      update.push({ _id: started.id, ...payload, ...(typeof version === 'number' ? { _version: version } : {}) });
    } else {
      const { payload, errors: converted } = toPayload(fields, row.values);
      const found = { ...validatePayload(payload, child.form.constraints.create, 'create'), ...converted };
      if (Object.keys(found).length > 0) errors[row.key] = found;
      create.push({ _key: row.key, ...payload });
    }
  }
  const kept = new Set(current.map((row) => row.key));
  const remove = initial.filter((row) => row.id !== undefined && !kept.has(row.key)).map((row) => row.id!);
  const ordered = inline.order !== undefined && child.form.update.includes(inline.order);
  const sequence = current.map((row) => row.key);
  const order = ordered && sequence.join('\n') !== initial.map((row) => row.key).join('\n') ? sequence : undefined;
  const changes: InlineChangeSet = {
    ...(create.length ? { create } : {}),
    ...(update.length ? { update } : {}),
    ...(remove.length ? { delete: remove } : {}),
    ...(order ? { order } : {}),
  };
  return { changes: Object.keys(changes).length ? changes : undefined, errors };
}

/**
 * The `_inlines` of a save: every inline that changed. `errors` by inline, then row key, then field; a row's count
 * outside `min`/`max` is an error of the inline (under `''`).
 */
export function inlinePayload(
  inlines: FormLayoutInline[],
  schemas: Record<string, ResourceSchema>,
  initial: InlineRowsState,
  current: InlineRowsState,
  countMessage: (inline: FormLayoutInline, count: number) => string | null,
): { changes?: InlineChanges; errors: Record<string, InlineErrors> } {
  const changes: InlineChanges = {};
  const errors: Record<string, InlineErrors> = {};
  for (const inline of inlines) {
    const child = schemas[inline.inline];
    // A read-only inline is shown, never written (the server refuses it too).
    if (!child || inline.readonly) continue;
    const rows = current[inline.inline] ?? [];
    const found = inlineChangeSet(inline, child, initial[inline.inline] ?? [], rows);
    const message = found.changes ? countMessage(inline, rows.length) : null;
    if (Object.keys(found.errors).length > 0 || message) errors[inline.inline] = { rows: found.errors, inline: message ? [message] : [] };
    if (found.changes) changes[inline.inline] = found.changes;
  }
  return { changes: Object.keys(changes).length ? changes : undefined, errors };
}

/**
 * The server's errors of a save, back on the rows: `_inlines.<child>.create.<index>.<field>` (the index in the sent
 * `create` list), `_inlines.<child>.update.<_id>.<field>`, `_inlines.<child>.delete.<_id>` and `_inlines.<child>`.
 * What names no row it knows goes to the inline. The rest (the parent's own fields) is returned in `parent`.
 */
export function inlineErrorsOf(
  fields: Record<string, string[]>,
  sent: InlineChanges | undefined,
): { inlines: Record<string, InlineErrors>; parent: Record<string, string[]> } {
  const inlines: Record<string, InlineErrors> = {};
  const parent: Record<string, string[]> = {};
  for (const [path, messages] of Object.entries(fields)) {
    if (path !== '_inlines' && !path.startsWith('_inlines.')) {
      parent[path] = messages;
      continue;
    }
    const [, child = '', operation, ref, ...rest] = path.split('.');
    const target = (inlines[child] ??= { rows: {}, inline: [] });
    const rowKey = operation === 'create' ? sent?.[child]?.create?.[Number(ref)]?._key : operation === 'update' || operation === 'delete' ? ref : undefined;
    const field = rest.join('.');
    if (rowKey === undefined || (operation === 'create' && !/^\d+$/.test(ref ?? ''))) target.inline.push(...messages);
    else if (field === '') target.inline.push(...messages);
    else ((target.rows[rowKey] ??= {})[field] ??= []).push(...messages);
  }
  return { inlines, parent };
}

/** Whether any inline has errors. */
export const hasInlineErrors = (errors: Record<string, InlineErrors>): boolean =>
  Object.values(errors).some((found) => found.inline.length > 0 || Object.keys(found.rows).length > 0);
