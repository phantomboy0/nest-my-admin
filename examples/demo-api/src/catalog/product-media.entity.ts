import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, type Relation } from 'typeorm';
import { Product } from './product.entity.js';

/** A picture of a product, in order: the first one is the product's thumbnail in the list (a computed column). */
@Entity('product_media')
export class ProductMedia {
  @PrimaryGeneratedColumn() id: number;
  @Column() productId: number;
  @ManyToOne(() => Product, (product) => product.media, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'productId' }) product: Relation<Product>;
  /** Storage key of the uploaded picture (the admin's image widget). */
  @Column({ type: 'varchar', length: 500, nullable: true }) image: string | null;
  @Column({ length: 120, default: '' }) caption: string;
  @Column({ type: 'int', default: 0 }) sort: number;
}
