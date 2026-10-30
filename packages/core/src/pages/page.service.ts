import type { WriteRunner } from '../api/write-runner.js';
import type { FieldSchema, MetaPageSummary, PageResponse, PageSchema } from '../contract.js';
import { validateWrite } from '../crud/validate-write.js';
import { AdminForbiddenError, AdminValidationError } from '../errors.js';
import type { FilesService } from '../files/files.service.js';
import { hostError } from '../http/error-response.js';
import { scopedText } from '../i18n/texts.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import type { AdminContext } from '../resource/admin-context.js';
import { localizeDtoForm } from '../schema/dto-form.js';
import { localizeLayout } from '../schema/field-config.js';
import { loadPage, type PageRegistry, type RegisteredPage } from './page-registry.js';

/** What the page service borrows from `AdminApiService`: its write transaction with the participants of a change. */
export interface PageHost {
  pages: PageRegistry;
  policy: AdminPolicy;
  options: ResolvedAdminOptions;
  files: FilesService;
  /** `AdminApiService`'s write transaction (`run`) and the participants of each change in it (`change`). */
  writes: WriteRunner;
}

const EMPTY_SECRET = 'must not be empty: send null to clear it, or leave it out to keep it';

/** Secret values shorter than this are not searched for in error texts: replacing "live" everywhere would garble them. */
const MIN_SCRUBBED = 6;

/**
 * Settings pages (`@AdminSettingsPage`): reading one and saving one. Built by `AdminApiService` (not a Nest provider,
 * like `ActionService`), which lends it its write transaction.
 *
 * A secret field never leaves: not in `values`, not in the answer of a save, and not in an error or a log line that
 * passes through here (see `scrubSecrets`).
 */
export class PageService {
  constructor(private readonly host: PageHost) {}

  private text(page: RegisteredPage, locale: string | undefined): string {
    return this.host.options.texts(page.label, locale ?? this.host.options.locale, `page.${page.name}`);
  }

  /** The pages `ctx`'s user may view (all of them without a request), labelled in `locale`. */
  summaries(locale: string, ctx?: AdminContext): Array<MetaPageSummary & { group: string; order: number }> {
    return this.host.pages
      .list()
      .filter((page) => !ctx || this.host.policy.canPage(page, 'view', ctx))
      .map((page) => ({ name: page.name, label: this.text(page, locale), ...(page.icon ? { icon: page.icon } : {}), group: page.group, order: page.order }));
  }

  /** The page's form as this request gets it. `readonly`: the user may not save (or is viewing as someone else). */
  private schema(page: RegisteredPage, ctx: AdminContext): PageSchema {
    const { options, files, policy } = this.host;
    const locale = ctx.locale ?? options.locale;
    const text = scopedText(options.texts, locale, `page.${page.name}`);
    const form = localizeDtoForm(page.form, (value, path) => text(value, `fields.${path}`), { maxBytes: options.files?.maxBytes, enabled: files.enabled });
    return {
      name: page.name,
      label: this.text(page, locale),
      ...(page.icon ? { icon: page.icon } : {}),
      fields: form.fields,
      ...(page.layout ? { layout: localizeLayout(page.layout, (value, key) => text(value, key === undefined ? undefined : `form.${key}`)) } : {}),
      constraints: form.constraints,
      required: form.required,
      readonly: ctx.viewAs !== undefined || !policy.canPage(page, 'update', ctx),
    };
  }

  /** The answer of GET and PATCH: only the form's fields leave, and of a secret only whether it is set. */
  private async respond(page: RegisteredPage, stored: Record<string, unknown>, ctx: AdminContext): Promise<PageResponse> {
    const schema = this.schema(page, ctx);
    const values: Record<string, unknown> = {};
    const secrets: Record<string, boolean> = {};
    for (const field of schema.fields) {
      if (page.secrets.includes(field.name)) secrets[field.name] = isSet(stored[field.name]);
      else values[field.name] = pick(field, stored[field.name]);
    }
    const fileFields = this.host.files.enabled ? schema.fields.filter((field) => field.file).map((field) => field.name) : [];
    const files = fileFields.length > 0 ? (await this.host.files.refs(this.host.files.ownerOf(page), [stored], fileFields, ctx))[0]! : {};
    return { schema, values, secrets, files };
  }

