import type { ActionResult, ActionSchema, AdminRecord, BulkResult, RecordPermissions, ResourceSchema } from '@nest-my-admin/core/contract';

/**
 * The record actions to offer on `record`: the schema's (already cut to what the user may run), narrowed by the
 * record's `_perm.actions`, each named as that record names it (a per-record label). A record without `_perm`, or a
 * `_perm` without `actions`, allows every one of them.
 */
export function recordActions(schema: ResourceSchema, record: AdminRecord | undefined): ActionSchema[] {
  const allowed = (record?._perm as RecordPermissions | undefined)?.actions;
  return schema.actions
    .filter((action) => action.target === 'record' && (allowed === undefined || typeof allowed[action.name] === 'string'))
    .map((action) => (allowed?.[action.name] ? { ...action, label: allowed[action.name] as string } : action));
}

/** Buttons shown in the record's header before the rest go into the ⋯ menu. */
export const HEADER_BUTTONS = 3;

/** The record's header (the design's order page): up to three outline buttons, the rest in ⋯, and the primary last. */
export function headerActions(schema: ResourceSchema, record: AdminRecord | undefined): { primary?: ActionSchema; buttons: ActionSchema[]; overflow: ActionSchema[] } {
  const actions = recordActions(schema, record);
  const primary = actions.find((action) => action.primary);
  const rest = actions.filter((action) => action !== primary);
  return { ...(primary ? { primary } : {}), buttons: rest.slice(0, HEADER_BUTTONS), overflow: rest.slice(HEADER_BUTTONS) };
}

/**
 * The bulk actions to offer for a selection: those at least one of the selected records allows. `records` are the
 * selected records the page knows; a selection it knows nothing about (phone cards) is offered every bulk action,
 * and the server answers per record.
 */
export function bulkActions(schema: ResourceSchema, records: AdminRecord[]): ActionSchema[] {
  const bulk = schema.actions.filter((action) => action.target === 'record' && action.bulk);
  if (records.length === 0) return bulk;
  return bulk.filter((action) => records.some((record) => recordActions(schema, record).some((offered) => offered.name === action.name)));
}

/** The actions of the list toolbar: they run once, without records. */
export function resourceActions(schema: ResourceSchema): ActionSchema[] {
  return schema.actions.filter((action) => action.target === 'resource');
}

/**
 * Whether a run is asked about first: the action says so (`confirm`), it is destructive, or it runs on more than
 * one record. `count` is the number of records (0 for a resource action).
 */
export function asksFirst(action: ActionSchema, count = 0): boolean {
  return action.confirm !== undefined || action.variant === 'destructive' || count > 1;
}

/** An action that runs on the click alone: nothing to fill in and nothing to confirm. */
export function runsAtOnce(action: ActionSchema, count = 0): boolean {
  return !action.input && !asksFirst(action, count);
}

/**
 * The question of the confirmation, when there is one to ask (`asksFirst`): the host's text, or a default one that
 * names the number of records, the record, or just the action.
 */
export function actionQuestion(
  action: ActionSchema,
  count: number,
  subject: string | undefined,
  t: (key: 'action.confirm' | 'action.confirmRecord' | 'action.confirmSelected', params: Record<string, string | number>) => string,
): string | undefined {
  if (!asksFirst(action, count)) return undefined;
  if (typeof action.confirm === 'string') return action.confirm;
  if (count > 1) return t('action.confirmSelected', { action: action.label, count });
  if (subject !== undefined) return t('action.confirmRecord', { action: action.label, name: subject });
  return t('action.confirm', { action: action.label });
}

export type ActionOutcome =
  /** One record: as it is now, or `null` when the user can no longer see it. */
  | { kind: 'record'; record: AdminRecord | null; message?: string }
  | { kind: 'bulk'; result: BulkResult; message?: string }
  | { kind: 'resource'; message?: string };

/** What the server answered. The shape follows the number of distinct ids sent, not the action. */
export function actionOutcome(result: ActionResult): ActionOutcome {
  const message = result.message === undefined ? {} : { message: result.message };
  if ('record' in result) return { kind: 'record', record: result.record, ...message };
  if ('ok' in result && 'failed' in result) return { kind: 'bulk', result: { ok: result.ok, failed: result.failed }, ...message };
  return { kind: 'resource', ...message };
}

/**
 * The outcome of a run on a selection as a `BulkResult`, whatever shape it had: one selected record (or several
 * spellings of one id) is answered like a single run.
 */
export function selectionResult(outcome: ActionOutcome, ids: string[]): BulkResult {
  return outcome.kind === 'bulk' ? outcome.result : { ok: ids, failed: [] };
}
