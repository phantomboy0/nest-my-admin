import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { OrderLine } from './order-line.entity.js';
import { Employee } from '../staff/employee.entity.js';

export const ORDER_STATUSES = ['draft', 'paid', 'shipped', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** Where the parcel is: the order page's stepper (`cancelled` is not a step). */
export const FULFILLMENT_STEPS = ['queued', 'confirmed', 'preparing', 'ready', 'posted', 'delivered', 'cancelled'] as const;

@Entity('shop_order')
export class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40, unique: true }) number: string;
  @Column({ length: 120 }) customer: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) total: string;
  /** Changed only by the admin's actions (Mark paid, Ship, Cancel), never by the form. */
  @Column({ type: 'simple-enum', enum: [...ORDER_STATUSES], default: 'draft' }) status: OrderStatus;
  @Column({ type: 'simple-enum', enum: [...FULFILLMENT_STEPS], default: 'queued' }) fulfillment: (typeof FULFILLMENT_STEPS)[number];
  /** The courier's code, asked for by the Ship action. */
  @Column({ type: 'varchar', length: 40, nullable: true }) tracking: string | null;
  /** Who handles the order (the order page's «Handled by» card links to them). */
  @Column({ type: 'int', nullable: true }) handledById: number | null;
  @ManyToOne(() => Employee, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'handledById' }) handledBy: Employee | null;
  @OneToMany(() => OrderLine, (line) => line.order) lines: OrderLine[];
  @CreateDateColumn() createdAt: Date;
}
