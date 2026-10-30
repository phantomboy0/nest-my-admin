import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { Logger, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AdminCan, AdminResource, AdminResourceBase, type FormConfig } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('icr_shelf')
class Shelf {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ default: false }) locked: boolean;
}

@Entity('icr_book')
class Book {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column({ type: 'int' }) shelfId: number;
  @ManyToOne(() => Shelf, { onDelete: 'CASCADE' }) shelf: Shelf;
}

@Entity('icr_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column() text: string;
  @Column({ type: 'int' }) shelfId: number;
  @ManyToOne(() => Shelf, { onDelete: 'CASCADE' }) shelf: Shelf;
}

/** No book is added to a locked shelf; a shelf named "boom" breaks the rule. */
@AdminResource(Book)
class BookAdmin extends AdminResourceBase<Book> {
  @AdminCan('create') open(shelf: Shelf) {
    if (shelf.name === 'boom') throw new Error('broken rule');
    return !shelf.locked;
  }
}

/** A child without a create rule. */
@AdminResource(Note)
class NoteAdmin extends AdminResourceBase<Note> {}

@AdminResource(Shelf)
class ShelfAdmin extends AdminResourceBase<Shelf> {
  override form: FormConfig = {
    layout: [
      { fields: ['name', 'locked'] },
      { inline: BookAdmin, display: 'table', fields: ['title'] },
      { inline: NoteAdmin, display: 'table', fields: ['text'] },
    ],
  };
}

@Module({ providers: [ShelfAdmin, BookAdmin, NoteAdmin] })
class ShelvesModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());
const shelves = '/admin/api/resources/shelf';
const books = async () => (await http().get('/admin/api/resources/book')).body.total as number;
const shelf = async (name: string, locked: boolean) => (await http().post(shelves).send({ name, locked })).body as { _id: string; id: number };

beforeAll(async () => {
  app = await createTestApp({ imports: [ShelvesModule], entities: [Shelf, Book, Note] });
});
afterAll(async () => {
  await app.close();
});

describe(`@AdminCan('create') on an inline child (${TEST_DB})`, () => {
  test('refuses an inline create under a locked parent', async () => {
    const locked = await shelf('Locked', true);
    const before = await books();
    const res = await http().patch(`${shelves}/${locked._id}`).send({ _inlines: { book: { create: [{ _key: 'n1', title: 'Nope' }] } } });
    expect(res.status).toBe(403);
    expect(await books()).toBe(before);
  });

  test('allows it under an open parent', async () => {
    const open = await shelf('Open', false);
    const res = await http().patch(`${shelves}/${open._id}`).send({ _inlines: { book: { create: [{ _key: 'n1', title: 'Yes' }] } } });
    expect(res.status).toBe(200);
  });

  test('the rule sees a parent created in the same request', async () => {
    const before = await books();
    const refused = await http().post(shelves).send({ name: 'New locked', locked: true, _inlines: { book: { create: [{ _key: 'n1', title: 'Nope' }] } } });
    expect(refused.status).toBe(403);
    expect(await books()).toBe(before);
    const created = await http().post(shelves).send({ name: 'New open', locked: false, _inlines: { book: { create: [{ _key: 'n1', title: 'Yes' }] } } });
    expect(created.status).toBe(201);
    expect(await books()).toBe(before + 1);
  });

  test('refuses a direct POST that names a locked parent', async () => {
    const locked = await shelf('Locked direct', true);
    expect((await http().post('/admin/api/resources/book').send({ title: 'Sneaky', shelfId: locked.id })).status).toBe(403);
    const open = await shelf('Open direct', false);
    expect((await http().post('/admin/api/resources/book').send({ title: 'Fine', shelfId: open.id })).status).toBe(201);
  });

  test('a direct POST without the link value is not judged by the rule', async () => {
    const res = await http().post('/admin/api/resources/book').send({ title: 'Lost' });
    expect(res.status).toBe(422);
  });

  test('_perm.inlines on the parent', async () => {
    const locked = await shelf('Perm locked', true);
    const read = (await http().get(`${shelves}/${locked._id}`)).body;
    expect(read._perm.inlines).toEqual({ book: { create: false } });
    const open = await shelf('Perm open', false);
    expect((await http().get(`${shelves}/${open._id}`)).body._perm.inlines).toEqual({ book: { create: true } });
    const note = (await http().get('/admin/api/resources/note')).body;
    expect(note.items.every((row: { _perm?: { inlines?: unknown } }) => row._perm?.inlines === undefined)).toBe(true);
  });

  test('a throwing rule says no', async () => {
    const warn = spyOn(Logger.prototype, 'warn');
    try {
      const boom = await shelf('boom', false);
      const res = await http().patch(`${shelves}/${boom._id}`).send({ _inlines: { book: { create: [{ _key: 'n1', title: 'X' }] } } });
      expect(res.status).toBe(403);
      expect(warn.mock.calls.filter(([message]: unknown[]) => String(message).includes('@AdminCan("create")'))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  test('declared on a resource that is no inline child fails boot', async () => {
    @AdminResource(Shelf, { name: 'lonely-shelf' })
    class LonelyAdmin extends AdminResourceBase<Shelf> {
      @AdminCan('create') never() {
        return false;
      }
    }
    @Module({ providers: [LonelyAdmin] })
    class LonelyModule {}
    await expect(createTestApp({ imports: [LonelyModule], entities: [Shelf] })).rejects.toThrow("LonelyAdmin: @AdminCan('create') needs LonelyAdmin to be an inline child (no form.layout names it)");
  });
});
