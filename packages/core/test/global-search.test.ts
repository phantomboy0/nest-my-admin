import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Column, Entity, PrimaryGeneratedColumn, type SelectQueryBuilder } from 'typeorm';
import { AdminResource, AdminResourceBase, type ListConfig } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('gs_note')
class Note {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) title: string;
  @Column({ default: false }) secret: boolean;
}

@Entity('gs_memo')
class Memo {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) subject: string;
}

@AdminResource(Note, { label: { en: 'Notes', fa: 'یادداشت‌ها' }, title: 'title' })
class NoteAdmin extends AdminResourceBase<Note> {
  /** Secret notes never leave the server: search must not find them either. */
  override query(qb: SelectQueryBuilder<Note>) {
    return qb.andWhere(`${qb.alias}.secret = :secret`, { secret: false });
  }
}

/** Not searchable: left out of global search. */
@AdminResource(Memo, { name: 'memo' })
class MemoAdmin extends AdminResourceBase<Memo> {
  list: ListConfig<Memo> = { search: [] };
}

/** Its search throws: left out, the others still answer. */
@AdminResource(Memo, { name: 'broken-memo' })
class BrokenMemoAdmin extends AdminResourceBase<Memo> {
  override async findMany(): Promise<never> {
    throw new Error('boom');
  }
}

@Module({ providers: [NoteAdmin, MemoAdmin, BrokenMemoAdmin] })
class NotesModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await createTestApp({ imports: [NotesModule], entities: [Note, Memo], admin: { locale: 'en', locales: ['en', 'fa'] } });
  for (let i = 1; i <= 7; i++) await http().post('/admin/api/resources/note').send({ title: `Meeting ${i}` });
  await http().post('/admin/api/resources/note').send({ title: 'Meeting secret', secret: true });
  await http().post('/admin/api/resources/memo').send({ subject: 'Meeting memo' });
});
afterAll(async () => {
  await app.close();
});

describe(`global search (${TEST_DB})`, () => {
  test('groups per searchable resource, limited, through query() (Review Focus 4)', async () => {
    const res = await http().get('/admin/api/search?q=meeting').set('Accept-Language', 'fa');
    expect(res.status).toBe(200);
    expect(res.body.groups.map((group: { resource: string }) => group.resource)).toEqual(['note']);
    const [notes] = res.body.groups;
    expect(notes).toMatchObject({ label: 'یادداشت‌ها', hasMore: true });
    expect(notes.items).toHaveLength(5);
    expect(notes.items[0]).toEqual({ _id: expect.any(String), _title: expect.stringMatching(/^Meeting \d$/) });

    const all = (await http().get('/admin/api/search?q=meeting&limit=20')).body.groups[0];
    expect(all.items).toHaveLength(7); // the secret note is not found
    expect(all.hasMore).toBe(false);
  });

  test('q and limit are checked', async () => {
    expect((await http().get('/admin/api/search?q=%20')).status).toBe(422);
    expect((await http().get('/admin/api/search?q=a&limit=0')).status).toBe(422);
    expect((await http().get('/admin/api/search?q=nothing-matches')).body).toEqual({ groups: [] });
  });
});
