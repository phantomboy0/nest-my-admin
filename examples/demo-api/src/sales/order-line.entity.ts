import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Product } from '../catalog/product.entity.js';
import { Order } from './order.entity.js';

/** One line of an order: edited inside the order's form (an inline), in the order of `position`. */
@Entity('shop_order_line')
export class OrderLine {
  @PrimaryGeneratedColumn() id: number;
  @Column() orderId: number;
  @ManyToOne(() => Order, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'orderId' }) order: Order;
  @Column({ type: 'int', nullable: true }) productId: number | null;
  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'productId' }) product: Product | null;
  @Column({ length: 120 }) description: string;
  @Column({ type: 'int', default: 1 }) quantity: number;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) unitPrice: string;
  @Column({ type: 'int', default: 0 }) position: number;
}
