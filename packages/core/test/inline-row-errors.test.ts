import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { IsInt, IsOptional, IsString } from 'class-validator';
import request from 'supertest';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, type DataSource } from 'typeorm';
import { AdminResource, AdminResourceBase, AdminValidationError, type AdminContext, type FormConfig } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('ire_box')
class Box {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ default: false }) sealed: boolean;
}

@Entity('ire_item')
class Item {
  @PrimaryGeneratedColumn() id: number;
  @Column({ unique: true }) code: string;
  @Column({ type: 'int' }) boxId: number;
  @ManyToOne(() => Box, { onDelete: 'CASCADE' }) box: Box;
}

@Entity('ire_tag')
class Tag {
  @PrimaryGeneratedColumn() id: number;
  @Column() label: string;
  @Column({ type: 'int' }) boxId: number;
  @ManyToOne(() => Box, { onDelete: 'CASCADE' }) box: Box;
}

@Entity('ire_inbox')
class Inbox {
  @PrimaryGeneratedColumn() id: number;
  @Column() subject: string;
  @Column({ default: false }) handled: boolean;
}

class ItemDto {
  @IsString() code: string;
  @IsInt() boxId: number;
}

class TagDto {
  @IsString() label: string;
  @IsInt() boxId: number;
}

class BoxDto {
  @IsString() name: string;
  @IsOptional() sealed?: boolean;
}

@AdminResource(Item, { title: 'code' })
class ItemAdmin extends AdminResourceBase<Item, number> {
  override form: FormConfig = { create: ItemDto };
  override create(dto: ItemDto, ctx: AdminContext): Promise<Item> {
    if (dto.code.startsWith('BAD')) throw new AdminValidationError({ code: [`${dto.code} is refused by the host`] });
    return super.create(dto, ctx);
  }
}

@AdminResource(Tag, { title: 'label' })
class TagAdmin extends AdminResourceBase<Tag, number> {
  override form: FormConfig = { create: TagDto };
}

@AdminResource(Box, { title: 'name' })
class BoxAdmin extends AdminResourceBase<Box, number> {
  override form: FormConfig = {
    create: BoxDto,
    afterCreate: 'edit',
    layout: [
      { section: 'Box', fields: ['name', 'sealed'] },
      { inline: ItemAdmin, display: 'table', fields: ['code'] },
      { inline: TagAdmin, display: 'table', fields: ['label'], existingOnly: true },
    ],
  };
  /** A rule about the box and its rows together: they are all written by now. */
  override async afterInlines(box: Box, _dto: Record<string, unknown>, ctx: AdminContext): Promise<void> {
    if (box.sealed && (await ctx.manager!.countBy(Item, { boxId: box.id })) === 0) throw new AdminValidationError({ sealed: ['An empty box cannot be sealed'] });
  }
}

@AdminResource(Inbox, { creatable: false, title: 'subject' })
class InboxAdmin extends AdminResourceBase<Inbox, number> {}

@Module({ providers: [BoxAdmin, ItemAdmin, TagAdmin, InboxAdmin] })
class BoxesModule {}

let app: INestApplication;
let db: DataSource;
const http = () => request(app.getHttpServer());
const boxes = '/admin/api/resources/box';

beforeAll(async () => {
  app = await createTestApp({ imports: [BoxesModule], entities: [Box, Item, Tag, Inbox] });
  db = app.get<DataSource>(getDataSourceToken());
});
afterAll(async () => {
  await app?.close();
});

