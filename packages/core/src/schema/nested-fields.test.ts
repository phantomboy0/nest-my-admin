import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { DataSource } from 'typeorm';
import { getAdminResourceDefinition } from '../decorators/admin-resource.js';
import { SHAPE_ENTITIES, Venue, VenueAdmin, VenueDto, VenueDtoAdmin } from '../../test/fixtures/shapes.js';
import type { AdminResourceBase } from '../resource/admin-resource-base.js';
import { buildResourceSchema } from './build-resource-schema.js';
import { nestedTypeOf } from './nested-fields.js';

let dataSource: DataSource;
beforeAll(async () => {
  dataSource = await new DataSource({ type: 'sqljs', entities: SHAPE_ENTITIES }).initialize();
});
afterAll(async () => {
  await dataSource.destroy();
});

const schemaFor = (resource: AdminResourceBase<any>) =>
  buildResourceSchema({
    definition: getAdminResourceDefinition(resource.constructor)!,
    resource,
    metadata: dataSource.getMetadata(Venue),
    moduleGroup: 'g',
    className: resource.constructor.name,
  });

describe('nested fields', () => {
  test('an embedded becomes an object field in column order, nested embeddeds included', () => {
    const schema = schemaFor(new VenueAdmin());
    expect(schema.fields.map((field) => [field.name, field.type])).toEqual([
      ['id', 'number'],
      ['name', 'string'],
      ['hours', 'json'],
      ['address', 'object'],
      ['address.city', 'string'],
    ]);
    const address = schema.fields.find((field) => field.name === 'address')!;
    expect(address.fields!.map((field) => [field.name, field.type, field.nullable])).toEqual([
      ['city', 'string', false],
      ['zip', 'string', true],
      ['geo', 'object', false],
    ]);
    expect(address.fields![2]!.fields!.map((field) => [field.name, field.type, field.scale])).toEqual([['lat', 'decimal', 5]]);
    expect(schema.form.create).toEqual(['name', 'hours', 'address']);
    expect(schema.form.requiredOnCreate).toEqual(['name']);
    expect(schema.form.constraints.create).toMatchObject({
      address: {},
      'address.city': { required: true, maxLength: 40 },
      'address.zip': { maxLength: 10 },
      'address.geo': {},
      'address.geo.lat': {},
    });
    expect(schema.form.constraints.update['address.city']).toEqual({ maxLength: 40 }); // nothing is required on update without an update DTO
    expect(schema.list.sortable).toContain('address.city');
  });

  test('@ValidateNested with @Type finds the nested class, arrays included', () => {
    expect(nestedTypeOf(VenueDto, 'address')).toMatchObject({ many: false });
    expect(nestedTypeOf(VenueDto, 'address')!.type.name).toBe('AddressDto');
    expect(nestedTypeOf(VenueDto, 'hours')!.type.name).toBe('OpeningDto');
    expect(nestedTypeOf(VenueDto, 'hours')!.many).toBe(true);
    expect(nestedTypeOf(VenueDto, 'name')).toBeUndefined();
  });

  test('a json column written through a list of nested DTOs is a list of sub-forms; constraints use dotted paths', () => {
    const schema = schemaFor(new VenueDtoAdmin());
    const hours = schema.fields.find((field) => field.name === 'hours')!;
    expect(hours).toMatchObject({ type: 'object', many: true, persisted: true, nullable: true });
    expect(hours.fields!.map((field) => [field.name, field.type, field.enumValues])).toEqual([
      ['day', 'enum', ['mon', 'tue', 'wed']],
      ['opens', 'string', undefined],
    ]);
    expect(schema.form.requiredOnCreate).toEqual(['name', 'address']);
    expect(schema.form.constraints.create).toMatchObject({
      'address.city': { required: true, minLength: 2, maxLength: 40 },
      'address.zip': { maxLength: 10, pattern: { source: '^\\d{5}$', flags: '', message: 'zip must be 5 digits' } },
      'hours.*.day': { required: true, oneOf: ['mon', 'tue', 'wed'] },
      'hours.*.opens': { required: true },
    });
  });
});
