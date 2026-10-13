import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { BadRequestException, Injectable, Logger, Module, UnauthorizedException, type Type as NestType } from '@nestjs/common';
import { InjectDataSource, getDataSourceToken } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Column, DeleteDateColumn, Entity, JoinTable, ManyToMany, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn, type DataSource } from 'typeorm';
import {
  ADMIN_AUDIT_ENTITIES,
  ADMIN_FILE_ENTITIES,
  ADMIN_RBAC_ENTITIES,
  AdminAction,
  AdminAuth,
  AdminField,
  AdminRateLimitError,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  AdminSettingsPage,
  AdminTwoFactorRequiredError,
  AdminUnauthenticatedError,
  NmaAuditEntry,
  NmaFile,
  localStorage,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminModuleOptions,
  type AdminPrincipal,
  type AdminSettingsSource,
  type AdminUserRecord,
  type AuthIO,
  type LoginInput,
  type RecordId,
  type RoleDefinition,
} from '../src/index.js';
import { AdminAudit } from '../src/audit/audit.service.js';
import type { AuditChange } from '../src/audit/diff.js';
import { AdminRbac } from '../src/rbac/rbac.service.js';
import { addressBucket } from '../src/audit/login-failures.js';
import { createTestApp } from './helpers/create-app.js';

/** Values that must never be stored: the whole audit table is searched for them. */
const PIN = 'PIN-SENTINEL-4471';
const API_KEY = 'sk_live_SENTINEL_9f3a71c2';
const APPROVAL = 'APPROVAL-SENTINEL-77';
const PASSWORD = 'ada-pass';
const WRONG_PASSWORD = 'WRONG-SENTINEL-PASS';
const OTP = '918273';
const NEW_PASSWORD = 'new-user-SENTINEL-pw';
const RESET_PASSWORD = 'reset-SENTINEL-pw';
const OWN_PASSWORD = 'own-SENTINEL-pw';
const CARD_NUMBER = 'CARD-SENTINEL-5599';
const SENTINELS = [PIN, API_KEY, APPROVAL, PASSWORD, WRONG_PASSWORD, OTP, NEW_PASSWORD, RESET_PASSWORD, OWN_PASSWORD, CARD_NUMBER, 'smtp-SENTINEL', 'door-SENTINEL', 'manager-SENTINEL', 'RECOVERY-SENTINEL', 'TOTP-SENTINEL'];

// A PDF by its first bytes.
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 0x20)]);

@Entity('au_customer')
class Customer {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

@Entity('au_tag')
class Tag {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

@Entity('au_product')
class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 }) price: string;
  @Column({ type: 'int', default: 0 }) stock: number;
  /** price × stock: the host computes it in `update()`, no request sends it. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 }) total: string;
  /** Computed too, and hidden from clerks. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 }) margin: string;
  @Column({ type: 'varchar', length: 40, nullable: true }) pin: string | null;
  @Column({ length: 10, default: 'u1' }) ownerId: string;
  @ManyToOne(() => Customer, { nullable: true }) customer: Customer | null;
  @ManyToMany(() => Tag) @JoinTable({ name: 'au_product_tag' }) tags: Tag[];
  @UpdateDateColumn() updatedAt: Date;
  @VersionColumn() version: number;
}

/** Its title is a sensitive field. */
@Entity('au_badge')
class Badge {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) code: string;
  @Column({ length: 40, default: '' }) holder: string;
}

/** Its title is a function, and one of its fields is sensitive: the function may put that field in the title. */
@Entity('au_card')
class Card {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) holder: string;
  @Column({ length: 40 }) number: string;
}

/** Its host service writes through its own repository: outside the admin's transaction. */
@Entity('au_memo')
class Memo {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) text: string;
  @Column({ type: 'int', default: 0 }) edits: number;
}

@Entity('au_crate')
class Crate {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
}

@Entity('au_sheet')
class Sheet {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) name: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) manual: string | null;
}

/** A composite key. */
@Entity('au_slot')
class Slot {
  @PrimaryColumn({ length: 10 }) depot: string;
  @PrimaryColumn({ type: 'int' }) no: number;
  @Column({ length: 40 }) name: string;
}

@Entity('au_doc')
class Doc {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) title: string;
  @DeleteDateColumn() deletedAt: Date | null;
}

@Entity('au_setting')
class Setting {
  @PrimaryColumn({ length: 40 }) name: string;
  @Column({ type: 'text' }) value: string;
}

class CardLikeDto {
  @AdminField({ sensitive: true }) @IsString() number: string;
}

class DiscountDto {
  @IsInt() @Min(1) @Max(90) percent: number;
  @IsOptional() @IsString() reason?: string;
  @AdminField({ sensitive: true }) @IsOptional() @IsString() approvalCode?: string;
  @AdminField({ widget: 'password' }) @IsOptional() @IsString() managerPassword?: string;
}

/** What the host methods saw. */
const host: { correlationId?: string } = {};

@AdminResource(Customer, { title: 'name' })
class CustomerAdmin extends AdminResourceBase<Customer> {}

@AdminResource(Tag, { title: 'name' })
class TagAdmin extends AdminResourceBase<Tag> {}

class ProductBase extends AdminResourceBase<Product> {
  fields = { pin: { sensitive: true } };

  /** A host service: saves, then computes columns no DTO carries, and answers the entity as it was before that. */
  override async update(id: RecordId, dto: object, ctx: AdminContext): Promise<Product> {
    host.correlationId = ctx.correlationId;
    const saved = await super.update(id, dto, ctx);
    const repo = this.repositoryFor(ctx);
    const row = await repo.findOneByOrFail({ id: saved.id });
    await repo.update(saved.id, { total: (Number(row.price) * row.stock).toFixed(2), margin: (Number(row.price) * 0.2).toFixed(2) });
    // Both after the rows were written (Review Focus 1).
    if (row.name === 'EXPLODE') throw new BadRequestException('The warehouse refused');
    if (row.name === 'DENIED') throw new UnauthorizedException('The warehouse token expired');
    return saved;
  }
}

@AdminResource(Product, { title: 'name' })
class ProductAdmin extends ProductBase {
  @AdminScope('own') own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }

  @AdminAction({ bulk: true, input: DiscountDto })
  async discount(product: Product, input: DiscountDto, ctx: AdminContext): Promise<void> {
    const price = (Number(product.price) * (1 - input.percent / 100)).toFixed(2);
    // The method changes what it was handed: the audit log must have read "before" already.
    product.price = price;
    input.reason = 'changed by the method';
    await this.repositoryFor(ctx).update(product.id, { price });
    if (input.percent === 66) throw new BadRequestException('Too generous');
  }

  /** Each run raises the stock of every "Atomic" product, so a later record of the same run starts from a changed row. */
  @AdminAction({ bulk: true, atomic: true })
  async raiseAll(_product: Product, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).createQueryBuilder().update().set({ stock: () => 'stock + 1' }).where('name LIKE :prefix', { prefix: 'Atomic %' }).execute();
  }

  @AdminAction()
  async scrap(product: Product, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).delete(product.id);
  }

  /** Afterwards the clerk who ran it cannot see the record. */
  @AdminAction()
  async handOver(product: Product, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update(product.id, { ownerId: 'u2' });
  }

  @AdminAction({ target: 'resource', input: DiscountDto })
  async sale(input: DiscountDto, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).update({ ownerId: 'nobody' }, { stock: input.percent });
  }
}

@AdminResource(Badge, { title: 'code' })
class BadgeAdmin extends AdminResourceBase<Badge> {
  fields = { code: { sensitive: true } };
}

@AdminResource(Card, { title: (card: Card) => `${card.holder} ${card.number}` })
class CardAdmin extends AdminResourceBase<Card> {
  fields = { number: { sensitive: true } };
}

@AdminResource(Memo, { title: 'text' })
class MemoAdmin extends AdminResourceBase<Memo> {
  constructor(@InjectDataSource() private readonly own: DataSource) {
    super();
  }

  /** Ignores `ctx.manager`: on Postgres and MySQL this commits on another connection, at once. */
  override async update(id: RecordId, dto: object): Promise<Memo> {
    const repo = this.own.getRepository(Memo);
    const row = await repo.findOneByOrFail({ id: id as number });
    await repo.update(row.id, { ...(dto as Partial<Memo>), edits: row.edits + 1 });
    return repo.findOneByOrFail({ id: row.id });
  }
}

/** The host's finder answers from a cache nothing ever clears: it still answers a record that is gone. */
@AdminResource(Crate, { title: 'name' })
class CrateAdmin extends AdminResourceBase<Crate> {
  private readonly cache = new Map<string, Crate>();

  override async findOne(id: RecordId, ctx: AdminContext, options: { withDeleted?: boolean } = {}): Promise<Crate | null> {
    const hit = this.cache.get(String(id));
    if (hit) return hit;
    const found = await super.findOne(id, ctx, options);
    if (found) this.cache.set(String(id), found);
    return found;
  }

  @AdminAction()
  async scrap(crate: Crate, _input: unknown, ctx: AdminContext): Promise<void> {
    await this.repositoryFor(ctx).delete(crate.id);
  }
}

@AdminResource(Sheet, { title: 'name' })
class SheetAdmin extends AdminResourceBase<Sheet> {
  fields = { manual: { widget: 'file' as const } };

  override async update(id: RecordId, dto: object, ctx: AdminContext): Promise<Sheet> {
    const saved = await super.update(id, dto, ctx);
    if (saved.name === 'EXPLODE') throw new BadRequestException('The printer jammed');
    return saved;
  }
}

@AdminResource(Slot, { title: 'name' })
class SlotAdmin extends AdminResourceBase<Slot> {}

/** The same host service without actions: an `atomic` action does not boot with `transactions: false`. */
@AdminResource(Product, { title: 'name' })
class LooseProductAdmin extends ProductBase {}

