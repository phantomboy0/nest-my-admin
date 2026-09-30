import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminField, AdminResource, AdminResourceBase, type FieldsConfig, type LayoutConfig } from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';
import { TEST_DB } from './helpers/test-db.js';

@Entity('fc_gadget')
class Gadget {
  @PrimaryGeneratedColumn() id: number;
  @AdminField({ label: { en: 'Name', fa: 'نام' }, help: { en: 'Shown to customers', fa: 'به مشتری نشان داده می‌شود' } })
  @Column() name: string;
  @Column({ default: '' }) slug: string;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: '0.00' }) price: string;
  @Column({ type: 'simple-enum', enum: ['draft', 'active', 'archived'], default: 'draft' }) status: 'draft' | 'active' | 'archived';
  @Column({ default: '' }) note: string;
  @Column({ type: 'varchar', length: 20, unique: true, nullable: true }) code: string | null;
}

@AdminResource(Gadget)
class GadgetAdmin extends AdminResourceBase<Gadget> {
  override fields: FieldsConfig<Gadget> = {
    name: { placeholder: 'Gadget name' },
    slug: { widget: 'slug', slugFrom: 'name', readonly: true },
    price: { widget: 'money', currency: 'USD', readonlyIf: (gadget) => gadget.status === 'archived' },
    status: { widget: 'badge', colors: { active: 'green' }, enumLabels: { draft: { en: 'Draft', fa: 'پیش‌نویس' }, archived: 'Archived' } },
    note: {
      readonlyIf: (gadget) => {
        if (gadget.name === 'boom') throw new Error('broken rule');
        return false;
      },
    },
  };
  override form = {
    layout: [
      { section: { en: 'Details', fa: 'جزئیات' }, fields: ['name', 'slug'], columns: 2 },
      { tab: 'Pricing', sections: [{ fields: ['price', 'status'] }] },
    ] satisfies LayoutConfig,
  };
  override links(gadget: Gadget) {
    return [
      { label: { en: 'View in shop', fa: 'در فروشگاه' }, href: `https://shop.example/g/${gadget.id}` },
      { label: 'Bad', href: 'javascript:alert(1)' },
      { label: 'Relative', href: `/g/${gadget.id}` },
    ];
  }
}

@Module({ providers: [GadgetAdmin] })
class GadgetModule {}

let app: INestApplication;
const http = () => request(app.getHttpServer());
const base = '/admin/api/resources/gadget';

beforeAll(async () => {
  app = await createTestApp({ imports: [GadgetModule], entities: [Gadget], admin: { locale: 'en', locales: ['en', 'fa'] } });
});
afterAll(async () => {
  await app.close();
});

