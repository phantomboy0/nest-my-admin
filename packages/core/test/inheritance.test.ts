import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/create-app.js';
import { CONTENT_ENTITIES, ContentModule } from './fixtures/content.js';

let app: INestApplication;
const http = () => request(app.getHttpServer());
const schemaOf = async (name: string) => (await http().get(`/admin/api/meta/resources/${name}`)).body;

beforeAll(async () => {
  // Post has a resource, Video gets one from autoRegister (children are no longer skipped)
  app = await createTestApp({ imports: [ContentModule], entities: CONTENT_ENTITIES, admin: { autoRegister: true } });
});
afterAll(async () => {
  await app.close();
});

describe('single-table inheritance (Review Focus 5)', () => {
  test('each child has a resource without the discriminator; the root shows it read-only', async () => {
    const post = await schemaOf('post');
    expect(post.fields.map((field: { name: string }) => field.name)).toEqual(['id', 'title', 'body']);
    expect(post.creatable).toBe(true);
    expect((await schemaOf('video')).fields.map((field: { name: string }) => field.name)).toEqual(['id', 'title', 'seconds']);

    const content = await schemaOf('content');
    expect(content.creatable).toBe(false);
    expect(content.fields.map((field: { name: string }) => field.name)).toEqual(['id', 'title', 'kind']);
    expect(content.fields[2]).toMatchObject({ type: 'enum', readonly: true, enumValues: ['Content', 'post', 'video'] });
  });

  test('children create rows of their kind and list only those', async () => {
    const created = await http().post('/admin/api/resources/post').send({ title: 'Hello', body: 'World' });
    expect(created.status).toBe(201);
    await http().post('/admin/api/resources/video').send({ title: 'Clip', seconds: 30 });
    expect((await http().get('/admin/api/resources/post')).body.items.map((item: { title: string }) => item.title)).toEqual(['Hello']);
    expect((await http().get('/admin/api/resources/video')).body.items.map((item: { title: string }) => item.title)).toEqual(['Clip']);
    const all = await http().get('/admin/api/resources/content?sort=title');
    expect(all.body.items.map((item: { title: string; kind: string }) => [item.title, item.kind])).toEqual([
      ['Clip', 'video'],
      ['Hello', 'post'],
    ]);
    // a video is not a post
    const videoId = all.body.items[0]._id;
    expect((await http().get(`/admin/api/resources/post/${videoId}`)).status).toBe(404);
  });

  test('the root refuses to create and names its kinds', async () => {
    const res = await http().post('/admin/api/resources/content').send({ title: 'Orphan' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Content records are created as one of their kinds: Post, Video');
  });
});
