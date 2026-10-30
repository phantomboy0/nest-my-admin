import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { IncomingMessage } from 'node:http';
import type { DataSource, EntityManager } from 'typeorm';
import { SINGLE_CONNECTION_DRIVERS, exclusive } from '../api/write-queue.js';
import type { AdminUser } from '../auth/auth-adapter.js';
import { ADMIN_OPTIONS } from '../constants.js';
import type { ResolvedAdminOptions } from '../options.js';
import type { RegisteredResource } from '../registry/resource-registry.js';
import { AdminContext, inAdminTransaction } from '../resource/admin-context.js';
import { fitChanges, type AuditChange } from './diff.js';
import { NmaAuditEntry, type AuditMeta } from './entities.js';
import { LoginFailures, WINDOW_MS } from './login-failures.js';
import { deleteEntriesBefore } from './retention.js';

/** What to record. */
export interface AuditInput {
  /** `product.updated`, `order.action.ship`, `page.shop.updated`, `rbac.role.changed`, `auth.login`… */
  event: string;
  /** The resource of a record entry. */
  entry?: Pick<RegisteredResource, 'schema'>;
  /** The record's `_id`. */
  recordId?: string;
  /** The record's real title (never one masked for the actor). */
  title?: string;
  /** Already diffed and masked (`diffRecords`): the audit log is never handed a raw payload. */
  changes?: AuditChange[];
  meta?: AuditMeta;
}

/** Who and in which request: an `AdminContext` is one. With `manager`, the transaction the entry may join. */
export interface AuditContext {
  correlationId: string;
  user?: Pick<AdminUser, 'id' | 'displayName'>;
  viewAs?: { by: Pick<AdminUser, 'id'> };
  manager?: EntityManager;
}

type AuditRow = Omit<NmaAuditEntry, 'id'>;

/** Entries waiting to be written by `recordDetached`; more than this and new ones are dropped (and logged). */
const MAX_WAITING = 1_000;
/** A recorded action input larger than this (bytes of JSON) is left out. */
const INPUT_LIMIT = 8_000;

/** How long a shutdown waits for the detached entries still in the queue. */
const SHUTDOWN_WAIT_MS = 2_000;

const DAY_MS = 86_400_000;
/** The first retention sweep after boot: soon, and not while the app is still starting. */
const FIRST_SWEEP_MS = 60_000;

const cut = (text: unknown, length: number): string => String(text ?? '').slice(0, length);
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Where a request came from, for `auth.*` entries. */
export function clientOf(req: IncomingMessage): Pick<AuditMeta, 'ip' | 'userAgent'> {
  const ip = (req as IncomingMessage & { ip?: string }).ip ?? req.socket?.remoteAddress;
  const userAgent = req.headers['user-agent'];
  return { ...(ip ? { ip } : {}), ...(typeof userAgent === 'string' && userAgent !== '' ? { userAgent } : {}) };
}

/**
 * The audit log's writer (spec §10.2). Without `forRoot({ audit })` every method does nothing.
 *
 * - `record` writes an entry now: in `ctx.manager`'s transaction when that is on the audit log's DataSource (a
 *   rollback then discards the entry with the change), else on the audit log's own connection. It throws when the
 *   entry cannot be written, so a change that shares its transaction fails with it.
 * - `recordAfter` is for when the change is already final (committed on another DataSource, or made without a
 *   transaction) and for sign-ins: own connection, and a failure is logged with the correlation id, never thrown.
 * - `recordDetached` does not make the caller wait at all (failed sign-ins).
 */
