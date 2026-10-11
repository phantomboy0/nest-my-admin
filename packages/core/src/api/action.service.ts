import type { Logger } from '@nestjs/common';
import type { ActionBulkResult, ActionRecordResult, ActionResourceResult, ActionResult, AdminRecord } from '../contract.js';
import { parseRecordId } from '../crud/record-id.js';
import { validateWrite } from '../crud/validate-write.js';
import type { ActionOutcome, RegisteredAction } from '../decorators/admin-action.js';
import { AdminBadRequestError, AdminForbiddenError, AdminNotFoundError, AdminValidationError } from '../errors.js';
import { toErrorResponse } from '../http/error-response.js';
import { resolveText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import type { AdminContext } from '../resource/admin-context.js';

/** Most ids one bulk request may name (a list page). */
export const MAX_BULK = 100;

/** What running actions needs from `AdminApiService`: its write transaction and its record serializer. */
export interface ActionHost {
  policy: AdminPolicy;
  options: ResolvedAdminOptions;
  logger: Logger;
  /** `AdminApiService.write`: one transaction, `ctx.manager` set, after-commit work. */
  write<T>(entry: RegisteredResource, ctx: AdminContext, work: (tx: AdminContext) => Promise<T>): Promise<T>;
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
    const label = resolveText(action.label, ctx.locale ?? options.locale, options.locale);
    policy.requireAction(entry, action, label, ctx);

    const request = parseRequest(body);
    const input = await validateInput(action, request.input);
    if (action.target === 'resource') {
      if (request.ids !== undefined) throw new AdminBadRequestError(`"${label}" runs on the resource, not on records: send no ids`);
      return this.runOnResource(entry, action, input, ctx);
    }
    const ids = parseIds(request.ids);
    if (ids.length === 1) return this.runOnOne(entry, action, label, ids[0]!, input, ctx);
    if (!action.bulk) throw new AdminBadRequestError(`"${label}" runs on one record at a time`);
    return action.atomic ? this.runTogether(entry, action, label, ids, input, ctx) : this.runEach(entry, action, label, ids, input, ctx);
  }

  private async runOnResource(entry: RegisteredResource, action: RegisteredAction, input: object, ctx: AdminContext): Promise<ActionResourceResult> {
    const outcome = await this.host.write(entry, ctx, async (tx) => methodOf(entry, action).call(entry.resource, input, tx));
    return withMessage({}, messageOf(outcome, ctx, this.host.options));
  }

  private runOnOne(entry: RegisteredResource, action: RegisteredAction, label: string, rawId: string, input: object, ctx: AdminContext): Promise<ActionRecordResult> {
    return this.host.write(entry, ctx, async (tx) => {
      const { message, after } = await this.runOnRecord(entry, action, label, rawId, input, tx);
      return withMessage({ record: after ? await this.host.record(entry, after, tx) : null }, message);
    });
  }

  /** Each record in its own transaction: a failure is reported for its id (as the single run would answer) and undoes nothing else. */
  private async runEach(entry: RegisteredResource, action: RegisteredAction, label: string, ids: string[], input: object, ctx: AdminContext): Promise<ActionBulkResult> {
    const result: ActionBulkResult = { ok: [], failed: [] };
    const messages: Array<string | undefined> = [];
    for (const id of ids) {
      try {
        const { message } = await this.host.write(entry, ctx, (tx) => this.runOnRecord(entry, action, label, id, input, tx));
        result.ok.push(id);
        messages.push(message);
      } catch (error) {
        const { body: failure } = toErrorResponse(error, ctx.correlationId, this.host.logger, { dbNames: entry.dbNames, errorMapper: this.host.options.errorMapper });
        result.failed.push({ id, code: failure.code, message: failure.message });
      }
    }
    return withMessage(result, sharedMessage(messages));
  }

  /** `atomic`: every record in one transaction; the first failure is the answer and nothing is applied. */
  private runTogether(entry: RegisteredResource, action: RegisteredAction, label: string, ids: string[], input: object, ctx: AdminContext): Promise<ActionBulkResult> {
    return this.host.write(entry, ctx, async (tx) => {
      const messages: Array<string | undefined> = [];
      for (const id of ids) messages.push((await this.runOnRecord(entry, action, label, id, input, tx)).message);
      return withMessage<ActionBulkResult>({ ok: [...ids], failed: [] }, sharedMessage(messages));
    });
  }

  /**
   * One record, start to finish, inside the write transaction `tx`: load it, check the user's scopes for view and
   * update (404, as if it did not exist) and the action's `@AdminCan` rules (403), call the method, read the record
   * again. Every path (single, bulk, atomic) runs a record through here and nowhere else.
   */
  private async runOnRecord(entry: RegisteredResource, action: RegisteredAction, label: string, rawId: string, input: object, tx: AdminContext): Promise<RecordRun> {
    const { policy, options } = this.host;
    const { schema, resource } = entry;
    const id = parseRecordId(rawId, schema);
    await policy.requireInScope(entry, id, rawId, 'view', tx);
    await policy.requireInScope(entry, id, rawId, 'update', tx);
    const existing = await resource.findOne(id, tx);
    if (!existing) throw new AdminNotFoundError(`${schema.label} "${rawId}" not found`);
    if (!policy.recordRule(entry, action.name, existing, tx)) throw new AdminForbiddenError(`You may not run "${label}" on ${schema.label} "${rawId}"`);

    // Each record gets its own copy of the input: a method that changes it must not change the next record's.
    const own = Object.assign(Object.create(Object.getPrototypeOf(input) as object | null) as object, input);
    const outcome = await methodOf(entry, action).call(resource, existing, own, tx);

    // The action may have deleted the record or moved it out of the user's scopes (a findOne override may ignore them).
    const reloaded = await resource.findOne(id, tx);
    const visible = reloaded !== null && (await policy.allowedIds(entry, [id], 'view', tx)).size > 0;
    return withMessage({ after: visible ? reloaded : null }, messageOf(outcome, tx, options));
  }
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

/** The distinct ids, in request order. */
function parseIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK || ids.some((id) => typeof id !== 'string' || id === '')) {
    throw new AdminValidationError({ ids: [`must be a list of 1 to ${MAX_BULK} record ids`] });
  }
  return [...new Set(ids as string[])];
}

