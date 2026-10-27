import { Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, JoinTable, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn, VersionColumn } from 'typeorm';
import { ProductMedia } from './product-media.entity.js';
import { ProductSpec } from './product-spec.entity.js';
import { Category } from './category.entity.js';
import { Tag } from './tag.entity.js';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

@Entity()
export class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) name: string;
  /** Filled from the name by the slug widget until someone edits it. */
  @Column({ length: 140, default: '' }) slug: string;
  @Column({ length: 40, unique: true }) sku: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) price: string;
  /** The price before a sale, shown struck through next to `price`. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true }) compareAtPrice: string | null;
  /** What the shop pays; restricted: only superusers and roles granting product.field.cost see it. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: '0.00' }) cost: string;
  @Column({ type: 'int', default: 0 }) stock: number;
  @Column({ type: 'simple-enum', enum: [...PRODUCT_STATUSES], default: 'draft' }) status: ProductStatus;
  @Column({ type: 'date', nullable: true }) releasedOn: string | null;
  /** The admin field is `categoryId` (the id column), labelled "Category"; paths use `category.name`. */
  @Column({ type: 'int', nullable: true }) categoryId: number | null;
  @ManyToOne(() => Category, { nullable: true, onDelete: 'RESTRICT' }) @JoinColumn({ name: 'categoryId' }) category: Category | null;
  @ManyToMany(() => Tag) @JoinTable() tags: Tag[];
  /** Storage keys of uploaded files (the admin's image widget): the main picture, and more pictures in order. */
  @Column({ type: 'varchar', length: 500, nullable: true }) image: string | null;
  @Column({ type: 'simple-json', nullable: true }) gallery: string[] | null;
  @OneToMany(() => ProductMedia, (media) => media.product) media: ProductMedia[];
  @OneToMany(() => ProductSpec, (spec) => spec.product) specs: ProductSpec[];
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  /** Two people editing one product: the second save gets a conflict dialog instead of overwriting. */
  @VersionColumn() version: number;
  /** Deleting moves a product to the trash. */
  @DeleteDateColumn() deletedAt: Date | null;
}
