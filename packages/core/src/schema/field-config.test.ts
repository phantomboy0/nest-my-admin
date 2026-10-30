import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { FieldSchema } from '../contract.js';
import { AdminField } from '../decorators/admin-field.js';
import { applyFieldConfig, checkFieldConfig, checkLayout, localizeLayout, mergeFieldConfig, type LayoutConfig, type LayoutInlineConfig } from './field-config.js';
import { resolveText, type LocalizedText } from '../i18n/localized-text.js';

/** Texts in `locale`, the default being English. */
const loc = (locale: string) => (value: LocalizedText) => resolveText(value, locale, 'en');

const field = (name: string, type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});
const FIELDS = [
  field('name', 'string'),
  field('slug', 'string'),
  field('price', 'decimal', { scale: 2 }),
  field('active', 'boolean'),
  field('status', 'enum', { enumValues: ['draft', 'active'] }),
  field('logo', 'string'),
  field('gallery', 'json'),
];
const fail = (message: string): never => {
  throw new Error(message);
};
const check = (config: Record<string, object>) => () => checkFieldConfig(FIELDS, new Map(Object.entries(config)), fail);

class Entity {
  @AdminField({ label: 'Entity label', help: 'Entity help' })
  name!: string;
}
class CreateDto {
  @AdminField({ label: 'DTO label', placeholder: 'Type it' })
  name!: string;
}

describe('mergeFieldConfig', () => {
  test('entity, then DTOs, then the resource config, option by option', () => {
    const merged = mergeFieldConfig([Entity, CreateDto, undefined], { name: { help: 'Resource help' }, price: { widget: 'money' } });
    expect(merged.get('name')).toEqual({ label: 'DTO label', help: 'Resource help', placeholder: 'Type it' });
    expect(merged.get('price')).toEqual({ widget: 'money' });
  });
});

describe('checkFieldConfig', () => {
  test('accepts fitting widgets and known references', () => {
    expect(check({ price: { widget: 'money' }, active: { widget: 'switch' }, slug: { widget: 'slug', slugFrom: 'name' }, status: { widget: 'badge', colors: { draft: 'amber' }, enumLabels: { draft: 'Draft' }, showIf: { active: true } } })).not.toThrow();
  });
  test('unknown fields and widgets get suggestions', () => {
    expect(check({ prise: {} })).toThrow('fields: unknown field "prise" (did you mean "price"?)');
    expect(check({ price: { widget: 'mony' } })).toThrow('fields.price: unknown widget "mony" (did you mean "money"?)');
  });
  test('a widget must fit the type', () => {
    expect(check({ active: { widget: 'money' } })).toThrow('fields.active: the "money" widget does not fit boolean fields');
  });
  test('showIf, slugFrom, colours and enum labels are checked', () => {
    expect(check({ price: { showIf: { stauts: 'x' } } })).toThrow('fields.price.showIf: unknown field "stauts" (did you mean "status"?)');
    expect(check({ slug: { slugFrom: 'nme' } })).toThrow('fields.slug.slugFrom: unknown field "nme"');
    expect(check({ status: { colors: { draft: 'orange' } } })).toThrow('unknown badge colour "orange"');
    expect(check({ status: { enumLabels: { gone: 'Gone' } } })).toThrow('fields.status.enumLabels: "gone" is not one of draft, active');
  });
});

