import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IsDateString, IsIn, IsOptional, IsString, Length, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Column, CreateDateColumn, DataSource, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, getAdminResourceDefinition } from '../decorators/admin-resource.js';
import { AdminResourceBase, type ListConfig } from '../resource/admin-resource-base.js';
import { ORDER_ENTITIES, Order, OrderAdmin } from '../../test/fixtures/orders.js';
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

@Entity()
class Shift {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column({ type: 'time' }) startsAt: string;
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
  dataSource = await new DataSource({ type: 'sqljs', entities: [Gadget, Pair, Tool, Shift], synchronize: true }).initialize();
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

    expect(schema).toMatchObject({ name: 'gadget', label: 'Gadget', group: 'catalog', primaryKeys: ['id'] });
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
      count: 'exact',
      pagination: 'offset',
      filters: [{ field: 'condition', operators: ['eq', 'ne', 'in', 'nin'] }],
      search: ['name'],
      editable: [],
    });
    expect(schema.form).toMatchObject({
      create: ['name', 'price', 'condition', 'specs'],
      update: ['name', 'price', 'condition', 'specs'],
      requiredOnCreate: ['name', 'price'],
    });
    expect(schema.form.constraints.create).toEqual({
      name: { required: true, maxLength: 60 },
      price: { required: true },
      condition: { oneOf: ['new', 'used'] },
      specs: {},
    });
    expect(schema.form.constraints.update.name).toEqual({ maxLength: 60 });
  });

  test('uses DTO properties for the form, including DTO-only fields', () => {
    @AdminResource(Gadget)
    class GadgetAdmin extends AdminResourceBase<Gadget> {
      form = { create: CreateGadgetDto };
    }
    const schema = schemaFor(new GadgetAdmin());
    expect(schema.form).toMatchObject({
      create: ['name', 'price', 'secret'],
      update: ['name', 'price', 'secret'],
      requiredOnCreate: ['name', 'price'],
    });
    expect(schema.form.constraints.create).toEqual({
      name: { required: true, minLength: 1, maxLength: 60 },
      price: { required: true },
      secret: {},
    });
    expect(schema.form.constraints.update.name).toEqual({ minLength: 1, maxLength: 60 }); // create DTO reused as a partial update
    expect(schema.fields.find((f) => f.name === 'secret')).toMatchObject({ type: 'string', persisted: false, nullable: true });
  });

  test('a dedicated update DTO decides what is required on update', () => {
    class RenameGadgetDto {
      @IsString() @MaxLength(10) name: string;
    }
    @AdminResource(Gadget)
    class RenameAdmin extends AdminResourceBase<Gadget> {
      form = { create: CreateGadgetDto, update: RenameGadgetDto };
    }
    expect(schemaFor(new RenameAdmin()).form.constraints.update).toEqual({ name: { required: true, maxLength: 10 } });
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

  test('composite primary keys: every key is writable on create only, the first is the default sort', () => {
    @AdminResource(Pair)
    class PairAdmin extends AdminResourceBase<Pair> {}
    const schema = schemaFor(new PairAdmin(), Pair);
    expect(schema.primaryKeys).toEqual(['first', 'second']);
    expect(schema.form.create).toEqual(['first', 'second']);
    expect(schema.form.update).toEqual([]);
    expect(schema.list.defaultSort).toEqual({ field: 'first', direction: 'desc' });
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

  test('rejects a name listed twice', () => {
    @AdminResource(Tool)
    class TwiceAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { filters: ['active', 'weight', 'active'] };
    }
    expect(() => schemaFor(new TwiceAdmin(), Tool)).toThrow('TwiceAdmin: list.filters: "active" is listed twice');
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

  test('columns of an unknown type are neither searched by default nor searchable', () => {
    @AdminResource(Shift)
    class ShiftAdmin extends AdminResourceBase<Shift> {}
    const schema = schemaFor(new ShiftAdmin(), Shift);
    expect(schema.fields.find((f) => f.name === 'startsAt')?.type).toBe('other');
    expect(schema.list.search).toEqual(['title']);

    @AdminResource(Shift)
    class ShiftSearchAdmin extends AdminResourceBase<Shift> {
      list: ListConfig<Shift> = { search: ['startsAt'] };
    }
    expect(() => schemaFor(new ShiftSearchAdmin(), Shift)).toThrow('list.search: column "startsAt" (other) is not a text column');
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

  test('a DTO property with a class initializer is not required on create', () => {
    class DefaultedGadgetDto {
      @IsString() name: string;
      @IsIn(['new', 'used']) condition = 'new';
    }
    @AdminResource(Gadget)
    class GadgetAdmin extends AdminResourceBase<Gadget> {
      form = { create: DefaultedGadgetDto };
    }
    const schema = schemaFor(new GadgetAdmin());
    expect(schema.form.requiredOnCreate).toEqual(['name']);
    expect(schema.form.constraints.create.condition.required).toBeUndefined();
  });

  test('a @ValidateIf property gets no client rules, not even entity-derived ones', () => {
    class ConditionalGadgetDto {
      @IsString() @Length(1, 60) price: string;
      @ValidateIf((o: { price?: string }) => o.price === 'x') @MinLength(5) name: string;
    }
    @AdminResource(Gadget)
    class GadgetAdmin extends AdminResourceBase<Gadget> {
      form = { create: ConditionalGadgetDto };
    }
    const schema = schemaFor(new GadgetAdmin());
    expect(schema.form.constraints.create.name).toEqual({});
    expect(schema.form.requiredOnCreate).not.toContain('name');
  });
});

describe('buildResourceSchema with relations', () => {
  let orders: DataSource;
  beforeAll(async () => {
    orders = await new DataSource({ type: 'sqljs', entities: ORDER_ENTITIES }).initialize();
  });
  afterAll(async () => {
    await orders.destroy();
  });
  const orderSchema = (resource: AdminResourceBase<any>) =>
    buildResourceSchema({
      definition: getAdminResourceDefinition(resource.constructor)!,
      resource,
      metadata: orders.getMetadata(Order),
      moduleGroup: 'sales',
      className: resource.constructor.name,
    });

  test('defaults: to-one relations are columns and writable, many-to-many is writable but not a column', () => {
    @AdminResource(Order)
    class PlainOrderAdmin extends AdminResourceBase<Order> {}
    const schema = orderSchema(new PlainOrderAdmin());
    expect(schema.fields.map((f) => [f.name, f.type])).toEqual([
      ['id', 'number'],
      ['number', 'string'],
      ['sellerId', 'relation'],
      ['customer', 'relation'],
      ['tags', 'relation'],
    ]);
    expect(schema.list.columns).toEqual(['id', 'number', 'sellerId', 'customer']);
    expect(schema.list.sortable).toEqual(['id', 'number']);
    expect(schema.form.create).toEqual(['number', 'sellerId', 'customer', 'tags']);
    expect(schema.form.requiredOnCreate).toEqual(['number', 'customer']);
  });

  test('dotted paths become read-only fields, sortable and filterable by their column type', () => {
    const schema = orderSchema(new OrderAdmin());
    expect(schema.fields.filter((f) => f.name.includes('.')).map((f) => [f.name, f.label, f.type, f.readonly])).toEqual([
      ['customer.name', 'Customer name', 'string', true],
      ['customer.company.name', 'Customer company name', 'string', true],
      ['customer.active', 'Customer active', 'boolean', true],
    ]);
    expect(schema.list.sortable).toEqual(['id', 'number', 'customer.name', 'customer.company.name', 'customer.active']);
    expect(schema.list.filters).toEqual([
      { field: 'customer', operators: ['eq', 'ne', 'in', 'nin'] },
      { field: 'sellerId', operators: ['eq', 'ne', 'in', 'nin', 'isNull'] },
      { field: 'tags', operators: ['in'] },
      { field: 'customer.name', operators: ['eq', 'ne', 'in', 'nin', 'contains', 'startsWith'] },
      { field: 'customer.active', operators: ['eq', 'ne'] },
    ]);
    expect(schema.list.search).toEqual(['number', 'customer.name']);
    expect(schema.form.create).not.toContain('customer.name');
  });

  test('sorts by a path', () => {
    @AdminResource(Order)
    class ByCustomerAdmin extends AdminResourceBase<Order> {
      list: ListConfig<Order> = { sort: '-customer.company.name' };
    }
    expect(orderSchema(new ByCustomerAdmin()).list.defaultSort).toEqual({ field: 'customer.company.name', direction: 'desc' });
  });

  test('unknown or unusable paths fail at boot with a suggestion', () => {
    @AdminResource(Order)
    class TypoAdmin extends AdminResourceBase<Order> {
      list: ListConfig<Order> = { columns: ['customer.nam' as 'number'] };
    }
    expect(() => orderSchema(new TypoAdmin())).toThrow('TypoAdmin: list.columns: unknown path "customer.nam" on Order (did you mean "customer.name"?)');

    @AdminResource(Order)
    class ManyAdmin extends AdminResourceBase<Order> {
      list: ListConfig<Order> = { filters: ['tags.label' as 'tags'] }; // also a compile error: arrays have no paths
    }
    expect(() => orderSchema(new ManyAdmin())).toThrow('list.filters: cannot use "tags.label" on Order: "tags" is not a many-to-one or owning one-to-one relation');

    @AdminResource(Order)
    class SearchAdmin extends AdminResourceBase<Order> {
      list: ListConfig<Order> = { search: ['customer.active'] };
    }
    expect(() => orderSchema(new SearchAdmin())).toThrow('list.search: column "customer.active" (boolean) is not a text column');

    @AdminResource(Order)
    class SortRelationAdmin extends AdminResourceBase<Order> {
      list: ListConfig<Order> = { sort: 'customer' };
    }
    expect(() => orderSchema(new SortRelationAdmin())).toThrow('list.sort: cannot sort by "customer"');

    @AdminResource(Order)
    class RelationNameAdmin extends AdminResourceBase<Order> {
      list: ListConfig<Order> = { columns: ['seller'] };
    }
    expect(() => orderSchema(new RelationNameAdmin())).toThrow('list.columns: "seller" is the relation; its field is "sellerId" (paths use "seller.<column>")');
  });

  test('field names starting with "_" are reserved', () => {
    class ReservedDto {
      @IsString() _title: string;
    }
    @AdminResource(Order)
    class ReservedAdmin extends AdminResourceBase<Order> {
      form = { create: ReservedDto };
    }
    expect(() => orderSchema(new ReservedAdmin())).toThrow('DTO property "_title": names starting with "_" are reserved for the admin');
  });
});

describe('list.editable', () => {
  test('fields from the update form, of inline-editable types', () => {
    @AdminResource(Tool)
    class EditableAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { editable: ['weight', 'active', 'title'] };
    }
    expect(schemaFor(new EditableAdmin(), Tool).list.editable).toEqual(['weight', 'active', 'title']);
  });

  test('fields outside the update form, or of other types, fail at boot', () => {
    class RenameToolDto {
      @IsString() title: string;
    }
    @AdminResource(Tool)
    class OutsideAdmin extends AdminResourceBase<Tool> {
      form = { create: RenameToolDto };
      list: ListConfig<Tool> = { editable: ['weight'] };
    }
    expect(() => schemaFor(new OutsideAdmin(), Tool)).toThrow('OutsideAdmin: list.editable: "weight" is not in the update form');

    @AdminResource(Tool)
    class JsonAdmin extends AdminResourceBase<Tool> {
      list: ListConfig<Tool> = { editable: ['extra'] };
    }
    expect(() => schemaFor(new JsonAdmin(), Tool)).toThrow('list.editable: "extra" (json) cannot be edited in a cell');
  });
});
