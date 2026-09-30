import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, type ListConfig } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('ps_shelf')
class Shelf {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
}

@Entity('ps_book')
class Book {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) title: string;
  @Column({ type: 'int', default: 0 }) pages: number;
  @Column({ type: 'date', nullable: true }) printedOn: string | null;
  @Column({ type: 'int', nullable: true }) shelfId: number | null;
  @ManyToOne(() => Shelf, { nullable: true }) @JoinColumn({ name: 'shelfId' }) shelf: Shelf | null;
}

@AdminResource(Shelf)
class ShelfAdmin extends AdminResourceBase<Shelf> {}

@AdminResource(Book)
class BookAdmin extends AdminResourceBase<Book> {
  list: ListConfig<Book> = {
    columns: ['id', 'title', 'pages'],
    search: ['title', 'shelf.name'],
    filters: ['title', 'pages', 'printedOn', 'shelfId'],
    mobile: { title: 'title', subtitle: 'shelf.name', meta: ['pages'] },
  };
}

@Module({ providers: [ShelfAdmin, BookAdmin] })
class LibraryModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());
const titles = async (query: string) => ((await http().get(`/admin/api/resources/book?${query}`)).body.items as Array<{ title: string }>).map((item) => item.title).sort();

beforeAll(async () => {
  app = await createTestApp({ imports: [LibraryModule], entities: [Shelf, Book] });
  const shelf = (await http().post('/admin/api/resources/shelf').send({ name: 'قفسه‌ی يك' })).body; // Arabic yeh and kaf
  for (const book of [
    { title: 'كتاب درسي', pages: 12, printedOn: '2024-03-20', shelfId: shelf.id }, // Arabic kaf and yeh
    { title: 'کتاب داستان', pages: 120 }, // Persian letters
    { title: 'می‌شود ۱۲ بار', pages: 5 }, // ZWNJ and Persian digits
    { title: 'Lamp 12', pages: 7 },
  ]) {
    expect((await http().post('/admin/api/resources/book').send(book)).status).toBe(201);
  }
});
afterAll(async () => {
  await app.close();
});

describe(`Persian search (${TEST_DB})`, () => {
  test('Persian letters find Arabic ones and the other way round (Review Focus 2)', async () => {
    expect(await titles(`search=${encodeURIComponent('کتاب')}`)).toEqual(['كتاب درسي', 'کتاب داستان'].sort());
    expect(await titles(`search=${encodeURIComponent('كتاب')}`)).toEqual(['كتاب درسي', 'کتاب داستان'].sort());
    expect(await titles(`search=${encodeURIComponent('درسی')}`)).toEqual(['كتاب درسي']);
  });

  test('every digit set matches, and ZWNJ matches a space', async () => {
    expect(await titles('search=12')).toEqual(['Lamp 12', 'می‌شود ۱۲ بار'].sort());
    expect(await titles(`search=${encodeURIComponent('۱۲')}`)).toEqual(['Lamp 12', 'می‌شود ۱۲ بار'].sort());
    expect(await titles(`search=${encodeURIComponent('می شود')}`)).toEqual(['می‌شود ۱۲ بار']);
  });

  test('paths and contains/startsWith filters normalize too', async () => {
    expect(await titles(`search=${encodeURIComponent('قفسه‌ی یک')}`)).toEqual(['كتاب درسي']);
    expect(await titles(`filter[title][startsWith]=${encodeURIComponent('کتاب')}`)).toEqual(['كتاب درسي', 'کتاب داستان'].sort());
    expect(await titles(`filter[title][contains]=${encodeURIComponent('داستان')}`)).toEqual(['کتاب داستان']);
  });

  test('numbers and dates accept Persian and Arabic-Indic digits', async () => {
    expect(await titles(`filter[pages][gte]=${encodeURIComponent('۱۰۰')}`)).toEqual(['کتاب داستان']);
    expect(await titles(`filter[printedOn][eq]=${encodeURIComponent('٢٠٢٤-٠٣-٢٠')}`)).toEqual(['كتاب درسي']);
  });

  test('relation options search normalizes', async () => {
    const res = await http().get(`/admin/api/resources/book/fields/shelfId/options?search=${encodeURIComponent('یک')}`);
    expect(res.body.items.map((item: { title: string }) => item.title)).toEqual(['قفسه‌ی يك']);
  });

  test('list.mobile paths are loaded with the list and described in the schema', async () => {
    const schema = (await http().get('/admin/api/meta/resources/book')).body;
    expect(schema.list.mobile).toEqual({ title: 'title', subtitle: 'shelf.name', meta: ['pages'] });
    const list = (await http().get(`/admin/api/resources/book?search=${encodeURIComponent('درسی')}`)).body;
    expect(list.items[0]['shelf.name']).toBe('قفسه‌ی يك');
  });

  test('an unknown list.mobile field is a boot error', async () => {
    @AdminResource(Book, { name: 'bad-book' })
    class BadAdmin extends AdminResourceBase<Book> {
      list: ListConfig<Book> = { mobile: { badge: 'titel' as 'title' } };
    }
    @Module({ providers: [BadAdmin] })
    class BadModule {}
    await expect(createTestApp({ imports: [BadModule], entities: [Shelf, Book] })).rejects.toThrow('list.mobile.badge');
  });
});
