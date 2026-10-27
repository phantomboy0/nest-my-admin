import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IsInt } from 'class-validator';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AdminAction, AdminField, AdminResource, AdminResourceBase, type AdminContext, type ResourceSchema } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('ap_shelf')
class Shelf {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 40 }) name: string;
}

@Entity('ap_book')
class Book {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'varchar', length: 40 }) title: string;
  @Column({ type: 'int', nullable: true }) shelfId: number | null;
  @ManyToOne(() => Shelf, { nullable: true }) @JoinColumn({ name: 'shelfId' }) shelf: Shelf | null;
}

class MoveDto {
  @AdminField({ pickFrom: 'shelfId', label: 'Shelf' }) @IsInt() shelfId: number;
}

@AdminResource(Shelf, { title: 'name' })
class ShelfAdmin extends AdminResourceBase<Shelf> {}

@AdminResource(Book, { title: 'title' })
class BookAdmin extends AdminResourceBase<Book> {
  @AdminAction({ bulk: true, input: MoveDto })
  async move(book: Book, input: MoveDto, ctx: AdminContext) {
    await ctx.manager!.getRepository(Book).update(book.id, { shelfId: input.shelfId });
  }
}

@Module({ providers: [ShelfAdmin, BookAdmin] })
class BooksModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp({ imports: [BooksModule], entities: [Shelf, Book] });
});
afterAll(async () => {
  await app?.close();
});

describe(`action inputs picked like a relation field (${TEST_DB})`, () => {
  test('the input is a relation field that names the options endpoint; the run gets the id', async () => {
    const schema = (await http().get('/admin/api/meta/resources/book')).body as ResourceSchema;
    const field = schema.actions.find((action) => action.name === 'move')!.input!.fields.find((candidate) => candidate.name === 'shelfId')!;
    expect(field).toMatchObject({ type: 'relation', optionsField: 'shelfId', relation: { resource: 'shelf' } });
    const shelf = (await http().post('/admin/api/resources/shelf').send({ name: 'Poetry' })).body;
    expect((await http().get('/admin/api/resources/book/fields/shelfId/options?search=Poe')).body.items).toEqual([{ id: shelf.id, title: 'Poetry' }]);
    const book = (await http().post('/admin/api/resources/book').send({ title: 'Divan' })).body;
    expect((await http().post('/admin/api/resources/book/actions/move').send({ ids: [book._id], input: { shelfId: shelf.id } })).status).toBe(200);
    expect((await http().get(`/admin/api/resources/book/${book._id}`)).body.shelfId).toEqual({ id: shelf.id, title: 'Poetry' });
  });

  test('boot refuses pickFrom naming no relation field', async () => {
    class BadDto {
      @AdminField({ pickFrom: 'title' }) @IsInt() x: number;
    }
    @AdminResource(Book, { name: 'bad-book', title: 'title' })
    class BadAdmin extends AdminResourceBase<Book> {
      @AdminAction({ input: BadDto }) async go() {}
    }
    @Module({ providers: [BadAdmin] })
    class BadModule {}
    await expect(createTestApp({ imports: [BadModule], entities: [Shelf, Book] })).rejects.toThrow(/pickFrom "title" is not a relation field of bad-book/);
  });
});