describe('file fields', () => {
  test('file and image widgets fit string, text and json columns only', () => {
    expect(check({ logo: { widget: 'image', file: { accept: ['image/*'], maxBytes: 1000, visibility: 'public' } }, gallery: { widget: 'file', many: true } })).not.toThrow();
    expect(check({ active: { widget: 'file' } })).toThrow('the "file" widget does not fit boolean fields');
    expect(check({ price: { widget: 'image' } })).toThrow('the "image" widget does not fit decimal fields');
  });
  test('file options and many are checked', () => {
    expect(check({ logo: { file: { accept: ['image/*'] } } })).toThrow('`file` options need the "file", "image" or "richtext" widget');
    expect(check({ logo: { widget: 'file', many: true } })).toThrow('`many` needs a json column');
    expect(check({ name: { many: true } })).toThrow('`many` needs the "file" or "image" widget');
    expect(check({ logo: { widget: 'file', file: { maxBytes: 0 } } })).toThrow('maxBytes: must be a positive number of bytes');
    // nma_file.size is an int column.
    expect(check({ logo: { widget: 'file', file: { maxBytes: 2_147_483_647 } } })).not.toThrow();
    expect(check({ logo: { widget: 'file', file: { maxBytes: 2_147_483_648 } } })).toThrow('fields.logo.file.maxBytes: must be at most 2147483647 bytes');
    expect(check({ logo: { widget: 'image', file: { maxBytes: 2 ** 40 } } })).toThrow('fields.logo.file.maxBytes: must be at most 2147483647 bytes');
    expect(check({ name: { widget: 'richtext', file: { maxBytes: 2_147_483_648 } } })).toThrow('fields.name.file.maxBytes: must be at most 2147483647 bytes');
    expect(check({ logo: { widget: 'file', file: { visibility: 'secret' as 'public' } } })).toThrow('visibility: must be "public" or "private"');
    expect(check({ logo: { widget: 'file', file: { accept: ['png'] } } })).toThrow('file.accept');
    expect(check({ logo: { widget: 'file', file: { accept: ['*/*'] } }, gallery: { widget: 'file', file: { accept: ['*', 'image/*', 'application/pdf'] } } })).not.toThrow();
    expect(check({ logo: { widget: 'file', file: { accept: ['*/png'] } } })).toThrow('file.accept');

  });
  test('the schema carries accept, maxBytes and many, with defaults', () => {
    const logo = FIELDS[5]!;
    expect(applyFieldConfig(logo, { widget: 'image' }, loc('en'), 500)).toMatchObject({ widget: 'image', file: { accept: ['image/*'], maxBytes: 500, many: false } });
    expect(applyFieldConfig(logo, { widget: 'file', file: { accept: ['application/pdf'], maxBytes: 9 } }, loc('en'), 500)).toMatchObject({ file: { accept: ['application/pdf'], maxBytes: 9, many: false } });
    expect(applyFieldConfig(FIELDS[6]!, { widget: 'file', many: true }, loc('en'))).toMatchObject({ file: { accept: ['*/*'], maxBytes: 10_485_760, many: true } });
  });
});

describe('applyFieldConfig', () => {
  test('texts in the locale; untouched fields come back as they are', () => {
    const options = { label: { en: 'Status', fa: 'وضعیت' }, enumLabels: { draft: { en: 'Draft', fa: 'پیش‌نویس' } }, widget: 'badge' as const, colors: { draft: 'amber' as const } };
    expect(applyFieldConfig(FIELDS[4]!, options, loc('fa'))).toMatchObject({ label: 'وضعیت', enumLabels: { draft: 'پیش‌نویس' }, widget: 'badge', colors: { draft: 'amber' }, enumValues: ['draft', 'active'] });
    expect(applyFieldConfig(FIELDS[4]!, options, loc('en')).label).toBe('Status');
    expect(applyFieldConfig(FIELDS[0]!, undefined, loc('fa'))).toEqual(FIELDS[0]!);
  });
});

