import { describe, expect, spyOn, test } from 'bun:test';
import { Logger, Module, type Type } from '@nestjs/common';
import { IsString } from 'class-validator';
import request from 'supertest';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AdminGroup, AdminResource, AdminResourceBase, AdminSettingsPage, ResourceRegistry } from '../src/index.js';
import type { MetaGroup, MetaResponse } from '../src/contract.js';
import { createTestApp } from './helpers/create-app.js';

@Entity('grp_alpha')
class Alpha {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
}
@Entity('grp_beta')
class Beta {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
}
@Entity('grp_gamma')
class Gamma {
  @PrimaryGeneratedColumn() id: number;
  @Column({ default: '' }) name: string;
}
const ENTITIES = [Alpha, Beta, Gamma];

class NoteDto {
  @IsString() text: string;
}

/** A settings page class of its own for each call: one provider belongs to one test's modules. */
const page = (name: string, options: Record<string, unknown> = {}) => {
  @AdminSettingsPage(name, { form: NoteDto, ...options } as never)
  class GroupTestPage {
    load() {
      return {};
    }
    save() {}
  }
  return GroupTestPage;
};

const resource = (entity: Function, options: Record<string, unknown> = {}) => {
  @AdminResource(entity, options as never)
  class GroupTestAdmin extends AdminResourceBase<object> {}
  return GroupTestAdmin;
};

const moduleOf = (providers: Function[], group?: Parameters<typeof AdminGroup>[0], name = 'Holder'): Type => {
  @Module({ providers: providers as never[] })
  class Holder {}
  Object.defineProperty(Holder, 'name', { value: `${name}Module` });
  if (group) AdminGroup(group)(Holder);
  return Holder;
};

/** Boots an admin with these modules and answers its meta in `locale`. */
async function metaOf(imports: Type[], locale = 'en', inspect?: (registry: ResourceRegistry) => void): Promise<MetaResponse> {
  const app = await createTestApp({ imports, entities: ENTITIES, admin: { locale: 'en', locales: ['en', 'fa'] } });
  try {
    inspect?.(app.get(ResourceRegistry));
    return (await request(app.getHttpServer()).get('/admin/api/meta').set('Accept-Language', locale)).body as MetaResponse;
  } finally {
    await app.close();
  }
}
const groupOf = (meta: MetaResponse, key: string): MetaGroup | undefined => meta.groups.find((group) => group.key === key);

const SETTINGS = { key: 'settings', label: { fa: 'تنظیمات', en: 'Settings area' }, icon: 'settings', order: 1 } as const;

describe('@AdminGroup by key', () => {
  test('a module whose only members are pages joined by key labels their group', async () => {
    // The first outside consumer's case: every page says `group: 'settings'`, the module has no resource.
    const meta = await metaOf([moduleOf([page('branding', { group: 'settings' }), page('seo', { group: 'settings' })], SETTINGS, 'SettingsPages')], 'fa');
    expect(meta.groups[0]).toMatchObject({ key: 'settings', label: 'تنظیمات', icon: 'settings' }); // order: 1 puts it first
    expect(meta.groups[0]!.pages.map((item) => item.name).sort()).toEqual(['branding', 'seo']);
  });

  test('the module with the key may hold nothing itself, in either import order', async () => {
    for (const reversed of [false, true]) {
      const imports = [moduleOf([], SETTINGS, 'Labels'), moduleOf([page('branding', { group: 'settings' })], undefined, 'PagesOnly')];
      const meta = await metaOf(reversed ? imports.reverse() : imports);
      expect(meta.groups[0]).toMatchObject({ key: 'settings', label: 'Settings area', icon: 'settings' });
      expect(meta.groups[0]!.pages.map((item) => item.name)).toEqual(['branding']);
    }
  });

  test('resources joined by key get it too, alone or with pages', async () => {
    for (const reversed of [false, true]) {
      const imports = [
        moduleOf([], SETTINGS, 'Labels'),
        moduleOf([resource(Alpha, { group: 'settings' })], undefined, 'Things'),
        moduleOf([page('branding', { group: 'settings' })], undefined, 'PagesOnly'),
      ];
      const settings = (await metaOf(reversed ? imports.reverse() : imports, 'fa')).groups[0]!;
      expect(settings).toMatchObject({ key: 'settings', label: 'تنظیمات', icon: 'settings' });
      expect(settings.resources.map((item) => item.name)).toEqual(['alpha']);
      expect(settings.pages.map((item) => item.name)).toEqual(['branding']);
    }
  });

  test('a module without a key still names its own group, and a key nobody claims is humanized', async () => {
    const meta = await metaOf([
      moduleOf([page('notes')], { label: 'Back office', order: 2 }, 'Office'),
      moduleOf([page('misc', { group: 'odds-and-ends' })], undefined, 'Plain'),
    ]);
    expect(groupOf(meta, 'office')).toMatchObject({ label: 'Back office' });
    expect(groupOf(meta, 'odds-and-ends')).toMatchObject({ label: 'Odds and ends' });
    expect(groupOf(meta, 'odds-and-ends')!.icon).toBeUndefined();
  });

  test('two modules claiming one key: the first one wins, with a warning at boot when they differ', async () => {
    const warned = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const meta = await metaOf([
        moduleOf([page('one', { group: 'settings' })], SETTINGS, 'First'),
        moduleOf([page('two', { group: 'settings' })], { key: 'settings', label: 'Other label' }, 'Second'),
      ]);
      expect(groupOf(meta, 'settings')).toMatchObject({ label: 'Settings area', icon: 'settings' });
      expect(groupOf(meta, 'settings')!.pages.map((item) => item.name)).toEqual(['one', 'two']);
      const messages = warned.mock.calls.flat().join('\n');
      expect(messages).toContain('@AdminGroup "settings" is configured by FirstModule and differently by SecondModule; FirstModule wins');

      // The same options twice are one definition: nothing to warn about.
      warned.mockClear();
      await metaOf([moduleOf([page('one', { group: 'settings' })], SETTINGS, 'First'), moduleOf([page('two', { group: 'settings' })], { ...SETTINGS }, 'Second')]);
      expect(warned.mock.calls.flat().join('\n')).not.toContain('@AdminGroup');
    } finally {
      warned.mockRestore();
    }
  });
});