@AdminResource(Doc, { title: 'title' })
class DocAdmin extends AdminResourceBase<Doc> {}

class ShopDto {
  @IsString() @Length(2, 40) shopName: string;
  @IsOptional() @IsInt() lowStock?: number;
  @IsOptional() @IsString() @Length(8, 64) apiKey?: string | null;
  @IsOptional() @IsString() doorCode?: string;
  @IsOptional() @IsString() smtpPassword?: string;
}

@AdminSettingsPage('shop', { form: ShopDto, fields: { apiKey: { secret: true }, doorCode: { sensitive: true }, smtpPassword: { widget: 'password' } } })
class ShopPage implements AdminSettingsSource<ShopDto> {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async load(ctx: AdminContext): Promise<Partial<ShopDto>> {
    const rows = await (ctx.manager ?? this.dataSource.manager).find(Setting);
    // A key the form does not have: it is no field, so it is never diffed.
    return { ...Object.fromEntries(rows.map((row) => [row.name, JSON.parse(row.value)])), savedAt: Date.now() + Math.random() } as Partial<ShopDto>;
  }

  async save(changes: Partial<ShopDto>, ctx: AdminContext): Promise<void> {
    const repo = (ctx.manager ?? this.dataSource.manager).getRepository(Setting);
    for (const [name, value] of Object.entries(changes)) await repo.save({ name, value: JSON.stringify(value) });
    if (changes.shopName === 'EXPLODE') throw new BadRequestException('The provider refused');
  }
}

const users = new Map<string, AdminUserRecord>();
for (const [id, isSuperuser] of [['ada', true], ['u1', false], ['u2', false], ['blind', false]] as const) {
  users.set(id, { id, displayName: `${id.toUpperCase()} Person`, username: id, isSuperuser, isActive: true });
}
const ROLES_OF: Record<string, string[]> = { u1: ['clerk'], u2: ['clerk'], blind: ['blind'] };
const ROLES: RoleDefinition[] = [
  // Own rows only, and no `margin` (a wildcard would grant the field's code and undo the rule).
  { name: 'clerk', permissions: ['product.view', 'product.update', 'product.action.handOver', 'customer.view', 'tag.view'], fields: { product: { margin: 'hidden' } }, scopes: { product: { view: 'own', update: 'own' } } },
  // Cannot see the title column: every title it is shown is `#id`.
  { name: 'blind', permissions: ['product.view', 'product.update'], fields: { product: { name: 'hidden' } } },
];

/** `X-User` signs a request in; `POST /api/session` checks `<username>-pass`. */
@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  async login(input: LoginInput, _io: AuthIO): Promise<AdminPrincipal> {
    if (input.username === 'locked') throw new AdminRateLimitError('Too many attempts', 60);
    const user = users.get(input.username);
    if (!user || input.password !== `${input.username}-pass`) throw new AdminUnauthenticatedError('Wrong username or password');
    if (input.username === 'u2' && input.otp === undefined) throw new AdminTwoFactorRequiredError();
    // Like the built-in adapter: a wrong code is answered as "second factor required", with another message.
    if (input.username === 'u2' && input.otp !== '000000') throw new AdminTwoFactorRequiredError('That code is not right');
    return { user };
  }
  async logout(): Promise<void> {}
  async listSessions() {
    return [];
  }
  async revokeSession(): Promise<void> {}
  async revokeOtherSessions(): Promise<void> {}
  async changePassword(_principal: AdminPrincipal, input: { current: string; next: string }): Promise<void> {
    if (input.current !== PASSWORD) throw new AdminUnauthenticatedError('Wrong password');
  }
  async twoFactorStatus() {
    return { enabled: false, recoveryCodesLeft: 0 };
  }
  async beginTwoFactor() {
    return { secret: 'TOTP-SENTINEL-KEY', otpauthUrl: 'otpauth://totp/x?secret=TOTP-SENTINEL-KEY' };
  }
  async confirmTwoFactor(_principal: AdminPrincipal, code: string) {
    if (code !== '000000') throw new AdminUnauthenticatedError('Wrong code');
    return { recoveryCodes: ['RECOVERY-SENTINEL-1'] };
  }
  async disableTwoFactor(): Promise<void> {}
  async newRecoveryCodes() {
    return { recoveryCodes: ['RECOVERY-SENTINEL-2'] };
  }
  async resetTwoFactor(): Promise<void> {}
  async createUser(input: { username: string; displayName: string; email?: string | null; isSuperuser?: boolean }): Promise<AdminUserRecord> {
    const user: AdminUserRecord = { id: input.username, username: input.username, displayName: input.displayName, ...(input.email ? { email: input.email } : {}), isSuperuser: input.isSuperuser === true, isActive: true };
    users.set(input.username, user);
    return user;
  }
  async updateUser(id: string, changes: Partial<AdminUserRecord>): Promise<AdminUserRecord> {
    const user = { ...users.get(id)!, ...changes } as AdminUserRecord;
    users.set(id, user);
    return user;
  }
  async setPassword(): Promise<void> {}
  resolveRoles(user: { id: string | number }) {
    return ROLES_OF[String(user.id)] ?? [];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [TestAuth, CustomerAdmin, TagAdmin, ProductAdmin, DocAdmin, BadgeAdmin, CardAdmin, MemoAdmin, CrateAdmin, SheetAdmin, SlotAdmin, ShopPage] })
class AuditModule {}

@Module({ providers: [TestAuth, LooseProductAdmin] })
class LooseModule {}

const ENTITIES = [Customer, Tag, Product, Doc, Badge, Card, Memo, Crate, Sheet, Slot, Setting];

type Entry = NmaAuditEntry & { changes: AuditChange[] | null };

