import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { AuditChange } from './diff.js';

/** What an entry says besides its changes. Never a password, a one-time code, a secret or a sensitive value. */
export interface AuditMeta {
  /** `{r}.action.{name}` entries: the action's name. */
  action?: string;
  /** The action's validated input, without its sensitive keys. */
  input?: Record<string, unknown>;
  /** The input was too large to keep. */
  inputTruncated?: true;
  /**
   * The record was gone for good once this change was made (no row left, trash included): a delete where there is
   * no trash or by a host `delete()` that does not use it, a purge, or an action that deleted the record it ran on.
   * Read back from the database after the write, but for a purge, which always is one. A delete's entry may get it
   * right after commit (a host service that deleted on another connection). It ends the record: entries up to this
   * one are that record's, and a record with the same key afterwards is another one.
   */
  deleted?: true;
  /** `page.{name}.updated` entries: the page's name. */
  page?: string;
  /** `auth.*` entries: where the request came from. */
  ip?: string;
  userAgent?: string;
  /**
   * `auth.login_failed`: the username that was tried, cut to 200 characters. It is whatever was typed in the
   * username box, so a password typed there by mistake is stored. `reason` is the error code it was answered
   * with (`UNAUTHENTICATED`, `RATE_LIMITED`), `WRONG_CODE` for a wrong second-factor code, or `SUPPRESSED` (below).
   */
  username?: string;
  reason?: string;
  /**
   * Failed sign-ins are capped in memory, per process, by three caps a minute (`audit/login-failures.ts`):
   *
   * - per address and username: the first 5 are recorded (then one more, marked `limited`);
   * - per address across usernames: the first 50 (then one more, marked `limited`). An IPv6 address counts as
   *   its /64, an IPv4-mapped one (`::ffff:a.b.c.d`) as the IPv4 address;
   * - for the whole process, whatever the addresses: 300 recorded failures.
   *
   * Of a lockout's answers (429) only the first is recorded. Successful sign-ins are never capped.
   * `limited`: this is the last failure recorded for its address (and username) in this minute.
   */
  limited?: true;
  /**
   * On an `auth.login_failed` entry with `reason: 'SUPPRESSED'`, written when a minute closes: how many failures
   * were not recorded. With `ip` (and `username`), those of that address (an IPv6 one as its /64,
   * `2001:db8:1:2::/64`) and username: at most 100 such entries a minute. Without either, at most one a minute:
   * what the process-wide cap left out, plus the counts of the addresses beyond those 100. So failed sign-ins
   * write at most 401 rows a minute per process (300 failures, 100 named summaries, 1 unnamed one:
   * `MAX_ROWS_PER_MINUTE`).
   */
  suppressed?: number;
  /** `auth.sessions_revoked`: which of the user's sessions ended (every other one, or one of them). */
  sessions?: 'others' | 'one';
}

/**
 * One entry of the audit log (spec §10.2): who did what to which record, and when. Written by `AdminAudit`, in the
 * transaction of the change it describes when both live on the same DataSource.
 *
 * `id` grows with every entry and is what the log is paged by. It is the database's own auto-increment integer
 * (64-bit on SQLite, 32-bit on Postgres and MySQL: TypeORM cannot declare one generated bigint column that SQLite
 * accepts too). Treat it as an opaque number or numeric string: the API serves it as a string, like a bigint, so
 * widening the column later changes nothing for clients.
 */
@Entity('nma_audit')
@Index(['resource', 'recordId', 'id'])
@Index(['actorId', 'id'])
@Index(['at'])
export class NmaAuditEntry {
  @PrimaryGeneratedColumn() id: number;
  /** Set by the admin (not the database's clock) when the entry is recorded. */
  @CreateDateColumn() at: Date;
  /** The user's id; null when nobody is signed in (a failed sign-in). */
  @Column({ type: 'varchar', length: 100, nullable: true }) actorId: string | null;
  /** The user's display name at the time. */
  @Column({ type: 'varchar', length: 200, nullable: true }) actorName: string | null;
  /** The superuser's id when the entry was made while viewing the admin as `actorId`. */
  @Column({ type: 'varchar', length: 100, nullable: true }) viewAsBy: string | null;
  /** `product.updated`, `order.action.ship`, `page.shop.updated`, `rbac.role.changed`, `auth.login`… */
  @Column({ type: 'varchar', length: 200 }) event: string;
  /** The resource's name for record entries; null otherwise. */
  @Column({ type: 'varchar', length: 100, nullable: true }) resource: string | null;
  /** The record's `_id` (a role's name, a group's or a user's id for `rbac.*`; the user looked at for `auth.view_as`). */
  @Column({ type: 'varchar', length: 255, nullable: true }) recordId: string | null;
  /** The record's real title at the time, whoever the actor was: readers who may not see titles must not be shown it. */
  @Column({ type: 'varchar', length: 255, nullable: true }) recordTitle: string | null;
  /** Null when the entry describes no record change (a resource action, a sign-in); `[]` when a record change changed no field (a restore). */
  @Column({ type: 'simple-json', nullable: true }) changes: AuditChange[] | null;
  @Column({ type: 'simple-json', nullable: true }) meta: AuditMeta | null;
  /** The request's correlation id, as in its error responses and log lines. */
  @Column({ type: 'varchar', length: 64 }) correlationId: string;
}

/** Add these to the TypeORM entities of the DataSource named in `forRoot({ audit })`. */
export const ADMIN_AUDIT_ENTITIES = [NmaAuditEntry];
