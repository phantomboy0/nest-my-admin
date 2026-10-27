import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { Product } from './product.entity.js';

/** One line of a product's specification ("Wattage: 40 W"): edited as a card inside the product's form. */
@Entity('product_spec')
export class ProductSpec {
  @PrimaryGeneratedColumn() id: number;
  @Column() productId: number;
  @ManyToOne(() => Product, (product) => product.specs, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Relation<Product>;
  @Column({ length: 80 }) label: string;
  @Column({ length: 200 }) value: string;
  @Column({ type: 'text', nullable: true }) notes: string | null;
  @Column({ type: 'int', default: 0 }) position: number;
}
