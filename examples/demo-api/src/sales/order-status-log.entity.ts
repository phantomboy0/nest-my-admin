import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { Order } from './order.entity.js';

/** One change of an order's status field (`field`: which one, `value`: what it became, `at`: when): the stepper's times. */
@Entity('shop_order_status_log')
export class OrderStatusLog {
  @PrimaryGeneratedColumn() id: number;
  @Column() orderId: number;
  @ManyToOne(() => Order, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'orderId' }) order: Relation<Order>;
  @Column({ length: 40 }) field: string;
  @Column({ length: 40 }) value: string;
  @CreateDateColumn() at: Date;
}
