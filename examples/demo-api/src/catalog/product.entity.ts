import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

@Entity()
export class Product {
  @PrimaryGeneratedColumn() id: number;
  @Column({ length: 120 }) name: string;
  @Column({ length: 40, unique: true }) sku: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) price: string;
  @Column({ type: 'int', default: 0 }) stock: number;
  @Column({ type: 'simple-enum', enum: [...PRODUCT_STATUSES], default: 'draft' }) status: ProductStatus;
  @Column({ type: 'date', nullable: true }) releasedOn: string | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