/** One app with the audit log on (or as `admin` says), and what the tests need of it. */
async function boot(
  admin: Partial<AdminModuleOptions> = { audit: {} },
  more: { entities?: Function[]; dataSources?: Record<string, Function[]>; module?: Function } = { entities: [...ADMIN_AUDIT_ENTITIES] },
) {
  const app = await createTestApp({
    imports: [(more.module ?? AuditModule) as NestType],
    entities: [...ENTITIES, ...ADMIN_RBAC_ENTITIES, ...(more.entities ?? [])],
    dataSources: more.dataSources,
    admin: { auth: AdminAuth.custom(TestAuth), roles: ROLES, rbac: {}, ...admin },
  });
  const auditDb = app.get<DataSource>(getDataSourceToken(admin.audit?.dataSource) as string, { strict: false });
  const http = (user = 'ada', headers: Record<string, string> = {}) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user).set(headers),
    post: (path: string, body: object = {}) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', user).set(headers).send(body),
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/admin/api${path}`).set('X-User', user).set(headers).send(body),
    delete: (path: string) => request(app.getHttpServer()).delete(`/admin/api${path}`).set('X-User', user).set(headers),
  });
  let mark = 0;
  /** The entries written since the last call, oldest first. */
  const fresh = async (): Promise<Entry[]> => {
    await app.get(AdminAudit).idle();
    const rows = (await auditDb.getRepository(NmaAuditEntry).find()).map((row) => ({ ...row, id: Number(row.id) })).sort((a, b) => a.id - b.id);
    const added = rows.filter((row) => row.id > mark);
    mark = rows.at(-1)?.id ?? mark;
    return added as unknown as Entry[];
  };
  const product = async (values: Record<string, unknown>): Promise<string> => {
    const res = await http().post('/resources/product', values);
    expect(res.status).toBe(201);
    await fresh();
    return res.body._id as string;
  };
  return { app, auditDb, http, fresh, product };
}

const change = (entry: Entry, field: string) => entry.changes?.find((item) => item.field === field);

describe('audit log: recording', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  let customers: number[];
  let tags: number[];

  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nma-audit-'));
    t = await boot({ audit: {}, files: { storage: localStorage({ dir }) } }, { entities: [...ADMIN_AUDIT_ENTITIES, ...ADMIN_FILE_ENTITIES] });
    const db = t.app.get<DataSource>(getDataSourceToken() as string, { strict: false });
    customers = (await db.getRepository(Customer).save([{ name: 'Acme' }, { name: 'Globex' }])).map((row) => row.id);
    tags = (await db.getRepository(Tag).save([{ name: 'red' }, { name: 'green' }, { name: 'blue' }])).map((row) => row.id);
  });
  afterAll(async () => {
    await t.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('create: who, what, when, and every stored value as `after`', async () => {
    const before = Date.now();
    const res = await t.http().post('/resources/product', { name: 'Lamp', price: '10.50', stock: 2, pin: PIN, customer: customers[0], tags: [tags[0], tags[1]] });
    expect(res.status).toBe(201);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'product.created', resource: 'product', recordId: res.body._id, recordTitle: 'Lamp', actorId: 'ada', actorName: 'ADA Person', viewAsBy: null });
    expect(entry!.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs(new Date(entry!.at).getTime() - before)).toBeLessThan(60_000);
    expect(change(entry!, 'name')).toEqual({ field: 'name', after: 'Lamp' });
    expect(change(entry!, 'price')).toEqual({ field: 'price', after: '10.50' });
    // Relations by id, a many-to-many as its ids.
    expect(change(entry!, 'customer')).toEqual({ field: 'customer', after: customers[0] });
    expect(change(entry!, 'tags')).toEqual({ field: 'tags', after: [tags[0], tags[1]] });
    // A sensitive field: that it was set, never what to.
    expect(change(entry!, 'pin')).toEqual({ field: 'pin', changed: true });
    // Columns TypeORM maintains are not changes.
    expect(change(entry!, 'updatedAt')).toBeUndefined();
    expect(change(entry!, 'version')).toBeUndefined();
  });

  test('update: the fields that changed, before and after, with the request’s correlation id', async () => {
    const id = await t.product({ name: 'Desk', price: '100.00', stock: 1, customer: customers[0], tags: [tags[0]] });
    const res = await t.http().patch(`/resources/product/${id}`, { name: 'Desk XL', customer: customers[1], tags: [tags[2], tags[0]] });
    expect(res.status).toBe(200);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'product.updated', resource: 'product', recordId: id, recordTitle: 'Desk XL', actorId: 'ada' });
    expect(entry!.correlationId).toBe(host.correlationId!);
    expect(change(entry!, 'name')).toEqual({ field: 'name', before: 'Desk', after: 'Desk XL' });
    expect(change(entry!, 'customer')).toEqual({ field: 'customer', before: customers[0], after: customers[1] });
    expect(change(entry!, 'tags')).toEqual({ field: 'tags', before: [tags[0]], after: [tags[0], tags[2]] });
    expect(change(entry!, 'stock')).toBeUndefined();
    expect(change(entry!, 'updatedAt')).toBeUndefined();
    expect(change(entry!, 'version')).toBeUndefined();
  });

  test('a sensitive field that changes is recorded without values', async () => {
    const id = await t.product({ name: 'Safe', pin: 'old-pin' });
    expect((await t.http().patch(`/resources/product/${id}`, { pin: PIN })).status).toBe(200);
    const [entry] = await t.fresh();
    expect(entry!.changes).toEqual([{ field: 'pin', changed: true }]);
  });

  test('a title that is a sensitive field is not stored as the record title', async () => {
    const created = await t.http().post('/resources/badge', { code: PIN, holder: 'Ada' });
    expect(created.status).toBe(201);
    expect((await t.http().patch(`/resources/badge/${created.body._id}`, { holder: 'Bob' })).status).toBe(200);
    expect((await t.http().delete(`/resources/badge/${created.body._id}`)).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => [entry.event, entry.recordId, entry.recordTitle])).toEqual([
      ['badge.created', created.body._id, null],
      ['badge.updated', created.body._id, null],
      ['badge.deleted', created.body._id, null],
    ]);
    expect(change(entries[0]!, 'code')).toEqual({ field: 'code', changed: true });
    expect(change(entries[0]!, 'holder')).toEqual({ field: 'holder', after: 'Ada' });
  });

  test('Review Focus 5: fields the host changed without the DTO sending them are recorded from the stored record', async () => {
    const id = await t.product({ name: 'Chair', price: '10.00', stock: 3 });
    const res = await t.http().patch(`/resources/product/${id}`, { price: '20.00' });
    expect(res.status).toBe(200);
    // The host's update() answered the entity as it was before it computed the totals.
    expect(res.body.total).toBe('0.00');
    const [entry] = await t.fresh();
    expect(change(entry!, 'price')).toEqual({ field: 'price', before: '10.00', after: '20.00' });
    expect(change(entry!, 'total')).toEqual({ field: 'total', before: '0.00', after: '60.00' });
    expect(change(entry!, 'margin')).toEqual({ field: 'margin', before: '0.00', after: '4.00' });
  });

  test('what the actor cannot see is recorded all the same: hidden fields, and the real title', async () => {
    const id = await t.product({ name: 'Stool', price: '10.00', stock: 1, ownerId: 'u1' });
    // A clerk has no `margin`.
    const asClerk = await t.http('u1').patch(`/resources/product/${id}`, { price: '50.00' });
    expect(asClerk.status).toBe(200);
    expect(asClerk.body.margin).toBeUndefined();
    const [byClerk] = await t.fresh();
    expect(byClerk).toMatchObject({ actorId: 'u1', actorName: 'U1 Person' });
    expect(change(byClerk!, 'margin')).toEqual({ field: 'margin', before: '0.00', after: '10.00' });
    // `blind` sees `#id` for a title; the entry keeps the title.
    const asBlind = await t.http('blind').patch(`/resources/product/${id}`, { stock: 9 });
    expect(asBlind.status).toBe(200);
    expect(asBlind.body._title).toBe(`#${id}`);
    const [byBlind] = await t.fresh();
    expect(byBlind!.recordTitle).toBe('Stool');
    expect(change(byBlind!, 'stock')).toEqual({ field: 'stock', before: 1, after: 9 });
  });

  test('a save that changes nothing writes no entry', async () => {
    const id = await t.product({ name: 'Rug' });
    expect((await t.http().patch(`/resources/product/${id}`, { name: 'Rug' })).status).toBe(200);
    expect(await t.fresh()).toEqual([]);
  });

  test('Review Focus 1: a write that rolls back after it flushed leaves no entry', async () => {
    const id = await t.product({ name: 'Vase', price: '5.00', stock: 2 });
    const res = await t.http().patch(`/resources/product/${id}`, { name: 'EXPLODE', price: '9.00' });
    expect(res.status).toBe(400);
    expect(await t.fresh()).toEqual([]);
    expect((await t.http().get(`/resources/product/${id}`)).body).toMatchObject({ name: 'Vase', price: '5.00', total: '0.00' });
    // The next write is recorded as usual.
    expect((await t.http().patch(`/resources/product/${id}`, { stock: 3 })).status).toBe(200);
    expect((await t.fresh()).map((entry) => entry.event)).toEqual(['product.updated']);
  });

  test('a host 401 inside a write is a 400, and nothing is recorded', async () => {
    const id = await t.product({ name: 'Bowl' });
    const res = await t.http().patch(`/resources/product/${id}`, { name: 'DENIED' });
    expect(res.status).toBe(400);
    expect(await t.fresh()).toEqual([]);
  });

  test('a refused write (validation, permission, not found) records nothing', async () => {
    const id = await t.product({ name: 'Cup', ownerId: 'u2' });
    expect((await t.http().patch(`/resources/product/${id}`, { nope: 1 })).status).toBe(422);
    expect((await t.http('u1').patch(`/resources/product/${id}`, { name: 'Mine' })).status).toBe(404);
    expect((await t.http().delete('/resources/product/999999')).status).toBe(404);
    expect(await t.fresh()).toEqual([]);
  });

  test('delete: what the record held, as `before`', async () => {
    const id = await t.product({ name: 'Plate', price: '3.00', pin: PIN, customer: customers[1] });
    expect((await t.http().delete(`/resources/product/${id}`)).status).toBe(204);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'product.deleted', resource: 'product', recordId: id, recordTitle: 'Plate', actorId: 'ada' });
    expect(change(entry!, 'name')).toEqual({ field: 'name', before: 'Plate' });
    expect(change(entry!, 'customer')).toEqual({ field: 'customer', before: customers[1] });
    expect(change(entry!, 'pin')).toEqual({ field: 'pin', changed: true });
  });

  test('trash, restore and purge each write an entry', async () => {
    const created = await t.http().post('/resources/doc', { title: 'Contract' });
    expect(created.status).toBe(201);
    const id = created.body._id as string;
    expect((await t.http().delete(`/resources/doc/${id}`)).status).toBe(204);
    expect((await t.http().post(`/resources/doc/${id}/restore`)).status).toBe(200);
    expect((await t.http().delete(`/resources/doc/${id}`)).status).toBe(204);
    expect((await t.http().delete(`/resources/doc/${id}?purge=true`)).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => entry.event)).toEqual(['doc.created', 'doc.deleted', 'doc.restored', 'doc.deleted', 'doc.purged']);
    for (const entry of entries) expect(entry).toMatchObject({ resource: 'doc', recordId: id, recordTitle: 'Contract', actorId: 'ada' });
    const [, deleted, restored, , purged] = entries;
    expect(change(deleted!, 'title')).toEqual({ field: 'title', before: 'Contract' });
    expect(restored!.changes).toEqual([]);
    // The before image of a purge is read from the trash.
    expect(change(purged!, 'title')).toEqual({ field: 'title', before: 'Contract' });
    expect(change(purged!, 'deletedAt')).toMatchObject({ field: 'deletedAt' });
    // Only the purge ended the record: the trash is no end.
    expect(entries.map((entry) => entry.meta?.deleted)).toEqual([undefined, undefined, undefined, undefined, true]);
  });

  test('bulk delete writes one entry per deleted record, none for a failure', async () => {
    const a = await t.product({ name: 'Bulk A' });
    const b = await t.product({ name: 'Bulk B' });
    const res = await t.http().post('/resources/product/bulk-delete', { ids: [a, '999999', b] });
    expect(res.body).toMatchObject({ ok: [a, b] });
    expect(res.body.failed).toHaveLength(1);
    const entries = await t.fresh();
    expect(entries.map((entry) => [entry.event, entry.recordId, entry.recordTitle])).toEqual([['product.deleted', a, 'Bulk A'], ['product.deleted', b, 'Bulk B']]);
    // One request, one correlation id.
    expect(entries[0]!.correlationId).toBe(entries[1]!.correlationId);
  });

  test('an action: its name, its input without sensitive keys, and what it changed', async () => {
    const id = await t.product({ name: 'Sofa', price: '200.00' });
    const res = await t.http().post('/resources/product/actions/discount', { ids: [id], input: { percent: 50, reason: 'clearance', approvalCode: APPROVAL, managerPassword: 'manager-SENTINEL' } });
    expect(res.status).toBe(200);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'product.action.discount', resource: 'product', recordId: id, recordTitle: 'Sofa', actorId: 'ada' });
    // What was sent and validated, not what the method turned it into; no sensitive or password key.
    expect(entry!.meta).toEqual({ action: 'discount', input: { percent: 50, reason: 'clearance' } });
    // "before" was read before the method changed the entity it was handed.
    expect(entry!.changes).toEqual([{ field: 'price', before: '200.00', after: '100.00' }]);
  });

  test('an action that deleted its record is stamped from the stored row, whatever the host’s `findOne` still answers', async () => {
    const created = await t.http().post('/resources/crate', { name: 'Crate one' });
    expect(created.status).toBe(201);
    const id = created.body._id as string;
    // The finder has the record in its cache from here on.
    expect((await t.http().get(`/resources/crate/${id}`)).body.name).toBe('Crate one');
    await t.fresh();
    expect((await t.http().post('/resources/crate/actions/scrap', { ids: [id] })).status).toBe(200);
    expect(await t.auditDb.getRepository(Crate).countBy({ id: Number(id) })).toBe(0);
    expect((await t.http().get(`/resources/crate/${id}`)).body.name).toBe('Crate one'); // the stale answer
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'crate.action.scrap', recordId: id, recordTitle: 'Crate one' });
    expect(entry!.meta).toEqual({ action: 'scrap', deleted: true });
    // The diff is of the row that went, not of the object the finder answered.
    expect(change(entry!, 'name')).toEqual({ field: 'name', before: 'Crate one' });
  });

  test('a bulk action writes one entry per record that ran; a failed run writes none', async () => {
    const a = await t.product({ name: 'Bed', price: '100.00' });
    const b = await t.product({ name: 'Cot', price: '50.00' });
    const ok = await t.http().post('/resources/product/actions/discount', { ids: [a, b], input: { percent: 10 } });
    expect(ok.body).toMatchObject({ ok: [a, b], failed: [] });
    const entries = await t.fresh();
    expect(entries.map((entry) => [entry.event, entry.recordId, entry.changes])).toEqual([
      ['product.action.discount', a, [{ field: 'price', before: '100.00', after: '90.00' }]],
      ['product.action.discount', b, [{ field: 'price', before: '50.00', after: '45.00' }]],
    ]);
    const failed = await t.http().post('/resources/product/actions/discount', { ids: [a], input: { percent: 66 } });
    expect(failed.status).toBe(400);
    expect(await t.fresh()).toEqual([]);
    expect((await t.http().get(`/resources/product/${a}`)).body.price).toBe('90.00');
  });

  test('an atomic run: each record’s "before" is read when its own turn comes', async () => {
    const a = await t.product({ name: 'Atomic A', stock: 0 });
    const b = await t.product({ name: 'Atomic B', stock: 0 });
    const res = await t.http().post('/resources/product/actions/raiseAll', { ids: [a, b] });
    expect(res.body).toMatchObject({ ok: [a, b], failed: [] });
    const [first, second] = await t.fresh();
    expect([first!.recordId, second!.recordId]).toEqual([a, b]);
    expect(first!.changes).toEqual([{ field: 'stock', before: 0, after: 1 }]);
    // A's run raised B too: B's own run starts from 1, not from what the pre-check pass loaded.
    expect(second!.changes).toEqual([{ field: 'stock', before: 1, after: 2 }]);
  });

  test('an action that deletes its record, and one that moves it out of the actor’s view', async () => {
    const gone = await t.product({ name: 'Scrap me', price: '1.00' });
    const scrapped = await t.http().post('/resources/product/actions/scrap', { ids: [gone] });
    expect(scrapped.body).toEqual({ record: null });
    const [entry] = await t.fresh();
    expect(entry).toMatchObject({ event: 'product.action.scrap', recordId: gone, recordTitle: 'Scrap me' });
    expect(entry!.meta).toEqual({ action: 'scrap', deleted: true });
    expect(change(entry!, 'name')).toEqual({ field: 'name', before: 'Scrap me' });

    const moved = await t.product({ name: 'Hand me over', ownerId: 'u1' });
    const handed = await t.http('u1').post('/resources/product/actions/handOver', { ids: [moved] });
    // The clerk no longer sees it; the entry still says what changed.
    expect(handed.body).toEqual({ record: null });
    const [second] = await t.fresh();
    expect(second).toMatchObject({ event: 'product.action.handOver', recordId: moved, recordTitle: 'Hand me over', actorId: 'u1' });
    expect(second!.meta).toEqual({ action: 'handOver' });
    expect(second!.changes).toEqual([{ field: 'ownerId', before: 'u1', after: 'u2' }]);
  });

  test('a resource action is recorded with its input and no record', async () => {
    const res = await t.http().post('/resources/product/actions/sale', { input: { percent: 15, approvalCode: APPROVAL } });
    expect(res.status).toBe(200);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'product.action.sale', resource: 'product', recordId: null, recordTitle: null, actorId: 'ada', changes: null });
    expect(entry!.meta).toEqual({ action: 'sale', input: { percent: 15 } });
  });

  test('a settings save: changed fields, secrets and sensitive fields without values, nothing else of load()', async () => {
    const first = await t.http().patch('/pages/shop', { shopName: 'Corner shop', lowStock: 3, apiKey: API_KEY, doorCode: 'door-SENTINEL-1', smtpPassword: 'smtp-SENTINEL-1' });
    expect(first.status).toBe(200);
    const [created, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(created).toMatchObject({ event: 'page.shop.updated', resource: null, recordId: null, actorId: 'ada', meta: { page: 'shop' } });
    expect(created!.changes).toEqual([
      { field: 'shopName', before: null, after: 'Corner shop' },
      { field: 'lowStock', before: null, after: 3 },
      { field: 'apiKey', changed: true },
      { field: 'doorCode', changed: true },
      { field: 'smtpPassword', changed: true },
    ]);
    // `savedAt` differs at every load(), and is no field of the form.
    const second = await t.http().patch('/pages/shop', { shopName: 'Corner store' });
    expect(second.status).toBe(200);
    expect((await t.fresh()).map((entry) => entry.changes)).toEqual([[{ field: 'shopName', before: 'Corner shop', after: 'Corner store' }]]);
    // Clearing a secret is a change; a save that changes nothing is not.
    expect((await t.http().patch('/pages/shop', { apiKey: null })).status).toBe(200);
    expect((await t.fresh()).map((entry) => entry.changes)).toEqual([[{ field: 'apiKey', changed: true }]]);
    expect((await t.http().patch('/pages/shop', { shopName: 'Corner store' })).status).toBe(200);
    expect(await t.fresh()).toEqual([]);
    // A save that fails after it wrote records nothing.
    expect((await t.http().patch('/pages/shop', { shopName: 'EXPLODE', apiKey: API_KEY })).status).toBe(400);
    expect(await t.fresh()).toEqual([]);
  });

  test('a role change records its permissions before and after', async () => {
    const created = await t.http().post('/rbac/roles', { name: 'packer', label: 'Packer', permissions: ['product.view'] });
    expect(created.status).toBe(201);
    const updated = await t.http().patch('/rbac/roles/packer', { label: 'Packer', permissions: ['product.view', 'product.update'], fields: { product: { margin: 'hidden' } } });
    expect(updated.status).toBe(200);
    // Nothing changes: no entry.
    expect((await t.http().patch('/rbac/roles/packer', { label: 'Packer', permissions: ['product.update', 'product.view'], fields: { product: { margin: 'hidden' } } })).status).toBe(200);
    expect((await t.http().delete('/rbac/roles/packer')).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => entry.event)).toEqual(['rbac.role.changed', 'rbac.role.changed', 'rbac.role.changed']);
    for (const entry of entries) expect(entry).toMatchObject({ resource: null, recordId: 'packer', actorId: 'ada', actorName: 'ADA Person' });
    expect(change(entries[0]!, 'permissions')).toEqual({ field: 'permissions', after: ['product.view'] });
    expect(change(entries[0]!, 'label')).toEqual({ field: 'label', after: 'Packer' });
    expect(entries[1]!.changes).toEqual([
      { field: 'permissions', before: ['product.view'], after: ['product.update', 'product.view'] },
      { field: 'fields', before: null, after: { product: { margin: 'hidden' } } },
    ]);
    expect(change(entries[2]!, 'permissions')).toEqual({ field: 'permissions', before: ['product.update', 'product.view'] });
    // A refused change records nothing.
    expect((await t.http('u1').post('/rbac/roles', { name: 'sneaky', permissions: ['*'] })).status).toBe(403);
    expect((await t.http().post('/rbac/roles', { name: 'broken', permissions: ['nothing.view'] })).status).toBe(422);
    expect(await t.fresh()).toEqual([]);
  });

  test('an imported role is recorded like a saved one', async () => {
    const res = await t.http().post('/rbac/roles/import', { roles: [{ name: 'imported', permissions: ['doc.view'] }] });
    expect(res.status).toBe(200);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'rbac.role.changed', recordId: 'imported' });
    expect(change(entry!, 'permissions')).toEqual({ field: 'permissions', after: ['doc.view'] });
  });

  test('group and membership changes are recorded', async () => {
    const created = await t.http().post('/rbac/groups', { name: 'warehouse', roles: ['clerk'], members: ['u1'] });
    expect(created.status).toBe(201);
    const groupId = created.body.id as number;
    expect((await t.http().patch(`/rbac/groups/${groupId}`, { members: ['u1', 'u2'] })).status).toBe(200);
    expect((await t.http().patch('/rbac/users/u2', { roles: ['blind'], groups: [] })).status).toBe(200);
    expect((await t.http().delete(`/rbac/groups/${groupId}`)).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => [entry.event, entry.recordId])).toEqual([
      ['rbac.group.changed', String(groupId)],
      ['rbac.group.changed', String(groupId)],
      ['rbac.user_roles.changed', 'u2'],
      ['rbac.group.changed', String(groupId)],
    ]);
    expect(entries[0]).toMatchObject({ recordTitle: 'warehouse', actorId: 'ada' });
    expect(entries[0]!.changes).toEqual([{ field: 'name', after: 'warehouse' }, { field: 'roles', after: ['clerk'] }, { field: 'members', after: ['u1'] }]);
    expect(entries[1]!.changes).toEqual([{ field: 'members', before: ['u1'], after: ['u1', 'u2'] }]);
    expect(entries[2]!.changes).toEqual([{ field: 'roles', before: [], after: ['blind'] }, { field: 'groups', before: [groupId], after: [] }]);
    expect(entries[3]!.changes).toEqual([{ field: 'name', before: 'warehouse' }, { field: 'roles', before: ['clerk'] }, { field: 'members', before: ['u1'] }]);
    await t.http().patch('/rbac/users/u2', { roles: [] });
    await t.fresh();
  });

  test('sign-in and sign-out are recorded with the address and the browser', async () => {
    const login = await request(t.app.getHttpServer()).post('/admin/api/session').set('User-Agent', 'TestBrowser/1.0').send({ username: 'ada', password: PASSWORD });
    expect(login.status).toBe(200);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'auth.login', actorId: 'ada', actorName: 'ADA Person', resource: null, recordId: null, changes: null });
    expect(entry!.meta).toMatchObject({ userAgent: 'TestBrowser/1.0' });
    expect(typeof (entry!.meta as { ip?: unknown }).ip).toBe('string');
    expect((await t.http().delete('/session')).status).toBe(204);
    expect((await t.fresh()).map((item) => [item.event, item.actorId])).toEqual([['auth.logout', 'ada']]);
  });

  test('Review Focus 4: a failed sign-in stores the username and the address, never the password or the code', async () => {
    const wrong = await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'ada', password: WRONG_PASSWORD, otp: OTP });
    expect(wrong.status).toBe(401);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'auth.login_failed', actorId: null, actorName: null, changes: null });
    expect(entry!.meta).toMatchObject({ username: 'ada', reason: 'UNAUTHENTICATED' });
    expect(typeof (entry!.meta as { ip?: unknown }).ip).toBe('string');
    expect(JSON.stringify(entry)).not.toContain(WRONG_PASSWORD);
    expect(JSON.stringify(entry)).not.toContain(OTP);
    // A lockout is a failure too; being asked for the second factor is not, and neither is a body that never reached the adapter.
    expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'locked', password: 'x' })).status).toBe(429);
    expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'u2', password: 'u2-pass' })).status).toBe(401);
    expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'u'.repeat(5000), password: 'x' })).status).toBe(422);
    expect((await t.fresh()).map((item) => [item.event, item.meta])).toEqual([['auth.login_failed', expect.objectContaining({ username: 'locked', reason: 'RATE_LIMITED' })]]);
  });

  test('a wrong second-factor code is a failed sign-in with its own reason, and the code is not stored', async () => {
    const wrong = await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'u2', password: 'u2-pass', otp: OTP });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('TWO_FACTOR_REQUIRED');
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'auth.login_failed', actorId: null });
    expect(entry!.meta).toMatchObject({ username: 'u2', reason: 'WRONG_CODE' });
    expect(JSON.stringify(entry)).not.toContain(OTP);
    // The right code signs in.
    expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'u2', password: 'u2-pass', otp: '000000' })).status).toBe(200);
    expect((await t.fresh()).map((item) => item.event)).toEqual(['auth.login']);
  });

  test('changes to a user are recorded with the user as the record: created, profile, password reset, 2FA reset', async () => {
    const created = await t.http().post('/rbac/users', { username: 'newbie', displayName: 'New Person', email: 'new@example.com', password: NEW_PASSWORD, roles: ['clerk'] });
    expect(created.status).toBe(201);
    expect((await t.http().patch('/rbac/users/newbie', { displayName: 'New Person', isActive: false, isSuperuser: true })).status).toBe(200);
    // A profile save that changes nothing is no entry.
    expect((await t.http().patch('/rbac/users/newbie', { isActive: false })).status).toBe(200);
    expect((await t.http().post('/rbac/users/newbie/password', { password: RESET_PASSWORD })).status).toBe(204);
    expect((await t.http().post('/rbac/users/newbie/2fa/reset')).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => entry.event)).toEqual(['rbac.user.created', 'rbac.user_roles.changed', 'rbac.user.changed', 'rbac.user.password_reset', 'rbac.user.two_factor_reset']);
    for (const entry of entries) expect(entry).toMatchObject({ resource: null, recordId: 'newbie', actorId: 'ada' });
    expect(entries[0]).toMatchObject({ recordTitle: 'New Person' });
    expect(entries[0]!.changes).toEqual([
      { field: 'username', after: 'newbie' },
      { field: 'displayName', after: 'New Person' },
      { field: 'email', after: 'new@example.com' },
      { field: 'isActive', after: true },
      { field: 'isSuperuser', after: false },
    ]);
    expect(entries[2]!.changes).toEqual([{ field: 'isActive', before: true, after: false }, { field: 'isSuperuser', before: false, after: true }]);
    expect(entries[3]!.changes).toBeNull();
    expect(entries[4]!.changes).toBeNull();
    // A refused change records nothing.
    expect((await t.http('u1').post('/rbac/users/newbie/password', { password: 'x' })).status).toBe(403);
    expect(await t.fresh()).toEqual([]);
    users.delete('newbie');
  });

  test('changes to one’s own account are recorded: password, 2FA on and off, recovery codes, sessions', async () => {
    expect((await t.http().post('/account/password', { current: 'not-it', next: OWN_PASSWORD })).status).toBe(401);
    expect(await t.fresh()).toEqual([]);
    expect((await t.http().post('/account/password', { current: PASSWORD, next: OWN_PASSWORD })).status).toBe(204);
    expect((await t.http().post('/account/2fa/setup')).status).toBe(200);
    expect((await t.http().post('/account/2fa/confirm', { code: '999999' })).status).toBe(401);
    expect((await t.http().post('/account/2fa/confirm', { code: '000000' })).status).toBe(200);
    expect((await t.http().post('/account/2fa/recovery-codes', { password: PASSWORD })).status).toBe(200);
    expect((await t.http().post('/account/2fa/disable', { password: PASSWORD })).status).toBe(204);
    expect((await t.http().delete('/account/sessions')).status).toBe(204);
    expect((await t.http().delete('/account/sessions/s1')).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => entry.event)).toEqual([
      'auth.password_changed',
      'auth.two_factor_enabled',
      'auth.recovery_codes_regenerated',
      'auth.two_factor_disabled',
      'auth.sessions_revoked',
      'auth.sessions_revoked',
    ]);
    for (const entry of entries) expect(entry).toMatchObject({ actorId: 'ada', recordId: 'ada', recordTitle: 'ADA Person', resource: null, changes: null });
    expect(entries[4]!.meta).toMatchObject({ sessions: 'others' });
    expect(entries[5]!.meta).toMatchObject({ sessions: 'one' });
  });

  test('deleting a role names the users and groups that lose it', async () => {
    expect((await t.http().post('/rbac/roles', { name: 'temp', permissions: ['doc.view'] })).status).toBe(201);
    const group = await t.http().post('/rbac/groups', { name: 'temps', roles: ['temp'] });
    expect((await t.http().patch('/rbac/users/u1', { roles: ['temp'] })).status).toBe(200);
    await t.fresh();
    expect((await t.http().delete('/rbac/roles/temp')).status).toBe(204);
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'rbac.role.changed', recordId: 'temp' });
    expect(change(entry!, 'users')).toEqual({ field: 'users', before: ['u1'] });
    expect(change(entry!, 'groups')).toEqual({ field: 'groups', before: ['temps'] });
    expect((await t.http().delete(`/rbac/groups/${group.body.id}`)).status).toBe(204);
    await t.fresh();
  });

  test('a function title on a resource with sensitive fields is not stored: it may hold one of them', async () => {
    const created = await t.http().post('/resources/card', { holder: 'Ada', number: CARD_NUMBER });
    expect(created.status).toBe(201);
    expect(created.body._title).toBe(`Ada ${CARD_NUMBER}`);
    expect((await t.http().patch(`/resources/card/${created.body._id}`, { holder: 'Bob' })).status).toBe(200);
    expect((await t.http().delete(`/resources/card/${created.body._id}`)).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => [entry.event, entry.recordTitle])).toEqual([['card.created', null], ['card.updated', null], ['card.deleted', null]]);
    expect(JSON.stringify(entries)).not.toContain(CARD_NUMBER);
  });

  test('a host service that writes outside the admin’s transaction still gets its entry', async () => {
    const created = await t.http().post('/resources/memo', { text: 'first' });
    expect(created.status).toBe(201);
    await t.fresh();
    const res = await t.http().patch(`/resources/memo/${created.body._id}`, { text: 'second' });
    expect(res.status).toBe(200);
    // On MySQL the admin's transaction cannot see that commit (REPEATABLE READ): the entity the host answered is the witness.
    const [entry, ...rest] = await t.fresh();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ event: 'memo.updated', recordId: created.body._id });
    expect(change(entry!, 'text')).toEqual({ field: 'text', before: 'first', after: 'second' });
    expect(change(entry!, 'edits')).toEqual({ field: 'edits', before: 0, after: 1 });
  });

  test('a file field is recorded by its keys; a write that rolls back leaves no entry and gives the upload back', async () => {
    const files = t.auditDb.getRepository(NmaFile);
    const upload = async () => {
      const res = await request(t.app.getHttpServer()).post('/admin/api/uploads?resource=sheet&field=manual').set('X-User', 'ada').set('Content-Type', 'application/pdf').send(PDF);
      expect(res.status).toBe(201);
      return { token: res.body.token as string, key: (await files.findOneByOrFail({ id: res.body.token })).key };
    };
    const first = await upload();
    const created = await t.http().post('/resources/sheet', { name: 'Guide', manual: { token: first.token } });
    expect(created.status).toBe(201);
    const id = created.body._id as string;
    const second = await upload();
    expect((await t.http().patch(`/resources/sheet/${id}`, { manual: { token: second.token } })).status).toBe(200);
    const [made, replaced] = await t.fresh();
    expect(change(made!, 'manual')).toEqual({ field: 'manual', after: first.key });
    expect(replaced!.changes).toEqual([{ field: 'manual', before: first.key, after: second.key }]);

    const third = await upload();
    expect((await t.http().patch(`/resources/sheet/${id}`, { name: 'EXPLODE', manual: { token: third.token } })).status).toBe(400);
    expect(await t.fresh()).toEqual([]);
    expect(await files.findOneByOrFail({ id: third.token })).toMatchObject({ status: 'temp', recordId: null });
    expect((await t.http().get(`/resources/sheet/${id}`)).body).toMatchObject({ name: 'Guide', manual: second.key });
  });

  test('a composite-key record is recorded under the `_id` the API uses for it', async () => {
    const created = await t.http().post('/resources/slot', { depot: 'north/1', no: 7, name: 'Bay' });
    expect(created.status).toBe(201);
    const id = created.body._id as string;
    expect((await t.http().get(`/resources/slot/${encodeURIComponent(id)}`)).status).toBe(200);
    expect((await t.http().patch(`/resources/slot/${encodeURIComponent(id)}`, { name: 'Bay 7' })).status).toBe(200);
    expect((await t.http().delete(`/resources/slot/${encodeURIComponent(id)}`)).status).toBe(204);
    const entries = await t.fresh();
    expect(entries.map((entry) => [entry.event, entry.recordId])).toEqual([['slot.created', id], ['slot.updated', id], ['slot.deleted', id]]);
    expect(entries[1]!.changes).toEqual([{ field: 'name', before: 'Bay', after: 'Bay 7' }]);
  });

  test('a failed sign-in does not wait for its entry, and a burst is recorded one insert at a time', async () => {
    const audit = t.app.get(AdminAudit);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let running = 0;
    let most = 0;
    const insert = (audit as unknown as { insert: (...args: unknown[]) => Promise<void> }).insert.bind(audit);
    const spy = spyOn(audit as unknown as { insert: (...args: unknown[]) => Promise<void> }, 'insert').mockImplementation(async (...args: unknown[]) => {
      most = Math.max(most, ++running);
      await held;
      try {
        await insert(...args);
      } finally {
        running -= 1;
      }
    });
    try {
      // No insert can finish, and every answer arrives.
      const answers = await Promise.all(Array.from({ length: 25 }, (_, index) => request(t.app.getHttpServer()).post('/admin/api/session').send({ username: `burst${index}`, password: 'x' })));
      expect(answers.map((res) => res.status)).toEqual(Array.from({ length: 25 }, () => 401));
      expect(most).toBe(1);
      release();
      const entries = await t.fresh();
      expect(entries.map((entry) => (entry.meta as { username: string }).username).sort()).toEqual(Array.from({ length: 25 }, (_, index) => `burst${index}`).sort());
      expect(most).toBe(1);
    } finally {
      release();
      spy.mockRestore();
    }
  });

  test('a failed-login entry that cannot be written is logged, and the answer is still a 401', async () => {
    const audit = t.app.get(AdminAudit);
    const warned = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const spy = spyOn(audit as unknown as { insert: () => Promise<void> }, 'insert').mockRejectedValue(new Error('the audit table is gone'));
    try {
      const res = await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'ada', password: 'nope' });
      expect(res.status).toBe(401);
      await audit.idle();
      expect(warned.mock.calls.flat().join('\n')).toContain('auth.login_failed');
      expect(warned.mock.calls.flat().join('\n')).toContain('the audit table is gone');
    } finally {
      spy.mockRestore();
      warned.mockRestore();
    }
    expect(await t.fresh()).toEqual([]);
  });

  test('a failed-login row is bounded: long names, addresses and browsers are cut', async () => {
    const audit = t.app.get(AdminAudit);
    audit.recordDetached({ event: 'auth.login_failed', meta: { username: 'n'.repeat(100_000), ip: '9'.repeat(1000), userAgent: 'a'.repeat(100_000), reason: 'UNAUTHENTICATED' } }, { correlationId: 'c'.repeat(1000) });
    const [entry] = await t.fresh();
    const meta = entry!.meta as { username: string; ip: string; userAgent: string };
    expect(meta.username.length).toBeLessThanOrEqual(200);
    expect(meta.ip.length).toBeLessThanOrEqual(64);
    expect(meta.userAgent.length).toBeLessThanOrEqual(300);
    expect(entry!.correlationId.length).toBeLessThanOrEqual(64);
  });

  test('view-as: one entry when it starts, not one per request', async () => {
    const logged = spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      expect((await t.http('ada', { 'X-View-As': 'u1' }).get('/meta')).status).toBe(200);
      expect((await t.http('ada', { 'X-View-As': 'u1' }).get('/resources/product')).status).toBe(200);
      const [entry, ...rest] = await t.fresh();
      expect(rest).toEqual([]);
      // The superuser is the actor; the user looked at is the record.
      expect(entry).toMatchObject({ event: 'auth.view_as', actorId: 'ada', actorName: 'ADA Person', recordId: 'u1', recordTitle: 'U1 Person', resource: null });
      // The entry replaces the log line.
      expect(logged.mock.calls.flat().join('\n')).not.toContain('is viewing the admin as');
      // Refused attempts are no view-as.
      expect((await t.http('u1', { 'X-View-As': 'u2' }).get('/meta')).status).toBe(403);
      expect(await t.fresh()).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  test('`audit.view` is a code roles can name while the audit log is on', async () => {
    expect(t.app.get(AdminRbac).catalog().global).toContain('audit.view');
    expect((await t.http().post('/rbac/roles', { name: 'auditor', permissions: ['audit.view'] })).status).toBe(201);
    expect((await t.http().delete('/rbac/roles/auditor')).status).toBe(204);
    await t.fresh();
  });

  test('a large change still fits its row', async () => {
    const audit = t.app.get(AdminAudit);
    await audit.record({ event: 'product.updated', changes: [{ field: 'body', before: 'ا'.repeat(200_000), after: 'ب'.repeat(200_000) }], meta: { action: 'x', input: { blob: 'z'.repeat(200_000) } } }, { correlationId: 'big' });
    const [entry] = await t.fresh();
    expect(Buffer.byteLength(JSON.stringify(entry!.changes))).toBeLessThan(60_000);
    expect(entry!.changes![0]).toMatchObject({ field: 'body', truncated: true });
    expect(entry!.meta).toEqual({ action: 'x', inputTruncated: true });
  });

  test('stamping an entry as the end of its record keeps the rest of its meta', async () => {
    const audit = t.app.get(AdminAudit);
    const ctx = { correlationId: 'stamp' };
    const withMeta = await audit.record({ event: 'product.action.shred', recordId: '424242', meta: { action: 'shred', input: { reason: 'spring cleaning' } } }, ctx);
    const without = await audit.record({ event: 'product.deleted', recordId: '424243' }, ctx);
    await audit.stampDeleted(withMeta!, 'product.action.shred', ctx);
    await audit.stampDeleted(without!, 'product.deleted', ctx);
    const [first, second] = await t.fresh();
    expect(first!.meta).toEqual({ action: 'shred', input: { reason: 'spring cleaning' }, deleted: true });
    expect(second!.meta).toEqual({ deleted: true });
  });

  test('nothing sensitive was stored by anything above: the whole table is searched', async () => {
    await t.app.get(AdminAudit).idle();
    const rows = await t.auditDb.getRepository(NmaAuditEntry).find();
    expect(rows.length).toBeGreaterThan(80);
    const all = JSON.stringify(rows);
    for (const secret of SENTINELS) expect(all).not.toContain(secret);
  });
});

