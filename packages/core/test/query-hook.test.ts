import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import type { AdminContext } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { Label, NOTE_ENTITIES, Note, NoteAdmin, NotesModule } from './fixtures/notes.js';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const notes = '/admin/api/resources/note';
const ids: Record<string, number> = {};

beforeAll(async () => {
  app = await createTestApp({ imports: [NotesModule], entities: NOTE_ENTITIES });
  const dataSource = app.get<DataSource>(getDataSourceToken());
  const label = await dataSource.getRepository(Label).save({ name: 'work' });
  for (const [text, ownerId] of [['mine', 1], ['theirs', 2], ['mine too', 1]] as const) {
    ids[text] = (await dataSource.getRepository(Note).save({ text, ownerId, label })).id;
  }
});
afterAll(async () => {
  await app.close();
});

describe('query(qb, ctx) restricts every read path (Review Focus 1)', () => {
  test('lists', async () => {
    const res = await http().get(`${notes}?sort=text`);
    expect(res.body.items.map((note: { text: string }) => note.text)).toEqual(['mine', 'mine too']);
    expect(res.body.total).toBe(2);
  });

  test('GET, PATCH and DELETE by id', async () => {
    expect((await http().get(`${notes}/${ids.theirs}`)).status).toBe(404);
    expect((await http().patch(`${notes}/${ids.theirs}`).send({ text: 'x' })).status).toBe(404);
    expect((await http().delete(`${notes}/${ids.theirs}`)).status).toBe(404);
    expect((await http().get(`${notes}/${ids.mine}`)).body.text).toBe('mine');
  });

  test('restore and purge', async () => {
    const dataSource = app.get<DataSource>(getDataSourceToken());
    await dataSource.getRepository(Note).softDelete(ids.theirs!);
    expect((await http().post(`${notes}/${ids.theirs}/restore`).send({})).status).toBe(404);
    expect((await http().delete(`${notes}/${ids.theirs}?purge=true`)).status).toBe(404);
    await dataSource.getRepository(Note).restore(ids.theirs!);
  });

  test('pickers of relations that point at the resource, and the ids they accept', async () => {
    const options = await http().get('/admin/api/resources/comment/fields/note/options');
    expect(options.body.items.map((item: { title: string }) => item.title)).toEqual(['mine', 'mine too']);
    const bad = await http().post('/admin/api/resources/comment').send({ body: 'hi', note: ids.theirs });
    expect(bad.body.fields).toEqual({ note: ['does not exist'] });
    expect((await http().post('/admin/api/resources/comment').send({ body: 'hi', note: ids.mine })).status).toBe(201);
  });

  test('findOne still loads eager relations', async () => {
    const note = await app.get(NoteAdmin).findOne(ids.mine!, {} as AdminContext);
    expect(note?.label?.name).toBe('work');
  });
});
