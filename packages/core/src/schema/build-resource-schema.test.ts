import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { Column, CreateDateColumn, DataSource, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, getAdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminResourceBase, type ListConfig } from '../resource/admin-resource-base.js';
import { buildResourceSchema } from './build-resource-schema.js';

@Entity()
class Gadget {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 60 }) name: string;
  @Column({ type: 'decimal', precision: 8, scale: 2 }) price: string;
  @Column({ type: 'simple-enum', enum: ['new', 'used'], default: 'new' }) condition: 'new' | 'used';
  @Column({ type: 'simple-json', nullable: true }) specs: Record<string, unknown> | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity()
class Pair {
  @PrimaryColumn() first: string;
  @PrimaryColumn() second: string;
}

@Entity()
class Tool {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column({ type: 'int', nullable: true }) weight: number | null;
  @Column({ default: false }) active: boolean;
  @Column({ type: 'simple-json', nullable: true }) extra: Record<string, unknown> | null;
}

class CreateGadgetDto {
  @IsString() @Length(1, 60) name: string;
  @IsString() price: string;
  @IsOptional() @IsString() secret?: string;
}

class StampedGadgetDto {
  @IsString() name: string;
  @IsDateString() createdAt: string;
}

let dataSource: DataSource;
beforeAll(async () => {
  dataSource = await new DataSource({ type: 'sqljs', entities: [Gadget, Pair, Tool], synchronize: true }).initialize();
});
afterAll(async () => {
  await dataSource.destroy();
});

function schemaFor(resource: AdminResourceBase<any>, entity: Function = Gadget) {
  const definition = getAdminResourceDefinition(resource.constructor)!;
  return buildResourceSchema({
    definition,
    resource,
    metadata: dataSource.getMetadata(entity),
    moduleGroup: 'catalog',
    className: resource.constructor.name,
  });
}