describe('audit log: failed sign-ins are bounded', () => {
  const fail = (t: Awaited<ReturnType<typeof boot>>, username: string) => request(t.app.getHttpServer()).post('/admin/api/session').send({ username, password: 'x' });
  const failures = (entries: Entry[]) => entries.map((entry) => entry.meta as { username?: string; ip?: string; reason: string; limited?: true; suppressed?: number });

  test('per address and username: five a minute, a sixth marked `limited`, then a count; a lockout’s repeats are not recorded', async () => {
    const t = await boot();
    try {
      for (let attempt = 0; attempt < 9; attempt += 1) expect((await fail(t, 'ada')).status).toBe(401);
      const recorded = failures(await t.fresh());
      expect(recorded.map((meta) => [meta.username, meta.reason, meta.limited ?? false])).toEqual([...Array.from({ length: 5 }, () => ['ada', 'UNAUTHENTICATED', false]), ['ada', 'UNAUTHENTICATED', true]]);
      // Another username from the same address has its own five.
      expect((await fail(t, 'u1')).status).toBe(401);
      for (let attempt = 0; attempt < 4; attempt += 1) expect((await fail(t, 'locked')).status).toBe(429);
      expect(failures(await t.fresh()).map((meta) => [meta.username, meta.reason])).toEqual([['u1', 'UNAUTHENTICATED'], ['locked', 'RATE_LIMITED']]);
      // Nothing is written while the minute is open; when it closes, one entry per pair says what was left out.
      t.app.get(AdminAudit).flushLoginFailures(Date.now() + 30_000);
      expect(await t.fresh()).toEqual([]);
      t.app.get(AdminAudit).flushLoginFailures(Date.now() + 61_000);
      const closed = failures(await t.fresh());
      expect(closed.map((meta) => [meta.username, meta.reason, meta.suppressed]).sort()).toEqual([['ada', 'SUPPRESSED', 3], ['locked', 'SUPPRESSED', 3]]);
      expect(typeof closed[0]!.ip).toBe('string');
      // A new minute records again.
      expect((await fail(t, 'ada')).status).toBe(401);
      expect(failures(await t.fresh()).map((meta) => [meta.username, meta.reason])).toEqual([['ada', 'UNAUTHENTICATED']]);
    } finally {
      await t.app.close();
    }
  }, 60_000);

  test('per address across usernames: fifty a minute, one more marked `limited`, then a count', async () => {
    const t = await boot();
    try {
      for (let attempt = 0; attempt < 58; attempt += 1) expect((await fail(t, `rotating${attempt}`)).status).toBe(401);
      const recorded = failures(await t.fresh());
      expect(recorded).toHaveLength(51);
      expect(recorded.filter((meta) => meta.limited)).toEqual([expect.objectContaining({ username: 'rotating50', limited: true })]);
      t.app.get(AdminAudit).flushLoginFailures(Date.now() + 61_000);
      const closed = failures(await t.fresh());
      // The summary names the address as the cap counts it (`addressBucket`: supertest's ::ffff:127.0.0.1 is 127.0.0.1).
      expect(closed).toEqual([{ ip: addressBucket(recorded[0]!.ip), reason: 'SUPPRESSED', suppressed: 7 }]);
    } finally {
      await t.app.close();
    }
  }, 60_000);

  test('the whole process: 300 a minute whatever the addresses, then one count; a /64 is one address; a sign-in that succeeds is always recorded', async () => {
    const t = await boot();
    const audit = t.app.get(AdminAudit);
    const from = (ip: string) => ({ ip, headers: {}, socket: {} }) as unknown as IncomingMessage;
    const now = Date.now();
    try {
      // One client walking through its IPv6 /64, a new address and username each time: one address to the cap.
      for (let attempt = 0; attempt < 60; attempt += 1) audit.recordLoginFailure({ username: `walk${attempt}`, reason: 'UNAUTHENTICATED', lockout: false }, from(`2001:db8:5:6::${(attempt + 1).toString(16)}`), { correlationId: 'walk' }, now);
      const walked = failures(await t.fresh());
      expect(walked).toHaveLength(51);
      expect(walked.at(-1)).toMatchObject({ username: 'walk50', ip: '2001:db8:5:6::33', limited: true });
      // Many addresses, one failure each: no per-address cap is reached, the ceiling is.
      for (let attempt = 0; attempt < 400; attempt += 1) audit.recordLoginFailure({ username: `bot${attempt}`, reason: 'UNAUTHENTICATED', lockout: false }, from(`198.51.${attempt >> 8}.${attempt & 255}`), { correlationId: 'bots' }, now);
      const bots = failures(await t.fresh());
      expect(bots).toHaveLength(300 - 51);
      expect(bots.at(-1)!.username).toBe(`bot${300 - 51 - 1}`);
      // A sign-in that succeeds is recorded all the same.
      expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'ada', password: 'ada-pass' })).status).toBe(200);
      expect((await t.fresh()).map((entry) => entry.event)).toEqual(['auth.login']);
      // When the minute closes: what the /64 left out, and one entry for what the ceiling left out.
      audit.flushLoginFailures(now + 61_000);
      const closed = failures(await t.fresh());
      expect(closed).toHaveLength(2);
      expect(closed).toContainEqual({ ip: '2001:db8:5:6::/64', reason: 'SUPPRESSED', suppressed: 9 });
      expect(closed).toContainEqual({ reason: 'SUPPRESSED', suppressed: 400 - (300 - 51) });
    } finally {
      await t.app.close();
    }
  }, 60_000);

  test('shutting down writes the entries still waiting, and does not wait for long on a table that does not answer', async () => {
    const t = await boot();
    const audit = t.app.get(AdminAudit);
    const real = (audit as unknown as { insert: (...args: unknown[]) => Promise<void> }).insert.bind(audit);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let stuck = false;
    const spy = spyOn(audit as unknown as { insert: (...args: unknown[]) => Promise<void> }, 'insert').mockImplementation(async (...args: unknown[]) => {
      if (stuck) await held;
      else await new Promise((resolve) => setTimeout(resolve, 20));
      await real(...args);
    });
    try {
      for (let index = 0; index < 3; index += 1) audit.recordDetached({ event: 'auth.login_failed', meta: { username: `late${index}` } }, { correlationId: 'shutdown' });
      await audit.onModuleDestroy();
      // Read without `fresh()`, which waits for the queue itself.
      expect(await t.auditDb.getRepository(NmaAuditEntry).countBy({ correlationId: 'shutdown' })).toBe(3);
      stuck = true;
      audit.recordDetached({ event: 'auth.login_failed', meta: { username: 'never' } }, { correlationId: 'stuck' });
      const started = Date.now();
      await audit.onModuleDestroy(50);
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(await t.auditDb.getRepository(NmaAuditEntry).countBy({ correlationId: 'stuck' })).toBe(0);
    } finally {
      release();
      await audit.idle();
      spy.mockRestore();
      await t.app.close();
    }
  }, 60_000);

  test('more than 1,000 entries waiting to be written: the rest are dropped, and that is logged once', async () => {
    const t = await boot();
    const audit = t.app.get(AdminAudit);
    const warned = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const insert = (audit as unknown as { insert: (...args: unknown[]) => Promise<void> }).insert.bind(audit);
    const spy = spyOn(audit as unknown as { insert: (...args: unknown[]) => Promise<void> }, 'insert').mockImplementation(async (...args: unknown[]) => {
      await held;
      await insert(...args);
    });
    try {
      for (let index = 0; index < 1_010; index += 1) audit.recordDetached({ event: 'auth.login_failed', meta: { username: `q${index}` } }, { correlationId: 'queue' });
      const lines = warned.mock.calls.flat().filter((line) => String(line).includes('entries are waiting'));
      expect(lines).toHaveLength(1);
      expect(String(lines[0])).toContain('auth.login_failed');
      release();
      const entries = await t.fresh();
      expect(entries).toHaveLength(1_000);
      expect((entries.at(-1)!.meta as { username: string }).username).toBe('q999');
    } finally {
      release();
      spy.mockRestore();
      warned.mockRestore();
      await t.app.close();
    }
  }, 60_000);
});

