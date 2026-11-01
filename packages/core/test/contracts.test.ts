import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { IsInt, IsString, Min } from 'class-validator';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, PrimaryGeneratedColumn, type DataSource, type SelectQueryBuilder } from 'typeorm';
import {
  AdminAction,
  AdminAuth,
  AdminCan,
  AdminPrint,
  AdminResource,
  AdminResourceBase,
  AdminScope,
  AdminSource,
  AdminSourceBase,
  AdminWidget,
  BeforeSave,
  html,
  type AdminAuthAdapter,
  type AdminContext,
  type AdminPrincipal,
  type AdminUser,
  type AdminWidgetSource,
  type ListParams,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

/**
 * Host code that breaks a contract fails loudly (spec: «fail loudly»): each case below was accepted and silently
 * misread before 0.9.0. The decorators' types refuse most of them at compile time too; `loose` casts them past the
 * types, as plain JavaScript or an `any` would.
 */
const loose = <T>(value: T): any => value;

@Entity('ct_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40 }) title: string;
  @Column({ length: 10, default: 'root' }) ownerId: string;
}

@AdminResource(Note, { name: 'async-scope', title: 'title' })
class AsyncScopeAdmin extends AdminResourceBase<Note> {
  @loose(AdminScope('own')) async own(ctx: AdminContext) {
    return { ownerId: ctx.user?.id };
  }
}

@AdminResource(Note, { name: 'async-can', title: 'title' })
class AsyncCanAdmin extends AdminResourceBase<Note> {
  @loose(AdminCan('update')) async canEdit() {
    return true;
  }
}

@AdminResource(Note, { name: 'label-for', title: 'title' })
class LabelForAdmin extends AdminResourceBase<Note> {
  @loose(AdminAction({ label: { static: 'Ship', for: loose(async () => 'Ship') } })) async ship() {}
}

@AdminResource(Note, { name: 'readonly-if', title: 'title' })
class ReadonlyIfAdmin extends AdminResourceBase<Note> {
  fields = { title: { readonlyIf: loose(async () => true) } };
}

@AdminResource(Note, { name: 'outcome', title: 'title' })
class OutcomeAdmin extends AdminResourceBase<Note> {
  @AdminAction() async fine() {
    return { message: 'Done' };
  }
  @AdminAction() async silent() {}
  @loose(AdminAction()) async typo(note: Note, _input: unknown, ctx: AdminContext) {
    await ctx.manager!.getRepository(Note).update(note.id, { title: 'renamed' });
    return { mesage: 'Done' };
  }
  @loose(AdminAction()) async record(note: Note) {
    return note;
  }
  @loose(AdminAction()) async text() {
    return 'Done';
  }
}

@AdminResource(Note, { name: 'printing', title: 'title' })
class PrintingAdmin extends AdminResourceBase<Note> {
  @loose(AdminPrint()) plain(notes: Note[]) {
    return `<b>${notes[0]!.title}</b>`;
  }
  @AdminPrint() escaped(notes: Note[]) {
    return html`<b>${notes[0]!.title}</b>`;
  }
}

@AdminResource(Note, { name: 'computing', title: 'title' })
class ComputingAdmin extends AdminResourceBase<Note> {
  list = { columns: ['title', 'bad'], computed: { bad: { label: 'Bad', kind: 'count' as const, source: { compute: loose(async () => [1, 2]), fields: ['title'] } } } };
}

@AdminResource(Note, { name: 'toning', title: 'title' })
class ToningAdmin extends AdminResourceBase<Note> {
  list = { columns: ['title', 'badge'], computed: { badge: { label: 'Badge', kind: 'badge' as const, source: 'title', map: loose(() => ({ label: 'x', tone: 'purple' })) } } };
}

@AdminResource(Note, { name: 'hooking', title: 'title' })
class HookingAdmin extends AdminResourceBase<Note> {
  @loose(BeforeSave()) stamp(dto: Partial<Note>) {
    return { ...dto, title: 'changed' };
  }
}

@AdminResource(Note, { name: 'querying', title: 'title' })
class QueryingAdmin extends AdminResourceBase<Note> {
  override query(qb: SelectQueryBuilder<Note>) {
    return loose(Promise.resolve(qb));
  }
}

@AdminResource(Note, { name: 'tabbing', title: 'title' })
class TabbingAdmin extends AdminResourceBase<Note> {
  list = { tabs: [{ key: 'mine', label: 'Mine', where: loose(async (qb: SelectQueryBuilder<Note>) => qb.andWhere(`${qb.alias}.ownerId = 'scoped'`)) }] };
}

@AdminResource(Note, { name: 'linking', title: 'title' })
class LinkingAdmin extends AdminResourceBase<Note> {
  override links() {
    return loose({ label: 'Site', href: 'https://example.com' });
  }
}

@AdminResource(Note, { name: 'creating', title: 'title' })
class CreatingAdmin extends AdminResourceBase<Note> {
  override async create() {
    return loose('saved');
  }
}

@AdminResource(Note, { name: 'finding', title: 'title' })
class FindingAdmin extends AdminResourceBase<Note> {
  override async findOne() {
    return loose([]);
  }
}

class NoteRow {
  @IsString() id: string;
  @IsString() title: string;
}

@AdminSource(NoteRow, { name: 'array-source', title: 'title' })
class ArraySourceAdmin extends AdminSourceBase<NoteRow, string> {
  async findMany() {
    return loose([{ id: '1', title: 'one' }]);
  }
  async findOne() {
    return null;
  }
}

@AdminWidget('wrong', { type: 'stat', title: 'Wrong' })
class WrongWidget implements AdminWidgetSource {
  async load() {
    return loose({ value: 12 });
  }
}

const users: Record<string, AdminUser> = { root: { id: 'root', displayName: 'Root', isSuperuser: true }, scoped: { id: 'scoped', displayName: 'Scoped', isSuperuser: false } };
@Injectable()
class HeaderAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users[String(req.headers['x-user'] ?? '')];
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return user.id === 'scoped' ? ['scoped'] : [];
  }
  async getUser(id: string) {
    return users[id] ?? null;
  }
}

