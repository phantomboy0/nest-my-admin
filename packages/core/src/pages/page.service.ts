import { HttpException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { FieldSchema, MetaPageSummary, PageResponse, PageSchema } from '../contract.js';
import { validateWrite } from '../crud/validate-write.js';
import { AdminError, AdminForbiddenError, AdminValidationError } from '../errors.js';
import type { FileOwner } from '../files/file-owner.js';
import type { FileChanges, FilesService } from '../files/files.service.js';
import { codeForStatus, httpExceptionMessage } from '../http/error-response.js';
import { resolveText } from '../i18n/localized-text.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { AdminPolicy } from '../policy/admin-policy.service.js';
import type { AdminContext } from '../resource/admin-context.js';
import { localizeDtoForm } from '../schema/dto-form.js';
import { localizeLayout } from '../schema/field-config.js';
import { loadPage, type PageRegistry, type RegisteredPage } from './page-registry.js';

/** What the page service borrows from `AdminApiService`: the write transaction and the file lifecycle of a write. */
export interface PageHost {
  pages: PageRegistry;
  policy: AdminPolicy;
  options: ResolvedAdminOptions;
  files: FilesService;
  write<T>(target: { dataSource: DataSource }, ctx: AdminContext, work: (tx: AdminContext) => Promise<T>): Promise<T>;
  saveFiles(owner: FileOwner, changes: FileChanges | undefined, saved: object, tx: AdminContext): Promise<void>;
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
    return resolveText(page.label, locale ?? this.host.options.locale, this.host.options.locale);
  }

  /** The pages `ctx`'s user may view (all of them without a request), labelled in `locale`. */
  summaries(locale: string, ctx?: AdminContext): Array<MetaPageSummary & { group: string }> {
    return this.host.pages
      .list()
      .filter((page) => !ctx || this.host.policy.canPage(page, 'view', ctx))
      .map((page) => ({ name: page.name, label: this.text(page, locale), ...(page.icon ? { icon: page.icon } : {}), group: page.group }));
  }

  /** The page's form as this request gets it. `readonly`: the user may not save (or is viewing as someone else). */
  private schema(page: RegisteredPage, ctx: AdminContext): PageSchema {
    const { options, files, policy } = this.host;
    const locale = ctx.locale ?? options.locale;
    const form = localizeDtoForm(page.form, locale, options.locale, { maxBytes: options.files?.maxBytes, enabled: files.enabled });
    return {
      name: page.name,
      label: this.text(page, locale),
      ...(page.icon ? { icon: page.icon } : {}),
      fields: form.fields,
      ...(page.layout ? { layout: localizeLayout(page.layout, locale, options.locale) } : {}),
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
    return this.respond(page, await loadPage(page, ctx), ctx);
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
    return this.host.write(page, ctx, async (tx) => {
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
   * One save, inside the write's transaction: what was stored, the files of the change resolved against it, the
   * host's `save()`, what is stored now, and the files attached to it (replaced objects are deleted after the
   * commit). Everything that changes a page goes through here, so the audit log (M4-3) can wrap it with
   * `before` and `after`.
   */
  private async apply(page: RegisteredPage, dto: Record<string, unknown>, sent: string[], tx: AdminContext): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }> {
    const before = await loadPage(page, tx);
    const secrets = [...sent, ...page.secrets.map((secret) => before[secret]).filter((value): value is string => typeof value === 'string')];
    try {
      const owner = this.host.files.ownerOf(page);
      const files = await this.host.files.resolve(owner, dto, before, tx);
      await page.source.save(dto, tx);
      const after = await loadPage(page, tx);
      await this.host.saveFiles(owner, files, after, tx);
      return { before, after };
    } catch (error) {
      throw scrubSecrets(error, secrets);
    }
  }
}

const isSet = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/** A stored value as it is served: `null` when missing, and inside a group only the keys the form has. */
function pick(field: FieldSchema, value: unknown): unknown {
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

/**
 * An error on its way out of a save, with every secret value (sent, or stored before) replaced by `***` in its
 * message, field messages and stack: a host that answers "the provider refused sk_live_…" must not leak the key into
 * the response or the log. An error naming no secret is returned as it is; one that does is rebuilt (an `AdminError`
 * or a 4xx `HttpException` keeps its status and code, anything else becomes a plain `Error` with the same name).
 * Values shorter than 6 characters are left alone.
 */
export function scrubSecrets(error: unknown, secrets: string[]): unknown {
  const values = [...new Set(secrets.filter((secret) => secret.length >= MIN_SCRUBBED))].sort((a, b) => b.length - a.length);
  if (values.length === 0) return error;
  const names = (text: string | undefined): boolean => text !== undefined && values.some((value) => text.includes(value));
  const clean = (text: string): string => values.reduce((out, value) => out.split(value).join('***'), text);
  if (error instanceof AdminError) {
    const messages = Object.entries(error.fields ?? {});
    if (!names(error.message) && !messages.some(([field, list]) => names(field) || list.some(names))) return error;
    return new AdminError(error.code, error.status, clean(error.message), error.fields ? Object.fromEntries(messages.map(([field, list]) => [clean(field), list.map(clean)])) : undefined);
  }
  if (error instanceof HttpException && error.getStatus() < 500) {
    const message = httpExceptionMessage(error);
    return names(message) ? new AdminError(codeForStatus(error.getStatus()), error.getStatus(), clean(message)) : error;
  }
  if (error instanceof Error) {
    if (!names(error.message) && !names(error.stack)) return error;
    const scrubbed = new Error(clean(error.message));
    scrubbed.name = error.name;
    scrubbed.stack = error.stack === undefined ? undefined : clean(error.stack);
    return scrubbed;
  }
  return typeof error === 'string' ? clean(error) : error;
}