  /** `GET /api/pages/:name`. A `load()` that throws is the request's error: nothing of the page is answered. */
  async get(name: string, ctx: AdminContext): Promise<PageResponse> {
    const page = this.host.pages.get(name);
    this.host.policy.requirePage(page, 'view', ctx);
    // Outside a write, so the host's 401 is remapped here (a save's goes through `write()`).
    const stored = await loadPage(page, ctx).catch((error: unknown) => Promise.reject(hostError(error)));
    return this.respond(page, stored, ctx);
  }

  /**
   * `PATCH /api/pages/:name`: validates the body as a partial of the DTO, then saves in one transaction on the
   * default DataSource and answers like GET.
   */
  async save(name: string, body: unknown, ctx: AdminContext): Promise<PageResponse> {
    const page = this.host.pages.get(name);
    this.host.policy.requirePage(page, 'update', ctx);
    // The HTTP layer refuses writes while viewing as someone; this covers callers that are not HTTP.
    if (ctx.viewAs) throw new AdminForbiddenError('Viewing as another user is read-only');
    const { dto, sent } = await this.validate(page, body, ctx);
    return this.host.writes.run(page, ctx, async (tx) => {
      const { after } = await this.apply(page, dto, sent, tx);
      return this.respond(page, after, tx);
    });
  }

  /**
   * The body as `save()` will get it: only keys of the form, each passing the DTO's rules. For a secret, `''` is
   * refused (an empty input means "unchanged" only in the UI, which then leaves the key out), `null` clears it
   * whatever the DTO says about the property, and no message tells what was sent.
   */
  private async validate(page: RegisteredPage, body: unknown, ctx: AdminContext): Promise<{ dto: Record<string, unknown>; sent: string[] }> {
    let input = body;
    const cleared: string[] = [];
    const sent: string[] = [];
    if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
      const values: Record<string, unknown> = { ...body };
      const refused: Record<string, string[]> = {};
      for (const secret of page.secrets) {
        if (!Object.hasOwn(values, secret)) continue;
        const value = values[secret];
        if (value === null) {
          cleared.push(secret);
          delete values[secret];
        } else if (value === '') refused[secret] = [EMPTY_SECRET];
        // Whatever the DTO checks, a secret is text or nothing.
        else if (typeof value !== 'string') refused[secret] = ['must be text'];
        else sent.push(value);
      }
      if (Object.keys(refused).length > 0) throw new AdminValidationError(refused);
      input = values;
    }
    const schema = this.schema(page, ctx);
    let dto: Record<string, unknown>;
    try {
      dto = (await validateWrite(input, {
        allowed: schema.fields.map((field) => field.name),
        dto: page.dto,
        partial: true,
        fields: schema.fields,
        sanitizeHtml: (html) => this.host.files.sanitizeHtml(html),
      })) as Record<string, unknown>;
    } catch (error) {
      throw error instanceof AdminValidationError ? withoutEchoes(error, page.secrets, input as Record<string, unknown>) : error;
    }
    for (const secret of cleared) dto[secret] = null;
    return { dto, sent };
  }

  /**
   * One save, inside the write's transaction: what was stored, then one change (`WriteRunner.change`) made of the
   * host's `save()` and what is stored afterwards. The participants see both: files resolve the uploads against
   * `before` and attach them to `after` (replaced objects are deleted after the commit).
   */
  private async apply(page: RegisteredPage, dto: Record<string, unknown>, sent: string[], tx: AdminContext): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }> {
    const before = await loadPage(page, tx);
    const secrets = [...sent, ...page.secrets.map((secret) => before[secret]).filter((value): value is string => typeof value === 'string')];
    try {
      const after = await this.host.writes.change({ kind: 'page', target: page, existing: before, dto }, tx, async () => {
        await page.source.save(dto, tx);
        return loadPage(page, tx);
      });
      return { before, after };
    } catch (error) {
      throw scrubSecrets(error, secrets);
    }
  }
}

