import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Employee } from '../staff/employee.entity.js';

export const ORDER_STATUSES = ['draft', 'paid', 'shipped', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

@Entity('shop_order')
export class Order {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 40, unique: true }) number: string;
  @Column({ length: 120 }) customer: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) total: string;
  /** Changed only by the admin's actions (Mark paid, Ship, Cancel), never by the form. */
  @Column({ type: 'simple-enum', enum: [...ORDER_STATUSES], default: 'draft' }) status: OrderStatus;
  /** The courier's code, asked for by the Ship action. */
  @Column({ type: 'varchar', length: 40, nullable: true }) tracking: string | null;
  /** Who handles the order (the order page's «Handled by» card links to them). */
  @Column({ type: 'int', nullable: true }) handledById: number | null;
  @ManyToOne(() => Employee, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'handledById' }) handledBy: Employee | null;
  @CreateDateColumn() createdAt: Date;
}
