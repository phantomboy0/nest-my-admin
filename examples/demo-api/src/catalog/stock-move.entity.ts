import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Product } from './product.entity.js';

/** An append-only log: it grows without bound, so the admin pages it with a cursor and does not count it. */
@Entity()
export class StockMove {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'int' }) productId: number;
  @ManyToOne(() => Product, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Product;
  @Column({ type: 'int' }) delta: number;
  @Column({ length: 60 }) reason: string;
}