describe('buildResourceSchema', () => {
  test('derives fields, list and form from the entity', () => {
    @AdminResource(Gadget)
    class GadgetAdmin extends AdminResourceBase<Gadget> {}
    const schema = schemaFor(new GadgetAdmin());

    expect(schema).toMatchObject({ name: 'gadget', label: 'Gadget', group: 'catalog', primaryKey: 'id' });
    expect(schema.fields.map((f) => [f.name, f.type, f.readonly])).toEqual([
      ['id', 'number', true],
      ['name', 'string', false],
      ['price', 'decimal', false],
      ['condition', 'enum', false],
      ['specs', 'json', false],
      ['createdAt', 'datetime', true],
    ]);
    expect(schema.fields.find((f) => f.name === 'price')?.scale).toBe(2);
    expect(schema.fields.find((f) => f.name === 'condition')?.enumValues).toEqual(['new', 'used']);
    expect(schema.list).toEqual({
      columns: ['id', 'name', 'price', 'condition', 'createdAt'],
      sortable: ['id', 'name', 'price', 'condition', 'createdAt'],
      defaultSort: { field: 'id', direction: 'desc' },
      pageSize: 25,
      filters: [{ field: 'condition', operators: ['eq', 'ne', 'in', 'nin'] }],
      search: ['name'],
    });
    expect(schema.form).toEqual({
      create: ['name', 'price', 'condition', 'specs'],
      update: ['name', 'price', 'condition', 'specs'],
      requiredOnCreate: ['name', 'price'],
    });
  });

  test('uses DTO properties for the form, including DTO-only fields', () => {
    @AdminResource(Gadget)
    class GadgetAdmin extends AdminResourceBase<Gadget> {
      form = { create: CreateGadgetDto };
    }
    const schema = schemaFor(new GadgetAdmin());
    expect(schema.form).toEqual({
      create: ['name', 'price', 'secret'],
      update: ['name', 'price', 'secret'],
      requiredOnCreate: ['name', 'price'],
    });
    expect(schema.fields.find((f) => f.name === 'secret')).toMatchObject({ type: 'string', persisted: false, nullable: true });
  });

  test('honours resource options and list config', () => {
    @AdminResource(Gadget, { name: 'toys', label: 'Toys', group: 'fun', icon: 'gift' })
    class ToyAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: ['name'], sort: 'name', pageSize: 10 };
    }
    const schema = schemaFor(new ToyAdmin());
    expect(schema).toMatchObject({ name: 'toys', label: 'Toys', group: 'fun', icon: 'gift' });
    expect(schema.list).toMatchObject({ columns: ['name'], defaultSort: { field: 'name', direction: 'asc' }, pageSize: 10 });
  });

  test('rejects unknown list columns', () => {
    @AdminResource(Gadget)
    class BrokenAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: ['nope' as 'name'] };
    }
    expect(() => schemaFor(new BrokenAdmin())).toThrow('BrokenAdmin: list.columns: unknown column "nope" on Gadget');
  });

  test('rejects DTOs that write read-only columns', () => {
    @AdminResource(Gadget)
    class StampedAdmin extends AdminResourceBase<Gadget> {
      form = { create: StampedGadgetDto };
    }
    expect(() => schemaFor(new StampedAdmin())).toThrow('DTO property "createdAt" maps to read-only column Gadget.createdAt');
  });

  test('rejects composite primary keys', () => {
    @AdminResource(Pair)
    class PairAdmin extends AdminResourceBase<Pair> {}
    expect(() => schemaFor(new PairAdmin(), Pair)).toThrow('PairAdmin: entity Pair has 2 primary columns; exactly one is supported');
  });

  test('configuration errors suggest the closest column', () => {
    @AdminResource(Gadget)
    class TypoAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: ['nmae' as 'name'] };
    }
    expect(() => schemaFor(new TypoAdmin())).toThrow('TypoAdmin: list.columns: unknown column "nmae" on Gadget (did you mean "name"?)');

    @AdminResource(Gadget)
    class SortTypoAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { sort: '-prcie' as '-price' };
    }
    expect(() => schemaFor(new SortTypoAdmin())).toThrow('list.sort: cannot sort by "prcie" (did you mean "price"?)');
  });

  test('rejects an empty column list', () => {
    @AdminResource(Gadget)
    class EmptyAdmin extends AdminResourceBase<Gadget> {
      list: ListConfig<Gadget> = { columns: [] };
    }
    expect(() => schemaFor(new EmptyAdmin())).toThrow('EmptyAdmin: list.columns must name at least one column');
  });

  test('uses configured filters and search fields', () => {
    @AdminResource(Tool)
    class ToolAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { filters: ['weight', 'active', 'title'], search: ['title'] };
    }
    const schema = schemaFor(new ToolAdmin(), Tool);
    expect(schema.list.filters).toEqual([
      { field: 'weight', operators: ['eq', 'ne', 'in', 'nin', 'lt', 'lte', 'gt', 'gte', 'between', 'isNull'] },
      { field: 'active', operators: ['eq', 'ne'] },
      { field: 'title', operators: ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith'] },
    ]);
    expect(schema.list.search).toEqual(['title']);
  });

  test('defaults: enum and boolean columns are filters, string columns are searched', () => {
    @AdminResource(Tool)
    class PlainToolAdmin extends AdminResourceBase<Tool> {}
    const schema = schemaFor(new PlainToolAdmin(), Tool);
    expect(schema.list.filters.map((f) => f.field)).toEqual(['active']);
    expect(schema.list.search).toEqual(['title']);
  });

  test('rejects filters and search fields that cannot work', () => {
    @AdminResource(Tool)
    class JsonFilterAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { filters: ['extra'] };
    }
    expect(() => schemaFor(new JsonFilterAdmin(), Tool)).toThrow('list.filters: column "extra" (json) cannot be filtered');

    @AdminResource(Tool)
    class NumberSearchAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { search: ['weight'] };
    }
    expect(() => schemaFor(new NumberSearchAdmin(), Tool)).toThrow('list.search: column "weight" (number) is not a text column');

    @AdminResource(Tool)
    class TypoFilterAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { filters: ['wieght' as 'weight'] };
    }
    expect(() => schemaFor(new TypoFilterAdmin(), Tool)).toThrow('list.filters: unknown column "wieght" on Tool (did you mean "weight"?)');
  });
});