describe('audit log: where the entry is written', () => {
  test('without `audit` nothing is recorded, no table is needed, and `audit.view` is no code', async () => {
    const t = await boot({}, {});
    try {
      const db = t.app.get<DataSource>(getDataSourceToken() as string, { strict: false });
      expect(db.hasMetadata(NmaAuditEntry)).toBe(false);
      expect(t.app.get(AdminAudit).enabled).toBe(false);
      const created = await t.http().post('/resources/product', { name: 'Quiet', price: '1.00' });
      expect(created.status).toBe(201);
      expect((await t.http().patch(`/resources/product/${created.body._id}`, { price: '2.00' })).status).toBe(200);
      expect((await t.http().post('/resources/product/actions/discount', { ids: [created.body._id], input: { percent: 10 } })).status).toBe(200);
      expect((await t.http().patch('/pages/shop', { shopName: 'No audit' })).status).toBe(200);
      expect((await t.http().post('/rbac/roles', { name: 'packer', permissions: ['product.view'] })).status).toBe(201);
      expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'ada', password: 'nope' })).status).toBe(401);
      expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'ada', password: PASSWORD })).status).toBe(200);
      expect((await t.http('ada', { 'X-View-As': 'u1' }).get('/meta')).status).toBe(200);
      expect((await t.http().delete(`/resources/product/${created.body._id}`)).status).toBe(204);
      expect(t.app.get(AdminRbac).catalog().global).not.toContain('audit.view');
      expect((await t.http().post('/rbac/roles', { name: 'auditor', permissions: ['audit.view'] })).status).toBe(422);
      // Recording by hand is a no-op too.
      await t.app.get(AdminAudit).record({ event: 'x.y' }, { correlationId: 'none' });
    } finally {
      await t.app.close();
    }
  });

  test('boot fails with a clear message when the table or the DataSource is missing', async () => {
    await expect(boot({ audit: {} }, {})).rejects.toThrow(/audit: add ADMIN_AUDIT_ENTITIES to the entities of the DataSource "default"/);
    await expect(boot({ audit: { dataSource: 'nowhere' } }, {})).rejects.toThrow(/audit: no TypeORM DataSource "nowhere"/);
    await expect(boot({ audit: { retentionDays: 0 } })).rejects.toThrow(/audit\.retentionDays must be a positive whole number of days/);
  });

  test('`sensitive` must be true or false', async () => {
    @Entity('au_bad')
    class Bad {
      @PrimaryGeneratedColumn() id: number;
      @Column({ length: 10 }) code: string;
    }
    @AdminResource(Bad)
    class BadAdmin extends AdminResourceBase<Bad> {
      fields = { code: { sensitive: 'yes' as unknown as boolean } };
    }
    @Module({ providers: [BadAdmin] })
    class BadModule {}
    await expect(createTestApp({ imports: [BadModule], entities: [Bad] })).rejects.toThrow(/fields\.code\.sensitive: must be true or false/);
  });

  test('`sensitive` inside a group is refused at boot: it would protect nothing there', async () => {
    class CardDto {
      @AdminField({ sensitive: true }) @IsString() number: string;
    }
    class PayDto {
      @ValidateNested() @Type(() => CardDto) card: CardDto;
    }
    @Entity('au_pay')
    class Pay {
      @PrimaryGeneratedColumn() id: number;
      @Column({ length: 10 }) code: string;
    }
    @AdminResource(Pay)
    class PayAdmin extends AdminResourceBase<Pay> {
      @AdminAction({ input: PayDto })
      async charge(): Promise<void> {}
    }
    @Module({ providers: [PayAdmin] })
    class PayModule {}
    await expect(createTestApp({ imports: [PayModule], entities: [Pay] })).rejects.toThrow(/fields\.card: `sensitive` on CardDto\.number is inside a group.*move the field to the top level/);

    class Vault {
      @AdminField({ sensitive: true }) @Column({ type: 'varchar', length: 20, nullable: true }) combination: string | null;
    }
    @Entity('au_bank')
    class Bank {
      @PrimaryGeneratedColumn() id: number;
      @Column(() => Vault) vault: Vault;
    }
    @AdminResource(Bank)
    class BankAdmin extends AdminResourceBase<Bank> {}
    @Module({ providers: [BankAdmin] })
    class BankModule {}
    await expect(createTestApp({ imports: [BankModule], entities: [Bank] })).rejects.toThrow(/fields\.vault: `sensitive` on Vault\.combination is inside a group/);
  });

  test('a `password` widget or a `secret` inside a group is refused at boot too: in an action input, a resource and a settings page', async () => {
    class LoginDto {
      @IsString() user: string;
      @AdminField({ widget: 'password' }) @IsString() pass: string;
    }
    class TokenDto {
      @AdminField({ secret: true }) @IsString() token: string;
    }
    class ConnectDto {
      @ValidateNested() @Type(() => LoginDto) login: LoginDto;
    }
    class LinkDto {
      @ValidateNested() @Type(() => TokenDto) link: TokenDto;
    }
    @Entity('au_host')
    class Host {
      @PrimaryGeneratedColumn() id: number;
      @Column({ length: 10 }) code: string;
      @Column({ type: 'simple-json', nullable: true }) login: object | null;
    }
    const bootWith = (provider: Function, entities: Function[] = [Host]) => {
      @Module({ providers: [provider as NestType] })
      class OneModule {}
      return createTestApp({ imports: [OneModule], entities });
    };
    const password = /fields\.login: `widget: 'password'` on LoginDto\.pass is inside a group.*move the field to the top level of the form/;

    // An action's input.
    @AdminResource(Host)
    class ActionHost extends AdminResourceBase<Host> {
      @AdminAction({ input: ConnectDto })
      async connect(): Promise<void> {}
    }
    await expect(bootWith(ActionHost)).rejects.toThrow(password);
    @AdminResource(Host)
    class SecretActionHost extends AdminResourceBase<Host> {
      @AdminAction({ input: LinkDto })
      async link(): Promise<void> {}
    }
    await expect(bootWith(SecretActionHost)).rejects.toThrow(/fields\.link: `secret` on TokenDto\.token is inside a group/);

    // A resource: a nested DTO of its form, and an embedded entity.
    class HostDto {
      @IsString() code: string;
      @IsOptional() @ValidateNested() @Type(() => LoginDto) login?: LoginDto;
    }
    @AdminResource(Host)
    class DtoHost extends AdminResourceBase<Host> {
      form = { create: HostDto };
    }
    await expect(bootWith(DtoHost)).rejects.toThrow(password);
    class Door {
      @AdminField({ widget: 'password' }) @Column({ type: 'varchar', length: 20, nullable: true }) code: string | null;
    }
    @Entity('au_gate')
    class Gate {
      @PrimaryGeneratedColumn() id: number;
      @Column(() => Door) door: Door;
    }
    @AdminResource(Gate)
    class GateAdmin extends AdminResourceBase<Gate> {}
    await expect(bootWith(GateAdmin, [Gate])).rejects.toThrow(/fields\.door: `widget: 'password'` on Door\.code is inside a group/);

    // A settings page.
    @AdminSettingsPage('connection', { form: ConnectDto })
    class ConnectionPage implements AdminSettingsSource<ConnectDto> {
      load() {
        return {};
      }
      save() {}
    }
    await expect(bootWith(ConnectionPage, [])).rejects.toThrow(password);
    class GuardDto {
      @ValidateNested() @Type(() => CardLikeDto) card: CardLikeDto;
    }
    @AdminSettingsPage('guard', { form: GuardDto })
    class GuardPage implements AdminSettingsSource<GuardDto> {
      load() {
        return {};
      }
      save() {}
    }
    await expect(bootWith(GuardPage, [])).rejects.toThrow(/fields\.card: `sensitive` on CardLikeDto\.number is inside a group/);
  }, 60_000);

  test('the audit table on another DataSource: written after the commit, never for a rollback', async () => {
    const t = await boot({ audit: { dataSource: 'audit' } }, { dataSources: { audit: [...ADMIN_AUDIT_ENTITIES] } });
    try {
      const main = t.app.get<DataSource>(getDataSourceToken() as string, { strict: false });
      expect(main.hasMetadata(NmaAuditEntry)).toBe(false);
      const created = await t.http().post('/resources/product', { name: 'Far', price: '10.00', stock: 1 });
      expect(created.status).toBe(201);
      const id = created.body._id as string;
      expect((await t.http().patch(`/resources/product/${id}`, { price: '12.00' })).status).toBe(200);
      const entries = await t.fresh();
      expect(entries.map((entry) => entry.event)).toEqual(['product.created', 'product.updated']);
      expect(change(entries[1]!, 'total')).toEqual({ field: 'total', before: '0.00', after: '12.00' });
      // A rollback: the commit hook never runs.
      expect((await t.http().patch(`/resources/product/${id}`, { name: 'EXPLODE' })).status).toBe(400);
      expect(await t.fresh()).toEqual([]);
      // Roles live on the default DataSource, the audit log does not: the entry follows the commit.
      expect((await t.http().post('/rbac/roles', { name: 'packer', permissions: ['product.view'] })).status).toBe(201);
      expect((await t.http().patch('/pages/shop', { shopName: 'Far shop' })).status).toBe(200);
      expect((await t.fresh()).map((entry) => entry.event)).toEqual(['rbac.role.changed', 'page.shop.updated']);

      // The change committed and its entry cannot be written: the write stands, and the failure is logged with the correlation id.
      const warned = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const spy = spyOn(t.app.get(AdminAudit) as unknown as { insert: () => Promise<void> }, 'insert').mockRejectedValue(new Error('the audit database is down'));
      try {
        expect((await t.http().patch(`/resources/product/${id}`, { price: '13.00' })).status).toBe(200);
        const lines = warned.mock.calls.flat().join('\n');
        expect(lines).toContain('product.updated');
        expect(lines).toContain(host.correlationId!);
        expect(lines).toContain('the audit database is down');
      } finally {
        spy.mockRestore();
        warned.mockRestore();
      }
      expect((await t.http().get(`/resources/product/${id}`)).body.price).toBe('13.00');
      expect(await t.fresh()).toEqual([]);

      // Sensitive values on this path too: a sensitive field, an action's input, a page's secret, a sign-in.
      expect((await t.http().patch(`/resources/product/${id}`, { pin: PIN })).status).toBe(200);
      expect((await t.http().post('/resources/product/actions/discount', { ids: [id], input: { percent: 10, approvalCode: APPROVAL, managerPassword: 'manager-SENTINEL' } })).status).toBe(200);
      expect((await t.http().patch('/pages/shop', { apiKey: API_KEY, doorCode: 'door-SENTINEL-2', smtpPassword: 'smtp-SENTINEL-2' })).status).toBe(200);
      expect((await request(t.app.getHttpServer()).post('/admin/api/session').send({ username: 'ada', password: WRONG_PASSWORD, otp: OTP })).status).toBe(401);
      expect((await t.fresh()).map((entry) => entry.event)).toEqual(['product.updated', 'product.action.discount', 'page.shop.updated', 'auth.login_failed']);
      const all = JSON.stringify(await t.auditDb.getRepository(NmaAuditEntry).find());
      for (const secret of SENTINELS) expect(all).not.toContain(secret);
    } finally {
      await t.app.close();
    }
  });

  test('transactions: false — the entry is written once the host method has returned, and never for a failure', async () => {
    const t = await boot({ audit: {}, transactions: false, roles: [] }, { entities: [...ADMIN_AUDIT_ENTITIES], module: LooseModule });
    try {
      const created = await t.http().post('/resources/product', { name: 'Loose', price: '10.00', stock: 2 });
      expect(created.status).toBe(201);
      const id = created.body._id as string;
      expect((await t.http().patch(`/resources/product/${id}`, { price: '11.00' })).status).toBe(200);
      const entries = await t.fresh();
      expect(entries.map((entry) => entry.event)).toEqual(['product.created', 'product.updated']);
      expect(change(entries[1]!, 'total')).toEqual({ field: 'total', before: '0.00', after: '22.00' });
      // Nothing undoes what the host wrote before it threw; the failed write is still not an entry.
      expect((await t.http().patch(`/resources/product/${id}`, { name: 'EXPLODE' })).status).toBe(400);
      expect((await t.http().get(`/resources/product/${id}`)).body.name).toBe('EXPLODE');
      expect(await t.fresh()).toEqual([]);
      expect((await t.http().delete(`/resources/product/${id}`)).status).toBe(204);
      expect((await t.fresh()).map((entry) => entry.event)).toEqual(['product.deleted']);
    } finally {
      await t.app.close();
    }
  });

  test('a same-DataSource entry that cannot be written fails the write with it', async () => {
    const t = await boot();
    const logged = spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const id = await t.product({ name: 'Bound', price: '1.00' });
      const spy = spyOn(t.app.get(AdminAudit) as unknown as { insert: () => Promise<void> }, 'insert').mockRejectedValue(new Error('the audit table is gone'));
      try {
        expect((await t.http().patch(`/resources/product/${id}`, { price: '2.00' })).status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      // An entry exists if and only if its change committed: no entry, so no change.
      expect((await t.http().get(`/resources/product/${id}`)).body.price).toBe('1.00');
      expect(await t.fresh()).toEqual([]);
    } finally {
      logged.mockRestore();
      await t.app.close();
    }
  });
});
