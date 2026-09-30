import { Module } from '@nestjs/common';
import type { SelectQueryBuilder } from 'typeorm';
import { Column, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AdminResource, AdminResourceBase, type AdminContext, type ListConfig } from '../../src/index.js';

/** Has no admin resource: relations to it are shown (titled by `name`) but not linked. */
@Entity()
export class Company {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
}

@Entity()
export class Customer {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 80 }) name: string;
  @Column({ default: true }) active: boolean;
  @ManyToOne(() => Company, { nullable: true, onDelete: 'RESTRICT' }) company: Company | null;
}

@Entity()
export class Tag {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 40 }) label: string;
}

/**
 * `customer` is a relation without its own column (field `customer`); `seller` has the explicit column
 * `sellerId` (field `sellerId`, labelled "Seller"); `tags` is an owning many-to-many to a uuid key.
 */
@Entity('shop_order')
export class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 20 }) number: string;
  @ManyToOne(() => Customer, { nullable: false, onDelete: 'RESTRICT' }) customer: Customer;
  @Column({ type: 'int', nullable: true }) sellerId: number | null;
  @ManyToOne(() => Customer, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'sellerId' }) seller: Customer | null;
  @ManyToMany(() => Tag) @JoinTable() tags: Tag[];
}

@AdminResource(Customer)
export class CustomerAdmin extends AdminResourceBase<Customer> {
  list: ListConfig<Customer> = { columns: ['id', 'name', 'active', 'company'], search: ['name'] };
}

@AdminResource(Tag, { title: 'label' })
export class TagAdmin extends AdminResourceBase<Tag> {
  list: ListConfig<Tag> = { search: ['label'] };
}

@AdminResource(Order, { title: (order: Order) => `Order ${order.number}` })
export class OrderAdmin extends AdminResourceBase<Order> {
  list: ListConfig<Order> = {
    columns: ['number', 'customer', 'customer.name', 'customer.company.name', 'sellerId', 'tags'],
    filters: ['customer', 'sellerId', 'tags', 'customer.name', 'customer.active'],
    search: ['number', 'customer.name'],
    sort: 'number',
    pageSize: 3,
  };

  /** Only active customers can be picked as the customer (the seller may be anyone). */
  relationOptions(field: string, qb: SelectQueryBuilder<any>, ctx: AdminContext): SelectQueryBuilder<any> {
    return field === 'customer' ? qb.andWhere('option.active = :active', { active: true }) : super.relationOptions(field, qb, ctx);
  }
}

@Module({ providers: [CustomerAdmin, TagAdmin, OrderAdmin] })
export class OrdersModule {}

export const ORDER_ENTITIES = [Company, Customer, Tag, Order];