@Module({ providers: [HeaderAuth, AsyncScopeAdmin, AsyncCanAdmin, LabelForAdmin, ReadonlyIfAdmin, OutcomeAdmin, PrintingAdmin, ComputingAdmin, ToningAdmin, ArraySourceAdmin, WrongWidget, HookingAdmin, QueryingAdmin, TabbingAdmin, LinkingAdmin, CreatingAdmin, FindingAdmin] })
class ContractsModule {}

let app: INestApplication;
let noteId: number;
const get = (user: string, path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user);
const post = (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', 'root').send(body);
const PERIOD = 'period=week&from=2026-10-24T00:00:00.000Z&to=2026-10-31T00:00:00.000Z&previousFrom=2026-10-17T00:00:00.000Z&previousTo=2026-10-24T00:00:00.000Z';

beforeAll(async () => {
  app = await createTestApp({
    imports: [ContractsModule],
    entities: [Note],
    admin: { auth: AdminAuth.custom(HeaderAuth), roles: [{ name: 'scoped', permissions: ['async-scope.view'], scopes: { 'async-scope': { view: 'own' } } }] },
  });
  const repo = app.get<DataSource>(getDataSourceToken()).getRepository(Note);
  noteId = (await repo.save({ title: 'mine', ownerId: 'scoped' })).id;
  await repo.save({ title: 'theirs', ownerId: 'other' });
});
afterAll(async () => {
  await app?.close();
});

describe(`host contracts at runtime (${TEST_DB})`, () => {
  test('an async scope is refused, never read as «no restriction»', async () => {
    const res = await get('scoped', '/resources/async-scope');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('theirs');
  });

  test('an async @AdminCan rule, an async label.for and an async readonlyIf fail the request', async () => {
    expect((await get('root', `/resources/async-can/${noteId}`)).status).toBe(500);
    expect((await get('root', `/resources/label-for/${noteId}`)).status).toBe(500);
    expect((await get('root', `/resources/readonly-if/${noteId}`)).status).toBe(500);
  });

  test('an action returns nothing or { message }; anything else fails and its writes are rolled back', async () => {
    const run = (name: string) => post(`/resources/outcome/actions/${name}`, { ids: [String(noteId)], input: {} });
    expect((await run('fine')).body.message).toBe('Done');
    expect((await run('silent')).status).toBe(200);
    expect((await run('typo')).status).toBe(500);
    expect((await app.get<DataSource>(getDataSourceToken()).getRepository(Note).findOneBy({ id: noteId }))!.title).toBe('mine');
    expect((await run('record')).status).toBe(500);
    expect((await run('text')).status).toBe(500);
  });

  test('a print template must return html`…`: a plain string is refused', async () => {
    expect((await get('root', `/resources/printing/print/plain?id=${noteId}`)).status).toBe(500);
    const good = await get('root', `/resources/printing/print/escaped?id=${noteId}`);
    expect(good.status).toBe(200);
    expect(good.text).toContain('<b>mine</b>');
  });

  test('compute() must answer an object by id; map() must give a known tone', async () => {
    expect((await get('root', '/resources/computing')).status).toBe(500);
    expect((await get('root', '/resources/toning')).status).toBe(500);
  });

  test('findMany() must answer { items, total }', async () => {
    expect((await get('root', '/resources/array-source')).status).toBe(500);
  });

  test('a hook returns nothing: a hook that returns a value fails the save, and nothing is saved', async () => {
    const repo = app.get<DataSource>(getDataSourceToken()).getRepository(Note);
    const before = await repo.count();
    expect((await post('/resources/hooking', { title: 'new' })).status).toBe(500);
    expect(await repo.count()).toBe(before);
  });

  test('query() and a tab’s where() work at once: an async one fails the list', async () => {
    expect((await get('root', '/resources/querying')).status).toBe(500);
    expect((await get('root', '/resources/tabbing?tab=mine')).status).toBe(500);
  });

  test('links() returns an array; create() the record or nothing; findOne() a record or null', async () => {
    expect((await get('root', `/resources/linking/${noteId}`)).status).toBe(500);
    expect((await post('/resources/creating', { title: 'new' })).status).toBe(500);
    expect((await get('root', `/resources/finding/${noteId}`)).status).toBe(500);
  });

  test("a widget's data must fit its type", async () => {
    expect((await get('root', `/dashboard/wrong?${PERIOD}`)).status).toBe(500);
  });
});

class ShipDto {
  @IsInt() @Min(1) boxes: number;
}
class OtherDto {
  @IsString() note: string;
}

describe(`action parameters checked at boot (${TEST_DB})`, () => {
  const boot = async (resource: Function) => {
    @Module({ providers: [resource as never] })
    class BootModule {}
    const booted = await createTestApp({ imports: [BootModule], entities: [Note] });
    return booted;
  };

  test('`input` that is not the class of the input parameter fails at boot', async () => {
    @AdminResource(Note, { name: 'mismatch' })
    class MismatchAdmin extends AdminResourceBase<Note> {
      @loose(AdminAction({ input: OtherDto })) async ship(_note: Note, _input: ShipDto) {}
    }
    await expect(boot(MismatchAdmin)).rejects.toThrow("`input` is OtherDto but the method's input parameter is ShipDto");
  });

  test('a record parameter of another class fails at boot', async () => {
    @AdminResource(Note, { name: 'wrong-record' })
    class WrongRecordAdmin extends AdminResourceBase<Note> {
      @loose(AdminAction()) async ship(_record: OtherDto) {}
    }
    await expect(boot(WrongRecordAdmin)).rejects.toThrow("the method's first parameter is OtherDto, but the action runs on Note records");
  });

  test('parameter types that cannot be read (esbuild, Vite, tsx) fail at boot unless `input` says what the input is', async () => {
    const strip = (cls: Function, name: string) => Reflect.deleteMetadata('design:paramtypes', cls.prototype, name);
    @AdminResource(Note, { name: 'unread' })
    class UnreadAdmin extends AdminResourceBase<Note> {
      @AdminAction() async ship(_note: Note, _input: ShipDto) {}
    }
    strip(UnreadAdmin, 'ship');
    await expect(boot(UnreadAdmin)).rejects.toThrow('UnreadAdmin: @AdminAction "ship": the method takes an input parameter, but its type cannot be read');

    @AdminResource(Note, { name: 'unread-ok' })
    class UnreadOkAdmin extends AdminResourceBase<Note> {
      @AdminAction({ input: ShipDto }) async ship(_note: Note, _input: ShipDto) {}
      @AdminAction({ input: false }) async cancel(_note: Note, _input: unknown, _ctx: AdminContext) {}
      @AdminAction() async archive(_note: Note) {}
    }
    for (const name of ['ship', 'cancel', 'archive']) strip(UnreadOkAdmin, name);
    await (await boot(UnreadOkAdmin)).close();
  });

  test('`input: false` with a DTO parameter fails at boot', async () => {
    @AdminResource(Note, { name: 'no-input' })
    class NoInputAdmin extends AdminResourceBase<Note> {
      @AdminAction({ input: false }) async ship(_note: Note, _input: ShipDto) {}
    }
    await expect(boot(NoInputAdmin)).rejects.toThrow("`input: false`, but the method's input parameter is ShipDto");
  });

  test('without `input`, the input parameter’s class is the input form', async () => {
    @AdminResource(Note, { name: 'inferred' })
    class InferredAdmin extends AdminResourceBase<Note> {
      @AdminAction() async ship(_note: Note, _input: ShipDto) {}
      @AdminAction({ target: 'resource' }) async restock(_input: ShipDto) {}
    }
    const booted = await boot(InferredAdmin);
    try {
      const schema = (await request(booted.getHttpServer()).get('/admin/api/meta/resources/inferred')).body;
      const field = (name: string) => schema.actions.find((action: { name: string }) => action.name === name).input.fields.map((f: { name: string }) => f.name);
      expect(field('ship')).toEqual(['boxes']);
      expect(field('restock')).toEqual(['boxes']);
      const bad = await request(booted.getHttpServer()).post('/admin/api/resources/inferred/actions/restock').send({ input: { boxes: 0 } });
      expect(bad.status).toBe(422);
    } finally {
      await booted.close();
    }
  });
});

describe(`auth and roles answers (${TEST_DB})`, () => {
  const bootWith = async (adapter: AdminAuthAdapter, resolveRoles?: (user: AdminUser) => unknown) => {
    @Injectable()
    class Adapter implements AdminAuthAdapter {
      authenticate = adapter.authenticate;
      resolveRoles = adapter.resolveRoles;
    }
    @Module({ providers: [Adapter, AsyncScopeAdmin] })
    class AuthModule {}
    return createTestApp({ imports: [AuthModule], entities: [Note], admin: { auth: AdminAuth.custom(Adapter), ...(resolveRoles ? { resolveRoles: loose(resolveRoles) } : {}) } });
  };
  const scoped = users.scoped!;

  test('resolveRoles must answer an array of names: a string is an error, not its letters', async () => {
    const booted = await bootWith({ authenticate: async () => ({ user: scoped }) }, () => 'scoped');
    try {
      expect((await request(booted.getHttpServer()).get('/admin/api/resources/async-scope')).status).toBe(500);
    } finally {
      await booted.close();
    }
  });

  test('authenticate() must answer { user } or null', async () => {
    const booted = await bootWith({ authenticate: async () => loose(scoped) });
    try {
      expect((await request(booted.getHttpServer()).get('/admin/api/resources/async-scope')).status).toBe(500);
    } finally {
      await booted.close();
    }
  });
});