describe('order inside a group', () => {
  const SHOP = { key: 'shop', label: 'Shop' };

  test('pages and resources sort by `order`, then by label; the default is 100', async () => {
    const meta = await metaOf(
      [
        moduleOf(
          [
            page('seo', { label: { en: 'SEO', fa: 'سئو' }, order: 20 }),
            page('branding', { label: { en: 'Branding', fa: 'ظاهر' }, order: 10 }),
            page('commerce', { label: 'Commerce' }), // 100
            page('about', { label: 'About' }), // 100
            page('zeta', { label: 'Zeta', order: 100 }),
            resource(Alpha, { label: 'Alpha' }), // 100
            resource(Beta, { label: 'Beta', order: 5 }),
            resource(Gamma, { label: 'Gamma', order: -1 }),
          ],
          SHOP,
          'Shop',
        ),
      ],
      'fa',
    );
    const shop = groupOf(meta, 'shop')!;
    expect(shop.pages.map((item) => item.name)).toEqual(['branding', 'seo', 'about', 'commerce', 'zeta']);
    expect(shop.resources.map((item) => item.name)).toEqual(['gamma', 'beta', 'alpha']);
  });

  test('without any `order` the members are sorted by label, as before', async () => {
    const meta = await metaOf([moduleOf([page('seo', { label: 'SEO' }), page('branding', { label: 'Branding' }), resource(Beta), resource(Alpha)], SHOP, 'Shop')]);
    expect(groupOf(meta, 'shop')!.pages.map((item) => item.name)).toEqual(['branding', 'seo']);
    expect(groupOf(meta, 'shop')!.resources.map((item) => item.name)).toEqual(['alpha', 'beta']);
  });

  test('`order` must be a finite number', async () => {
    const boot = (provider: Function) => metaOf([moduleOf([provider], SHOP, 'Shop')]);
    await expect(boot(page('late', { order: Number.NaN }))).rejects.toThrow('GroupTestPage: `order` must be a finite number, got NaN');
    await expect(boot(page('late', { order: '1' }))).rejects.toThrow('GroupTestPage: `order` must be a finite number, got "1"');
    await expect(boot(resource(Alpha, { order: Number.POSITIVE_INFINITY }))).rejects.toThrow('GroupTestAdmin: `order` must be a finite number, got Infinity');
    await expect(boot(resource(Alpha, { order: null }))).rejects.toThrow('GroupTestAdmin: `order` must be a finite number, got null');
  });

  test('the registry keeps the order of each resource', async () => {
    await metaOf([moduleOf([resource(Alpha, { order: 3 }), resource(Beta)], SHOP, 'Shop')], 'en', (registry) => {
      expect(registry.get('alpha').order).toBe(3);
      expect(registry.get('beta').order).toBe(100);
    });
  });
});
