import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

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
  @CreateDateColumn() createdAt: Date;
}
