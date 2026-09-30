import { afterEach, describe, expect, test } from 'bun:test';
import { Module, type INestApplication } from '@nestjs/common';
import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, ResourceRegistry, type AdminContext } from '../src/index.js';
import { Widget } from './fixtures/widgets.js';
import { createTestApp } from './helpers/create-app.js';
import request from 'supertest';

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
    expect(registry.get('widget').dbNames.columns.get('createdAt')).toBe('createdAt');
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

  @Entity()
  class Gizmo {
    @PrimaryGeneratedColumn() id: number;
    @Column() label: string;
  }

  @Entity()
  class Pairing {
    @PrimaryColumn() first: string;
    @PrimaryColumn() second: string;
  }

  @Entity()
  class Opaque {
    // select: false leaves the admin nothing to list or sort by, so its schema cannot be built
    @PrimaryColumn({ type: 'varchar', length: 40, select: false }) key: string;
  }

  describe('autoRegister', () => {
    test('is off by default', async () => {
      app = await createTestApp({ entities: [Gizmo] });
      expect(app.get(ResourceRegistry).list().map((entry) => entry.schema.name)).toEqual(['widget']);
    });

    test('exposes entities without a resource under "Entities", composite keys included', async () => {
      app = await createTestApp({ admin: { autoRegister: true }, entities: [Gizmo, Pairing] });
      const registry = app.get(ResourceRegistry);
      expect(registry.list().map((entry) => entry.schema.name).sort()).toEqual(['gizmo', 'pairing', 'widget']);
      expect(registry.get('gizmo').schema.group).toBe('entities');
      expect(registry.get('widget').schema.group).toBe('widgets');
      expect(registry.groupList().find((group) => group.key === 'entities')).toEqual({ key: 'entities', label: 'Entities', order: 1000 });
      const created = await request(app.getHttpServer()).post('/admin/api/resources/gizmo').send({ label: 'Auto' });
      expect(created.status).toBe(201);
    });

    test('skips an entity whose schema cannot be built instead of failing bootstrap', async () => {
      app = await createTestApp({ admin: { autoRegister: true }, entities: [Gizmo, Opaque] });
      expect(app.get(ResourceRegistry).list().map((entry) => entry.schema.name).sort()).toEqual(['gizmo', 'widget']);
    });
  });
});