@Injectable()
export class AdminAudit implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('NestMyAdmin');
  private dataSource?: DataSource;
  /** The detached entries, written one at a time so a burst never takes more than one connection. */
  private tail: Promise<void> = Promise.resolve();
  private waiting = 0;
  private dropWarnedAt = 0;
  private readonly loginFailures = new LoginFailures();
  private loginTimer?: ReturnType<typeof setTimeout>;
  private retentionTimers: Array<ReturnType<typeof setTimeout>> = [];
  private sweeping?: Promise<number>;

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(ADMIN_OPTIONS) private readonly options: ResolvedAdminOptions,
  ) {}

  /** Whether `audit` is configured. */
  get enabled(): boolean {
    return this.options.audit !== undefined;
  }

  /** The DataSource holding the `nma_audit` table. */
  get db(): DataSource {
    if (!this.dataSource) throw new Error('nest-my-admin: the audit log is not enabled in this admin (no `audit` option)');
    return this.dataSource;
  }

  onApplicationBootstrap(): void {
    if (!this.options.audit) return;
    const name = this.options.audit.dataSource;
    try {
      this.dataSource = this.moduleRef.get<DataSource>(getDataSourceToken(name) as string, { strict: false });
    } catch {
      throw new Error(`nest-my-admin: audit: no TypeORM DataSource "${name ?? 'default'}"`);
    }
    if (!this.dataSource.hasMetadata(NmaAuditEntry)) {
      throw new Error(`nest-my-admin: audit: add ADMIN_AUDIT_ENTITIES to the entities of the DataSource "${name ?? 'default'}" (NmaAuditEntry is missing)`);
    }
    if (this.options.audit.retentionDays !== undefined) {
      // Shortly after boot, then once a day. Neither timer keeps the process alive.
      const first = setTimeout(() => void this.sweepQuietly(), FIRST_SWEEP_MS);
      const daily = setInterval(() => void this.sweepQuietly(), DAY_MS);
      first.unref();
      daily.unref();
      this.retentionTimers = [first, daily];
    }
  }

  /** Whether the retention timers are running (`audit.retentionDays`, until the module is destroyed). */
  get retentionArmed(): boolean {
    return this.retentionTimers.length > 0;
  }

  /**
   * Deletes the entries older than `audit.retentionDays`, in batches of 1,000, and answers how many; 0 without
   * `retentionDays`. The daily timer runs it (through `sweepQuietly`); a sweep already running is joined, not doubled.
   */
  sweep(now = Date.now()): Promise<number> {
    const days = this.options.audit?.retentionDays;
    if (days === undefined) return Promise.resolve(0);
    this.sweeping ??= deleteEntriesBefore(this.db, new Date(now - days * DAY_MS)).finally(() => {
      this.sweeping = undefined;
    });
    return this.sweeping;
  }

  /** What the timers call: a sweep that fails is logged, and the next one runs as planned. */
  async sweepQuietly(): Promise<void> {
    try {
      const deleted = await this.sweep();
      if (deleted > 0) this.logger.log(`audit: deleted ${deleted} entries older than ${this.options.audit?.retentionDays} days`);
    } catch (error) {
      this.logger.warn(`audit: the retention sweep failed (${message(error)}); it runs again in a day`);
    }
  }

  /** Whether an entry recorded with `ctx` is written in its transaction (the transaction is on the audit log's DataSource). */
  joins(ctx: AuditContext): boolean {
    return this.enabled && inAdminTransaction(ctx) && ctx.manager !== undefined && ctx.manager.connection === this.db;
  }

  /**
   * Writes an entry now, inside `ctx.manager`'s transaction when it `joins`, and answers its id. Throws when it
   * cannot be written.
   */
  async record(input: AuditInput, ctx: AuditContext): Promise<number | undefined> {
    if (!this.enabled) return undefined;
    return this.insert(this.row(input, ctx), this.joins(ctx) ? ctx.manager : undefined);
  }

  /**
   * After a delete has committed: whether `read` (the record's row, read outside the write's transaction) finds
   * nothing. A read that fails is logged with the correlation id and answers false: the entry then stays unstamped.
   */
  async leftNoRow(event: string, ctx: AuditContext, read: () => Promise<object | undefined>): Promise<boolean> {
    try {
      return (await read()) === undefined;
    } catch (error) {
      this.logger.warn(`[${ctx.correlationId}] audit: could not check whether "${event}" left a row (${message(error)}); its entry is not stamped`);
      return false;
    }
  }

  /**
   * Stamps an entry that is already in the table as the end of its record: `deleted: true` is added to whatever
   * `meta` it has (an action's entry carries its name and input), on the audit log's own connection. A failure is
   * logged, never thrown.
   */
  async stampDeleted(id: number, event: string, ctx: AuditContext): Promise<void> {
    try {
      const repo = this.db.getRepository(NmaAuditEntry);
      const entry = await repo.findOne({ where: { id } as never, select: { id: true, meta: true } as never });
      if (!entry) throw new Error('the entry is not there');
      await repo.update(id, { meta: { ...(entry.meta ?? {}), deleted: true } } as never);
    } catch (error) {
      this.logger.warn(`[${ctx.correlationId}] audit: could not stamp "${event}" (entry ${id}) as the end of its record (${message(error)})`);
    }
  }

  /**
   * A delete whose row was to be read again after commit, and whose entry cannot be found for the stamp: the
   * insert answered no id (a driver that reports none). Said once per write, so the missing stamp can be traced.
   */
  unstamped(event: string, ctx: AuditContext): void {
    this.logger.warn(`[${ctx.correlationId}] audit: the entry of "${event}" has no id to find it by; it is not checked again after commit and stays unstamped`);
  }

  /** Writes an entry for something already final, on the audit log's own connection. A failure is logged, never thrown. */
  async recordAfter(input: AuditInput, ctx: AuditContext): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.insert(this.row(input, ctx));
    } catch (error) {
      this.failed(input.event, ctx.correlationId, error);
    }
  }

  /**
   * Queues an entry and returns at once: the caller's response never waits for the audit table. Entries are written
   * one after the other on the audit log's own connection; a failure is logged. With 1,000 already waiting, new ones
   * are dropped (and that is logged, at most once a minute).
   */
  recordDetached(input: AuditInput, ctx: AuditContext): void {
    if (!this.enabled) return;
    if (this.waiting >= MAX_WAITING) {
      if (Date.now() - this.dropWarnedAt > 60_000) {
        this.dropWarnedAt = Date.now();
        this.logger.warn(`audit: ${MAX_WAITING} entries are waiting to be written; "${cut(input.event, 200)}" entries are being dropped`);
      }
      return;
    }
    const row = this.row(input, ctx);
    this.waiting += 1;
    this.tail = this.tail
      .then(async () => {
        await this.insert(row);
      })
      .catch((error: unknown) => this.failed(row.event, row.correlationId, error))
      .finally(() => {
        this.waiting -= 1;
      });
  }

  /**
   * A failed sign-in, never awaited. Capped per address and username, per address, and for the whole process (see
   * `LoginFailures`), so neither a password-guessing run nor a client with many addresses can fill the table:
   * beyond the caps failures are counted, and `SUPPRESSED` entries say how many were left out when the minute
   * closes.
   */
  recordLoginFailure(attempt: { username: string; reason: string; lockout: boolean }, req: IncomingMessage, ctx: AuditContext, now = Date.now()): void {
    if (!this.enabled) return;
    this.flushLoginFailures(now, ctx.correlationId);
    const client = clientOf(req);
    const verdict = this.loginFailures.note(client.ip, attempt.username, attempt.lockout, now);
    if (verdict.record) {
      const meta: AuditMeta = { username: attempt.username, ...client, reason: attempt.reason, ...(verdict.limited ? { limited: true as const } : {}) };
      this.recordDetached({ event: 'auth.login_failed', meta }, { correlationId: ctx.correlationId });
    }
    this.armLoginTimer();
  }

  /** Writes the `SUPPRESSED` entries of the minutes that have closed by `now` (the timer does; tests call it). */
  flushLoginFailures(now = Date.now(), correlationId = 'audit'): void {
    for (const left of this.loginFailures.closed(now)) {
      this.recordDetached({ event: 'auth.login_failed', meta: { ...(left.username !== undefined ? { username: left.username } : {}), ...(left.ip ? { ip: left.ip } : {}), reason: 'SUPPRESSED', suppressed: left.suppressed } }, { correlationId });
    }
    this.armLoginTimer();
  }

  /** A minute that left failures out is summed up even when no further sign-in fails. Never keeps the process alive. */
  private armLoginTimer(): void {
    if (this.loginTimer || !this.loginFailures.active) return;
    this.loginTimer = setTimeout(() => {
      this.loginTimer = undefined;
      this.flushLoginFailures();
    }, WINDOW_MS + 1_000);
    this.loginTimer.unref();
  }

  /**
   * Stops the timers and lets the detached entries that are still waiting (failed sign-ins) reach the table, for
   * `wait` milliseconds at most: a shutdown never hangs on an audit table that does not answer. The DataSource is
   * still open here (TypeORM closes it on application shutdown, after every module was destroyed).
   */
  async onModuleDestroy(wait = SHUTDOWN_WAIT_MS): Promise<void> {
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = undefined;
    // clearTimeout stops an interval too.
    for (const timer of this.retentionTimers) clearTimeout(timer);
    this.retentionTimers = [];
    if (this.waiting === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), wait);
      timer.unref();
    });
    const late = await Promise.race([this.idle().then(() => false), timedOut]);
    clearTimeout(timer);
    if (late) this.logger.warn(`audit: ${this.waiting} entries were still waiting to be written after ${wait} ms of shutdown; they may be lost`);
  }

  /** Resolves once every detached entry queued so far has been written (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.waiting > 0) await this.tail;
  }

  private failed(event: string, correlationId: string, error: unknown): void {
    this.logger.warn(`[${correlationId}] audit: could not record "${event}" (${message(error)})`);
  }

  /** The one place a row reaches the table. Outside a transaction it waits its turn on single-connection drivers. */
  private async insert(row: AuditRow, manager?: EntityManager): Promise<number | undefined> {
    // TypeORM's deep-partial type does not take a json column holding `unknown` values.
    const values = row as never;
    // On a single-connection driver, an entry written from inside an admin write on the audit log's own DataSource
    // (host code of that write changed something on another DataSource) cannot wait for the queue that write
    // holds: it goes through the write's manager.
    const holder = SINGLE_CONNECTION_DRIVERS.has(this.db.options.type) ? AdminContext.current()?.manager : undefined;
    const inside = manager ?? (holder?.connection === this.db ? holder : undefined);
    const result = inside ? await inside.getRepository(NmaAuditEntry).insert(values) : await exclusive(this.db, () => this.db.getRepository(NmaAuditEntry).insert(values));
    const id = Number((result.identifiers[0] as { id?: unknown } | undefined)?.id);
    return Number.isSafeInteger(id) && id > 0 ? id : undefined;
  }

  /** The entry as stored: every text cut to its column, the changes and the input cut to what a row holds. */
  private row(input: AuditInput, ctx: AuditContext): AuditRow {
    return {
      at: new Date(),
      actorId: ctx.user ? cut(ctx.user.id, 100) : null,
      actorName: ctx.user ? cut(ctx.user.displayName, 200) : null,
      viewAsBy: ctx.viewAs ? cut(ctx.viewAs.by.id, 100) : null,
      event: cut(input.event, 200),
      resource: input.entry ? cut(input.entry.schema.name, 100) : null,
      recordId: input.recordId === undefined ? null : cut(input.recordId, 255),
      recordTitle: input.title === undefined ? null : cut(input.title, 255),
      changes: input.changes ? fitChanges(input.changes) : null,
      meta: fitMeta(input.meta),
      correlationId: cut(ctx.correlationId, 64),
    };
  }
}

/** The meta as stored: texts cut (a failed sign-in must not be a way to write megabytes), a large input left out. */
function fitMeta(meta: AuditMeta | undefined): AuditMeta | null {
  if (!meta) return null;
  const out: AuditMeta = { ...meta };
  if (out.action !== undefined) out.action = cut(out.action, 100);
  if (out.page !== undefined) out.page = cut(out.page, 100);
  if (out.username !== undefined) out.username = cut(out.username, 200);
  if (out.ip !== undefined) out.ip = cut(out.ip, 64);
  if (out.userAgent !== undefined) out.userAgent = cut(out.userAgent, 300);
  if (out.reason !== undefined) out.reason = cut(out.reason, 50);
  if (out.input !== undefined && Buffer.byteLength(JSON.stringify(out.input) ?? '') > INPUT_LIMIT) {
    delete out.input;
    out.inputTruncated = true;
  }
  return Object.keys(out).length > 0 ? out : null;
}