describe('layout', () => {
  const names = ['name', 'slug', 'price'];
  test('unknown, duplicate and bad columns are refused', () => {
    expect(() => checkLayout([{ fields: ['nam'] }], names, fail)).toThrow('form.layout: "nam" is not on the form (did you mean "name"?)');
    expect(() => checkLayout([{ fields: ['name'] }, { tab: 'More', sections: [{ fields: ['name'] }] }], names, fail)).toThrow('"name" is listed twice');
    expect(() => checkLayout([{ fields: ['name'], columns: 4 as 1 }], names, fail)).toThrow('columns must be 1, 2 or 3');
    expect(() => checkLayout([{ section: 'Main', fields: ['name', 'slug'], columns: 2 }, { tab: 'Price', sections: [{ fields: ['price'] }] }], names, fail)).not.toThrow();
  });
  test('titles are localized and columns default to 1', () => {
    expect(localizeLayout([{ section: { en: 'Main', fa: 'اصلی' }, fields: ['name'] }, { tab: { en: 'Price', fa: 'قیمت' }, sections: [{ fields: ['price'], columns: 2 }] }], loc('fa'))).toEqual([
      { title: 'اصلی', fields: ['name'], columns: 1 },
      { tab: 'قیمت', sections: [{ fields: ['price'], columns: 2 }] },
    ]);
  });

  class ChildAdmin {}
  const inline = ChildAdmin as unknown as LayoutInlineConfig['inline'];
  test('inline nodes: shape checked, allowed only where inlines are', () => {
    const ok: LayoutConfig = [{ fields: ['name'] }, { section: 'Lines', inline, display: 'table', order: 'pos', min: 1, max: 500 }, { tab: 'More', sections: [{ inline, fields: ['a'] }] }];
    expect(() => checkLayout(ok, names, fail, { inlines: true })).not.toThrow();
    expect(() => checkLayout(ok, names, fail)).toThrow('form.layout: inlines belong in the form of a resource');
    const bad = (node: Partial<LayoutInlineConfig>) => () => checkLayout([{ inline, ...node } as LayoutInlineConfig], names, fail, { inlines: true });
    expect(bad({ inline: 'Child' as unknown as LayoutInlineConfig['inline'] })).toThrow('form.layout: `inline` must be a resource class');
    expect(bad({ display: 'grid' as 'table' })).toThrow('inline ChildAdmin: display must be "cards" or "table"');
    expect(bad({ max: 501 })).toThrow('inline ChildAdmin: max: must be an integer from 1 to 500');
    expect(bad({ max: 0 })).toThrow('max: must be an integer from 1 to 500');
    expect(bad({ min: -1 })).toThrow('inline ChildAdmin: min: must be an integer from 0 to max (100)');
    expect(bad({ min: 3, max: 2 })).toThrow('min: must be an integer from 0 to max (2)');
    expect(bad({ min: 1.5 })).toThrow('min: must be an integer');
    expect(bad({ fields: [] })).toThrow('inline ChildAdmin: fields: must list at least one field');
    expect(bad({ fields: ['a', 'a'] })).toThrow('inline ChildAdmin: fields: "a" is listed twice');
    expect(bad({ order: 3 as unknown as string })).toThrow('inline ChildAdmin: order: must be a field name');
    expect(bad({ link: '' })).toThrow('inline ChildAdmin: link: must be a field name');
  });

  test('inline nodes are localized by the resolver, and dropped when it has none', () => {
    const layout: LayoutConfig = [{ fields: ['name'] }, { section: { en: 'Lines', fa: 'ردیف‌ها' }, inline }, { tab: 'More', sections: [{ inline }] }];
    const resolved = (node: LayoutInlineConfig, label: string | undefined) => ({ inline: 'child', label: label ?? 'Child', display: 'cards' as const, fields: ['a'], max: 100, link: 'parentId', ...(node.order ? { order: node.order } : {}) });
    expect(localizeLayout(layout, loc('fa'), resolved)).toEqual([
      { fields: ['name'], columns: 1 },
      { inline: 'child', label: 'ردیف‌ها', display: 'cards', fields: ['a'], max: 100, link: 'parentId' },
      { tab: 'More', sections: [{ inline: 'child', label: 'Child', display: 'cards', fields: ['a'], max: 100, link: 'parentId' }] },
    ]);
    // Without a resolver (before the registry resolves them): inline nodes are left out, and so is a tab left empty.
    expect(localizeLayout(layout, loc('en'))).toEqual([{ fields: ['name'], columns: 1 }]);
  });
});