/**
 * The input as an instance of the action's DTO, validated like a write: unknown keys and class-validator failures
 * are a 422 keyed by the input's field names. An action without a DTO takes no input (`{}`).
 */
async function validateInput(action: RegisteredAction, input: unknown): Promise<object> {
  if (input !== undefined && input !== null && !isPlainObject(input)) throw new AdminBadRequestError('`input` must be a JSON object');
  // Class initializers of the DTO are the input's defaults, so they are kept (a write would drop them).
  return validateWrite(input ?? {}, { allowed: action.form?.fields.map((field) => field.name) ?? [], dto: action.input, keepDefaults: true });
}

/** `ActionOutcome.message` in the request's language; anything else a method returns is ignored. */
function messageOf(outcome: unknown, ctx: AdminContext, options: ResolvedAdminOptions): string | undefined {
  const message = isPlainObject(outcome) ? (outcome as ActionOutcome).message : undefined;
  const isText = typeof message === 'string' || (isPlainObject(message) && Object.values(message).every((text) => typeof text === 'string'));
  return isText ? resolveText(message!, ctx.locale ?? options.locale, options.locale) || undefined : undefined;
}

/** One message for a bulk run only when every record that ran gave the same one. */
function sharedMessage(messages: Array<string | undefined>): string | undefined {
  return messages.length > 0 && messages.every((message) => message === messages[0]) ? messages[0] : undefined;
}

function withMessage<T extends object>(result: T, message: string | undefined): T & { message?: string } {
  return message === undefined ? result : { ...result, message };
}
