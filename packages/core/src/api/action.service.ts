import type { Logger } from '@nestjs/common';
import type { ActionBulkResult, ActionRecordResult, ActionResourceResult, ActionResult, AdminRecord } from '../contract.js';
import { MAX_BULK } from '../constants.js';
import { parseRecordId, recordIdOf } from '../crud/record-id.js';
import { validateWrite } from '../crud/validate-write.js';
import type { ActionOutcome, RegisteredAction } from '../decorators/admin-action.js';
import { AdminBadRequestError, AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { toErrorResponse } from '../http/error-response.js';
import { resolveText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';
import type { RecordId } from '../resource/admin-resource-base.js';
import type { WriteRunner } from './write-runner.js';

/** What running actions needs from `AdminApiService`: its write transaction and its record serializer. */
export interface ActionHost {
  policy: AdminPolicy;
  options: ResolvedAdminOptions;
  logger: Logger;
  /** `AdminApiService`'s write transaction (`run`) and the participants of each change in it (`change`). */
  writes: WriteRunner;
  /** One record as the user sees it (`_perm` included). */
  record(entry: RegisteredResource, entity: object, ctx: AdminContext): Promise<AdminRecord>;
}

/** One record's run: what the method answered and the record afterwards (null when the user can no longer see it). */
interface RecordRun {
  message?: string;
  after: object | null;
}

type ActionMethod = (...args: unknown[]) => unknown;

/**
 * Runs `@AdminAction` methods (spec §5.2, §11): permission, input validation, then the method inside
 * `AdminApiService.write()`. A record action never reaches a record the user cannot view and update.
 */
export class ActionService {
  constructor(private readonly host: ActionHost) {}

  async run(entry: RegisteredResource, name: string, body: unknown, ctx: AdminContext): Promise<ActionResult> {
    const { policy, options } = this.host;
    policy.requireReach(entry, ctx);
    const action = entry.actions.get(name);
    if (!action) throw new AdminNotFoundError(`${entry.schema.label} has no action "${name}"`);
    const label = options.texts(action.label, ctx.locale ?? options.locale, `resource.${entry.schema.name}.actions.${action.name}.label`);
    policy.requireAction(entry, action, label, ctx);
    // The HTTP layer refuses writes while viewing as someone; this covers callers that are not HTTP.
    if (ctx.viewAs) throw new AdminForbiddenError('Viewing as another user is read-only');

    const request = parseRequest(body);
    // Validated once up front (a 422 before anything runs); every run then gets an instance of its own, and the
    // first one, which no method ever sees, is what the participants of the write are told was sent.
    const input: ActionInput = { sent: await validateInput(action, request.input), fresh: () => validateInput(action, request.input) };
    if (action.target === 'resource') {
      if (request.ids !== undefined) throw new AdminBadRequestError(`"${label}" runs on the resource, not on records: send no ids`);
      return this.runOnResource(entry, action, input, ctx);
    }
    const ids = distinctIds(parseIds(request.ids), entry);
    if (ids.length === 1) return this.runOnOne(entry, action, label, ids[0]!, input, ctx);
    if (!action.bulk) throw new AdminBadRequestError(`"${label}" runs on one record at a time`);
    return action.atomic ? this.runTogether(entry, action, label, ids, input, ctx) : this.runEach(entry, action, label, ids, input, ctx);
  }

  private async runOnResource(entry: RegisteredResource, action: RegisteredAction, input: ActionInput, ctx: AdminContext): Promise<ActionResourceResult> {
    const outcome = await this.host.writes.run(entry, ctx, (tx) =>
      this.host.writes.change({ kind: 'action', target: entry, action: { definition: action, input: input.sent } }, tx, async () => methodOf(entry, action).call(entry.resource, await input.fresh(), tx), () => undefined),
    );
    return withMessage({}, messageOf(outcome, ctx, this.host.options));
  }

  private runOnOne(entry: RegisteredResource, action: RegisteredAction, label: string, rawId: string, input: ActionInput, ctx: AdminContext): Promise<ActionRecordResult> {
    return this.host.writes.run(entry, ctx, async (tx) => {
      const { message, after } = await this.runOnRecord(entry, action, label, rawId, input, tx);
      return withMessage({ record: after ? await this.host.record(entry, after, tx) : null }, message);
    });
  }

  /** Each record in its own transaction: a failure is reported for its id (as the single run would answer) and undoes nothing else. */
  private async runEach(entry: RegisteredResource, action: RegisteredAction, label: string, ids: string[], input: ActionInput, ctx: AdminContext): Promise<ActionBulkResult> {
    const result: ActionBulkResult = { ok: [], failed: [] };
    const messages: Array<string | undefined> = [];
    for (const id of ids) {
      try {
        const { message } = await this.host.writes.run(entry, ctx, (tx) => this.runOnRecord(entry, action, label, id, input, tx));
        result.ok.push(id);
        messages.push(message);
      } catch (error) {
        const { body: failure } = toErrorResponse(error, ctx.correlationId, this.host.logger, { dbNames: entry.dbNames, errorMapper: this.host.options.errorMapper });
        result.failed.push({ id, code: failure.code, message: failure.message });
      }
    }
    return withMessage(result, sharedMessage(messages));
  }

  /**
   * `atomic`: every record is loaded and checked before any method is called, so a record the user may not touch
   * refuses the whole run without leaning on a rollback. Then all of them run in the same transaction; a method
   * that throws is the answer and undoes the ones before it (the registry refuses `atomic` without transactions).
   */
  private runTogether(entry: RegisteredResource, action: RegisteredAction, label: string, ids: string[], input: ActionInput, ctx: AdminContext): Promise<ActionBulkResult> {
    return this.host.writes.run(entry, ctx, async (tx) => {
      for (const id of ids) await this.loadAllowed(entry, action, label, id, tx);
      const messages: Array<string | undefined> = [];
      for (const id of ids) messages.push((await this.runOnRecord(entry, action, label, id, input, tx)).message);
      return withMessage<ActionBulkResult>({ ok: [...ids], failed: [] }, sharedMessage(messages));
    });
  }

  /**
   * The record, if the user may run the action on it: within their scopes for view and update (404 otherwise, as if
   * it did not exist; the trash counts as gone) and with the action's `@AdminCan` rules agreeing (403 otherwise).
   */
  private async loadAllowed(entry: RegisteredResource, action: RegisteredAction, label: string, rawId: string, tx: AdminContext): Promise<{ id: RecordId; record: object }> {
    const { policy } = this.host;
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    await policy.requireInScope(entry, id, rawId, 'view', tx);
    await policy.requireInScope(entry, id, rawId, 'update', tx);
    const record = await resource.findOne(id, tx);
    if (!record) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    // A per-record label of `null` means the action does not exist on this record (it is not offered there either).
    if (action.labelFor && action.labelFor(record) === null) throw new AdminNotFoundError(`"${action.name}" does not apply to ${schema.label} "${rawId}"`);
    if (!policy.recordRule(entry, action.name, record, tx)) throw new AdminForbiddenError(`You may not run "${label}" on ${schema.label} "${rawId}"`);
    return { id, record };
  }

  /**
   * One record, start to finish, inside the write `tx`: load and check it (`loadAllowed`), call the method with an
   * input of its own, read the record again. Every path (single, bulk, atomic) runs a record through here and
   * nowhere else. An atomic run has checked every record once already; it is loaded again here, because the methods
   * that ran before it may have changed it.
   */
  private async runOnRecord(entry: RegisteredResource, action: RegisteredAction, label: string, rawId: string, input: ActionInput, tx: AdminContext): Promise<RecordRun> {
    const { policy, options } = this.host;
    const { id, record } = await this.loadAllowed(entry, action, label, rawId, tx);
    // One change of the write: its participants see the record before the method runs (which may change the entity
    // it is handed) and as it is read again afterwards, whether or not the user can still see it; null: it is gone.
    const { outcome, reloaded } = await this.host.writes.change(
      { kind: 'action', target: entry, existing: record, id, action: { definition: action, input: input.sent } },
      tx,
      async () => ({ outcome: await methodOf(entry, action).call(entry.resource, record, await input.fresh(), tx), reloaded: (await entry.resource.findOne(id, tx)) as object | null }),
      (result) => result.reloaded,
    );
    // The action may have deleted the record or moved it out of the user's scopes (a findOne override may ignore them).
    const visible = reloaded !== null && (await policy.allowedIds(entry, [id], 'view', tx)).size > 0;
    return withMessage({ after: visible ? reloaded : null }, messageOf(outcome, tx, options));
  }
}

/**
 * The action's validated input. `fresh()` is a new instance for each run: a method that changes its input changes
 * nobody else's. `sent` is the instance of the up-front validation, handed to no method.
 */
interface ActionInput {
  sent: object;
  fresh(): Promise<object>;
}

function methodOf(entry: RegisteredResource, action: RegisteredAction): ActionMethod {
  return (entry.resource as unknown as Record<string, ActionMethod>)[action.name]!;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `{ ids?, input? }` and nothing else; an empty body is `{}`. */
function parseRequest(body: unknown): { ids?: unknown; input?: unknown } {
  if (body === undefined || body === null) return {};
  if (!isPlainObject(body)) throw new AdminBadRequestError('Request body must be a JSON object');
  const unknown = Object.keys(body).filter((key) => key !== 'ids' && key !== 'input');
  if (unknown.length > 0) throw new AdminBadRequestError(`An action takes \`ids\` and \`input\`, not ${unknown.map((key) => `\`${key}\``).join(', ')}`);
  return body;
}

function parseIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK || ids.some((id) => typeof id !== 'string' || id === '')) {
    throw new AdminValidationError({ ids: [`must be a list of 1 to ${MAX_BULK} record ids`] });
  }
  return ids as string[];
}

/**
 * The ids naming distinct records, in request order, each as first spelled. Two spellings of one key (`1` and `01`
 * for a number, the cases of a uuid) are one record; an id that cannot be parsed stays, to be answered as not found.
 */
function distinctIds(ids: string[], entry: RegisteredResource): string[] {
  const { schema } = entry;
  const keys = schema.primaryKeys;
  const seen = new Set<string>();
  return ids.filter((raw) => {
    let canonical: string;
    try {
      const id = parseRecordId(raw, schema);
      const values = typeof id === 'object' ? id : { [keys[0]!]: id };
      // Numbers are parsed already; bigint and uuid keys stay strings, so their spellings are folded here.
      const folded = Object.fromEntries(keys.map((key) => [key, foldKey(values[key]!, schema.fields.find((field) => field.name === key)?.type)]));
      canonical = `id:${recordIdOf(folded, keys)}`;
    } catch {
      canonical = `raw:${raw}`;
    }
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

function foldKey(value: string | number, type: string | undefined): string | number {
  if (type === 'bigint') return BigInt(value).toString();
  if (type === 'uuid') return String(value).toLowerCase();
  return value;
}

/**
 * The input as an instance of the action's DTO, validated like a write: unknown keys and class-validator failures
 * are a 422 keyed by the input's field names. An action without a DTO takes no input (`{}`).
 */
async function validateInput(action: RegisteredAction, input: unknown): Promise<object> {
  if (input !== undefined && input !== null && !isPlainObject(input)) throw new AdminBadRequestError('`input` must be a JSON object');
  // Class initializers of the DTO are the input's defaults, so they are kept (a write would drop them).
  // A deep copy first: the instance must share nothing, nested lists included, with the body or another run's input.
  return validateWrite(structuredClone(input ?? {}), { allowed: action.form?.fields.map((field) => field.name) ?? [], dto: action.input, keepDefaults: true });
}

/** `ActionOutcome.message` in the request's language; anything else a method returns is ignored. */
function messageOf(outcome: unknown, ctx: AdminContext, options: ResolvedAdminOptions): string | undefined {
  const message = isPlainObject(outcome) ? (outcome as ActionOutcome).message : undefined;
  const isText = typeof message === 'string' || (isPlainObject(message) && Object.values(message).every((text) => typeof text === 'string'));
  return isText ? options.texts(message!, ctx.locale ?? options.locale) || undefined : undefined;
}

/** One message for a bulk run only when every record that ran gave the same one. */
function sharedMessage(messages: Array<string | undefined>): string | undefined {
  return messages.length > 0 && messages.every((message) => message === messages[0]) ? messages[0] : undefined;
}

function withMessage<T extends object>(result: T, message: string | undefined): T & { message?: string } {
  return message === undefined ? result : { ...result, message };
}