describe(`every row's problem at once (${TEST_DB})`, () => {
  test('a refused row and a unique violation are answered together, and nothing is saved', async () => {
    await db.getRepository(Box).save({ name: 'first' });
    const first = await http().post(boxes).send({ name: 'seed', _inlines: { item: { create: [{ _key: 'a', code: 'TAKEN' }] } } });
    expect(first.status).toBe(201);
    const res = await http()
      .post(boxes)
      .send({ name: 'many', _inlines: { item: { create: [{ _key: 'a', code: 'BAD-1' }, { _key: 'b', code: 'TAKEN' }, { _key: 'c', code: 'BAD-2' }, { _key: 'd', code: 'FINE' }] } } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields).sort()).toEqual(['_inlines.item.create.0.code', '_inlines.item.create.1.code', '_inlines.item.create.2.code']);
    expect(await db.getRepository(Box).countBy({ name: 'many' })).toBe(0);
    expect(await db.getRepository(Item).countBy({ code: 'FINE' })).toBe(0);
  });

  test('one refused row keeps its own status and rows after it that work do not change the answer', async () => {
    const res = await http()
      .post(boxes)
      .send({ name: 'one', _inlines: { item: { create: [{ _key: 'a', code: 'TAKEN' }, { _key: 'b', code: 'OTHER' }] } } });
    expect(res.status).toBe(409);
    expect(Object.keys(res.body.fields)).toEqual(['_inlines.item.create.0.code']);
    expect(await db.getRepository(Item).countBy({ code: 'OTHER' })).toBe(0);
  });

  test('rows that all work are saved, in the same transaction as the parent', async () => {
    const res = await http()
      .post(boxes)
      .send({ name: 'good', _inlines: { item: { create: [{ _key: 'a', code: 'G1' }, { _key: 'b', code: 'G2' }] } } });
    expect(res.status).toBe(201);
    expect(await db.getRepository(Item).countBy({ boxId: res.body.id })).toBe(2);
  });
});

describe(`existingOnly inlines (${TEST_DB})`, () => {
  test('the new form is told, and a create with rows is refused', async () => {
    const schema = await http().get('/admin/api/meta/resources/box');
    const tag = schema.body.form.layout.find((node: { inline?: string }) => node.inline === 'tag');
    expect(tag.existingOnly).toBe(true);
    expect(schema.body.form.afterCreate).toBe('edit');
    const res = await http().post(boxes).send({ name: 'tagged', _inlines: { tag: { create: [{ _key: 'a', label: 'x' }] } } });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fields)).toEqual(['_inlines.tag']);
  });

  test('an existing record takes its rows', async () => {
    const created = await http().post(boxes).send({ name: 'later' });
    const res = await http().patch(`${boxes}/${created.body.id}`).send({ _inlines: { tag: { create: [{ _key: 'a', label: 'x' }] } } });
    expect(res.status).toBe(200);
    expect(await db.getRepository(Tag).countBy({ boxId: created.body.id })).toBe(1);
  });
});

describe(`afterInlines (${TEST_DB})`, () => {
  test('sees the rows of the same save; its refusal undoes the save', async () => {
    const refused = await http().post(boxes).send({ name: 'empty', sealed: true });
    expect(refused.status).toBe(422);
    expect(refused.body.fields).toEqual({ sealed: ['An empty box cannot be sealed'] });
    expect(await db.getRepository(Box).countBy({ name: 'empty' })).toBe(0);
    const accepted = await http().post(boxes).send({ name: 'full', sealed: true, _inlines: { item: { create: [{ _key: 'a', code: 'F1' }] } } });
    expect(accepted.status).toBe(201);
  });
});

describe(`creatable: false (${TEST_DB})`, () => {
  test('offers no «New» and refuses a create, and its records can still be edited', async () => {
    const schema = await http().get('/admin/api/meta/resources/inbox');
    expect(schema.body.creatable).toBe(false);
    expect((await http().post('/admin/api/resources/inbox').send({ subject: 'x' })).status).toBeGreaterThanOrEqual(400);
    const row = await db.getRepository(Inbox).save({ subject: 'from the shop' });
    const res = await http().patch(`/admin/api/resources/inbox/${row.id}`).send({ handled: true });
    expect(res.status).toBe(200);
    expect(res.body.handled).toBe(true);
  });
});
