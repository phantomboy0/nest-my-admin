import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import type { FieldSchema } from '../contract.js';
import { AdminField } from '../decorators/admin-field.js';
import { applyFieldConfig, checkFieldConfig, checkLayout, localizeLayout, mergeFieldConfig } from './field-config.js';

const field = (name: string, type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema => ({
  name, label: name, type, nullable: false, primary: false, readonly: false, persisted: true, ...extra,
});
const FIELDS = [
  field('name', 'string'),
  field('slug', 'string'),
  field('price', 'decimal', { scale: 2 }),
  field('active', 'boolean'),
  field('status', 'enum', { enumValues: ['draft', 'active'] }),
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

describe('applyFieldConfig', () => {
  test('texts in the locale; untouched fields come back as they are', () => {
    const options = { label: { en: 'Status', fa: 'وضعیت' }, enumLabels: { draft: { en: 'Draft', fa: 'پیش‌نویس' } }, widget: 'badge' as const, colors: { draft: 'amber' as const } };
    expect(applyFieldConfig(FIELDS[4]!, options, 'fa', 'en')).toMatchObject({ label: 'وضعیت', enumLabels: { draft: 'پیش‌نویس' }, widget: 'badge', colors: { draft: 'amber' }, enumValues: ['draft', 'active'] });
    expect(applyFieldConfig(FIELDS[4]!, options, 'en', 'en').label).toBe('Status');
    expect(applyFieldConfig(FIELDS[0]!, undefined, 'fa', 'en')).toBe(FIELDS[0]!);
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
    expect(localizeLayout([{ section: { en: 'Main', fa: 'اصلی' }, fields: ['name'] }, { tab: { en: 'Price', fa: 'قیمت' }, sections: [{ fields: ['price'], columns: 2 }] }], 'fa', 'en')).toEqual([
      { title: 'اصلی', fields: ['name'], columns: 1 },
      { tab: 'قیمت', sections: [{ fields: ['price'], columns: 2 }] },
    ]);
  });
});
