import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Injectable, Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { IncomingMessage } from 'node:http';
import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import {
  ADMIN_AUDIT_ENTITIES,
  ADMIN_RBAC_ENTITIES,
  AdminAuth,
  AdminResource,
  AdminResourceBase,
  type AdminAuthAdapter,
  type AdminPrincipal,
  type AdminUserRecord,
  type FormConfig,
  type MetaResponse,
  type SearchResponse,
} from '../src/index.js';
import { ResourceRegistry } from '../src/registry/resource-registry.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

// Book has two inline children: Chapter (no `nav` option: inline-only) and Review (`nav: true`: stays in the sidebar).
// Note is no inline at all but sets `nav: false` itself.

@Entity('nav_book')
class Book {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) title: string;
}

@Entity('nav_chapter')
class Chapter {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) heading: string;
  @Column({ type: 'int' }) bookId: number;
  @ManyToOne(() => Book, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'bookId' }) book: Book;
}

@Entity('nav_review')
class Review {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) body: string;
  @Column({ type: 'int' }) bookId: number;
  @ManyToOne(() => Book, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'bookId' }) book: Book;
}

@Entity('nav_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) text: string;
}

@AdminResource(Chapter, { title: 'heading' })
class ChapterAdmin extends AdminResourceBase<Chapter> {}

@AdminResource(Review, { title: 'body', nav: true })
class ReviewAdmin extends AdminResourceBase<Review> {}

@AdminResource(Note, { title: 'text', nav: false })
class NoteAdmin extends AdminResourceBase<Note> {}

@AdminResource(Book, { title: 'title' })
class BookAdmin extends AdminResourceBase<Book> {
  override form: FormConfig = {
    layout: [{ fields: ['title'] }, { inline: ChapterAdmin, display: 'table' }, { inline: ReviewAdmin, display: 'table' }],
  };
}

const users = new Map<string, AdminUserRecord>([
  ['root', { id: 'root', displayName: 'Root', username: 'root', isSuperuser: true, isActive: true }],
  ['reader', { id: 'reader', displayName: 'Reader', username: 'reader', isSuperuser: false, isActive: true }],
]);

@Injectable()
class TestAuth implements AdminAuthAdapter {
  async authenticate(req: IncomingMessage): Promise<AdminPrincipal | null> {
    const user = users.get(String(req.headers['x-user'] ?? ''));
    return user ? { user } : null;
  }
  resolveRoles(user: { id: string | number }) {
    return user.id === 'reader' ? ['reader'] : [];
  }
  async getUser(id: string) {
    return users.get(id) ?? null;
  }
}

@Module({ providers: [TestAuth, BookAdmin, ChapterAdmin, ReviewAdmin, NoteAdmin] })
class NavModule {}

let app: INestApplication;
const api = (user: string) => ({
  get: (path: string) => request(app.getHttpServer()).get(`/admin/api${path}`).set('X-User', user),
  post: (path: string, body: object) => request(app.getHttpServer()).post(`/admin/api${path}`).set('X-User', user).send(body),
});
let chapterId: string;

beforeAll(async () => {
  app = await createTestApp({
    imports: [NavModule],
    entities: [Book, Chapter, Review, Note, ...ADMIN_RBAC_ENTITIES, ...ADMIN_AUDIT_ENTITIES],
    admin: {
      auth: AdminAuth.custom(TestAuth),
      rbac: {},
      audit: {},
      roles: [{ name: 'reader', permissions: ['audit.view', 'book.view', 'chapter.view', 'review.view', 'note.view'] }],
    },
  });
  const book = await api('root').post('/resources/book', { title: 'Dune' });
  expect(book.status).toBe(201);
  const chapter = await api('root').post('/resources/chapter', { heading: 'Findnav chapter', bookId: book.body.id });
  expect(chapter.status).toBe(201);
  chapterId = chapter.body._id;
  expect((await api('root').post('/resources/review', { body: 'Findnav review', bookId: book.body.id })).status).toBe(201);
  expect((await api('root').post('/resources/note', { text: 'Findnav note' })).status).toBe(201);
});
afterAll(async () => {
  await app.close();
});

describe(`inline-only resources (${TEST_DB})`, () => {
  test('an inline child without `nav` is inline-only; `nav: true` keeps it; `nav: false` works on any resource', () => {
    const registry = app.get(ResourceRegistry);
    expect(registry.get('chapter').nav).toBe(false);
    expect(registry.get('review').nav).toBe(true);
    expect(registry.get('note').nav).toBe(false);
    expect(registry.get('book').nav).toBe(true);
  });

  test('meta leaves nav: false resources out of the groups (and so out of home counts)', async () => {
    const meta = (await api('reader').get('/meta')).body as MetaResponse;
    const names = meta.groups.flatMap((group) => group.resources.map((resource) => resource.name));
    expect(names).toContain('book');
    expect(names).toContain('review');
    expect(names).not.toContain('chapter');
    expect(names).not.toContain('note');
  });

  test('global search finds no records of them', async () => {
    const found = (await api('reader').get('/search?q=Findnav')).body as SearchResponse;
    expect(found.groups.map((group) => group.resource).sort()).toEqual(['review']);
  });

  test('their records, history and audit entries stay reachable for whoever may read them', async () => {
    const record = await api('reader').get(`/resources/chapter/${chapterId}`);
    expect(record.status).toBe(200);
    expect(record.body.heading).toBe('Findnav chapter');
    const history = await api('reader').get(`/resources/chapter/${chapterId}/history`);
    expect(history.status).toBe(200);
    expect(history.body.entries.length).toBeGreaterThan(0);
    const audit = await api('reader').get('/audit?resource=chapter');
    expect(audit.status).toBe(200);
    expect(audit.body.entries.length).toBeGreaterThan(0);
  });

  test('the role editor still lists them', async () => {
    const catalog = await api('root').get('/rbac/catalog');
    expect(catalog.status).toBe(200);
    const names = (catalog.body.resources as Array<{ name: string }>).map((resource) => resource.name);
    expect(names).toEqual(expect.arrayContaining(['chapter', 'note', 'review', 'book']));
  });
});
