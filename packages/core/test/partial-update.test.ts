import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import request from 'supertest';
import { AdminResource, AdminResourceBase } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

class CreateStrictDto {
  @IsString() @Length(1, 50) name: string;
}
class RenameStrictDto {
  @IsString() @Length(1, 50) name: string;
}

@AdminResource(Widget, { name: 'strict-widget' })
class StrictWidgetAdmin extends AdminResourceBase<Widget> {
  form = { create: CreateStrictDto, update: RenameStrictDto };
}

@Module({ providers: [StrictWidgetAdmin] })
class StrictModule {}

const base = '/admin/api/resources/strict-widget';
let app: INestApplication;
beforeAll(async () => {
  app = await createTestApp({ imports: [StrictModule] });
});
afterAll(async () => {
  await app.close();
});

describe('PATCH with a dedicated update DTO', () => {
  test('validates only the keys that were sent', async () => {
    const { id } = (await request(app.getHttpServer()).post(base).send({ name: 'Bolt' })).body;
    const omitted = await request(app.getHttpServer()).patch(`${base}/${id}`).send({});
    expect(omitted.status).toBe(200);
    for (const bad of [null, '']) {
      const res = await request(app.getHttpServer()).patch(`${base}/${id}`).send({ name: bad });
      expect(res.status).toBe(422);
      expect(res.body.fields.name).toBeDefined();
    }
  });
});
