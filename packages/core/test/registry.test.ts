import { afterEach, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, ResourceRegistry, type AdminContext } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';

let app: INestApplication | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const ctx = { correlationId: 'test', request: {} } as AdminContext;

describe('ResourceRegistry', () => {
  test('discovers resources and groups them by the module that provides them', async () => {
    app = await createTestApp();
    const registry = app.get(ResourceRegistry);
    expect(registry.list().map((entry) => entry.schema.name)).toEqual(['widget']);
    expect(registry.groupList()).toEqual([{ key: 'widgets', label: 'Inventory', icon: 'boxes', order: 100 }]);
    expect(registry.get('widget').schema.group).toBe('widgets');
    expect(registry.get('widget').columnProperties.get('createdAt')).toBe('createdAt');
  });

  test('attaches the repository so the default CRUD methods work', async () => {
    app = await createTestApp();
    const { resource } = app.get(ResourceRegistry).get('widget');
    const created = (await resource.create({ name: 'Bolt' }, ctx)) as Widget;
    expect(await resource.findOne(created.id, ctx)).toMatchObject({ name: 'Bolt' });
  });

  test('unknown names are AdminNotFoundError', async () => {
    app = await createTestApp();
    expect(() => app!.get(ResourceRegistry).get('nope')).toThrow('Unknown resource "nope"');
    expect(app.get(ResourceRegistry).find('nope')).toBeUndefined();
  });

  test('rejects duplicate resource names', async () => {
    @AdminResource(Widget)
    class SecondWidgetAdmin extends AdminResourceBase<Widget> {}
    @Module({ providers: [SecondWidgetAdmin] })
    class DuplicateModule {}
    await expect(createTestApp({ imports: [DuplicateModule] })).rejects.toThrow('Duplicate admin resource name "widget"');
  });

  test('rejects @AdminResource classes that do not extend AdminResourceBase', async () => {
    @AdminResource(Widget, { name: 'plain' })
    class PlainAdmin {}
    @Module({ providers: [PlainAdmin] })
    class PlainModule {}
    await expect(createTestApp({ imports: [PlainModule] })).rejects.toThrow(
      'PlainAdmin is decorated with @AdminResource but does not extend AdminResourceBase',
    );
  });

  test('rejects entities that are not registered in the DataSource', async () => {
    @Entity()
    class Orphan {
      @PrimaryGeneratedColumn() id: number;
      @Column() name: string;
    }
    @AdminResource(Orphan)
    class OrphanAdmin extends AdminResourceBase<Orphan> {}
    @Module({ providers: [OrphanAdmin] })
    class OrphanModule {}
    await expect(createTestApp({ imports: [OrphanModule] })).rejects.toThrow(
      'OrphanAdmin: entity Orphan is not registered in DataSource "default"',
    );
  });
});