const isPlain = (value: unknown): boolean => Array.isArray(value) || (typeof value === 'object' && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null));

const isSet = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/** A stored value as it is served: `null` when missing, and inside a group only the keys the form has. */
export function pick(field: FieldSchema, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  if (field.type !== 'object' || !field.fields || field.file) return value;
  const group = (item: unknown): unknown =>
    typeof item === 'object' && item !== null && !Array.isArray(item) ? Object.fromEntries(field.fields!.map((child) => [child.name, pick(child, (item as Record<string, unknown>)[child.name])])) : null;
  return field.many ? (Array.isArray(value) ? value.map(group) : null) : group(value);
}

/**
 * A validation message on a secret field that contains what was sent for it (a DTO message using `$value`) is
 * replaced whole. class-validator's own messages name the rule, not the value.
 */
function withoutEchoes(error: AdminValidationError, secrets: string[], input: Record<string, unknown>): AdminValidationError {
  const fields = { ...error.fields };
  for (const secret of secrets) {
    const value = input[secret];
    if (typeof value !== 'string' || !fields[secret]) continue;
    fields[secret] = fields[secret].map((message) => (message.includes(value) ? 'is not valid' : message));
  }
  return new AdminValidationError(fields, error.message);
}

/** Properties of an error that hold more of the same: a driver's error, the cause, an HttpException's body, field messages, query parameters. */
const NESTED = ['driverError', 'cause', 'response', 'fields', 'parameters', 'errors', 'originalError'];
const MAX_DEPTH = 4;

/**
 * An error on its way out of a save, with every secret value (sent, or stored before) replaced by `***`: a host that
 * answers "the provider refused sk_live_…", or a database that quotes the duplicate value, must not leak the key into
 * the response or the log.
 *
 * An error naming no secret is returned as it is. One that does is copied with its class and its own properties (so
 * `errorMapper`, `instanceof` checks and the database-error mapping still recognise it), and the copy's `message`,
 * `stack` and string properties are cleaned, as are those of its `driverError`, `cause`, `response`, `fields`… (a few
 * levels deep). Besides the value itself, its JSON-escaped and URL-encoded forms are replaced. Best effort: values
 * shorter than 6 characters, and values transformed in any other way, are not found.
 */
export function scrubSecrets(error: unknown, secrets: string[]): unknown {
  const values = [...new Set(secrets.filter((secret) => secret.length >= MIN_SCRUBBED).flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]))].sort(
    (a, b) => b.length - a.length,
  );
  if (values.length === 0) return error;
  let found = false;
  const clean = (text: string): string => {
    const out = values.reduce((result, value) => result.split(value).join('***'), text);
    if (out !== text) found = true;
    return out;
  };
  // `whole`: a plain container (`fields`, a response body, parameters) is cleaned through; of an error, only what is named.
  const scrub = (value: unknown, depth: number, whole = false): unknown => {
    if (typeof value === 'string') return clean(value);
    if (typeof value !== 'object' || value === null || depth > MAX_DEPTH || ArrayBuffer.isView(value)) return value;
    if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1, whole));
    const copy = Object.assign(Object.create(Object.getPrototypeOf(value) as object | null) as Record<string, unknown>, value);
    for (const [key, item] of Object.entries(copy)) {
      if (typeof item === 'string') copy[key] = clean(item);
      else if (whole || NESTED.includes(key)) copy[key] = scrub(item, depth + 1, isPlain(item));
    }
    if (value instanceof Error) {
      // Own but not enumerable, so the copy above left them behind.
      const hidden = (key: 'message' | 'stack' | 'cause') => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && 'value' in descriptor && !descriptor.enumerable) Object.defineProperty(copy, key, { ...descriptor, value: scrub(descriptor.value, depth + 1) });
      };
      hidden('message');
      hidden('stack');
      hidden('cause');
    }
    return copy;
  };
  const scrubbed = scrub(error, 0);
  return found ? scrubbed : error;
}
