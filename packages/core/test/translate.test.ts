import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { IsString } from 'class-validator';
import request from 'supertest';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import {
  AdminAction,
  AdminGroup,
  AdminPrint,
  AdminResource,
  AdminResourceBase,
  AdminSettingsPage,
  AdminWidget,
  html,
  type AdminSettingsSource,
  type AdminTranslate,
  type FieldsConfig,
  type ListConfig,
} from '../src/index.js';
import { createTestApp } from './helpers/create-app.js';

class Place {
  @Column({ default: '' }) city: string;
}

@Entity('tr_item')
class Item {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ default: '' }) note: string;
  @Column({ type: 'simple-enum', enum: ['open', 'closed'], default: 'open' }) status: 'open' | 'closed';
  @Column(() => Place) place: Place;
}

@AdminResource(Item, { name: 'item', label: { fa: 'کالا' } })
class ItemAdmin extends AdminResourceBase<Item> {
  override list: ListConfig<Item> = {
    columns: ['name', 'status', 'shout'],
    tabs: [{ key: 'all', label: 'All' }],
    computed: { shout: { label: 'Shout', kind: 'title', source: 'name' } },
  };
  override fields: FieldsConfig<Item> = {
    name: { label: { fa: 'نام' }, help: 'Help' },
    status: { enumLabels: { open: { fa: 'باز' } } },
  };
  override form = { layout: [{ key: 'main', section: { fa: 'اصلی' }, fields: ['name', 'note', 'status', 'place'] }] };

  @AdminAction({ label: 'Close', confirm: 'Sure?' })
  async close() {
    return {};
  }

  @AdminPrint({ label: 'Card' })
  card(items: Item[]) {
    return html`${items.length}`;
  }
}

class NoticeDto {
  @IsString() text: string;
}

@AdminSettingsPage('notices', { label: 'Notices', form: NoticeDto, group: 'tools' })
class NoticesPage implements AdminSettingsSource<NoticeDto> {
  load() {
    return { text: 'hello' };
  }
  save() {}
}

@AdminWidget('count', { type: 'stat', title: 'Count' })
class CountWidget {
  async load() {
    return { value: '1' };
  }
}

@AdminGroup({ key: 'tools', label: { fa: 'ابزار' }, icon: 'wrench' })
@Module({ providers: [ItemAdmin, NoticesPage, CountWidget] })
class ToolsModule {}

const asked: Array<{ key?: string; text: unknown; locale: string }> = [];
const translate: AdminTranslate = (request) => {
  // The UI's own texts (`ui.`) are asked at boot and must keep their placeholders: not this test's business.
  if (request.key?.startsWith('ui.')) return undefined;
  asked.push(request);
  return request.key ? `T(${request.key})` : undefined;
};

let app: INestApplication;
const get = async (path: string) => (await request(app.getHttpServer()).get(`/admin/api${path}`).set('Accept-Language', 'en')).body;

beforeAll(async () => {
  app = await createTestApp({
    imports: [ToolsModule],
    entities: [Item],
    admin: {
      title: { fa: 'مدیریت' },
      locale: 'fa',
      locales: ['fa', 'en'],
      translate,
      menu: { sections: [{ key: 'tools', label: { fa: 'ابزار' }, icon: 'wrench', items: [{ resource: 'item' }] }] },
    },
  });
});
afterAll(async () => {
  await app.close();
});

describe('translate', () => {
  test('every keyed text goes through translate', async () => {
    const meta = await get('/meta');
    const schema = await get('/meta/resources/item');
    const page = await get('/pages/notices');
    const dashboard = await get('/dashboard');

    expect(meta.title).toBe('T(title)');
    expect(meta.menu.sections[0].label).toBe('T(menu.tools)');
    expect(meta.menu.advanced.label).toBe('T(menu.advanced)');
    expect(schema.label).toBe('T(resource.item)');
    const field = (name: string) => schema.fields.find((candidate: { name: string }) => candidate.name === name);
    expect(field('name').label).toBe('T(resource.item.fields.name.label)');
    expect(field('name').help).toBe('T(resource.item.fields.name.help)');
    expect(field('status').enumLabels.open).toBe('T(resource.item.fields.status.enumLabels.open)');
    expect(schema.actions[0]).toMatchObject({ label: 'T(resource.item.actions.close.label)', confirm: 'T(resource.item.actions.close.confirm)' });
    expect(schema.prints[0].label).toBe('T(resource.item.prints.card.label)');
    expect(schema.list.tabs[0].label).toBe('T(resource.item.list.tabs.all.label)');
    expect(schema.list.computed.shout.label).toBe('T(resource.item.list.computed.shout.label)');
    expect(schema.form.layout[0].title).toBe('T(resource.item.form.main)');
    expect(page.schema.label).toBe('T(page.notices)');
    expect(page.schema.fields[0].label).toBe('T(page.notices.fields.text.label)');
    expect(dashboard.widgets[0].title).toBe('T(widget.count.title)');

    const keys = new Set(asked.map((entry) => entry.key));
    expect(keys.has('group.tools')).toBe(true);
    for (const key of keys) if (key !== undefined) expect(key).toMatch(/^(title|group\.[\w-]+|menu\.[\w-]+|resource\.[\w-]+(\..+)?|page\.[\w-]+(\..+)?|widget\.[\w-]+\.title)$/);
  });

  test('an unlabelled field asks with its humanized name', async () => {
    await get('/meta/resources/item');
    expect(asked.find((entry) => entry.key === 'resource.item.fields.note.label')?.text).toBe('Note');
  });

  test('a nested field uses its dotted path', async () => {
    const schema = await get('/meta/resources/item');
    const place = schema.fields.find((candidate: { name: string }) => candidate.name === 'place');
    expect(place.fields.find((candidate: { name: string }) => candidate.name === 'city').label).toBe('T(resource.item.fields.place.city.label)');
  });

  test('a duplicate layout key is a boot error', async () => {
    @AdminResource(Item, { name: 'twice' })
    class TwiceAdmin extends AdminResourceBase<Item> {
      override form = { layout: [{ key: 'main', fields: ['name'] }, { key: 'main', fields: ['note'] }] };
    }
    @Module({ providers: [TwiceAdmin] })
    class TwiceModule {}
    await expect(createTestApp({ imports: [TwiceModule], entities: [Item] })).rejects.toThrow('form.layout: key "main" is used twice');
  });
});