describe(`field config (${TEST_DB})`, () => {
  test('field texts, enum labels and layout follow the language (Review Focus 2)', async () => {
    const fa = (await http().get('/admin/api/meta/resources/gadget').set('Accept-Language', 'fa')).body;
    const byName = (name: string) => fa.fields.find((f: { name: string }) => f.name === name);
    expect(byName('name')).toMatchObject({ label: 'نام', help: 'به مشتری نشان داده می‌شود', placeholder: 'Gadget name' });
    expect(byName('status')).toMatchObject({ widget: 'badge', colors: { active: 'green' }, enumLabels: { draft: 'پیش‌نویس', archived: 'Archived' }, enumValues: ['draft', 'active', 'archived'] });
    expect(byName('price')).toMatchObject({ widget: 'money', currency: 'USD' });
    expect(byName('slug')).toMatchObject({ widget: 'slug', slugFrom: 'name' });
    expect(fa.form.layout).toEqual([
      { title: 'جزئیات', fields: ['name', 'slug'], columns: 2 },
      { tab: 'Pricing', sections: [{ fields: ['price', 'status'], columns: 1 }] },
    ]);
    const en = (await http().get('/admin/api/meta/resources/gadget').set('Accept-Language', 'en')).body;
    expect(en.fields.find((f: { name: string }) => f.name === 'name').label).toBe('Name');
    expect(en.fields.find((f: { name: string }) => f.name === 'status').enumLabels.draft).toBe('Draft');
    expect(en.form.layout[0].title).toBe('Details');
  });

  test('columns unique on their own are flagged', async () => {
    const { fields } = (await http().get('/admin/api/meta/resources/gadget')).body;
    expect(fields.find((f: { name: string }) => f.name === 'code').unique).toBe(true);
    expect(fields.find((f: { name: string }) => f.name === 'name').unique).toBeUndefined();
  });

  test('readonly: true is off the update form and listed as read-only', async () => {
    const { form } = (await http().get('/admin/api/meta/resources/gadget')).body;
    expect(form.update).not.toContain('slug');
    expect(form.readonly).toContain('slug');
    expect(form.create).toContain('slug');
  });

  test('records carry _readonly and safe, localized _links', async () => {
    const created = (await http().post(base).send({ name: 'Old', price: '5.00', status: 'archived' })).body;
    expect(created._readonly).toEqual(['price']);
    const fa = (await http().get(`${base}/${created._id}`).set('Accept-Language', 'fa')).body;
    expect(fa._links).toEqual([
      { label: 'در فروشگاه', href: `https://shop.example/g/${created.id}` },
      { label: 'Relative', href: `/g/${created.id}` },
    ]);
    const list = (await http().get(base)).body;
    expect(list.items.find((item: { id: number }) => item.id === created.id)._readonly).toEqual(['price']);

    const fresh = (await http().post(base).send({ name: 'New', price: '5.00', status: 'active' })).body;
    expect(fresh._readonly).toBeUndefined();
  });

  test('a locked field cannot be changed by PATCH; the rest of the record and unlocked records can (Review Focus 1)', async () => {
    const archived = (await http().post(base).send({ name: 'Locked', price: '9.00', status: 'archived' })).body;
    const refused = await http().patch(`${base}/${archived._id}`).send({ price: '1.00', note: 'x' });
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({ code: 'VALIDATION', fields: { price: ['is read-only'] } });
    const after = (await http().get(`${base}/${archived._id}`)).body;
    expect(after).toMatchObject({ price: '9.00', note: '' });

    expect((await http().patch(`${base}/${archived._id}`).send({ note: 'ok' })).body.note).toBe('ok');
    // Unarchiving unlocks price for the next request.
    expect((await http().patch(`${base}/${archived._id}`).send({ status: 'active' })).status).toBe(200);
    expect((await http().patch(`${base}/${archived._id}`).send({ price: '1.00' })).body.price).toBe('1.00');

    const open = (await http().post(base).send({ name: 'Open', price: '3.00', status: 'draft' })).body;
    expect((await http().patch(`${base}/${open._id}`).send({ price: '4.00' })).body.price).toBe('4.00');
  });

  test('a throwing readonlyIf locks its field', async () => {
    const boom = (await http().post(base).send({ name: 'boom' })).body;
    expect(boom._readonly).toEqual(['note']);
    const res = await http().patch(`${base}/${boom._id}`).send({ note: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.fields).toEqual({ note: ['is read-only'] });
  });
});

describe('field config errors at boot', () => {
  test('an unfitting widget is a boot error', async () => {
    @AdminResource(Gadget, { name: 'bad-gadget' })
    class BadAdmin extends AdminResourceBase<Gadget> {
      override fields: FieldsConfig<Gadget> = { status: { widget: 'money' } };
    }
    @Module({ providers: [BadAdmin] })
    class BadModule {}
    await expect(createTestApp({ imports: [BadModule], entities: [Gadget] })).rejects.toThrow('the "money" widget does not fit enum fields');
  });

  test('a layout naming an unknown field is a boot error', async () => {
    @AdminResource(Gadget, { name: 'bad-layout' })
    class BadAdmin extends AdminResourceBase<Gadget> {
      override form = { layout: [{ fields: ['nmae'] }] };
    }
    @Module({ providers: [BadAdmin] })
    class BadModule {}
    await expect(createTestApp({ imports: [BadModule], entities: [Gadget] })).rejects.toThrow('form.layout: "nmae" is not on the form (did you mean "name"?)');
  });
});
